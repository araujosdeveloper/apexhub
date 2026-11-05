#!/usr/bin/env bash
# Dump online do banco REAL. Não pausa gravações nem reinicia containers.
set +x
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if (( $# )); then printf 'Uso: bash scripts/backup-live.sh\n' >&2; exit 2; fi
backup_require
backup_release
backup_private_root
exec 9>"$backup_root/.lock"
flock -w 600 9
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
partial_dir="$backup_root/.partial-$run_id"
final_dir="$backup_root/live-$run_id"
mkdir "$partial_dir"
cleanup() {
 result=$?
 trap - EXIT
 if [[ -d "$partial_dir" ]]; then rm -rf -- "$partial_dir"; fi
 if (( result )); then printf 'BACKUP FALHOU (código %s). Nenhum backup antigo foi removido antes de concluir o novo.\n' "$result" >&2; fi
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
nontransactional="$(printf '%s\n' "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND ENGINE <> 'InnoDB';" | backup_mysql)"
if [[ "$nontransactional" != 0 ]]; then printf 'Banco contém tabela não InnoDB; revisar consistência antes de continuar.\n' >&2; exit 3; fi
identity="$(printf '%s\n' "SELECT DATABASE(), @@server_uuid, VERSION(), (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE');" | backup_mysql)"
IFS=$'\t' read -r database_name server_uuid mysql_version table_count <<< "$identity"
if [[ "$database_name" != delivery_live_db || ! "$table_count" =~ ^[0-9]+$ || "$table_count" -lt 12 ]]; then printf 'Identidade/esquema do banco real divergente.\n' >&2; exit 3; fi
live_container="$(bash "$backup_release_dir/manage.sh" ps -q mysql)"
mysql_image="$(docker inspect --format '{{.Image}}' "$live_container")"
if [[ ! "$mysql_image" =~ ^sha256:[a-f0-9]{64}$ ]]; then printf 'Imagem do MySQL não identificada.\n' >&2; exit 3; fi
printf 'Gerando backup privado do banco real, sem interromper pedidos...\n'
bash "$backup_release_dir/manage.sh" exec -T mysql sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysqldump --user=root --default-character-set=utf8mb4 --single-transaction --quick --hex-blob --no-tablespaces --set-gtid-purged=OFF --skip-lock-tables --skip-comments --routines --events --triggers delivery_live_db
' | gzip > "$partial_dir/backup.sql.gz"
gzip -t "$partial_dir/backup.sql.gz"
node -e '
const fs=require("node:fs"),path=require("node:path");
const [directory,uuid,version,tables,image]=process.argv.slice(1);
fs.writeFileSync(path.join(directory,"manifest.json"),JSON.stringify({status:"BACKUP_COMPLETE",database:"delivery_live_db",created_at:new Date().toISOString(),source_server_uuid:uuid,mysql_version:version,mysql_image:image,base_tables:Number(tables),compressed_bytes:fs.statSync(path.join(directory,"backup.sql.gz")).size,mode:"single-transaction; não executar DDL durante o dump"},null,2)+"\n",{mode:0o600});
' "$partial_dir" "$server_uuid" "$mysql_version" "$table_count" "$mysql_image"
printf 'delivery-live-backup-v1\n' > "$partial_dir/.delivery-live-backup"
(cd "$partial_dir" && sha256sum backup.sql.gz manifest.json > SHA256SUMS && sha256sum --check SHA256SUMS)
mv -- "$partial_dir" "$final_dir"
# Atualiza latest atomicamente; retenção ignora symlinks e pastas incompletas.
ln -s -- "$(basename "$final_dir")" "$backup_root/.latest-$$"
mv -Tf -- "$backup_root/.latest-$$" "$backup_root/latest"
node -e 'const {enforceRetention}=require(process.argv[1]);for(const name of enforceRetention(process.argv[2],30)) console.log("Retenção: removido "+name)' "$backup_project_root/backend/src/backup-retention.js" "$backup_root"
printf 'BACKUP CONCLUÍDO: %s\n' "$final_dir"
printf 'Gzip e SHA-256 aprovados. Restauração é verificada separadamente.\n'
