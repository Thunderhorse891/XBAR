-- Close the unauthenticated RPC surface created by PostgreSQL's default grant.
--
-- NOT YET APPLIED. See "How to apply this" at the bottom.
--
-- WHY
-- ---
-- `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, and Supabase's `anon`
-- role inherits PUBLIC. Every SECURITY DEFINER function in this schema is
-- therefore callable by anyone holding the publishable key — which ships in the
-- browser bundle by design — through /rest/v1/rpc/<name>. SECURITY DEFINER runs
-- with the definer's privileges and bypasses RLS, so that surface is worth
-- closing even where the individual functions look harmless.
--
-- Loading this repository's schema into a local PostgreSQL 16 instance and
-- reading pg_proc.proacl shows three functions anon can execute:
--
--     xbar_resolve_public_listing         explicit grant, used by publicShare.ts
--     xbar_track_public_share_view        explicit grant, used by publicShare.ts
--     xbar_resolve_public_listing_legacy  explicit grant, referenced nowhere
--
-- The first two are the buyer share flow: a buyer opens a link with no account,
-- so both must stay public. The third is a second, unmaintained anon entry
-- point to the same listing data and is closed here.
--
-- The remaining SECURITY DEFINER functions are reachable only through the
-- default PUBLIC grant, which is exposure by omission rather than by intent.
--
-- WHY THIS IS DRIVEN BY A CATALOG QUERY
-- -------------------------------------
-- The revokes are generated from pg_proc rather than written as a fixed list.
-- Two reasons, both practical:
--
--   * A hardcoded `revoke execute on function public.foo()` fails outright if
--     `foo` does not exist in the target database. Deployments have drifted
--     from these migration files before, so a list that is correct here can
--     still abort halfway through somewhere else — and a migration that aborts
--     partway is worse than one that does nothing.
--   * It stays correct for functions added later. A new SECURITY DEFINER
--     function is covered the next time this runs, instead of silently
--     reopening the surface this migration exists to close.
--
-- It is idempotent: revoking a privilege that is already absent is a no-op, so
-- this can be run repeatedly and after any of the existing migrations.

begin;

do $$
declare
  target record;
  -- Functions that must KEEP execute access beyond the owner.
  --
  -- The public share flow, both halves of it. src/lib/publicShare.ts calls
  -- xbar_resolve_public_listing to open a shared listing and
  -- xbar_track_public_share_view to record the view, both from a browser with
  -- no account, so both must stay reachable by anon.
  --
  -- xbar_resolve_public_listing_legacy is deliberately NOT here: it is
  -- referenced from nowhere in src/ or api/, so it is a second, unmaintained
  -- anon entry point to the same listing data. See the note at the bottom
  -- about restoring it if old share links turn out to still reach it.
  -- Exact signatures, not names. A name-only allowlist exempts every overload
  -- of these names from the revoke, so a drifted database carrying an
  -- unintended `xbar_resolve_public_listing(uuid)` would keep it reachable by
  -- anon — through the very migration written to close that surface. Only
  -- these two signatures serve the buyer flow.
  keep_public text[] := array[
    'xbar_resolve_public_listing(text, text)',
    'xbar_track_public_share_view(text, text)'
  ];
begin
  for target in
    select p.oid::regprocedure::text as signature, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef                       -- SECURITY DEFINER only
      and p.proname like 'xbar\_%'
      and not (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = any(keep_public))
    order by p.proname
  loop
    -- Both are needed, and neither substitutes for the other.
    --
    -- Revoking only `anon` leaves the underlying PUBLIC grant in place, which
    -- anon inherits, so nothing changes. Revoking only PUBLIC leaves any
    -- *explicit* grant to anon untouched — this schema issues several, so a
    -- PUBLIC-only revoke silently leaves those functions wide open. Verified
    -- against a real PostgreSQL 16 instance with this schema loaded.
    execute format('revoke execute on function %s from public', target.signature);
    execute format('revoke execute on function %s from anon', target.signature);
  end loop;
end
$$;

-- Re-assert every grant the application actually needs.
--
-- These are written as explicit grants rather than relied upon from PUBLIC, so
-- the intended surface is stated in one place instead of implied by what was
-- not revoked. Each is guarded by an existence check for the same reason the
-- revokes are generated: a database missing one of these should not abort the
-- whole migration.
do $$
declare
  grantee record;
begin
  for grantee in
    select *
    from (
      values
        -- RLS helpers, referenced by 19 policies each. A policy that calls a
        -- function requires the *querying* role to hold EXECUTE on it, so the
        -- grant below is what keeps signed-in data access working after the
        -- PUBLIC grant is removed. Without it every read fails with
        -- "permission denied for function" — this is the line that makes
        -- revoking PUBLIC safe rather than catastrophic.
        ('xbar_has_workspace_access', 'authenticated'),
        ('xbar_can_manage_workspace', 'authenticated'),
        -- Entitlement lookups read from inside other SECURITY DEFINER
        -- functions, but the schema grants them to authenticated already and
        -- that grant is preserved here rather than quietly dropped.
        ('xbar_commercial_limits', 'authenticated'),
        ('xbar_subscription_limits', 'authenticated'),
        -- Storage accounting is called from api/_lib/entitlements.js with the
        -- service role. service_role is NOT exempt from the revoke above:
        -- BYPASSRLS covers row-level policies and nothing else, and function
        -- EXECUTE is an ordinary privilege that service_role held here only
        -- through the default PUBLIC grant. Without this grant the storage cap
        -- stops being enforceable.
        ('xbar_workspace_storage_bytes', 'service_role'),
        ('xbar_workspace_storage_bytes', 'authenticated')
    ) as t(fn_name, role_name)
  loop
    -- coalesce so a database that lacks one of these still applies the rest;
    -- execute(NULL) would abort the block.
    execute coalesce(
      (
        select string_agg(format('grant execute on function %s to %I', p.oid::regprocedure, grantee.role_name), '; ')
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = grantee.fn_name
      ),
      'select 1'
    );
  end loop;
exception
  when others then
    raise exception 'Re-granting execute failed: %', sqlerrm;
end
$$;

-- The intentionally public RPCs, stated explicitly so the anon surface is
-- defined in one place rather than inferred from what was not revoked.
do $$
declare
  fn text;
begin
  foreach fn in array array['xbar_resolve_public_listing', 'xbar_track_public_share_view']
  loop
    execute coalesce(
      (
        select string_agg(format('grant execute on function %s to anon, authenticated', p.oid::regprocedure), '; ')
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fn
      ),
      'select 1'
    );
  end loop;
end
$$;

commit;

-- WHAT THIS DOES NOT COVER
-- ------------------------
-- pg_graphql table exposure is a separate concern: it reports that table
-- shapes are discoverable through the GraphQL endpoint, which this app does not
-- use, and RLS still governs every row. Disabling pg_graphql or revoking
-- table-level SELECT from anon is a larger change and belongs in its own
-- migration.
--
-- HOW TO APPLY THIS
-- -----------------
-- Not applied by this change, and it should not be run straight at production.
--
--   1. Create a Supabase branch (or restore a snapshot into a scratch project)
--      and apply it there:
--
--        supabase db push --db-url "$STAGING_DATABASE_URL"
--
--      or paste the file into the SQL editor for that branch.
--
--   2. Confirm the anon surface actually shrank. This should return exactly the
--      two functions the buyer share flow needs and nothing else:
--
--        xbar_resolve_public_listing
--        xbar_track_public_share_view
--
--        select p.proname, r.rolname
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--        cross join lateral (values ('anon')) as r(rolname)
--        where n.nspname = 'public'
--          and p.proname like 'xbar\_%'
--          and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
--        order by p.proname;
--
--   3. Confirm nothing that should work broke. As a signed-in user, load a
--      workspace and read horses, documents and sale packets — those paths go
--      through the RLS policies that call xbar_has_workspace_access and
--      xbar_can_manage_workspace, so a missing grant shows up immediately as
--      "permission denied for function". Then run a document upload, which
--      exercises xbar_workspace_storage_bytes through the service role.
--
--   4. Re-run Supabase's security advisor and confirm the
--      anon_security_definer_function_executable count drops to 2 — the two
--      RPCs above, which are anon-reachable by design because a buyer opens a
--      share link with no account.
--
--      Two, not one: xbar_track_public_share_view is re-granted deliberately
--      alongside the resolver. Reading a lower number as success, or revoking
--      the tracking RPC to reach one, breaks public-view recording.
--
--   5. Only then apply to production, ideally in a low-traffic window.
--
-- ROLLBACK
-- --------
-- Restoring the previous state is a single statement per function:
--
--   grant execute on function public.<name>(<args>) to public;
--
-- but prefer fixing the specific missing grant over restoring PUBLIC access
-- wholesale, since PUBLIC is what this migration exists to remove.
--
-- IF OLD SHARE LINKS BREAK
-- ------------------------
-- The one behavioral risk in this migration is xbar_resolve_public_listing_legacy.
-- It is called from nowhere in this repository, so closing it should be
-- invisible — but a browser running a cached older bundle could still reach it,
-- and those buyers would see the listing fail to load. If that happens:
--
--   grant execute on function public.xbar_resolve_public_listing_legacy(text, text)
--     to anon, authenticated;
--
-- Prefer confirming from request logs that something actually calls it before
-- restoring, rather than restoring pre-emptively: it resolves the same listing
-- data as the current function and is no longer maintained alongside it.
