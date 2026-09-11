-- Integration check against the deployed schema. All fixture rows and audit
-- events roll back; no tables, policies, functions, or constraints are changed.
-- Requires an existing auth user and an administrative database connection.
-- This checks SQL behavior, not customer authentication or Stripe billing.
begin;
do $check$
declare
  fixture_workspace uuid := gen_random_uuid();
  fixture_owner uuid;
  fixture_path text := '/verify/codex-check-' || gen_random_uuid()::text;
  release_payload jsonb := '{"releaseConfirmedAt":"2026-09-10T00:00:00Z","releaseConfirmedBy":"Transactional test fixture"}';
  rejected_constraint text;
begin
  select id into fixture_owner from auth.users order by created_at limit 1;
  if fixture_owner is null then raise exception 'An existing auth user is required'; end if;
  insert into public.workspaces (id, owner_user_id, workspace_key, name)
  values (fixture_workspace, fixture_owner, fixture_workspace::text, 'Rollback verification');
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
  values (fixture_workspace, 'Professional', 'Manual Billing');
  insert into public.horses (workspace_id, horse_id, name, payload)
  values (fixture_workspace, 'fixture-horse', 'Rollback fixture', '{"name":"Rollback fixture"}');

  begin
    insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, payload)
    values (fixture_workspace, 'invalid', 'fixture-horse', fixture_path, 'Live', release_payload);
    raise exception 'Empty private token unexpectedly accepted';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'shared_listings_private_token_present' then raise; end if;
  end;

  insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, share_token, payload)
  values (fixture_workspace, 'private', 'fixture-horse', fixture_path, 'Live', 'fixture-token', release_payload);
  if public.xbar_resolve_public_listing(fixture_path, null) is not null then raise exception 'Missing token resolved'; end if;
  if public.xbar_resolve_public_listing(fixture_path, 'wrong') is not null then raise exception 'Wrong token resolved'; end if;
  if public.xbar_resolve_public_listing(fixture_path, 'fixture-token') is null then raise exception 'Correct token refused'; end if;
  perform public.xbar_track_public_share_view(fixture_path, null);
  perform public.xbar_track_public_share_view(fixture_path, 'wrong');
  if exists (select 1 from public.public_share_events where workspace_id = fixture_workspace) then raise exception 'Refused view tracked'; end if;
  perform public.xbar_track_public_share_view(fixture_path, 'fixture-token');

  update public.shared_listings set access_mode = 'Public Link', share_token = ''
  where workspace_id = fixture_workspace and listing_id = 'private';
  if public.xbar_resolve_public_listing(fixture_path, null) is null then raise exception 'Public link refused'; end if;
  perform public.xbar_track_public_share_view(fixture_path, null);
  update public.shared_listings set state = 'Archived', access_mode = 'Private Token'
  where workspace_id = fixture_workspace and listing_id = 'private';
  if public.xbar_resolve_public_listing(fixture_path, null) is not null then raise exception 'Archived listing resolved'; end if;
  perform public.xbar_track_public_share_view(fixture_path, null);
  if (select count(*) from public.public_share_events where workspace_id = fixture_workspace) <> 2 then raise exception 'Unexpected view count'; end if;

  -- A released sibling must not authorize a newer draft with the same path.
  update public.shared_listings set state = 'Live', access_mode = 'Public Link'
  where workspace_id = fixture_workspace and listing_id = 'private';
  insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, access_mode, payload, updated_at)
  values (fixture_workspace, 'unreleased-draft', 'fixture-horse', fixture_path, 'Draft', 'Public Link', '{}', now() + interval '1 hour');
  if public.xbar_resolve_public_listing(fixture_path, null) is not null then raise exception 'Released sibling authorized an unreleased draft'; end if;
  if public.xbar_resolve_public_listing_legacy(fixture_path, null) is not null then raise exception 'Legacy resolver bypassed release approval'; end if;
  perform public.xbar_track_public_share_view(fixture_path, null);
  if (select count(*) from public.public_share_events where workspace_id = fixture_workspace) <> 2 then raise exception 'Unreleased draft view tracked'; end if;
end;
$check$;
rollback;
select 'PASS: token constraint, private/public/archive resolution, selected-row release approval, view tracking; fixture rolled back' as result;
