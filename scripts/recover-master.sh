#!/usr/bin/env bash
# Recuperação privada no host; credenciais somente em memória e stdin.
set +x
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if [[ ! -t 0 || ! -t 1 ]]; then printf 'Execute em um terminal SSH interativo da VPS.\n' >&2; exit 2; fi
backup_require
backup_release
master_terminal_state="$(stty -g <&0)"
master_cleanup(){ stty "$master_terminal_state" <&0 2>/dev/null || true; unset master_email master_password master_confirmation; }
trap master_cleanup EXIT
trap 'printf "\nRecuperação cancelada.\n" >&2; exit 130' INT
trap 'exit 143' TERM
unset master_email master_password master_confirmation
printf 'Recuperação Master: redefine a senha, reativa a conta informada e encerra as sessões antigas dela.\n'
read -r -p 'E-mail da conta Master: ' master_email <&0
read -r -s -p 'Nova senha de 16 a 128 caracteres (oculta; pressione Enter ao terminar): ' master_password <&0
printf '\n'
read -r -s -p 'Repita a nova senha (oculta; pressione Enter ao terminar): ' master_confirmation <&0
printf '\n'
if [[ "$master_password" != "$master_confirmation" ]]; then printf 'As senhas não coincidem. Nenhuma conta alterada.\n' >&2; exit 2; fi
printf '%s\0' "$master_email" "$master_password" |
 node "$backup_project_root/scripts/master-recovery-payload.js" |
 bash "$backup_release_dir/manage.sh" exec -T app node
printf 'Acesse: https://179.198.120.188/master-login.html\n'
