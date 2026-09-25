// Unlike ordinary activity logging, deletion requires acknowledged durability.
// IDs only: never record email addresses, request bodies, tokens or file content.
export async function recordDeletionAudit(supabase, event) {
  const { data, error } = await supabase.from('account_deletion_events').insert(event).select('id').single();
  if (error || !data?.id) throw new Error('deletion_audit_unavailable');
}
