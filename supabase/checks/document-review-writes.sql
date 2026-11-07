-- Disposable PostgreSQL only. All synthetic records are rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.expect_review_refusal(command text) returns void
language plpgsql as $$
begin
  begin
    execute command;
    raise exception 'Upload permission forged document approval' using errcode = 'P9999';
  exception when raise_exception then
    if sqlerrm <> 'Document approval requires reviewDocuments permission.' then raise; end if;
  end;
end;
$$;
do $$ begin
  execute format('grant usage on schema %I to authenticated', (select nspname from pg_namespace where oid=pg_my_temp_schema()));
end $$;
grant execute on function pg_temp.expect_review_refusal(text) to authenticated;

do $check$
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  sales_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  other_ws uuid := gen_random_uuid();
  caller uuid;
  changed integer;
  patch jsonb;
begin
  insert into auth.users(id,email)
    select id,id::text || '@example.invalid' from unnest(array[owner_id,manager_id,sales_id,reviewer_id,outsider_id]) id;
  insert into public.workspaces(id,owner_user_id,workspace_key) values
    (ws,owner_id,ws::text),(other_ws,manager_id,other_ws::text);
  insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values
    (ws,'Enterprise','Manual Billing'),(other_ws,'Enterprise','Manual Billing');
  insert into public.workspace_memberships(workspace_id,user_id,email,role,status) values
    (ws,manager_id,'manager@example.invalid','Ranch Manager','active'),
    (ws,sales_id,'sales@example.invalid','Sales Lead','active'),
    (ws,reviewer_id,'reviewer@example.invalid','Medical Lead','active');
  insert into public.documents(workspace_id,document_id,horse_id,title,state,payload) values
    (ws,'pending','horse-a','Synthetic pending','Needs Review','{"id":"pending","horseId":"horse-a","state":"Needs Review"}'),
    (ws,'approved','horse-a','Synthetic reviewed','Ready','{"id":"approved","horseId":"horse-a","state":"Ready","storagePath":"original.pdf","entities":{"horseName":"Blue"}}');

  foreach caller in array array[manager_id,sales_id] loop
    perform set_config('request.jwt.claim.sub',caller::text,true);
    set local role authenticated;
    perform pg_temp.expect_review_refusal(format(
      'insert into public.documents(workspace_id,document_id,title,state,payload) values(%L,''forged'',''Synthetic'',''Ready'',''{"state":"Ready"}'')',ws));
    perform pg_temp.expect_review_refusal(format(
      'insert into public.documents(workspace_id,document_id,title,state,payload) values(%L,''payload-forged'',''Synthetic'',''Needs Review'',''{"state":"Ready"}'')',ws));
    perform pg_temp.expect_review_refusal(format(
      'update public.documents set state=''Ready'' where workspace_id=%L and document_id=''pending''',ws));
    perform pg_temp.expect_review_refusal(format(
      'update public.documents set payload=jsonb_set(payload,''{state}'',''"Ready"'') where workspace_id=%L and document_id=''pending''',ws));
    perform pg_temp.expect_review_refusal(format(
      'insert into public.documents(workspace_id,document_id,title,state,payload) values(%L,''pending'',''Synthetic'',''Ready'',''{"state":"Ready"}'') on conflict(workspace_id,document_id) do update set state=excluded.state,payload=excluded.payload',ws));
    foreach patch in array array[
      '{"storagePath":"replacement.pdf"}'::jsonb,
      '{"localFileKey":"replacement"}'::jsonb,
      '{"downloadUrl":"https://other.example.invalid/original"}'::jsonb,
      '{"contentSha256":"changed"}'::jsonb,
      '{"entities":{"horseName":"Different"}}'::jsonb,
      '{"extractedTextPreview":"replacement original"}'::jsonb,
      '{"identityReviewRequired":false}'::jsonb,
      '{"horseId":"horse-b"}'::jsonb
    ] loop
      perform pg_temp.expect_review_refusal(format(
        'update public.documents set payload=payload || %L::jsonb where workspace_id=%L and document_id=''approved''',patch,ws));
    end loop;
    perform pg_temp.expect_review_refusal(format(
      'update public.documents set horse_id=''horse-b'' where workspace_id=%L and document_id=''approved''',ws));
    perform pg_temp.expect_review_refusal(format(
      'update public.documents set document_id=''renamed'' where workspace_id=%L and document_id=''approved''',ws));
    -- AFTER enforcement must allow an unchanged approved upsert to reach UPDATE.
    insert into public.documents(workspace_id,document_id,horse_id,title,state,payload)
      select workspace_id,document_id,horse_id,title,state,payload from public.documents
      where workspace_id=ws and document_id='approved'
      on conflict(workspace_id,document_id) do update set payload=excluded.payload;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Unchanged approved upsert did not save'; end if;
    update public.documents set updated_at=now() where workspace_id=ws and document_id='approved';
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Ordinary approved save did not save'; end if;
    update public.documents set title='Pending edit' where workspace_id=ws and document_id='pending';
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Pending edit did not save'; end if;
    reset role;
  end loop;

  -- Moving into the caller's own workspace permits a fresh review there, but
  -- that approval cannot be carried back into a workspace where they only upload.
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  set local role authenticated;
  update public.documents set workspace_id=other_ws,state='Ready',payload=payload || '{"state":"Ready"}'
    where workspace_id=ws and document_id='pending';
  if not found then raise exception 'Authorized destination review did not save'; end if;
  perform pg_temp.expect_review_refusal(format(
    'update public.documents set workspace_id=%L where workspace_id=%L and document_id=''pending''',ws,other_ws));
  update public.documents set workspace_id=ws,state='Needs Review',payload=payload || '{"state":"Needs Review"}'
    where workspace_id=other_ws and document_id='pending';
  if not found then raise exception 'Unapproved return transfer did not save'; end if;
  -- An uploader may invalidate approval to replace a source, but not retain it.
  update public.documents set state='Needs Review',payload=payload || '{"state":"Needs Review","storagePath":"replacement.pdf"}'
    where workspace_id=ws and document_id='approved';
  if not found then raise exception 'Returning a changed source to review did not save'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',reviewer_id::text,true);
  set local role authenticated;
  update public.documents set state='Ready',payload=payload || '{"state":"Ready"}'
    where workspace_id=ws and document_id='approved';
  if not found then raise exception 'Medical Lead review did not save'; end if;
  insert into public.documents(workspace_id,document_id,title,state,payload)
    values(ws,'reviewed-new','Reviewed','Ready','{"state":"Ready"}');
  reset role;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  set local role authenticated;
  update public.documents set state='Ready' where workspace_id=ws;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Another workspace changed records'; end if;
  reset role;
end;
$check$;
rollback;
select 'PASS: upload roles cannot forge or transfer approval; reviewer controls and unchanged saves work; no synthetic records retained' as result;
