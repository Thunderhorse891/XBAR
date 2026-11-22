-- Isolated synthetic fixture; execute only after repository schema load.
begin;
insert into auth.users(id,email) values
('04000000-0000-4000-8000-000000000001','packet-owner-a@example.invalid'),
('04000000-0000-4000-8000-000000000002','packet-owner-b@example.invalid');
insert into public.workspaces(id,owner_user_id,name) values
('14000000-0000-4000-8000-000000000001','04000000-0000-4000-8000-000000000001','Packet Fixture A'),
('14000000-0000-4000-8000-000000000002','04000000-0000-4000-8000-000000000002','Packet Fixture B');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values
('14000000-0000-4000-8000-000000000001','Professional','Manual Billing'),
('14000000-0000-4000-8000-000000000002','Professional','Manual Billing');

do $$
declare
  a uuid := '14000000-0000-4000-8000-000000000001';
  b uuid := '14000000-0000-4000-8000-000000000002';
  owner_a uuid := '04000000-0000-4000-8000-000000000001';
  owner_b uuid := '04000000-0000-4000-8000-000000000002';
  issuer text := 'public.xbar_issue_sale_packet(jsonb,jsonb)';
  ledger text := 'public.sale_packet_proofs';
  protected_seal jsonb := jsonb_build_object('anchor','server','payload','{"packetId":"fixture-issued","horseId":"fixture-horse"}');
  delivery jsonb := jsonb_build_object(
    'workspace_id',a,'packet_id','fixture-issued','horse_id','fixture-horse',
    'created_by_user_id',owner_a,'packet_pdf_path','fixture-packet.pdf',
    'watermark_text','','shared_with_email','','document_ids','[]'::jsonb,'size_bytes',3,
    'payload','{"buyerName":"Fixture buyer"}'::jsonb
  );
  role_name text;
  privilege_name text;
  changed integer;
  duplicate_refused boolean := false;
  denied boolean := false;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name,issuer,'execute') then
      raise exception 'Unexpected issuance grant to %',role_name;
    end if;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege(role_name,ledger,privilege_name) then
        raise exception 'Unexpected protected proof table grant % to %',privilege_name,role_name;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role',issuer,'execute')
    or not has_table_privilege('service_role',ledger,'SELECT')
    or not has_table_privilege('service_role',ledger,'INSERT')
    or has_table_privilege('service_role',ledger,'UPDATE')
    or has_table_privilege('service_role',ledger,'DELETE')
    or has_table_privilege('service_role',ledger,'TRUNCATE') then
    raise exception 'Service issuer is not append-only';
  end if;

  insert into public.sale_packets(workspace_id,packet_id,payload) values
    (a,'fixture-legacy','{"seal":{"anchor":"server"}}');

  set local role service_role;
  if not public.xbar_issue_sale_packet(delivery, protected_seal) then raise exception 'Verified issuer denied'; end if;
  if (select seal from public.sale_packet_proofs where packet_id='fixture-issued') is distinct from protected_seal
    or (select payload from public.sale_packets where workspace_id=a and packet_id='fixture-issued') ? 'seal'
    or exists(select 1 from public.sale_packet_proofs where packet_id='fixture-legacy') then
    raise exception 'Proof separation/history invariant failed';
  end if;
  begin
    perform public.xbar_issue_sale_packet(
      delivery || jsonb_build_object('workspace_id',b,'created_by_user_id',owner_b), protected_seal
    );
  exception when unique_violation then
    duplicate_refused := true;
  end;
  if not duplicate_refused
    or exists(select 1 from public.sale_packets where workspace_id=b and packet_id='fixture-issued') then
    raise exception 'Issuance partially committed after duplicate proof refusal';
  end if;
  reset role;

  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  set local role authenticated;
  update public.sale_packets set payload=jsonb_build_object('buyerName','Edited delivery')
    where workspace_id=a and packet_id='fixture-issued';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Existing authorized delivery edit broken'; end if;
  begin
    select count(*) into changed from public.sale_packet_proofs;
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'Authenticated role can read protected proof directly'; end if;
  reset role;

  set local role service_role;
  if (select seal from public.sale_packet_proofs where packet_id='fixture-issued') is distinct from protected_seal then
    raise exception 'Delivery edit changed protected evidence';
  end if;
  reset role;
end;
$$;
rollback;
select 'Synthetic sale packet issuance, role separation, immutable proof and atomic rollback passed.' as result;
