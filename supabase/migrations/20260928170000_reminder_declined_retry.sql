begin;
-- Only confirmed, retryable provider rejections get a next attempt. NULL stays
-- held after uncertain transport/receipt failures, with no automatic reclaim.
alter table public.reminder_email_deliveries add column if not exists request jsonb;
alter table public.reminder_email_deliveries add column if not exists next_attempt_at timestamptz;
create index if not exists reminder_email_retry_due on public.reminder_email_deliveries(next_attempt_at)
  where status='pending' and next_attempt_at is not null;
commit;
