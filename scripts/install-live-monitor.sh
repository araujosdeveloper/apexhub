#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$project_root" == /root/delivery-saas && "$EUID" == 0 && $# == 0 ]] || { echo 'Execute sem argumentos como root em /root/delivery-saas.' >&2; exit 2; }
command -v python3 >/dev/null
systemd-analyze verify "$project_root/deploy/systemd/delivery-live-monitor.service" "$project_root/deploy/systemd/delivery-live-monitor.timer"
python3 "$project_root/scripts/monitor-live.py"
for unit in delivery-live-monitor.service delivery-live-monitor.timer; do
 install -m 644 "$project_root/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl start delivery-live-monitor.service
systemctl enable --now delivery-live-monitor.timer
systemctl is-active delivery-live-monitor.timer
printf 'MONITORAMENTO CONFIGURADO: HTTPS/API e backups a cada cinco minutos.\nFalhas ficam no journal e em reports/monitoring/latest.json; sem notificações externas.\n'
