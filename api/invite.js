import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin, requireWorkspaceAccess } from './_lib/supabase-admin.js';
import { inviteSchema, parseBody } from './_lib/validation.js';

// The invited role is validated by inviteSchema; anything unrecognized is
// coerced to the least privileged option so a caller cannot inject arbitrary
// role metadata.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const body = await readJsonBody(req);
  const parsed = parseBody(inviteSchema, body);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, message: parsed.message });
  }
  const { email, role, workspaceId, invitationId } = parsed.data;

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }

  // Sending an invite provisions Supabase auth access and assigns a role, so it
  // is an admin-only action — consistent with managed billing.
  if (access.role !== 'Admin') {
    return sendJson(res, 403, { ok: false, message: 'Only workspace admins can invite members.' });
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
