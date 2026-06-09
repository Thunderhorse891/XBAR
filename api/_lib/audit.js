// Best-effort audit trail. Failures are swallowed so an audit outage never
// blocks the user-facing operation.
export async function recordAuditEvent(supabase, { workspaceId, actorUserId, action, entityType = '', entityId = '', metadata = {} }) {
  try {
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      actor_user_id: actorUserId || null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  } catch {
    // Intentionally ignored.
  }
}
