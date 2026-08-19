-- Close the unauthenticated RPC surface created by PostgreSQL's default grant.
--
-- PROPOSED — NOT YET APPLIED. Review before running against production.
--
-- WHY
-- ---
-- Supabase's security advisor reports 12 SECURITY DEFINER functions executable
-- by the `anon` role via /rest/v1/rpc/<name>. SECURITY DEFINER runs with the
-- definer's privileges and therefore bypasses RLS, so anything reachable by
-- `anon` is reachable by anyone holding the publishable key — which ships in
-- the browser bundle by design.
--
-- Almost none of that exposure was intended. `CREATE FUNCTION` grants EXECUTE
-- to PUBLIC by default, and `anon` inherits it. Searching this schema for
-- deliberate anon grants returns exactly two functions:
--
--     grant execute on function public.xbar_resolve_public_listing(text, text)
--       to anon, authenticated;
--     grant execute on function public.xbar_track_public_share_view(text, text)
--       to anon, authenticated;
--
-- Those two are the buyer share flow (src/lib/publicShare.ts) and must stay
-- public — a buyer opens a link with no account. Everything else below is
-- exposed by the default grant, not by intent.
--
-- WHAT THIS DOES
-- --------------
-- Revokes EXECUTE from PUBLIC (which is where `anon` inherits it) on functions
-- that no unauthenticated caller has any reason to invoke. Revoking from PUBLIC
-- rather than from `anon` is deliberate: revoking the role alone leaves the
-- underlying PUBLIC grant in place. Explicit grants to `authenticated` are
-- unaffected and are re-asserted below so this migration is self-documenting
-- and safe to re-run.
--
-- WHY EACH ONE IS SAFE
-- --------------------
-- The four trigger functions return `trigger` and are attached with CREATE
-- TRIGGER (trg_shared_listings_audit, trg_*_enforce_commercial_limits,
-- trg_documents_enforce_storage, trg_sale_packets_enforce_storage, and the
-- seat-limit trigger). PostgreSQL fires a trigger as part of the statement and
-- does not require the invoking role to hold EXECUTE on the trigger function,
-- so revoking closes the direct RPC path without disarming any enforcement.
--
-- xbar_workspace_storage_bytes is called only from api/ using the service role,
-- which bypasses grants entirely.
--
-- xbar_commercial_limits and xbar_subscription_limits are read from inside
-- other SECURITY DEFINER functions (`select * into limits from ...`), which run
-- as the definer, so the caller's privileges are irrelevant. Their explicit
-- grants to `authenticated` are preserved below.

begin;

-- Trigger functions: fired by the statement, never called directly.
revoke execute on function public.xbar_audit_shared_listing_change() from public;
revoke execute on function public.xbar_enforce_commercial_resource_limits() from public;
revoke execute on function public.xbar_enforce_workspace_seat_limits() from public;
revoke execute on function public.xbar_enforce_storage_limit() from public;

-- Server-side accounting: invoked with the service role only.
revoke execute on function public.xbar_workspace_storage_bytes(p_workspace_id uuid) from public;

-- Entitlement lookups: read from inside SECURITY DEFINER callers.
revoke execute on function public.xbar_commercial_limits(p_workspace_id uuid) from public;
revoke execute on function public.xbar_subscription_limits(p_workspace_id uuid) from public;

-- Preserve the deliberate authenticated grants the schema already declares.
grant execute on function public.xbar_commercial_limits(p_workspace_id uuid) to authenticated;
grant execute on function public.xbar_subscription_limits(p_workspace_id uuid) to authenticated;

-- Re-assert the two intentionally public RPCs. No-ops today; they make the
-- intended anon surface explicit in one place rather than implied by absence.
grant execute on function public.xbar_resolve_public_listing(text, text) to anon, authenticated;
grant execute on function public.xbar_track_public_share_view(text, text) to anon, authenticated;

commit;

-- DELIBERATELY NOT TOUCHED
-- ------------------------
-- public.xbar_has_workspace_access(...)
-- public.xbar_can_manage_workspace(...)
--     Each is referenced by 32 RLS policies in this schema. A policy calling a
--     function requires the querying role to hold EXECUTE on it, so revoking
--     would not harden anything — it would make policy evaluation fail with
--     "permission denied for function" and break data access for signed-in
--     users. They are SECURITY DEFINER because that is how they read
--     membership without recursing through the policies that call them.
--     Hardening these means changing how policies are written, not a revoke.
--
-- public.xbar_resolve_public_listing_legacy(...)
--     Left alone deliberately. It is not called anywhere in src/ or api/, so it
--     looks removable — but share links already in circulation may still reach
--     it through a cached client, and revoking access to a resolver that buyers
--     might still hit would break real links for no security gain that the
--     current resolver's own checks do not already provide. Decide this with
--     traffic data, not from the schema.
--
-- AFTER APPLYING
-- --------------
-- Re-run the security advisor. The anon_security_definer_function_executable
-- count should drop from 12 to 5 (the two public RPCs, the two RLS helpers, and
-- the legacy resolver). The pg_graphql_*_table_exposed warnings are separate:
-- they report that table shapes are discoverable through the GraphQL endpoint,
-- which this app does not use — RLS still governs every row. Disabling
-- pg_graphql, or revoking table-level SELECT from anon, is a larger change and
-- belongs in its own migration.
