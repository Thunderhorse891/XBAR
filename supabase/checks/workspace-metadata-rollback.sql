-- Recovery rehearsal only. This restores the previous vulnerable metadata surface.
-- Requires a separate deliberate operator decision; never run automatically.
-- Saved from live catalog, read-only, November 20 2026. Owner postgres; PUBLIC/anon absent.
begin;

CREATE OR REPLACE FUNCTION public.xbar_commercial_limits(p_workspace_id uuid)
 RETURNS TABLE(horse_limit integer, document_limit integer, sale_packet_limit integer, buyer_deal_room_enabled boolean, ranch_ops_enabled boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with subscription_row as (
    select case
      when billing_state in ('Active', 'Manual Billing') then tier
      when public.xbar_trial_active(payload) then 'Professional'
      else 'Starter'
    end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 200 when 'Professional' then 30 else 5 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 else 250 end,
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 250 when 'Professional' then 30 else 2 end,
    effective_tier in ('Professional', 'Ranch Ops', 'Enterprise'),
    effective_tier in ('Ranch Ops', 'Enterprise')
  from subscription_row
  union all select 5, 250, 2, false, false where not exists (select 1 from subscription_row)
  limit 1
$function$;

revoke execute on function public.xbar_commercial_limits(uuid) from public, anon;
grant execute on function public.xbar_commercial_limits(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.xbar_subscription_limits(p_workspace_id uuid)
 RETURNS TABLE(seat_limit integer, shared_access_seat_limit integer, document_limit integer, storage_limit_gb integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with subscription_row as (
    select case
      when billing_state in ('Active', 'Manual Billing') then tier
      when public.xbar_trial_active(payload) then 'Professional'
      else 'Starter'
    end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 60 when 'Ranch Ops' then 20 when 'Professional' then 5 else 1 end,
    case effective_tier when 'Enterprise' then 200 when 'Ranch Ops' then 40 when 'Professional' then 10 else 0 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 else 250 end,
    case effective_tier when 'Enterprise' then 2500 when 'Ranch Ops' then 500 when 'Professional' then 100 else 25 end
  from subscription_row
  union all select 1, 0, 250, 25 where not exists (select 1 from subscription_row)
  limit 1
$function$;

revoke execute on function public.xbar_subscription_limits(uuid) from public, anon;
grant execute on function public.xbar_subscription_limits(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.xbar_workspace_storage_bytes(p_workspace_id uuid)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((
      select sum(size_bytes) from public.documents
      where workspace_id = p_workspace_id
    ), 0)
    + coalesce((
      select sum(size_bytes) from public.sale_packets
      where workspace_id = p_workspace_id
    ), 0)
$function$;

revoke execute on function public.xbar_workspace_storage_bytes(uuid) from public, anon;
grant execute on function public.xbar_workspace_storage_bytes(uuid) to authenticated, service_role;

commit;

