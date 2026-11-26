-- Disposable full-schema test only. Every synthetic fixture rolls back.
begin;
insert into auth.users(id,email) values
('f1000000-0000-4000-8000-000000000001','free-owner@example.invalid'),
('f1000000-0000-4000-8000-000000000002','free-outsider@example.invalid');
insert into workspaces(id,owner_user_id,name) values
('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Disposable Free ranch');
insert into workspace_subscription_profiles(workspace_id) values('f2000000-0000-4000-8000-000000000001');

do $$
declare visible integer;
begin
  perform set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  set local role authenticated;
  insert into horses(workspace_id,horse_id,name) values
    ('f2000000-0000-4000-8000-000000000001','h1','First'),
    ('f2000000-0000-4000-8000-000000000001','h2','Second');
  begin
    insert into horses(workspace_id,horse_id,name) values('f2000000-0000-4000-8000-000000000001','h3','Refused');
    raise exception 'Third Free horse accepted';
  exception when raise_exception then
    if sqlerrm <> 'Horse limit reached for this workspace.' then raise; end if;
  end;
  insert into documents(workspace_id,document_id,title,state)
    select 'f2000000-0000-4000-8000-000000000001','doc-'||n,'Document','Ready' from generate_series(1,10) n;
  begin
    insert into documents(workspace_id,document_id,title,state) values('f2000000-0000-4000-8000-000000000001','doc-11','Refused','Ready');
    raise exception 'Eleventh Free document accepted';
  exception when raise_exception then
    if sqlerrm <> 'Document limit reached for this workspace.' then raise; end if;
  end;
  update documents set size_bytes=1073741824 where document_id='doc-1';
  begin
    update documents set size_bytes=1 where document_id='doc-2';
    raise exception 'Free storage growth accepted';
  exception when raise_exception then
    if sqlerrm <> 'Storage limit reached for this workspace.' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  set local role authenticated;
  select count(*) into visible from horses;
  assert visible=0,'Another ranch read Free records';
  begin
    insert into horses(workspace_id,horse_id,name) values('f2000000-0000-4000-8000-000000000001','h1','Unauthorized upsert')
      on conflict(workspace_id,horse_id) do update set name=excluded.name;
    raise exception 'Another ranch upserted Free records';
  exception when insufficient_privilege then null;
  end;
  reset role;
  assert (select name='First' from horses where workspace_id='f2000000-0000-4000-8000-000000000001' and horse_id='h1'), 'Denied upsert persisted';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  select count(*) into visible from horses;
  assert visible=0,'Anonymous role read Free records';
  reset role;
end $$;
rollback;
