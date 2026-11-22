-- Existing sale_packets.payload is delivery metadata, not an issuance authority.
-- Deliberately do not migrate historical seals out of that mutable payload.
create table if not exists public.sale_packet_proofs (
  packet_id text primary key,
  workspace_id uuid not null,
  seal jsonb not null,
  constraint sale_packet_proofs_packet_fk foreign key (workspace_id, packet_id)
    references public.sale_packets(workspace_id, packet_id) on delete cascade,
  constraint sale_packet_proofs_seal_object check (pg_catalog.jsonb_typeof(seal) = 'object')
);

alter table public.sale_packet_proofs enable row level security;
revoke all on table public.sale_packet_proofs from public, anon, authenticated, service_role;
grant select, insert on table public.sale_packet_proofs to service_role;

-- An invoker with only service-role EXECUTE permission. The two inserts are
-- atomic. Existing packet capacity/storage triggers still apply to the first
-- insert. No upsert: a prior packet identifier can never receive a new proof.
create or replace function public.xbar_issue_sale_packet(p_delivery jsonb, p_seal jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_packet_id text := p_delivery->>'packet_id';
  v_workspace_id uuid := (p_delivery->>'workspace_id')::uuid;
  v_horse_id text := p_delivery->>'horse_id';
  v_sealed jsonb;
begin
  if pg_catalog.jsonb_typeof(p_delivery) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_seal) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_seal->'payload') is distinct from 'string'
    or p_seal->>'anchor' is distinct from 'server'
    or v_packet_id is null or v_packet_id = ''
    or v_workspace_id is null or v_horse_id is null or v_horse_id = '' then
    raise exception 'Malformed sale packet issuance' using errcode = '22023';
  end if;

  v_sealed := (p_seal->>'payload')::jsonb;
  if v_sealed->>'packetId' is distinct from v_packet_id
    or v_sealed->>'horseId' is distinct from v_horse_id then
    raise exception 'Sale packet proof identity mismatch' using errcode = '22023';
  end if;

  insert into public.sale_packets (
    workspace_id, packet_id, horse_id, created_by_user_id, packet_pdf_path,
    watermark_text, shared_with_email, document_ids, status, size_bytes, payload
  ) values (
    v_workspace_id, v_packet_id, v_horse_id, (p_delivery->>'created_by_user_id')::uuid,
    p_delivery->>'packet_pdf_path', p_delivery->>'watermark_text',
    p_delivery->>'shared_with_email', p_delivery->'document_ids', 'ready',
    (p_delivery->>'size_bytes')::bigint, (p_delivery->'payload') - 'seal'
  );

  insert into public.sale_packet_proofs(packet_id, workspace_id, seal)
  values (v_packet_id, v_workspace_id, p_seal);
  return true;
end;
$$;

revoke all on function public.xbar_issue_sale_packet(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.xbar_issue_sale_packet(jsonb, jsonb) to service_role;
