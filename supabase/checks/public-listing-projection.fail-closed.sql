-- Emergency privacy-preserving fallback, ONLY with explicit owner authorization.
-- Buyer listing resolution/media/inquiries will be unavailable until forward repair.
-- Never restore the historical raw-payload resolver as a rollback.
begin;
create or replace function public.xbar_resolve_public_listing_legacy(
  p_share_path text,
  p_share_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return null;
end;
$function$;
commit;
