#!/usr/bin/env bash
# After sale-packet-rolling-allowance.sql, run against the same fresh, local,
# disposable fixture. Uses socket defaults, never a remote DB URL.
set -euo pipefail
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
db=xbar_sale_packet_allowance_fixture
psql_local() {
  env -u PGHOST -u PGHOSTADDR -u PGSERVICE -u PGDATABASE \
    psql -X -d "$db" -v ON_ERROR_STOP=1 "$@"
}

psql_local >/dev/null <<'SQL'
do $$
begin
  if to_regclass('public.quota_fixture_limits') is null then
    raise exception 'Initialize the disposable sale packet fixture first.';
  end if;
end;
$$;
insert into public.quota_fixture_limits values ('10000000-0000-0000-0000-000000000099', 1);
SQL

claim_slot() {
  psql_local -v packet="$1" <<'SQL'
begin isolation level read committed;
insert into public.sale_packets (workspace_id, packet_id)
  values ('10000000-0000-0000-0000-000000000099', :'packet');
-- The first claimant holds the transaction lock while the second sees a
-- workspace whose winning row may not yet be committed.
select pg_sleep(2);
commit;
SQL
}
claim_slot concurrent-a >"$scratch/a.log" 2>&1 & a=$!
claim_slot concurrent-b >"$scratch/b.log" 2>&1 & b=$!
a_ok=0
b_ok=0
if wait "$a"; then a_ok=1; fi
if wait "$b"; then b_ok=1; fi
[[ $((a_ok + b_ok)) == 1 ]]
grep -q 'xbar_sale_packet_allowance_reached' "$scratch/a.log" "$scratch/b.log"
count=$(psql_local -Atc "select count(*) from public.sale_packets where workspace_id = '10000000-0000-0000-0000-000000000099'")
[[ $count == 1 ]]
printf '%s\n' 'PASS: exactly one of two simultaneous packet writes used the last slot.'
