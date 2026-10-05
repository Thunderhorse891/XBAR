-- Actual PostgreSQL role/RLS/rollback contract using only synthetic records.
begin;
insert into auth.users(id,email,email_confirmed_at)
select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'fixture-'||i||'@example.invalid', now()
from generate_series(1,9) i;
insert into public.workspaces(id,owner_user_id,name) values
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Synthetic Ranch A'),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000007','Synthetic Ranch B');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values
('10000000-0000-4000-8000-000000000001','Enterprise','Manual Billing'),
('10000000-0000-4000-8000-000000000002','Enterprise','Manual Billing');
insert into public.workspace_memberships(workspace_id,user_id,email,role,status)
select '10000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
'fixture-'||i||'@example.invalid', role, status
from (values (2,'Admin','active'),(3,'Ranch Manager','active'),(4,'Medical Lead','active'),
(5,'Sales Lead','active'),(6,'Owner','active'),(8,'Admin','inactive'),(9,'Unknown role','active')) roles(i,role,status);
insert into public.horses(workspace_id,horse_id,name,payload) values
('10000000-0000-4000-8000-000000000001','horse-a','Synthetic A','{"id":"horse-a","name":"Synthetic A"}'),
('10000000-0000-4000-8000-000000000002','horse-b','Synthetic B','{"id":"horse-b","name":"Synthetic B"}');
insert into public.workspace_profiles(workspace_id,payload) values
('10000000-0000-4000-8000-000000000001','{"ranchName":"Synthetic Ranch A"}');

do $$
declare actor record; affected integer; visible integer; permitted boolean;
begin
  for actor in select * from (values
    (1,true,true,true,true),(2,true,true,true,true),(3,true,true,true,false),
    (4,true,false,true,false),(5,true,false,true,false),(6,true,false,true,false),
    (7,false,false,false,false),(8,false,false,false,false),(9,true,false,false,false)
  ) expectations(id,can_read,can_create,can_edit,can_profile) loop
    perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-'||lpad(actor.id::text,12,'0'),true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-'||lpad(actor.id::text,12,'0'),'role','authenticated')::text,true);
    set local role authenticated;
    select count(*) into visible from public.horses where workspace_id='10000000-0000-4000-8000-000000000001';
    if (visible=1) is distinct from actor.can_read then raise exception 'Unexpected horse read for actor %',actor.id; end if;
    update public.horses set payload=jsonb_set(payload,'{fixtureProbe}',to_jsonb(actor.id))
    where workspace_id='10000000-0000-4000-8000-000000000001' and horse_id='horse-a';
    get diagnostics affected=row_count;
    if (affected=1) is distinct from actor.can_edit then raise exception 'Unexpected horse update for actor %',actor.id; end if;
    update public.workspace_profiles set default_barn='Synthetic check'
    where workspace_id='10000000-0000-4000-8000-000000000001';
    get diagnostics affected=row_count;
    if (affected=1) is distinct from actor.can_profile then raise exception 'Unexpected profile update for actor %',actor.id; end if;
    permitted:=true;
    begin
      insert into public.horses(workspace_id,horse_id,name,payload)
      values('10000000-0000-4000-8000-000000000001','create-'||actor.id,'Synthetic new',jsonb_build_object('id','create-'||actor.id));
    exception when insufficient_privilege then permitted:=false;
    end;
    if permitted is distinct from actor.can_create then raise exception 'Unexpected horse insert for actor %',actor.id; end if;
    reset role;
    delete from public.horses where horse_id='create-'||actor.id;
  end loop;
end;
$$;

-- Anonymous requests cannot see private ranch rows even with normal table grants.
do $$
declare visible integer;
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  select count(*) into visible from public.horses;
  if visible<>0 then raise exception 'Anonymous role read private horse rows'; end if;
  reset role;
end;
$$;

-- Rollback removes earlier business writes even when a later write fails RLS.
do $$
declare visible integer;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  set local role authenticated;
  begin
    insert into public.horses(workspace_id,horse_id,name,payload)
    values('10000000-0000-4000-8000-000000000001','must-rollback','Synthetic rollback','{"id":"must-rollback"}');
    insert into public.horses(workspace_id,horse_id,name,payload)
    values('10000000-0000-4000-8000-000000000002','forbidden','Forbidden','{"id":"forbidden"}');
    raise exception 'Foreign workspace insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  select count(*) into visible from public.horses where horse_id='must-rollback';
  if visible<>0 then raise exception 'Earlier write survived the failed transaction'; end if;
  reset role;
end;
$$;

-- Current deletion protocol refuses shared-workspace destruction and fences a
-- private account against creating more workspaces while deletion is pending.
do $$
declare result jsonb; blocked boolean:=false;
begin
  set local role service_role;
  result:=public.xbar_hold_account_deletion_request('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
  if coalesce((result->>'ok')::boolean,true) then raise exception 'Shared owner deletion was not refused'; end if;
  result:=public.xbar_hold_account_deletion_request('00000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000007');
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'Private deletion fixture could not establish hold'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
  set local role authenticated;
  begin
    insert into public.workspaces(owner_user_id,workspace_key) values('00000000-0000-4000-8000-000000000007','blocked-new-ranch');
  exception when raise_exception then blocked:=true;
  end;
  if not blocked then raise exception 'Held account created a new workspace'; end if;
  reset role;
end;
$$;
rollback;
select 'Synthetic RLS, role and rollback baseline passed; no production data used.' as result;
