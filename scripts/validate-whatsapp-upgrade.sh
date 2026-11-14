#!/usr/bin/env bash
# Ensaio isolado com dados sintéticos, a partir da versão anterior ao WhatsApp.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null
base=cfa4f41526d69bb4e96517492d11af25d371d78e
name="apex-wa-rehearsal-$(date +%s)-$$"
temp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$temp"
}
trap cleanup EXIT
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
printf 'MYSQL_ROOT_PASSWORD=%s\n' "$password" > "$temp/mysql.env"
printf 'DB_HOST=localhost\nDB_USER=root\nDB_PASSWORD=%s\nDB_NAME=delivery_upgrade_test\nUPDATE_REPORT_DIR=/output\n' "$password" > "$temp/app.env"
docker run -d --name "$name" --env-file "$temp/mysql.env" --tmpfs /var/lib/mysql mysql:8.0 --event-scheduler=OFF >/dev/null
mysql_cmd=(docker exec -i "$name" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$@"' mysql)
for i in {1..90}; do
  if [[ "$("${mysql_cmd[@]}" -Nse "SELECT @@skip_networking" 2>/dev/null || true)" == 0 ]]; then break; fi
  sleep 2
done
"${mysql_cmd[@]}" -e 'CREATE DATABASE apex_fixture; CREATE DATABASE delivery_upgrade_test;'
for file in database/001-initial.sql database/002-checkout-requests.sql; do
  git show "$base:$file" | "${mysql_cmd[@]}" apex_fixture
done
"${mysql_cmd[@]}" apex_fixture -e "INSERT INTO companies (name,slug) VALUES ('Loja sintética', 'ensaio-whatsapp')"
docker exec "$name" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction apex_fixture' > "$temp/fixture.sql"
"${mysql_cmd[@]}" delivery_upgrade_test < "$temp/fixture.sql"
docker build -t "$name" .
trap 'docker image rm "$name" >/dev/null 2>&1 || true; cleanup' EXIT
docker run --rm --network "container:$name" --user 0:0 --env-file "$temp/app.env" \
  -e DB_HOST=127.0.0.1 -v "$temp:/output" "$name" node scripts/upgrade-live.js --rehearse
"${mysql_cmd[@]}" delivery_upgrade_test -Nse "SELECT COUNT(*) FROM companies WHERE slug='ensaio-whatsapp'" | grep -qx 1
printf 'Ensaio MySQL com backup sintético restaurado aprovado.\n'
