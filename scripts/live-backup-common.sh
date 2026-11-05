#!/usr/bin/env bash
# Biblioteca: não carregar arquivos com segredos no shell do host.
backup_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="$backup_project_root/backups/live"
backup_require() {
 for executable in docker node gzip sha256sum flock; do
  if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; return 2; fi
 done
 if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no host com acesso ao Docker.\n' >&2; return 2; fi
}
backup_release() {
 IFS= read -r backup_release_dir < "$backup_project_root/deploy/live-release.path"
 backup_release_run="${backup_release_dir#"$backup_project_root/reports/release-"}"
 if [[ ! "$backup_release_run" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]; then printf 'Identificador da publicação inválido.\n' >&2; return 2; fi
 if [[ "$backup_release_dir" != "$backup_project_root"/reports/release-* || ! -f "$backup_release_dir/manage.sh" || "$(cat "$backup_release_dir/STATUS.txt")" != PUBLICADO ]]; then
  printf 'Ambiente publicado não identificado. Não consultar banco legado ou prévia.\n' >&2; return 2
 fi
 if ! grep -Fq -- "reverse_proxy delivery-app-${backup_release_run,,}:3000" "$backup_project_root/deploy/public-edge/routes/active.caddy"; then
  printf 'A publicação configurada não coincide com a rota pública. Atualize deploy/live-release.path.\n' >&2; return 2
 fi
}
backup_private_root() {
 if [[ -L "$backup_root" ]]; then printf 'Pasta de backup não pode ser link simbólico.\n' >&2; return 2; fi
 mkdir -p "$backup_root"
 chmod 700 "$backup_root"
}
backup_mysql() {
 bash "$backup_release_dir/manage.sh" exec -T mysql sh -c '
  set -eu
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  exec mysql --user=root --batch --raw --skip-column-names delivery_live_db
 '
}
