-- This internal predicate is called through the security-definer capacity
-- helpers. Supabase's default privileges otherwise expose new functions to
-- PUBLIC/anon/authenticated even when no explicit grant appears in the file.
begin;
revoke all on function public.xbar_trial_active(jsonb) from public, anon, authenticated;
grant execute on function public.xbar_trial_active(jsonb) to service_role;
commit;
