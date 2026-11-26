-- Disposable full-schema fixture only. Storage metadata writes simulate trusted
-- provider completion; live object operations must use the supported API.
begin;
insert into storage.buckets(id,name,public) values('sale-packets','sale-packets',false),('fixture-unrelated','fixture-unrelated',false) on conflict(id) do nothing;
-- A leftover permissive policy must not defeat a restrictive cutover policy.
create policy fixture_allow_insert on storage.objects for insert to authenticated with check(true);
create policy fixture_allow_update on storage.objects for update to authenticated using(true) with check(true);
insert into auth.users(id,email) values
('f5000000-0000-4000-8000-000000000001','reservation-owner@example.invalid'),
('f5000000-0000-4000-8000-000000000002','reservation-outsider@example.invalid');
insert into workspaces(id,owner_user_id,name) values
('f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Reservation fixture');
insert into workspace_subscription_profiles(workspace_id) values('f6000000-0000-4000-8000-000000000001');

do $$
declare ws uuid := 'f6000000-0000-4000-8000-000000000001';
  actor uuid := 'f5000000-0000-4000-8000-000000000001';
  id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); id3 uuid := gen_random_uuid();
  create_token uuid := gen_random_uuid(); verify_token uuid := gen_random_uuid(); abort_token uuid := gen_random_uuid();
  path1 text; path2 text; r jsonb; used_bytes bigint;
begin
  path1:=ws::text||'/documents/'||id1::text||'/first.pdf';
  path2:=ws::text||'/documents/'||id2::text||'/second.pdf';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  r:=public.xbar_reserve_upload(id1,ws,actor,'horse-documents',path1,629145600,'application/pdf','document');
  assert r->>'state'='reserved';
  assert (public.xbar_reserve_upload(id1,ws,actor,'horse-documents',path1,629145600,'application/pdf','document')->>'id')=id1::text;
  begin
    perform public.xbar_reserve_upload(id1,ws,actor,'horse-documents',path1,1,'application/pdf','document');
    raise exception 'Conflicting retry was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.xbar_reserve_upload(id2,ws,actor,'horse-documents',path2,629145600,'application/pdf','document');
    raise exception 'Competing reservation exceeded capacity';
  exception when raise_exception then
    if sqlerrm<>'Storage limit reached for this workspace.' then raise; end if;
  end;
  begin
    update public.workspace_upload_reservations set state='aborted' where id=id1;
    raise exception 'Service table write bypassed CAS';
  exception when insufficient_privilege then null; end;
  reset role;
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600;
  update public.workspace_upload_reservations set created_at=now()-interval '90 days' where id=id1;
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600,'Reservation expired without provider proof';
  begin
    delete from public.workspaces where id=ws;
    raise exception 'Workspace deletion erased an active reservation';
  exception when object_not_in_prerequisite_state then null; end;

  set local role service_role;
  perform public.xbar_begin_upload(id1,create_token);
  begin
    perform public.xbar_claim_upload_abort(id1,abort_token);
    raise exception 'Unknown provider creation was allowed to abort/release';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.xbar_mark_upload_reconcile(id1,create_token,'Unknown CreateMultipart acknowledgement');
  perform public.xbar_bind_upload(id1,create_token,'provider-upload-1');
  perform public.xbar_claim_upload_completion(id1,verify_token);
  begin
    perform public.xbar_claim_upload_abort(id1,abort_token);
    raise exception 'Abort stole a verification claim';
  exception when object_not_in_prerequisite_state then null; end;
  -- Known incomplete manifest can return to uploading BEFORE Complete begins.
  perform public.xbar_release_upload_completion(id1,verify_token);
  perform public.xbar_claim_upload_abort(id1,abort_token);
  begin
    perform public.xbar_settle_upload_aborted(id1,abort_token,false);
    raise exception 'Unconfirmed abort released capacity';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.xbar_mark_upload_reconcile(id1,abort_token,'Unknown AbortMultipart acknowledgement');
  perform public.xbar_settle_upload_aborted(id1,abort_token,true);
  reset role;
  assert public.xbar_workspace_upload_admission_bytes(ws)=0;

  set local role service_role;
  perform public.xbar_reserve_upload(id2,ws,actor,'horse-documents',path2,629145600,'application/pdf','document');
  perform public.xbar_begin_upload(id2,create_token);
  perform public.xbar_bind_upload(id2,create_token,'provider-upload-2');
  perform public.xbar_claim_upload_completion(id2,verify_token);
  perform public.xbar_start_upload_completion(id2,verify_token);
  perform public.xbar_mark_upload_reconcile(id2,verify_token,'Unknown CompleteMultipart acknowledgement');
  begin
    perform public.xbar_release_upload_completion(id2,verify_token);
    raise exception 'Uncertain completion returned to uploading';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.xbar_claim_upload_abort(id2,abort_token);
    raise exception 'Uncertain completion was allowed to abort';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.xbar_settle_upload_aborted(id2,verify_token,true);
    raise exception 'Uncertain completion was released as aborted';
  exception when object_not_in_prerequisite_state then null; end;
  reset role;
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600;

  -- A provider object appears before settlement. Count max(actual,reserved),
  -- not both; an undersized object must not release the reserved difference.
  insert into storage.objects(bucket_id,name,metadata) values('horse-documents',path2,'{"size":629145599}');
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600;
  set local role service_role;
  begin
    perform public.xbar_settle_upload_stored(id2,verify_token);
    raise exception 'Wrong byte size finalized';
  exception when object_not_in_prerequisite_state then null; end;
  reset role;
  update storage.objects set metadata='{"size":629145600}' where bucket_id='horse-documents' and name=path2;
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600;
  set local role service_role;
  perform public.xbar_settle_upload_stored(id2,verify_token);
  reset role;
  assert public.xbar_workspace_upload_admission_bytes(ws)=629145600;
  assert (select state='stored' from public.workspace_upload_reservations where id=id2);

  -- User tokens cannot reserve or mutate ledger rows, and direct storage
  -- writes cannot bypass the server. Existing reads remain usable.
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.xbar_reserve_upload(id3,ws,actor,'horse-documents',ws::text||'/documents/'||id3::text||'/third.pdf',1);
    raise exception 'Authenticated RPC bypass accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.workspace_upload_reservations;
    raise exception 'Authenticated caller read private provider claims';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name,metadata) values('horse-documents',ws::text||'/direct.pdf','{"size":1}');
    raise exception 'Direct document upload bypass accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name,metadata) values('horse-media',ws::text||'/direct.jpg','{"size":1}');
    raise exception 'Direct media upload bypass accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name,metadata) values('sale-packets',ws::text||'/direct.pdf','{"size":1}');
    raise exception 'Direct packet upload bypass accepted';
  exception when insufficient_privilege then null; end;
  insert into storage.objects(bucket_id,name,metadata) values('fixture-unrelated','unrelated','{"size":1}');
  update storage.objects set metadata='{"size":1}' where name=path2;
  get diagnostics used_bytes=row_count;
  assert used_bytes=0,'Direct update bypass accepted';
  assert (select count(*)=1 from storage.objects where name=path2),'Existing file read was blocked';
  reset role;
  assert (select metadata->>'size'='629145600' from storage.objects where name=path2);

  perform set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"f5000000-0000-4000-8000-000000000002"}',true);
  set local role authenticated;
  assert (select count(*)=0 from storage.objects where name=path2),'Outsider read reserved object';
  reset role;
end $$;
rollback;
