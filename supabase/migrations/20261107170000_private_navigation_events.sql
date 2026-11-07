-- Prepared only. Erin's explicit approval is required before production.
-- Preserve event identity/ownership/timestamps; remove only navigation metadata
-- that can contain buyer credentials or authentication parameters.
begin;

create or replace function public.xbar_private_navigation_event()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  path text;
begin
  if new.event_name = 'navigation.page_view' then
    path := new.payload ->> 'pathname';
    if jsonb_typeof(new.payload -> 'pathname') = 'string'
       and left(path, 1) = '/' and left(path, 2) <> '//' then
      new.payload := jsonb_build_object('pathname', split_part(split_part(path, '?', 1), '#', 1));
    else
      new.payload := '{}'::jsonb;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.xbar_private_navigation_event() from public, anon, authenticated;

create or replace trigger trg_runtime_events_private_navigation
before insert or update on public.runtime_events
for each row execute function public.xbar_private_navigation_event();

-- Reuses the trigger above instead of maintaining a second sanitization rule.
-- All other event types and every non-payload column remain unchanged.
update public.runtime_events set payload = payload
where event_name = 'navigation.page_view'
  and payload is distinct from case
    when jsonb_typeof(payload -> 'pathname') = 'string'
      and left(payload ->> 'pathname', 1) = '/' and left(payload ->> 'pathname', 2) <> '//'
    then jsonb_build_object('pathname', split_part(split_part(payload ->> 'pathname', '?', 1), '#', 1))
    else '{}'::jsonb
  end;
commit;
