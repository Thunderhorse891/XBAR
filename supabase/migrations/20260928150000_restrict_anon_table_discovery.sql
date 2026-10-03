-- Anonymous buyers use the two SECURITY DEFINER share RPCs, not direct table
-- operations. Revoke read and write grants, including GraphQL mutation access.
-- No customer rows, RLS policies or function grants are changed.
-- Production application requires Erin's explicit approval and recovery review.
begin;
do $$
declare
 target record;
 columns text;
 before_permissions jsonb;
 after_permissions jsonb;
begin
 for target in select c.oid, n.nspname, c.relname
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
 loop
  select jsonb_object_agg(role_name, jsonb_build_object(
    'table', (select jsonb_object_agg(privilege,has_table_privilege(role_name,target.oid,privilege))
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege),
    'columns', (select jsonb_object_agg(attname, permissions) from (
      select a.attname, (select jsonb_object_agg(privilege,has_column_privilege(role_name,target.oid,a.attnum,privilege))
        from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege) permissions
      from pg_attribute a where a.attrelid=target.oid and a.attnum>0 and not a.attisdropped
    ) cols))) into before_permissions from unnest(array['authenticated','service_role']) role_name;
  -- PUBLIC grants are inherited by anon. Preserve intended roles by checking
  -- effective privileges before/after; never add blanket GRANT to hide drift.
  execute format('revoke all privileges on table %I.%I from anon, public',target.nspname,target.relname);
  select string_agg(quote_ident(attname),', ' order by attnum) into columns
   from pg_attribute where attrelid=target.oid and attnum>0 and not attisdropped;
  if columns is not null then
   execute format('revoke all privileges (%s) on table %I.%I from anon, public',columns,target.nspname,target.relname);
  end if;
  select jsonb_object_agg(role_name, jsonb_build_object(
    'table', (select jsonb_object_agg(privilege,has_table_privilege(role_name,target.oid,privilege))
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege),
    'columns', (select jsonb_object_agg(attname, permissions) from (
      select a.attname, (select jsonb_object_agg(privilege,has_column_privilege(role_name,target.oid,a.attnum,privilege))
        from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege) permissions
      from pg_attribute a where a.attrelid=target.oid and a.attnum>0 and not a.attisdropped
    ) cols))) into after_permissions from unnest(array['authenticated','service_role']) role_name;
  if after_permissions is distinct from before_permissions
  then raise exception 'Intended access changed for %.%; reconcile explicit grants first',target.nspname,target.relname;
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege where has_table_privilege('anon',target.oid,privilege))
    or exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege where has_any_column_privilege('anon',target.oid,privilege))
  then raise exception 'Anonymous access inherited through another role for %.%',target.nspname,target.relname;
  end if;
 end loop;
end $$;
commit;
-- New tables must explicitly revoke unnecessary anon/PUBLIC privileges in their
-- own migration. CI seeds legacy Supabase defaults and checks every table.
-- Default grants for unrelated schemas/creator roles are deliberately unchanged.
-- Recovery: restore only reviewed captured ACLs when necessary, never GRANT ALL.
