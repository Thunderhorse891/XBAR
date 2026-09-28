-- Isolated CI fixture and rolled-back claim identity/privilege contract; sends no email.
begin;
do $$
declare
  fixture_owner uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  delivery uuid := gen_random_uuid();
  reminder text := 'delivery-contract-' || gen_random_uuid()::text;
  retry_at timestamptz := now() - interval '1 hour';
begin
  if has_table_privilege('anon', 'public.reminder_email_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'public.reminder_email_deliveries', 'INSERT')
    or has_table_privilege('authenticated', 'public.reminder_email_deliveries', 'UPDATE') then
    raise exception 'Delivery claims exposed outside service role';
  end if;
  insert into auth.users(id,email) values(fixture_owner,'reminder-contract@example.invalid');
  insert into public.workspaces(id,owner_user_id) values(workspace,fixture_owner);
  insert into public.reminder_email_deliveries(id,workspace_id,reminder_id,due_date,status)
    values(delivery,workspace,reminder,current_date,'pending');
  begin
    insert into public.reminder_email_deliveries(id,workspace_id,reminder_id,due_date,status)
      values(gen_random_uuid(),workspace,reminder,current_date,'pending');
    raise exception 'Duplicate occurrence was accepted';
  exception when unique_violation then null;
  end;
  update public.reminder_email_deliveries set next_attempt_at=retry_at where id=delivery;
  update public.reminder_email_deliveries set next_attempt_at=null where id=delivery and next_attempt_at=retry_at;
  if not found then raise exception 'Declined retry could not be claimed'; end if;
  update public.reminder_email_deliveries set next_attempt_at=null where id=delivery and next_attempt_at=retry_at;
  if found then raise exception 'Retry was claimed twice'; end if;
  update public.reminder_email_deliveries set status='accepted',accepted_at=now()
    where id=delivery and status='pending';
  if not found then raise exception 'Pending claim could not be acknowledged'; end if;
end $$;
rollback;
