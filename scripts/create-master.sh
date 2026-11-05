#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
backup_require
backup_release
bash "$backup_release_dir/manage.sh" exec app node scripts/provision-master.js
