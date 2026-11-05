#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if (( EUID != 0 )) || [[ "$project_root" != /root/delivery-saas ]] || (( $# )); then printf 'Execute sem argumentos no terminal root do servidor.\n' >&2; exit 2; fi
systemctl is-active --quiet delivery-live-backup.timer
systemd-analyze verify "$project_root/deploy/systemd/delivery-live-drive.service"
bash "$project_root/scripts/backup-live.sh"
bash "$project_root/scripts/upload-drive-backup.sh"
install -m 644 "$project_root/deploy/systemd/delivery-live-drive.service" /etc/systemd/system/delivery-live-drive.service
install -d -m 755 /etc/systemd/system/delivery-live-backup.service.d
install -m 644 "$project_root/deploy/systemd/delivery-live-backup.service.d/google-drive.conf" /etc/systemd/system/delivery-live-backup.service.d/google-drive.conf
systemctl daemon-reload
on_success="$(systemctl show delivery-live-backup.service --property=OnSuccess --value)"
if [[ " $on_success " != *' delivery-live-drive.service '* ]]; then printf 'Gatilho de envio não confirmado no systemd.\n' >&2; exit 3; fi
printf 'OnSuccess=%s\n' "$on_success"
printf '\nENVIO AUTOMÁTICO AO GOOGLE DRIVE CONFIGURADO.\n'
printf 'Será acionado após cada execução bem-sucedida do backup diário pelo systemd.\n'
printf 'A cópia inicial foi enviada e conferida por download/descriptografia.\n'
printf 'Baixe RECUPERACAO-PRIVADA.txt para um local privado fora da VPS; sem essas chaves os arquivos são irrecuperáveis.\n'
