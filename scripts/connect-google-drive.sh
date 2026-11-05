#!/usr/bin/env bash
# OAuth interativo por túnel SSH. Ainda não instala o envio automático.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if (( $# )) || [[ ! -t 0 || ! -t 1 ]]; then printf 'Execute sem argumentos em terminal interativo.\n' >&2; exit 2; fi
if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no terminal do host com acesso ao Docker.\n' >&2; exit 2; fi
private_dir="$project_root/backups/drive-private"
if [[ -L "$private_dir" ]]; then printf 'Pasta privada não pode ser symlink.\n' >&2; exit 2; fi
mkdir -p "$private_dir"
chmod 700 "$private_dir"
exec 8>"$private_dir/.lock"
flock -w 600 8
docker pull rclone/rclone:1.75.2
image_id="$(docker image inspect --format '{{.Id}}' rclone/rclone:1.75.2)"
if [[ ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then printf 'Imagem rclone não identificada.\n' >&2; exit 2; fi
printf '%s\n' "$image_id" > "$private_dir/image-id"
if [[ ! -f "$private_dir/rclone.conf" ]]; then
 # Segredos gerados por CSPRNG; stdin evita exposição em argv/histórico.
 key1="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n' | docker run --rm -i --network none "$image_id" --config /dev/null obscure -)"
 key2="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n' | docker run --rm -i --network none "$image_id" --config /dev/null obscure -)"
 {
  printf '[delivery_drive]\ntype = drive\nscope = drive.file\n\n'
  printf '[delivery_crypt]\ntype = crypt\nremote = delivery_drive:Delivery-SaaS-Backups\nfilename_encryption = standard\ndirectory_name_encryption = true\npassword = %s\npassword2 = %s\n' "$key1" "$key2"
 } > "$private_dir/.rclone.conf.next"
 mv "$private_dir/.rclone.conf.next" "$private_dir/rclone.conf"
 unset key1 key2
fi
chmod 600 "$private_dir/rclone.conf"
if ! node -e 'const fs=require("node:fs");const t=fs.readFileSync(process.argv[1],"utf8");if(!/^client_id\s*=\s*\S+/m.test(t)||!/^client_secret\s*=\s*\S+/m.test(t))process.exit(2)' "$private_dir/rclone.conf"; then
 printf 'Configure um cliente OAuth Google próprio. O cliente compartilhado está sendo desativado.\n' >&2
 printf 'Instruções: docs/google-cliente-proprio.md. Nenhum envio ou agendamento foi ativado.\n' >&2
 exit 2
fi
printf '\nAntes de continuar, deixe aberto no seu computador o túnel:\n'
printf 'ssh -N -L 53682:127.0.0.1:53682 root@179.198.120.188\n'
printf 'Na pergunta sobre navegador, responda y. Abra no computador o link localhost:53682 mostrado abaixo.\n'
printf 'Quando perguntar Shared Drive (Team Drive), responda n para Drive pessoal.\n'
printf 'Autorize sua conta Google. Não envie tokens nem a configuração na conversa.\n\n'
docker run --rm -it --network host --read-only --tmpfs /tmp --user "$(id -u):$(id -g)" --volume "$private_dir:/config/rclone" "$image_id" --config /config/rclone/rclone.conf config reconnect delivery_drive:
bash "$project_root/scripts/drive-rclone.sh" mkdir delivery_drive:Delivery-SaaS-Backups --log-level ERROR
# Guarda somente a seção de criptografia para recuperação; nunca enviar ao Drive.
chmod 600 "$private_dir/rclone.conf"
node -e '
const fs=require("node:fs"),path=require("node:path");
const {recoveryText}=require(process.argv[2]);
const directory=process.argv[1];
fs.writeFileSync(path.join(directory,"RECUPERACAO-PRIVADA.txt"),recoveryText(fs.readFileSync(path.join(directory,"rclone.conf"),"utf8")),{mode:0o600});
' "$private_dir" "$project_root/backend/src/drive-config.js"
printf '\nGOOGLE DRIVE CONECTADO. Pasta privada: Delivery-SaaS-Backups.\n'
printf 'Chaves de recuperação: %s/RECUPERACAO-PRIVADA.txt\n' "$private_dir"
printf 'Copie esse arquivo para seu computador por SCP; não envie seu conteúdo na conversa ou ao Drive.\n'
printf 'Envio automático ainda não ativado. Próximo passo: teste de envio e conferência.\n'
