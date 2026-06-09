import { sendJson } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';
import { sendEmail, isEmailConfigured } from '../_lib/email.js';

// Daily background job (Vercel cron, see vercel.json). For each reminder due
// within the next 7 days that hasn't been notified: email the workspace's
// operations contact (falling back to the workspace owner), write an in-app
// notification, then mark notification_sent so it never double-fires.

const LOOKAHEAD_DAYS = 7;
const BATCH_LIMIT = 200;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!cronSecret || provided !== cronSecret) {
    return sendJson(res, 401, { ok: false, message: 'Invalid or missing cron secret.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'Supabase admin credentials are not configured.' });
  }

  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('workspace_id, reminder_id, horse_id, type, due_date')
    .eq('notification_sent', false)
    .lte('due_date', horizon)
    .order('due_date', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return sendJson(res, 500, { ok: false, message: error.message });
  }

  let sent = 0;
  let inAppOnly = 0;
  const failures = [];
  const recipientCache = new Map();

  for (const reminder of reminders || []) {
    try {
      const recipient = await resolveRecipient(supabase, reminder.workspace_id, recipientCache);
      const { data: horse } = await supabase
        .from('horses')
        .select('name')
        .eq('workspace_id', reminder.workspace_id)
        .eq('horse_id', reminder.horse_id)
        .maybeSingle();

      const horseName = horse?.name || 'a horse';
      const title = `${formatReminderType(reminder.type)} due ${reminder.due_date}`;
      const bodyText = `${formatReminderType(reminder.type)} for ${horseName} is due on ${reminder.due_date}. Open XBAR to review the record and schedule the appointment.`;

      let channel = 'in-app';
      if (isEmailConfigured() && recipient.email) {
        const result = await sendEmail({
          to: recipient.email,
          subject: `XBAR reminder: ${title} for ${horseName}`,
          text: bodyText,
          html: `<p>${bodyText}</p>`,
        });
        if (result.ok) {
          channel = 'email';
          sent += 1;
        } else if (!result.skipped) {
          failures.push({ reminderId: reminder.reminder_id, message: result.message });
          continue; // Leave notification_sent=false so the next run retries.
        }
      }
      if (channel === 'in-app') {
        inAppOnly += 1;
      }

      await supabase.from('notifications').insert({
        workspace_id: reminder.workspace_id,
        user_id: recipient.userId,
        reminder_id: reminder.reminder_id,
        title,
        body: bodyText,
        channel,
      });

      await supabase
        .from('reminders')
        .update({ notification_sent: true, updated_at: new Date().toISOString() })
        .eq('workspace_id', reminder.workspace_id)
        .eq('reminder_id', reminder.reminder_id);
    } catch (jobError) {
      failures.push({ reminderId: reminder.reminder_id, message: jobError.message });
    }
  }

  return sendJson(res, 200, {
    ok: true,
    processed: (reminders || []).length,
    emailed: sent,
    inAppOnly,
    failures,
  });
}

async function resolveRecipient(supabase, workspaceId, cache) {
  if (cache.has(workspaceId)) {
    return cache.get(workspaceId);
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('owner_user_id')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: profile } = await supabase
    .from('workspace_profiles')
    .select('operations_email')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  let email = profile?.operations_email || '';
  const userId = workspace?.owner_user_id || null;
  if (!email && userId) {
    const { data: owner } = await supabase.auth.admin.getUserById(userId);
    email = owner?.user?.email || '';
  }

  const recipient = { email, userId };
  cache.set(workspaceId, recipient);
  return recipient;
}

function formatReminderType(type) {
  const labels = {
    coggins: 'Coggins test',
    vaccination: 'Vaccination',
    deworming: 'Deworming',
    farrier: 'Farrier visit',
    health_cert: 'Health certificate renewal',
  };
  return labels[type] || `${type} reminder`;
}
