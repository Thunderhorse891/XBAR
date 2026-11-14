-- Disposable database only. All synthetic data rolls back.
begin;
do $$
declare
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  total integer;
begin
  insert into auth.users(id,email) values(owner_id,owner_id::text||'@example.invalid');
  insert into public.workspaces(id,owner_user_id,name) values(ws,owner_id,'Packet-window fixture');
  insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state)
    values(ws,'Professional','Active');
  insert into public.sale_packets(workspace_id,packet_id,created_at)
    select ws,'old-'||n,now()-interval '45 days' from generate_series(1,30) n;
  -- Historical packets must not prevent a new month's first packet.
  insert into public.sale_packets(workspace_id,packet_id) values(ws,'current-1');
  select count(*) into total from public.sale_packets where workspace_id=ws;
  assert total=31,'Historical packets were removed or the new packet was not saved';
  insert into public.sale_packets(workspace_id,packet_id)
    select ws,'current-'||n from generate_series(2,30) n;
  begin
    insert into public.sale_packets(workspace_id,packet_id) values(ws,'over-limit');
    raise exception 'Accepted 31 packets inside the current window';
  exception when raise_exception then
    if sqlerrm <> 'Sale packet limit reached for this workspace.' then raise; end if;
  end;
  update public.sale_packets set payload='{"title":"preserved"}' where workspace_id=ws and packet_id='old-1';
  insert into public.sale_packets(workspace_id,packet_id) values(ws,'current-1')
    on conflict(workspace_id,packet_id) do update set payload='{"title":"existing upsert"}';
  assert (select count(*)=60 from public.sale_packets where workspace_id=ws),'Edit or upsert generated another packet';
  -- Boundary is inclusive, matching the client and PostgREST gte filter.
  delete from public.sale_packets where workspace_id=ws;
  insert into public.sale_packets(workspace_id,packet_id)
    select ws,'recent-'||n from generate_series(1,29) n;
  insert into public.sale_packets(workspace_id,packet_id,created_at)
    values(ws,'edge',now()-interval '720 hours');
  begin
    insert into public.sale_packets(workspace_id,packet_id) values(ws,'edge-refused');
    raise exception 'The exact 30-day boundary was not counted';
  exception when raise_exception then
    if sqlerrm <> 'Sale packet limit reached for this workspace.' then raise; end if;
  end;
  update public.sale_packets set created_at=now()-interval '720 hours 1 microsecond' where workspace_id=ws and packet_id='edge';
  insert into public.sale_packets(workspace_id,packet_id) values(ws,'edge-renewed');
  update public.workspace_subscription_profiles set tier='Free',billing_state='Inactive' where workspace_id=ws;
  begin
    insert into public.sale_packets(workspace_id,packet_id) values(ws,'free-refused');
    raise exception 'Free generated a new packet';
  exception when raise_exception then
    if sqlerrm <> 'Sale packet limit reached for this workspace.' then raise; end if;
  end;
  update public.sale_packets set payload='{"title":"retained after downgrade"}' where workspace_id=ws;
  assert (select count(*)=31 from public.sale_packets where workspace_id=ws),'Downgrade changed packet inventory';
end $$;
rollback;
