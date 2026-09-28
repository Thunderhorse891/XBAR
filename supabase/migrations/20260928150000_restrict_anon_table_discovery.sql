-- Anonymous buyers use the two SECURITY DEFINER share RPCs, not direct table
-- SELECT. RLS already restricts rows; this removes unnecessary GraphQL table
-- discovery as well. No customer rows, policies or function grants are changed.
-- Production application requires Erin's explicit approval and recovery review.
begin;
do $$
declare
 target record;
 columns text;
 authenticated_read boolean;
 service_read boolean;
 column_permissions jsonb;
 remaining_column_permissions jsonb;
begin
 for target in select c.oid, n.nspname, c.relname
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
 loop
  authenticated_read := has_table_privilege('authenticated',target.oid,'SELECT');
  service_read := has_table_privilege('service_role',target.oid,'SELECT');
  select jsonb_object_agg(attname,jsonb_build_array(
    has_column_privilege('authenticated',target.oid,attnum,'SELECT'),
    has_column_privilege('service_role',target.oid,attnum,'SELECT')))
   into column_permissions from pg_attribute
   where attrelid=target.oid and attnum>0 and not attisdropped;
  -- Revoke PUBLIC too: otherwise its inherited SELECT can keep anon exposed.
  execute format('revoke select on table %I.%I from anon, public', target.nspname, target.relname);
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns
   from pg_attribute where attrelid=target.oid and attnum>0 and not attisdropped;
  if columns is not null then
   execute format('revoke select (%s) on table %I.%I from anon, public', columns, target.nspname, target.relname);
  end if;
  -- Refuse rather than silently remove an intended role's inherited access.
  select jsonb_object_agg(attname,jsonb_build_array(
    has_column_privilege('authenticated',target.oid,attnum,'SELECT'),
    has_column_privilege('service_role',target.oid,attnum,'SELECT')))
   into remaining_column_permissions from pg_attribute
   where attrelid=target.oid and attnum>0 and not attisdropped;
  -- A drifted deployment needs explicit grant reconciliation, not blanket GRANT.
  if has_table_privilege('authenticated',target.oid,'SELECT') is distinct from authenticated_read
     or has_table_privilege('service_role',target.oid,'SELECT') is distinct from service_read
     or remaining_column_permissions is distinct from column_permissions
  then raise exception 'Intended read access changed for %.%; reconcile explicit grants first', target.nspname,target.relname;
  end if;
  if has_table_privilege('anon',target.oid,'SELECT') or has_any_column_privilege('anon',target.oid,'SELECT')
  then raise exception 'Anonymous read inherited through another role for %.%',target.nspname,target.relname;
  end if;
 end loop;
end $$;
commit;
-- New tables must explicitly revoke unnecessary anon/PUBLIC SELECT in their
-- own migration. CI seeds the legacy Supabase default and tests every table.
-- Default grants for unrelated schemas/creator roles are deliberately unchanged.
-- Recovery: restore only reviewed captured ACLs when necessary, never GRANT ALL.
