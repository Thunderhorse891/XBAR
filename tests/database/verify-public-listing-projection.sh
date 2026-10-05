#!/usr/bin/env bash
set -euo pipefail
# Never target a saved/production connection. The only permitted target is CI's disposable fixture.
if [[ "${PGHOST:-}" != localhost && "${PGHOST:-}" != 127.0.0.1 ]] || [[ "${PGDATABASE:-}" != recovery_fixture || "${PGUSER:-}" != postgres || "${PGPASSWORD:-}" != synthetic-ci-only ]]; then
  echo 'Refusing public-listing fixture outside its isolated synthetic PostgreSQL service.' >&2
  exit 2
fi
historical_file=$(mktemp)
trap 'rm -f "$historical_file"' EXIT
node --input-type=module - "$historical_file" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('supabase/migrations/20261001090000_workspace_keyed_storage_expand.sql','utf8');
const start=source.indexOf('create or replace function public.xbar_resolve_public_listing_legacy(');
const end=source.indexOf('\ncommit;',start);
if(start<0||end<0)throw Error('Historical resolver not found');
writeFileSync(process.argv[2],source.slice(start,end));
JS
psql -X -v ON_ERROR_STOP=1 -f "$historical_file"
psql -X -v ON_ERROR_STOP=1 -v expect_fixed=0 -f tests/database/public-listing-projection.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/checks/public-listing-projection.candidate.sql
psql -X -v ON_ERROR_STOP=1 -v expect_fixed=1 -f tests/database/public-listing-projection.sql
# CREATE OR REPLACE must be idempotent.
psql -X -v ON_ERROR_STOP=1 -f supabase/checks/public-listing-projection.candidate.sql
psql -X -v ON_ERROR_STOP=1 -v expect_fixed=1 -f tests/database/public-listing-projection.sql
