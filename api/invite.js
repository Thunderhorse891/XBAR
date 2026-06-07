import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin, requireWorkspaceAccess } from './_lib/supabase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { ok: false, message: err.message });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role : 'Viewer';
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const invitationId = typeof body.invitationId === 'string' ? body.invitationId : '';

  if (!email || !workspaceId) {
    return sendJson(res, 400, { ok: false, message: 'Email and workspace id are required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }

  const supabase = getSupabaseAdmin();
  const redirectTo = `${process.env.VITE_PUBLIC_APP_URL || ''}/login?invite=${encodeURIComponent(invitationId)}&workspace=${encodeURIComponent(workspaceId)}`;

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      workspace_id: workspaceId,
      invitation_id: invitationId,
      invited_role: role,
    },
  });

  if (error) {
    return sendJson(res, 400, { ok: false, message: error.message });
  }

  return sendJson(res, 200, { ok: true, message: `Invite sent to ${email}.`, userId: data.user?.id });
}
