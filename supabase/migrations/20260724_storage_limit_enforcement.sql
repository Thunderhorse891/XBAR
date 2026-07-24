-- Server-authoritative storage-limit enforcement.
--
-- Every subscription tier sells a storage cap (Starter 25 / Professional 100 /
-- Ranch Ops 500 / Enterprise 2500 GB), but nothing measured or enforced it: the
-- figure shown in-app was a client-side estimate, so any tier could store
-- unbounded data. This makes the paid limit real and server-authoritative for
-- the primary storage consumers — uploaded documents and generated sale packets
-- — at both the API layer and the database, mirroring the existing horse /
-- document / sale-packet gates in 20260611_commercial_entitlements.sql.
--
-- Byte accounting uses binary gigabytes (1 GB = 1024^3 bytes) to match the
-- client's estimateStorageGb (src/lib/xbarRuntime.ts), so the enforced cap and
-- the displayed usage never disagree.

-- 1. Track the byte size of every stored artifact. Existing rows default to 0
--    and are re-counted as they are next written; new rows carry a real size.
alter table public.documents add column if not exists size_bytes bigint not null default 0;
alter table public.sale_packets add column if not exists size_bytes bigint not null default 0;

-- 2. Authoritative per-workspace storage usage in bytes: live (non-archived)
--    documents plus all generated sale packets. security definer so the API's
--    service-role client and workspace members resolve the same number.
create or replace function public.xbar_workspace_storage_bytes(p_workspace_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(size_bytes) from public.documents
      where workspace_id = p_workspace_id and state <> 'Archived'
    ), 0)
    + coalesce((
      select sum(size_bytes) from public.sale_packets
      where workspace_id = p_workspace_id
    ), 0)
$$;

grant execute on function public.xbar_workspace_storage_bytes(uuid) to authenticated;

-- 3. Enforce the cap at the database as defense-in-depth behind the API check.
--    Kept as a dedicated function rather than folded into
--    xbar_enforce_commercial_resource_limits because this gate is an aggregate
--    SUM (not the COUNT-based gates) and to avoid editing that load-bearing
--    function. The GB cap comes from the existing xbar_subscription_limits, so
--    tiers stay defined in exactly one place.
create or replace function public.xbar_enforce_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_gb integer;
  used_bytes bigint;
begin
  -- Archived documents are excluded from usage, so they can never breach the cap.
  if TG_TABLE_NAME = 'documents' and new.state = 'Archived' then
    return new;
  end if;

  select storage_limit_gb into limit_gb from public.xbar_subscription_limits(new.workspace_id);

  -- Sum every OTHER stored artifact for the workspace (exclude the current row
  -- by id so this works identically for INSERT and UPDATE), then add the
  -- incoming row's size.
  if TG_TABLE_NAME = 'documents' then
    used_bytes :=
      coalesce((
        select sum(size_bytes) from public.documents
        where workspace_id = new.workspace_id and document_id <> new.document_id and state <> 'Archived'
      ), 0)
      + coalesce((
        select sum(size_bytes) from public.sale_packets where workspace_id = new.workspace_id
      ), 0);
  else -- sale_packets
    used_bytes :=
      coalesce((
        select sum(size_bytes) from public.sale_packets
        where workspace_id = new.workspace_id and packet_id <> new.packet_id
      ), 0)
      + coalesce((
        select sum(size_bytes) from public.documents
        where workspace_id = new.workspace_id and state <> 'Archived'
      ), 0);
  end if;

  if used_bytes + new.size_bytes > limit_gb::bigint * 1073741824 then
    raise exception 'Storage limit reached for this workspace.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_documents_enforce_storage on public.documents;
create trigger trg_documents_enforce_storage
  before insert or update on public.documents
  for each row execute function public.xbar_enforce_storage_limit();

drop trigger if exists trg_sale_packets_enforce_storage on public.sale_packets;
create trigger trg_sale_packets_enforce_storage
  before insert or update on public.sale_packets
  for each row execute function public.xbar_enforce_storage_limit();
