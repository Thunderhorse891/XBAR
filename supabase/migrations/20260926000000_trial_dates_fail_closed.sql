-- A timestamp-shaped string can still be an impossible date. The prior SQL
-- predicate's regex let such values reach a cast that aborts capacity checks.
-- Reject only date-conversion errors; do not hide unrelated database failures.
-- This changes no records, grants, signatures, or capacity limits.
-- Production application requires Erin's explicit migration approval.
-- Rollback: restore xbar_trial_active from 20260924130000_trial_entitlement.sql.
begin;

create or replace function public.xbar_trial_active(p_payload jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  trial_start timestamptz;
  trial_end timestamptz;
begin
  if (p_payload -> 'trial' ->> 'plan') is distinct from 'Professional' then
    return false;
  end if;
  if (p_payload -> 'trial' ->> 'startedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     or (p_payload -> 'trial' ->> 'endsAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' then
    return false;
  end if;

  trial_start := (p_payload -> 'trial' ->> 'startedAt')::timestamptz;
  trial_end := (p_payload -> 'trial' ->> 'endsAt')::timestamptz;
  return coalesce(
    trial_start <= now()
    and now() < trial_end
    and trial_end <= trial_start + interval '14 days',
    false
  );
exception
  when invalid_datetime_format or datetime_field_overflow then
    return false;
end;
$$;

commit;
