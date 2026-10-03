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
      or schemaname = 'public'
  ), '{}'::jsonb),
  'rls', coalesce((
    select jsonb_object_agg(n.nspname || '.' || c.relname, c.relrowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and (n.nspname = 'public'
      or (n.nspname = 'storage' and c.relname = 'objects'))
  ), '{}'::jsonb),
  'deletionLifecycle', coalesce((
    select jsonb_object_agg(c.relname, jsonb_build_object(
      'columns', coalesce((select jsonb_object_agg(a.attname,jsonb_build_object(
        'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid)))
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped), '{}'::jsonb),
      'constraints', coalesce((select jsonb_object_agg(conname,pg_get_constraintdef(oid))
        from pg_constraint where conrelid=c.oid), '{}'::jsonb),
      'indexes', coalesce((select jsonb_object_agg(idx.relname,jsonb_build_object(
        'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready))
        from pg_index i join pg_class idx on idx.oid=i.indexrelid
        where i.indrelid=c.oid), '{}'::jsonb)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in
      ('account_deletion_events','account_deletion_holds','account_deletion_receipts','account_deletion_requests')
      and c.relkind in ('r','p')
  ), '{}'::jsonb),
  'triggers', coalesce((
    select jsonb_object_agg(n.nspname || '.' || c.relname || '.' || t.tgname,
      jsonb_build_object('enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ), '{}'::jsonb),
  'reminderDelivery', jsonb_build_object(
    'columns', coalesce((select jsonb_object_agg(a.attname,jsonb_build_object(
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid)))
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass('public.reminder_email_deliveries') and a.attnum>0 and not a.attisdropped), '{}'::jsonb),
    'constraints', coalesce((select jsonb_object_agg(conname,pg_get_constraintdef(oid))
      from pg_constraint where conrelid=to_regclass('public.reminder_email_deliveries')), '{}'::jsonb),
    'indexes', coalesce((select jsonb_object_agg(c.relname,jsonb_build_object(
      'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready))
      from pg_index i join pg_class c on c.oid=i.indexrelid
      where i.indrelid=to_regclass('public.reminder_email_deliveries')), '{}'::jsonb)
  ),
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
