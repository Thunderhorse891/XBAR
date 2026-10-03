#!/usr/bin/env bash
# Disposable PostgreSQL only. Never run this fixture writer on production.
set -euo pipefail
if [[ $(psql -Atqc 'select current_database()') != xbar_storage_test ]]; then
  echo 'Refusing to seed storage preflight fixtures outside xbar_storage_test.' >&2
  exit 1
fi

migration=supabase/migrations/20261001090100_workspace_keyed_storage_contract.sql
user_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
owner_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
psql -v ON_ERROR_STOP=1 -c "insert into auth.users (id) values ('$user_id'), ('$owner_id');"
for bucket in horse-media horse-documents; do
  for state in legacy collision; do
    if [[ $state == collision ]]; then
      # An attacker-created workspace must not relabel another user's old bytes.
      psql -v ON_ERROR_STOP=1 -c "insert into public.workspaces (id, owner_user_id) values ('$user_id', '$owner_id');"
    fi
    psql -v ON_ERROR_STOP=1 -c "insert into storage.objects (bucket_id, name, owner) values ('$bucket', '$user_id/fixture/legacy.bin', '$user_id');"
    if out=$(psql -v ON_ERROR_STOP=1 -f "$migration" 2>&1); then
      echo 'Storage contract accepted legacy or ambiguous bytes; the inventory gate did not run.' >&2
      exit 1
    fi
    echo "$out" | grep -q 'Storage contract refused: legacy or ambiguous object namespaces remain' || { echo "$out"; exit 1; }
    # A failed cutover preserves the original policies and bytes.
    [[ $(psql -Atqc "select count(*) from storage.objects where bucket_id='$bucket' and name='$user_id/fixture/legacy.bin'") == 1 ]]
    [[ $(psql -Atqc "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='horse media update own'") == 1 ]]
    psql -v ON_ERROR_STOP=1 -c "delete from storage.objects where bucket_id='$bucket' and name='$user_id/fixture/legacy.bin';"
    if [[ $state == collision ]]; then
      psql -v ON_ERROR_STOP=1 -c "delete from public.workspaces where id='$user_id';"
    fi
  done
done
psql -v ON_ERROR_STOP=1 -c "delete from auth.users where id = '$user_id';"
# Leave valid, nonempty controls through expand/contract. Both UUID spellings
# must survive; they are checked by the workflow immediately after cutover.
psql -v ON_ERROR_STOP=1 <<SQL
insert into public.workspaces (id, owner_user_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '$owner_id');
insert into storage.objects (bucket_id, name, owner) values
  ('horse-documents', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/documents/preflight/keep.pdf', '$owner_id'),
  ('horse-media', 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC/horses/preflight/media-keep.jpg', '$owner_id');
SQL
echo 'PASS: both buckets refuse legacy/user-workspace collisions and preserve data and policies on failure'
