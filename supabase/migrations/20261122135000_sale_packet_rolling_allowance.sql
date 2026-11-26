-- F6: match the existing 30 x 24 hour commercial allowance in the UI and API.
-- No historical rows, plan limits, policies, or other table triggers change.
begin;

create index if not exists idx_sale_packets_workspace_created_at
  on public.sale_packets (workspace_id, created_at);

create or replace function public.xbar_enforce_sale_packet_rolling_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_created_at timestamptz;
  issued_at timestamptz;
  allowance integer;
  used bigint;
begin
  -- Updating metadata must not consume a slot or strand an existing packet
  -- after a downgrade. Neither its workspace/ID nor the metering clock may move.
  if TG_OP = 'UPDATE' then
    if (new.workspace_id, new.packet_id, new.created_at)
      is distinct from (old.workspace_id, old.packet_id, old.created_at) then
      raise exception 'Sale packet identity and creation time cannot change.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Reuse the exact key taken by the storage gate and subscription event
  -- writers. This avoids a lock-order dependency and resolves the effective
  -- limit only after preceding quota writes and billing events settle.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.workspace_id::text, 0));

  -- The trigger's fresh statements observe the preceding commit at READ
  -- COMMITTED (PostgREST default); SERIALIZABLE detects predicate conflicts.
  -- REPEATABLE READ alone could retain a stale count after the lock wait.
  if pg_catalog.current_setting('transaction_isolation') = 'repeatable read' then
    raise exception 'Retry sale packet creation in a read committed transaction.' using errcode = '40001';
  end if;

  select packet.created_at into existing_created_at
    from public.sale_packets as packet
    where packet.workspace_id = new.workspace_id and packet.packet_id = new.packet_id
    for key share;
  if found then
    -- BEFORE INSERT also runs for ON CONFLICT DO UPDATE. Preserve the original
    -- timestamp when a transport retries the same existing packet identity.
    new.created_at := existing_created_at;
    return new;
  end if;

  issued_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select limits.sale_packet_limit into strict allowance
    from public.xbar_commercial_limits(new.workspace_id) as limits;
  select count(*) into used
    from public.sale_packets as packet
    where packet.workspace_id = new.workspace_id
      and packet.created_at >= issued_at - interval '720 hours';
  if used >= allowance then
    raise exception 'Sale packet limit reached for this workspace.'
      using errcode = 'P0001', detail = 'xbar_sale_packet_allowance_reached';
  end if;

  -- Do not let caller timestamps move new work outside the metered window.
  new.created_at := issued_at;
  return new;
end;
$$;

revoke all on function public.xbar_enforce_sale_packet_rolling_allowance() from public;
drop trigger if exists trg_sale_packets_enforce_commercial_limits on public.sale_packets;
create trigger trg_sale_packets_enforce_commercial_limits
  before insert or update on public.sale_packets
  for each row execute function public.xbar_enforce_sale_packet_rolling_allowance();

commit;
