-- Rolled-back claim identity and privilege contract; sends no email.
begin;
do $$
declare
  workspace uuid := (select id from public.workspaces limit 1);
  delivery uuid := gen_random_uuid();
  reminder text := 'delivery-contract-' || gen_random_uuid()::text;
begin
  if has_table_privilege('anon', 'public.reminder_email_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'public.reminder_email_deliveries', 'INSERT')
    or has_table_privilege('authenticated', 'public.reminder_email_deliveries', 'UPDATE') then
    raise exception 'Delivery claims exposed outside service role';
  end if;
  if workspace is null then raise exception 'A disposable or existing workspace is needed'; end if;
  insert into public.reminder_email_deliveries(id,workspace_id,reminder_id,due_date,status)
    values(delivery,workspace,reminder,current_date,'pending');
  begin
    insert into public.reminder_email_deliveries(id,workspace_id,reminder_id,due_date,status)
      values(gen_random_uuid(),workspace,reminder,current_date,'pending');
    raise exception 'Duplicate occurrence was accepted';
  exception when unique_violation then null;
  end;
  update public.reminder_email_deliveries set status='accepted',accepted_at=now()
    where id=delivery and status='pending';
  if not found then raise exception 'Pending claim could not be acknowledged'; end if;
end $$;
rollback;
