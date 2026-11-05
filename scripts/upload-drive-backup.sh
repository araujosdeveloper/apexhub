#!/usr/bin/env bash
# Envia somente um backup concluído pelo remote crypt, nunca pela conta Drive bruta.
set +x
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if (( $# )); then printf 'Uso: bash scripts/upload-drive-backup.sh\n' >&2; exit 2; fi
backup_require
backup_release
private_dir="$backup_project_root/backups/drive-private"
if [[ ! -f "$private_dir/rclone.conf" || -L "$private_dir" ]]; then printf 'Google Drive ainda não configurado.\n' >&2; exit 2; fi
exec 8>"$private_dir/.lock"
flock -w 600 8
node -e 'const fs=require("node:fs");require(process.argv[1]).validateDriveConfig(fs.readFileSync(process.argv[2],"utf8"))' "$backup_project_root/backend/src/drive-config.js" "$private_dir/rclone.conf"
backup_private_root
exec 9>"$backup_root/.lock"
flock -w 600 9
backup_name="$(node -e '
const fs=require("node:fs"),path=require("node:path");const {completedBackups}=require(process.argv[1]);const root=process.argv[2];const name=completedBackups(root)[0];if(!name)throw Error("Nenhum backup completo disponível.");const m=JSON.parse(fs.readFileSync(path.join(root,name,"manifest.json"),"utf8"));const age=Date.now()-Date.parse(m.created_at);if(!Number.isFinite(age)||age>36*3600000||age< -300000)throw Error("Backup ausente ou desatualizado; gerar backup local primeiro.");console.log(name);
' "$backup_project_root/backend/src/backup-retention.js" "$backup_root")"
(cd "$backup_root/$backup_name" && sha256sum --check SHA256SUMS)
gzip -t "$backup_root/$backup_name/backup.sql.gz"
printf 'Enviando backup criptografado: %s...\n' "$backup_name"
bash "$backup_project_root/scripts/drive-rclone.sh" copy "/backups/$backup_name" "delivery_crypt:$backup_name" --exclude '/restore-check.json' --immutable --retries 3 --transfers 2 --log-level ERROR
printf 'Conferindo os arquivos baixados e descriptografados do Drive...\n'
bash "$backup_project_root/scripts/drive-rclone.sh" check "/backups/$backup_name" "delivery_crypt:$backup_name" --exclude '/restore-check.json' --download --one-way --retries 3 --log-level ERROR
node -e 'const fs=require("node:fs");const file=process.argv[1];fs.writeFileSync(file+".next",JSON.stringify({status:"DRIVE_UPLOAD_VERIFIED",backup:process.argv[2],verified_at:new Date().toISOString(),encrypted_remote:"delivery_crypt",verification:"rclone check --download"},null,2)+"\n",{mode:0o600});fs.renameSync(file+".next",file)' "$private_dir/last-upload.json" "$backup_name"
printf 'CÓPIA NO GOOGLE DRIVE VERIFICADA. Conteúdo e nomes criptografados.\n'
printf 'Pasta no Drive: Delivery-SaaS-Backups. Preserve as chaves de recuperação fora da VPS.\n'
