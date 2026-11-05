#!/usr/bin/env bash
# Executar no host. Só agenda após backup E restauração aprovados.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if (( $# )); then printf 'Uso: bash scripts/install-live-backups.sh\n' >&2; exit 2; fi
if (( EUID != 0 )); then printf 'Execute no terminal root do servidor.\n' >&2; exit 2; fi
if [[ "$project_root" != /root/delivery-saas ]]; then printf 'Os serviços foram preparados para /root/delivery-saas.\n' >&2; exit 2; fi
for executable in systemctl systemd-analyze install; do
 if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
systemctl list-timers --no-pager >/dev/null
systemd-analyze calendar '*-*-* 04:15:00 UTC' 'Sun *-*-* 05:00:00 UTC' >/dev/null
systemd-analyze verify "$project_root/deploy/systemd/delivery-live-backup.service" "$project_root/deploy/systemd/delivery-live-backup.timer" "$project_root/deploy/systemd/delivery-live-restore-check.service" "$project_root/deploy/systemd/delivery-live-restore-check.timer"
bash "$project_root/scripts/backup-live.sh"
bash "$project_root/scripts/verify-live-backup.sh"
for unit in delivery-live-backup.service delivery-live-backup.timer delivery-live-restore-check.service delivery-live-restore-check.timer; do
 install -m 644 "$project_root/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now delivery-live-backup.timer delivery-live-restore-check.timer
systemctl is-enabled delivery-live-backup.timer delivery-live-restore-check.timer
systemctl is-active delivery-live-backup.timer delivery-live-restore-check.timer
systemctl list-timers --all --no-pager delivery-live-backup.timer delivery-live-restore-check.timer
printf '\nBACKUPS AUTOMÁTICOS CONFIGURADOS.\n'
printf 'Diário: 04:15 UTC (01:15 em Timon). Retenção: 30 backups concluídos.\n'
printf 'Restauração isolada: domingos às 05:00 UTC (02:00 em Timon).\n'
printf 'Cópias privadas: %s/backups/live/\n' "$project_root"
printf 'O primeiro backup e a restauração já passaram. Cópia fora da VPS ainda não configurada.\n'
