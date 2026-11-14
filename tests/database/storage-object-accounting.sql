-- Disposable full-schema fixture only. Storage mutations below simulate the
-- supported Storage API's measured metadata; never run against a real project.
begin;
insert into storage.buckets(id,name,public) values('sale-packets','sale-packets',false) on conflict(id) do nothing;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email) values('f3000000-0000-4000-8000-000000000001','accounting@example.invalid');
insert into workspaces(id,owner_user_id,name) values('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','Accounting fixture');
insert into workspace_subscription_profiles(workspace_id,tier,billing_state) values('f4000000-0000-4000-8000-000000000001','Professional','Active');

-- Photos, receipt scans and unreferenced successful uploads count immediately.
insert into storage.objects(bucket_id,name,metadata) values
('horse-media','f4000000-0000-4000-8000-000000000001/photo.jpg','{"size":100}'),
('horse-documents','f4000000-0000-4000-8000-000000000001/receipt.pdf','{"size":200}'),
('horse-documents','f4000000-0000-4000-8000-000000000001/orphan.pdf','{"size":300}'),
('horse-documents','f4000000-0000-4000-8000-000000000001/document.pdf','{"size":400}'),
('sale-packets','f4000000-0000-4000-8000-000000000001/packet.pdf','{"size":500}');
insert into horses(workspace_id,horse_id,name,payload) values
('f4000000-0000-4000-8000-000000000001','h1','Photo horse','{"gallery":[{"storagePath":"f4000000-0000-4000-8000-000000000001/photo.jpg"}]}');
insert into expense_receipts(workspace_id,receipt_id,payload) values
('f4000000-0000-4000-8000-000000000001','r1','{"storagePath":"f4000000-0000-4000-8000-000000000001/receipt.pdf","fileSizeBytes":999}');
insert into documents(workspace_id,document_id,title,state,size_bytes,payload) values
('f4000000-0000-4000-8000-000000000001','d1','Document','Ready',999,'{"storagePath":"f4000000-0000-4000-8000-000000000001/document.pdf"}');
insert into sale_packets(workspace_id,packet_id,packet_pdf_path,size_bytes) values
('f4000000-0000-4000-8000-000000000001','p1','f4000000-0000-4000-8000-000000000001/packet.pdf',999);
-- Metadata-only legacy rows retain their recorded byte charge.
insert into documents(workspace_id,document_id,title,state,size_bytes) values
('f4000000-0000-4000-8000-000000000001','legacy','Legacy','Archived',50);

do $$ declare ws uuid := 'f4000000-0000-4000-8000-000000000001'; before_bytes bigint;
begin
  assert public.xbar_workspace_storage_bytes(ws)=1550, 'actual objects plus legacy bytes were double counted or omitted';
  assert public.xbar_storage_metadata_bytes('{"size":-1}') is null;
  assert public.xbar_storage_metadata_bytes('{"size":"1.5"}') is null;
  assert public.xbar_storage_metadata_bytes('{"size":"99999999999999999999999"}') is null;
  assert public.xbar_storage_metadata_bytes('{"size":0}')=0;

  -- A successful object is already charged when its document row arrives.
  update storage.objects set metadata='{"size":1073741824}'
    where name=ws::text||'/document.pdf';
  update workspace_subscription_profiles set billing_state='Inactive' where workspace_id=ws;
  insert into documents(workspace_id,document_id,title,state,size_bytes,payload)
    values(ws,'d1','Preserved above cap','Ready',1073741824,jsonb_build_object('storagePath',ws::text||'/document.pdf'))
    on conflict(workspace_id,document_id) do update set title=excluded.title,size_bytes=excluded.size_bytes,payload=excluded.payload;
  before_bytes := public.xbar_workspace_storage_bytes(ws);
  update documents set title='Non-growth edit' where workspace_id=ws;
  assert public.xbar_workspace_storage_bytes(ws)=before_bytes;
  update documents set size_bytes=40 where workspace_id=ws and document_id='legacy';
  assert public.xbar_workspace_storage_bytes(ws)=before_bytes-10;
  begin
    insert into documents(workspace_id,document_id,title,state,size_bytes) values(ws,'growth','Refused','Ready',1);
    raise exception 'New fallback byte accepted above quota';
  exception when raise_exception then
    if sqlerrm <> 'Storage limit reached for this workspace.' then raise; end if;
  end;

  -- Unknown finalized metadata fails usage checks closed, while existing
  -- records, downloads (policies unchanged), and non-growth edits remain.
  update storage.objects set metadata='{}' where name=ws::text||'/orphan.pdf';
  begin
    perform public.xbar_workspace_storage_bytes(ws);
    raise exception 'Unknown object size silently treated as zero';
  exception when raise_exception then
    if sqlerrm <> 'Cloud storage usage could not be verified because an object has unknown size.' then raise; end if;
  end;
  update documents set title='Preserved while usage unknown' where workspace_id=ws;
  update storage.objects set metadata='{"size":300}' where name=ws::text||'/orphan.pdf';

  -- A pointer into an uploader namespace cannot silently omit legacy photos
  -- or disclose another workspace's metadata through this accounting RPC.
  update horses set payload='{"gallery":[{"storagePath":"f3000000-0000-4000-8000-000000000001/legacy-photo.jpg"}]}' where workspace_id=ws;
  begin
    perform public.xbar_workspace_storage_bytes(ws);
    raise exception 'Ambiguous legacy photo was omitted';
  exception when raise_exception then
    if sqlerrm <> 'Cloud storage usage could not be verified because an object has unknown size.' then raise; end if;
  end;
  update horses set payload='{}' where workspace_id=ws;
  before_bytes:=public.xbar_workspace_storage_bytes(ws);
  delete from storage.objects where name=ws::text||'/orphan.pdf';
  assert public.xbar_workspace_storage_bytes(ws)=before_bytes-300;
end $$;
-- The modified public RPC must not widen metadata visibility. Test real roles,
-- including denial BEFORE an unknown-size error could reveal another ranch.
insert into auth.users(id,email) values
('f3000000-0000-4000-8000-000000000002','member@example.invalid'),
('f3000000-0000-4000-8000-000000000003','outsider@example.invalid');
insert into workspace_memberships(workspace_id,user_id,email,role,status) values
('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002','member@example.invalid','Staff','active');
do $$ declare ws uuid := 'f4000000-0000-4000-8000-000000000001'; actor text; amount bigint;
begin
  foreach actor in array array['f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    set local role authenticated;
    amount:=public.xbar_workspace_storage_bytes(ws);
    assert amount > 0,'Owner/member failed to read own usage';
    begin
      perform public.xbar_workspace_storage_bytes_internal(ws);
      raise exception 'Authenticated caller reached private counter';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  update storage.objects set metadata='{}' where name=ws::text||'/photo.jpg';
  perform set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"f3000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  set local role authenticated;
  begin
    perform public.xbar_workspace_storage_bytes(ws);
    raise exception 'Outsider read storage metadata';
  exception when insufficient_privilege then
    if sqlerrm <> 'Workspace access required.' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin
    perform public.xbar_workspace_storage_bytes(ws);
    raise exception 'Anonymous caller read storage metadata';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update storage.objects set metadata='{"size":100}' where name=ws::text||'/photo.jpg';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  amount:=public.xbar_workspace_storage_bytes(ws);
  assert amount > 0,'Service role could not read usage';
  reset role;
end $$;
rollback;
