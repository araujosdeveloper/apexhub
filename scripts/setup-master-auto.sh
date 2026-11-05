#!/usr/bin/env bash
# Email solicitado pelo responsável. Cria ou recupera somente essa conta Master.
set +x
set -euo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
backup_require
backup_release
exec 9>"$backup_project_root/reports/.master-access.lock"
flock -n 9 || { printf 'Outra configuração Master está em andamento.\n' >&2; exit 2; }
printf 'Configurando Master para araujosdeveloper@gmail.com; aguarde a confirmação.\n'
node "$backup_project_root/scripts/setup-master-auto.js" --program |
 bash "$backup_release_dir/manage.sh" exec -T app node |
 node "$backup_project_root/scripts/setup-master-auto.js" --result
