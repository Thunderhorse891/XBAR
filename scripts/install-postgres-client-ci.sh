#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's default repository may not contain the production database's major
# version. Use PostgreSQL's signed repository, not a different pg_dump version.
# https://www.postgresql.org/download/linux/ubuntu/
source /etc/os-release
sudo apt-get update
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$VERSION_CODENAME" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update
sudo apt-get install -y postgresql-client-17
echo '/usr/lib/postgresql/17/bin' >> "$GITHUB_PATH"
