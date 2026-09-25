\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','member@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','outsider@example.invalid');
insert into public.workspaces(id,owner_user_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values
 ('20000000-0000-4000-8000-000000000001','Professional','Active');
insert into public.workspace_memberships(workspace_id,user_id,email,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','member@example.invalid','Owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare n integer; begin
 if (select count(*) from public.workspace_subscription_profiles) <> 1 then raise exception 'owner cannot read'; end if;
 update public.workspace_subscription_profiles set tier='Enterprise';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'authenticated owner changed server billing'; end if;
 delete from public.workspace_subscription_profiles;
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'authenticated owner deleted server billing'; end if;
 begin
  insert into public.workspace_subscription_profiles(workspace_id) values ('20000000-0000-4000-8000-000000000001');
  raise exception 'authenticated owner inserted billing';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ declare n integer; begin
 if (select count(*) from public.workspaces) <> 1 then raise exception 'member cannot read workspace'; end if;
 if (select count(*) from public.workspace_subscription_profiles) <> 1 then raise exception 'member cannot read billing'; end if;
 update public.workspace_memberships set role='Admin';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'member promoted self'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists (select 1 from public.workspaces) then raise exception 'outsider sees workspace'; end if;
 if exists (select 1 from public.workspace_subscription_profiles) then raise exception 'outsider sees billing'; end if;
 begin
  insert into public.workspace_memberships(workspace_id,user_id,email,role) values
   ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','outsider@example.invalid','Admin');
  raise exception 'outsider joined workspace';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if exists (select 1 from pg_policies where schemaname='public' and tablename='workspace_subscription_profiles'
  and 'authenticated'=any(roles) and cmd <> 'SELECT') then raise exception 'billing has write policy'; end if;
 if not (select relrowsecurity from pg_class where oid='public.workspace_subscription_profiles'::regclass)
  then raise exception 'billing RLS disabled'; end if;
end $$;
-- Audit receipts survive an auth/workspace cascade and cannot be altered by
-- the service role or read by an authenticated user.
set local role service_role;
insert into public.account_deletion_events(operation_id,actor_user_id,workspace_ids,phase) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',array['20000000-0000-4000-8000-000000000001'::uuid],'started');
do $$ begin
 begin delete from public.account_deletion_events; raise exception 'service deleted audit'; exception when insufficient_privilege then null; end;
 begin update public.account_deletion_events set phase='completed'; raise exception 'service overwrote audit'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from auth.users where id='10000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from public.account_deletion_events) <> 1 then raise exception 'cascade erased audit'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform * from public.account_deletion_events; raise exception 'user read audit'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
