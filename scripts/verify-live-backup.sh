#!/usr/bin/env bash
# Restaura somente em MySQL temporário sem rede, portas ou volumes persistentes.
set +x
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if (( $# )); then printf 'Uso: bash scripts/verify-live-backup.sh\n' >&2; exit 2; fi
backup_require
backup_private_root
exec 9>"$backup_root/.lock"
flock -w 600 9
backup_name="$(node -e 'const {completedBackups}=require(process.argv[1]);const latest=completedBackups(process.argv[2])[0];if(!latest)process.exit(2);console.log(latest)' "$backup_project_root/backend/src/backup-retention.js" "$backup_root")"
backup_dir="$backup_root/$backup_name"
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
gzip -t "$backup_dir/backup.sql.gz"
mapfile -t restore_fields < <(node -e '
const r=require(process.argv[1]);if(!/^sha256:[a-f0-9]{64}$/.test(r.mysql_image)||!Number.isInteger(r.base_tables)||r.base_tables<12)process.exit(2);console.log(r.mysql_image);console.log(r.base_tables)
' "$backup_dir/manifest.json")
if [[ ${#restore_fields[@]} != 2 ]]; then printf 'Manifesto do backup inválido.\n' >&2; exit 2; fi
mysql_image="${restore_fields[0]}"
expected_tables="${restore_fields[1]}"
# Não muda de versão silenciosamente nem baixa imagens externas durante o ensaio.
docker image inspect "$mysql_image" >/dev/null
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
restore_container="delivery-backup-check-${run_id,,}"
restore_tmpdir="$(mktemp -d)"
restore_env="$restore_tmpdir/mysql.env"
printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_DATABASE=delivery_restore_test\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" > "$restore_env"
cleanup() {
 result=$?
 trap - EXIT
 set +e
 if docker container inspect "$restore_container" >/dev/null 2>&1; then
  if ! docker rm -f "$restore_container" >/dev/null; then
   printf 'Limpeza incompleta: %s\n' "$restore_container" >&2
   result=4
  fi
 fi
 rm -f -- "$restore_env" "$restore_tmpdir/tables.txt" "$restore_tmpdir/check.sql" "$restore_tmpdir/check.tsv"
 rmdir -- "$restore_tmpdir"
 if (( result )); then printf 'RESTAURAÇÃO NÃO APROVADA (código %s). Backup e produção preservados.\n' "$result" >&2; fi
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Testando restauração isolada de %s...\n' "$backup_name"
docker run --detach --name "$restore_container" --network none --memory 1g --memory-swap 1g --tmpfs /var/lib/mysql:size=512m --env-file "$restore_env" "$mysql_image" --event-scheduler=OFF --local-infile=OFF --skip-log-bin --skip-networking >/dev/null
ready=false
for attempt in {1..60}; do
 if docker exec "$restore_container" sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql --user=root --batch --skip-column-names -e "SELECT 1" delivery_restore_test' >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
if [[ "$ready" != true ]]; then printf 'MySQL de restauração não iniciou dentro do prazo.\n' >&2; exit 3; fi
gzip -dc "$backup_dir/backup.sql.gz" | docker exec -i "$restore_container" sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --default-character-set=utf8mb4 --binary-mode=1 delivery_restore_test
'
actual_tables="$(docker exec "$restore_container" sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --batch --skip-column-names delivery_restore_test -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\"BASE TABLE\"; SELECT id, company_id, password_hash FROM users LIMIT 0; SELECT id, customer_name, snapshot_source FROM orders LIMIT 0; SELECT company_id, request_key FROM checkout_requests LIMIT 0;"
')"
if [[ "$actual_tables" != "$expected_tables" ]]; then printf 'Número de tabelas restauradas divergiu do manifesto.\n' >&2; exit 3; fi
printf '%s\n' "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;" | docker exec -i "$restore_container" sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --batch --raw --skip-column-names delivery_restore_test
' > "$restore_tmpdir/tables.txt"
node "$backup_project_root/backend/scripts/check-restored-tables.js" --sql "$restore_tmpdir/tables.txt" "$expected_tables" > "$restore_tmpdir/check.sql"
docker exec -i "$restore_container" sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --batch --raw --skip-column-names delivery_restore_test
' < "$restore_tmpdir/check.sql" > "$restore_tmpdir/check.tsv"
node "$backup_project_root/backend/scripts/check-restored-tables.js" --verify "$restore_tmpdir/tables.txt" "$expected_tables" "$restore_tmpdir/check.tsv"
docker rm -f "$restore_container" >/dev/null
node -e 'const fs=require("node:fs"),path=require("node:path");fs.writeFileSync(path.join(process.argv[1],"restore-check.json"),JSON.stringify({status:"RESTORE_PASSED",checked_at:new Date().toISOString(),base_tables:Number(process.argv[2]),production_changed:false,temporary_container_removed:true},null,2)+"\n",{mode:0o600})' "$backup_dir" "$expected_tables"
printf 'RESTAURAÇÃO APROVADA. Tabelas conferidas e container temporário removido.\n'
