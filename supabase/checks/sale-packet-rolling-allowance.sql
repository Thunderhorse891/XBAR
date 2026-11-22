-- Synthetic, disposable PostgreSQL only, never an XBAR deployment. The
-- production migration is exercised against the relevant column/key shape and
-- representative current entitlements. Authorization policies are unchanged.
\set ON_ERROR_STOP on
do $$
begin
  if current_database() <> 'xbar_sale_packet_allowance_fixture'
     or to_regclass('public.sale_packets') is not null then
    raise exception 'Use a new disposable xbar_sale_packet_allowance_fixture database.';
  end if;
end;
$$;

create table public.sale_packets (
  workspace_id uuid not null,
  packet_id text not null,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, packet_id)
);
create table public.quota_fixture_limits (workspace_id uuid primary key, sale_packet_limit integer not null);
create function public.xbar_commercial_limits(uuid) returns table (sale_packet_limit integer)
language sql as $$
  select coalesce((select l.sale_packet_limit from public.quota_fixture_limits as l where l.workspace_id = $1), 2);
$$;

-- Retained history is seeded BEFORE the candidate attaches its trigger.
insert into public.sale_packets (workspace_id, packet_id, created_at)
select '10000000-0000-0000-0000-000000000001', 'historic-' || n, now() - interval '45 days'
from generate_series(1, 30) n;
insert into public.sale_packets (workspace_id, packet_id, created_at) values
  ('10000000-0000-0000-0000-000000000002', 'recent', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000002', 'inside-boundary', now() - interval '719 hours 59 minutes 50 seconds'),
  ('10000000-0000-0000-0000-000000000003', 'outside-boundary', now() - interval '720 hours 10 seconds');

\ir ../migrations/20261122135000_sale_packet_rolling_allowance.sql

do $$
declare
  historical uuid := '10000000-0000-0000-0000-000000000001';
  full_workspace uuid := '10000000-0000-0000-0000-000000000002';
  outside_workspace uuid := '10000000-0000-0000-0000-000000000003';
  details text;
  creation_time timestamptz;
begin
  -- 30 historical rows may be kept and the 31st lifetime packet can be issued.
  insert into public.sale_packets (workspace_id, packet_id, created_at)
    values (historical, 'new-1', now() - interval '90 days') returning created_at into creation_time;
  if creation_time < now() - interval '1 minute'
     or (select count(*) from public.sale_packets where workspace_id = historical) <> 31 then
    raise exception 'historical rows blocked creation, changed, or the issuance clock was not applied';
  end if;
  insert into public.sale_packets (workspace_id, packet_id) values (historical, 'new-2');

  -- A same-ID retried upsert and metadata update may succeed over the limit,
  -- without changing the original clock or creating a third row.
  insert into public.sale_packets (workspace_id, packet_id, created_at, payload)
    values (historical, 'new-1', now() + interval '90 days', '{"retry":true}')
    on conflict (workspace_id, packet_id) do update
      set created_at = excluded.created_at, payload = excluded.payload;
  update public.sale_packets set payload = '{"updated":true}'
    where workspace_id = historical and packet_id = 'historic-1';
  if (select created_at from public.sale_packets where workspace_id = historical and packet_id = 'new-1')
      is distinct from creation_time
     or (select count(*) from public.sale_packets where workspace_id = historical) <> 32 then
    raise exception 'same-packet update moved the metering clock or created another row';
  end if;

  begin
    update public.sale_packets set created_at = now() - interval '30 days'
      where workspace_id = historical and packet_id = 'new-1';
    raise exception 'mutable metering clock';
  exception when check_violation then null;
  end;

  begin
    insert into public.sale_packets (workspace_id, packet_id) values (full_workspace, 'refused');
    raise exception 'in-window rows did not enforce their cap';
  exception when raise_exception then
    get stacked diagnostics details = pg_exception_detail;
    if details is distinct from 'xbar_sale_packet_allowance_reached' then raise; end if;
  end;

  insert into public.sale_packets (workspace_id, packet_id) values
    (outside_workspace, 'new-1'), (outside_workspace, 'new-2');
  begin
    insert into public.sale_packets (workspace_id, packet_id) values (outside_workspace, 'new-3');
    raise exception 'new rows did not enforce their cap';
  exception when raise_exception then
    get stacked diagnostics details = pg_exception_detail;
    if details is distinct from 'xbar_sale_packet_allowance_reached' then raise; end if;
  end;

  insert into public.quota_fixture_limits values (full_workspace, 3);
  insert into public.sale_packets (workspace_id, packet_id) values (full_workspace, 'after-upgrade');
  update public.quota_fixture_limits set sale_packet_limit = 1 where workspace_id = full_workspace;
  update public.sale_packets set payload = '{"retained":true}'
    where workspace_id = full_workspace and packet_id = 'after-upgrade';
  begin
    insert into public.sale_packets (workspace_id, packet_id) values (full_workspace, 'after-downgrade');
    raise exception 'the new limit after a downgrade was not enforced';
  exception when raise_exception then
    get stacked diagnostics details = pg_exception_detail;
    if details is distinct from 'xbar_sale_packet_allowance_reached' then raise; end if;
  end;
end;
$$;
select 'sale packet rolling allowance behaviors verified' as result;
