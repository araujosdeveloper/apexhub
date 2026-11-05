#!/usr/bin/env bash
# Importa JSON local, sem imprimir credenciais ou recebê-las no argv.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
private_dir="$project_root/backups/drive-private"
if (( $# )) || [[ -L "$private_dir" || ! -f "$private_dir/rclone.conf" || ! -f "$private_dir/google-client.json" ]]; then
 printf 'Coloque o JSON OAuth de aplicativo para computador em backups/drive-private/google-client.json antes de continuar.\n' >&2; exit 2
fi
exec 8>"$private_dir/.lock"
flock -w 600 8
node -e '
const fs=require("node:fs"),path=require("node:path");const {updateGoogleClient}=require(process.argv[2]);const d=process.argv[1];
try {
const file=path.join(d,"rclone.conf");const next=updateGoogleClient(fs.readFileSync(file,"utf8"),JSON.parse(fs.readFileSync(path.join(d,"google-client.json"),"utf8")));
fs.writeFileSync(file+".next",next,{mode:0o600});fs.renameSync(file+".next",file);
} catch { console.error("JSON OAuth inválido ou configuração indisponível. Use um cliente próprio do tipo Aplicativo para computador; nenhum segredo foi exibido."); process.exitCode=2; }
' "$private_dir" "$project_root/backend/src/google-client.js"
chmod 600 "$private_dir/rclone.conf" "$private_dir/google-client.json"
printf 'CLIENTE GOOGLE PRÓPRIO CONFIGURADO. Chaves de criptografia preservadas. Reautorize a conta pelo túnel SSH.\n'
