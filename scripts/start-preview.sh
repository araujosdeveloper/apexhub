#!/usr/bin/env bash
# Mantém uma cópia descartável para navegador. Não se conecta ao MySQL legado.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 2 || ! -d "$1" ]]; then
  printf 'Uso: bash scripts/start-preview.sh PASTA_BACKUP EMAIL\n' >&2; exit 2
fi
if [[ ! -t 0 || ! -t 1 ]]; then printf 'Execute em terminal interativo para definir a senha oculta.\n' >&2; exit 2; fi
backup_dir="$(cd -- "$1" && pwd)"
owner_email="$2"
for executable in docker node gzip sha256sum; do
  if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
node -e 'if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.argv[1]) || process.argv[1].length > 254) process.exit(2)' "$owner_email"
for file in backup.sql.gz inventory.json schema.sql SHA256SUMS; do
  if [[ ! -f "$backup_dir/$file" ]]; then printf 'Artefato ausente: %s\n' "$file" >&2; exit 2; fi
done
if ! docker info >/dev/null; then printf 'BLOQUEADO: Docker sem acesso nesta sessão.\n' >&2; exit 2; fi
(cd -- "$backup_dir" && sha256sum --check SHA256SUMS)
gzip -t "$backup_dir/backup.sql.gz"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
preview_project="delivery-preview-${run_id,,}"
report_dir="$project_root/reports/preview-$run_id"
mkdir -p "$report_dir"
preview_env="$report_dir/preview.env"
{
  printf 'PREVIEW_ROOT_PASSWORD=%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'PREVIEW_APP_PASSWORD=%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
} > "$preview_env"
export PREVIEW_REPORT_DIR="$report_dir"
compose=(docker compose --project-name "$preview_project" --env-file "$preview_env" -f "$project_root/compose.preview.yml")
succeeded=false
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$succeeded" != true ]]; then
    printf '\nFalha: removendo somente a prévia %s...\n' "$preview_project"
    if "${compose[@]}" down --timeout 15; then
      rm -f -- "$preview_env"
    else
      printf 'Limpeza incompleta. Use: bash %s/manage.sh down\n' "$report_dir" >&2
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Comando de gerenciamento registra apenas caminhos e o projeto, sem senhas.
{
  printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
  printf 'export PREVIEW_REPORT_DIR=%q\n' "$report_dir"
  printf 'exec docker compose --project-name %q --env-file %q -f %q "$@"\n' "$preview_project" "$preview_env" "$project_root/compose.preview.yml"
} > "$report_dir/manage.sh"
printf 'Prévia isolada: %s\nGerenciamento: bash %s/manage.sh\n' "$preview_project" "$report_dir"
"${compose[@]}" config --quiet
"${compose[@]}" build prepare app
"${compose[@]}" up -d --wait --wait-timeout 240 mysql
printf '\nRestaurando somente no banco temporário da prévia...\n'
gzip -dc "$backup_dir/backup.sql.gz" | "${compose[@]}" exec -T mysql sh -c '
  set -eu
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  exec mysql --user=root --default-character-set=utf8mb4 --binary-mode=1 delivery_preview_rehearsal_test
'
"${compose[@]}" run --rm --no-deps prepare
mapfile -t company_fields < <(node -e 'const r = require(process.argv[1]); console.log(r.company.id); console.log(r.company.slug)' "$report_dir/preview.json")
if [[ ${#company_fields[@]} != 2 ]]; then printf 'Identificação da loja ausente.\n' >&2; exit 2; fi
printf '\nCriando proprietário SOMENTE NA CÓPIA. Confira o slug e defina uma senha de teste.\n'
"${compose[@]}" run --rm --no-deps -it app node scripts/provision-owner.js --apply "${company_fields[0]}" "${company_fields[1]}" 'Proprietário da loja' "$owner_email"
"${compose[@]}" up -d --wait --wait-timeout 120 app
succeeded=true
printf '\nPRÉVIA PRONTA em 127.0.0.1:3002, acessível por túnel SSH.\n'
printf 'Nenhum reinício do PM2 ou alteração no banco original foi realizado.\n'
printf 'Em OUTRO terminal, no seu computador: ssh -N -L 3002:127.0.0.1:3002 root@179.198.120.188\n'
printf 'Depois abra http://localhost:3002/login.html\n'
printf 'Para remover a cópia e os dados de teste: bash %s/manage.sh down\n' "$report_dir"
printf 'Depois de remover os containers, apague o arquivo privado: rm -- %q\n' "$preview_env"
