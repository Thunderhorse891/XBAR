-- Prepared only: production application requires Erin's explicit approval.
-- Upload permission never grants approval. A reviewed record can be saved
-- unchanged by its uploader, or returned to review before replacing its source.
begin;
create or replace function public.xbar_guard_document_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service endpoints authorize their own actions; administrative maintenance
  -- remains possible. Ordinary authenticated requests must use the role matrix.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if public.xbar_has_workspace_capability(new.workspace_id, 'reviewDocuments') then
    return new;
  end if;
  -- Both readers exist: relational columns feed server/buyer paths; payload
  -- feeds the browser. Neither representation may be used to forge approval.
  if new.state = 'Ready' or new.payload ->> 'state' = 'Ready' then
    if tg_op = 'UPDATE' then
      -- Compare all stored evidence, identity and metadata, including future
      -- columns. Only the write timestamp is not part of the reviewed record.
      -- An AFTER trigger sees the actual UPDATE branch of INSERT ON CONFLICT,
      -- so an unchanged approved upsert does not look like a forged new insert.
      if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
        return new;
      end if;
    end if;
    raise exception 'Document approval requires reviewDocuments permission.';
  end if;
  return new;
end;
$$;
revoke all on function public.xbar_guard_document_approval() from public, anon, authenticated;
create or replace trigger trg_documents_guard_approval
after insert or update on public.documents
for each row execute function public.xbar_guard_document_approval();
commit;
