-- Read-only metadata snapshot. No customer rows, secrets, RPC execution or DDL.
-- Always use the same search_path so PostgreSQL deparses definitions identically.
begin isolation level repeatable read read only;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
select jsonb_build_object(
  'functions', coalesce((
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      jsonb_build_object('definition', md5(replace(pg_get_functiondef(p.oid), chr(13), '')),
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'xbar\_%' escape '\'
  ), '{}'::jsonb),
  'tableGrants', coalesce((
    select jsonb_object_agg(c.relname, jsonb_build_object(
      'table', (select jsonb_object_agg(role_name,permissions) from (
        select role_name,(select jsonb_object_agg(p,has_table_privilege(role_name,c.oid,p))
          from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p) permissions
        from unnest(array['anon','authenticated','service_role']) role_name) grants),
      'column', (select jsonb_object_agg(role_name,permissions) from (
        select role_name,(select jsonb_object_agg(p,has_any_column_privilege(role_name,c.oid,p))
          from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p) permissions
        from unnest(array['anon','authenticated','service_role']) role_name) grants)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  ), '{}'::jsonb),
  'policies', coalesce((
    select jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname,
      jsonb_build_object('command', cmd, 'roles', roles, 'permissive', permissive,
        'using', qual, 'check', with_check))
    from pg_policies where (schemaname = 'storage' and tablename = 'objects')
      or (schemaname = 'public' and tablename in
        ('workspace_subscription_profiles', 'workspace_billing_customers', 'account_deletion_events'))
  ), '{}'::jsonb),
  'rls', coalesce((
    select jsonb_object_agg(n.nspname || '.' || c.relname, c.relrowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and ((n.nspname = 'public' and c.relname in
      ('horses', 'documents', 'workspace_memberships', 'workspace_subscription_profiles',
       'workspace_billing_customers', 'account_deletion_events'))
      or (n.nspname = 'storage' and c.relname = 'objects'))
  ), '{}'::jsonb),
  'triggers', coalesce((
    select jsonb_object_agg(n.nspname || '.' || c.relname || '.' || t.tgname,
      jsonb_build_object('enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ), '{}'::jsonb),
  'billingPeriod', coalesce((
    select jsonb_build_object('type', data_type, 'nullable', is_nullable)
    from information_schema.columns where table_schema = 'public'
      and table_name = 'workspace_subscription_profiles' and column_name = 'billing_period'
  ), 'null'::jsonb),
  'buckets', coalesce((
    select jsonb_object_agg(id, public) from storage.buckets
    where id in ('horse-media', 'horse-documents', 'sale-packets')
  ), '{}'::jsonb)
) as catalog;
rollback;
