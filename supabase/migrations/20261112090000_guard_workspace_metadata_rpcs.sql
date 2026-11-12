-- Prepared only: applying this production security change requires owner approval.
-- Limit calculators are internal helpers of SECURITY DEFINER enforcement/seat
-- triggers, including invitation acceptance before membership exists. Do not
-- add membership guards to those calculators: remove their direct client RPC
-- grants instead. Their owner and service_role retain access.
begin;

revoke execute on function public.xbar_subscription_limits(uuid) from public, anon, authenticated;
revoke execute on function public.xbar_commercial_limits(uuid) from public, anon, authenticated;
grant execute on function public.xbar_subscription_limits(uuid) to service_role;
grant execute on function public.xbar_commercial_limits(uuid) to service_role;

-- This RPC is used directly by cloudWorkspace.ts, so members still need it.
-- SECURITY DEFINER bypasses table RLS: validate the requesting identity first.
create or replace function public.xbar_workspace_storage_bytes(p_workspace_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not coalesce(public.xbar_has_workspace_access(p_workspace_id), false) then
    raise exception 'Workspace access required.' using errcode = '42501';
  end if;
  return
    coalesce((select sum(size_bytes) from public.documents where workspace_id = p_workspace_id), 0)
    + coalesce((select sum(size_bytes) from public.sale_packets where workspace_id = p_workspace_id), 0);
end;
$$;
revoke execute on function public.xbar_workspace_storage_bytes(uuid) from public, anon;
grant execute on function public.xbar_workspace_storage_bytes(uuid) to authenticated, service_role;

commit;
