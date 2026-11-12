-- Exact read-only accounting of workspace-owned Storage objects.
-- Production application requires explicit owner approval. No object writes,
-- deletes, policy changes, snapshot caps, or paid profile changes are made.
-- A separately validated upload boundary is required for atomic object quotas.
begin;

create or replace function public.xbar_storage_metadata_bytes(p_metadata jsonb)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare value_text text;
begin
  value_text := p_metadata ->> 'size';
  if value_text is null or value_text !~ '^[0-9]+$' then return null; end if;
  begin
    return value_text::bigint;
  exception when numeric_value_out_of_range then return null;
  end;
end;
$$;
revoke all on function public.xbar_storage_metadata_bytes(jsonb) from public, anon, authenticated;

create or replace function public.xbar_workspace_storage_bytes_internal(p_workspace_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare object_bytes numeric; fallback_bytes numeric; unknown_objects bigint;
begin
  -- One statement/snapshot: unknown-size detection, actual objects and fallback
  -- references cannot race each other during this read. Backend metadata.size
  -- is authoritative; user_metadata never contributes. Missing sizes are
  -- unknown, not free space. This does not restrict downloads or recovery.
  with workspace_objects as materialized (
    select o.bucket_id, o.name, public.xbar_storage_metadata_bytes(o.metadata) as bytes
    from storage.objects o
    where o.bucket_id in ('horse-documents', 'horse-media', 'sale-packets')
      and lower(split_part(o.name, '/', 1)) = p_workspace_id::text
  ), cloud_references as (
    select 'horse-documents'::text as bucket_id,
      coalesce(nullif(storage_path, ''), nullif(payload ->> 'storagePath', '')) as path,
      size_bytes as bytes from public.documents where workspace_id = p_workspace_id
    union all
    select 'sale-packets', nullif(packet_pdf_path, ''), size_bytes
      from public.sale_packets where workspace_id = p_workspace_id
    union all
    select 'horse-documents', nullif(payload ->> 'storagePath', ''),
      public.xbar_storage_metadata_bytes(jsonb_build_object('size', payload -> 'fileSizeBytes'))
      from public.expense_receipts where workspace_id = p_workspace_id
    union all
    select 'horse-media', nullif(asset ->> 'storagePath', ''), null::bigint
      from public.horses h
      cross join lateral jsonb_array_elements(case
        when jsonb_typeof(h.payload -> 'gallery') = 'array' then h.payload -> 'gallery'
        else '[]'::jsonb end) asset
      where h.workspace_id = p_workspace_id
  ), unresolved_references as (
    -- Do not attribute an uploader-prefix legacy object to a ranch merely
    -- because a mutable gallery points to it. That can cross ranch boundaries.
    -- Keep existing access/recovery, but refuse new growth until reconciled.
    select r.* from cloud_references r where r.path is not null
      and (lower(split_part(r.path, '/', 1)) <> p_workspace_id::text
        or (r.bytes is null and not exists (
          select 1 from workspace_objects o where o.bucket_id = r.bucket_id and o.name = r.path
        )))
  ), legacy_rows as (
    -- Retain legacy/unrepresented sizes, without double charging an object
    -- when its row arrives. Client documents keep storagePath in payload;
    -- API documents use the dedicated column.
    select d.size_bytes from public.documents d
    where d.workspace_id = p_workspace_id
      and not exists (
        select 1 from workspace_objects o
        where o.bucket_id = 'horse-documents'
          and o.name = coalesce(nullif(d.storage_path, ''), d.payload ->> 'storagePath')
      )
    union all
    select p.size_bytes from public.sale_packets p
    where p.workspace_id = p_workspace_id
      and not exists (
        select 1 from workspace_objects o
        where o.bucket_id in ('sale-packets', 'horse-documents') and o.name = p.packet_pdf_path
      )
    union all
    select public.xbar_storage_metadata_bytes(jsonb_build_object('size', r.payload -> 'fileSizeBytes'))
      from public.expense_receipts r where r.workspace_id = p_workspace_id
        and nullif(r.payload ->> 'storagePath', '') is not null
        and not exists (
          select 1 from workspace_objects o
          where o.bucket_id = 'horse-documents' and o.name = r.payload ->> 'storagePath'
        )
  )
  select (select coalesce(sum(bytes), 0) from workspace_objects),
    (select count(*) from workspace_objects where bytes is null) + (select count(*) from unresolved_references),
    (select coalesce(sum(size_bytes), 0) from legacy_rows)
    into object_bytes, unknown_objects, fallback_bytes;
  if unknown_objects > 0 then
    raise exception 'Cloud storage usage could not be verified because an object has unknown size.';
  end if;
  return (object_bytes + fallback_bytes)::bigint;
end;
$$;
revoke all on function public.xbar_workspace_storage_bytes_internal(uuid) from public, anon, authenticated, service_role;

-- Preserve the workspace-scoped RPC guard also prepared in PR395. Internal
-- SECURITY DEFINER triggers use the private counter, not this caller-facing RPC.
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
  return public.xbar_workspace_storage_bytes_internal(p_workspace_id);
end;
$$;
revoke execute on function public.xbar_workspace_storage_bytes(uuid) from public, anon;
grant execute on function public.xbar_workspace_storage_bytes(uuid) to authenticated, service_role;

-- The row-level backstop charges only the portion not already counted as a
-- Storage object. Otherwise a 600 MiB object and its later 600 MiB document
-- would be charged twice and strand a valid upload on a 1 GiB Free workspace.
create or replace function public.xbar_enforce_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_gb integer;
  used_bytes bigint;
  previous_bytes bigint := 0;
  incoming_bytes bigint;
  previous_path text;
  incoming_path text;
begin
  if TG_OP = 'UPDATE' and new.workspace_id = old.workspace_id
    and new.size_bytes <= old.size_bytes then
    -- A changed reference can stop being covered by the object counter. Only
    -- skip when the underlying reference also remains the same.
    if TG_TABLE_NAME = 'documents' then
      if coalesce(nullif(new.storage_path, ''), new.payload ->> 'storagePath')
        is not distinct from coalesce(nullif(old.storage_path, ''), old.payload ->> 'storagePath') then return new; end if;
    elsif new.packet_pdf_path is not distinct from old.packet_pdf_path then return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  if TG_TABLE_NAME = 'documents' then
    incoming_path := coalesce(nullif(new.storage_path, ''), new.payload ->> 'storagePath');
    select size_bytes, coalesce(nullif(storage_path, ''), payload ->> 'storagePath')
      into previous_bytes, previous_path from public.documents
      where workspace_id = new.workspace_id and document_id = new.document_id;
  else
    incoming_path := new.packet_pdf_path;
    select size_bytes, packet_pdf_path into previous_bytes, previous_path
      from public.sale_packets where workspace_id = new.workspace_id and packet_id = new.packet_id;
  end if;
  previous_bytes := coalesce(previous_bytes, 0);
  if exists(select 1 from storage.objects o where (o.bucket_id = 'horse-documents'
    or (TG_TABLE_NAME = 'sale_packets' and o.bucket_id = 'sale-packets'))
    and lower(split_part(o.name, '/', 1)) = new.workspace_id::text and o.name = previous_path) then
    previous_bytes := 0;
  end if;
  incoming_bytes := new.size_bytes;
  if exists(select 1 from storage.objects o where (o.bucket_id = 'horse-documents'
    or (TG_TABLE_NAME = 'sale_packets' and o.bucket_id = 'sale-packets'))
    and lower(split_part(o.name, '/', 1)) = new.workspace_id::text and o.name = incoming_path) then
    incoming_bytes := 0;
  end if;
  if incoming_bytes <= previous_bytes then return new; end if;
  used_bytes := public.xbar_workspace_storage_bytes_internal(new.workspace_id);
  select storage_limit_gb into limit_gb from public.xbar_subscription_limits(new.workspace_id);
  if used_bytes - previous_bytes + incoming_bytes > limit_gb::bigint * 1073741824 then
    raise exception 'Storage limit reached for this workspace.';
  end if;
  return new;
end;
$$;

commit;
