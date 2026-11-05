#!/usr/bin/env bash
# Restaura o backup e migra somente um MySQL temporário, sem portas publicadas.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 1 || ! -d "$1" ]]; then
  printf 'Uso: bash scripts/rehearse-migration.sh /caminho/da/pasta/legacy-data-id\n' >&2; exit 2
fi
backup_dir="$(cd -- "$1" && pwd)"
for file in backup.sql.gz inventory.json schema.sql SHA256SUMS; do
  if [[ ! -f "$backup_dir/$file" ]]; then printf 'Artefato ausente: %s\n' "$file" >&2; exit 2; fi
done
for executable in docker gzip sha256sum; do
  if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no terminal do host com acesso autorizado ao Docker.\n' >&2; exit 2; fi
(cd -- "$backup_dir" && sha256sum --check SHA256SUMS)
gzip -t "$backup_dir/backup.sql.gz"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
report_dir="$project_root/reports/rehearsal-$run_id"
mkdir -p -- "$report_dir"
exec > >(tee "$report_dir/run.log") 2>&1
printf 'Ensaio isolado: %s\nOrigem do backup: %s\nRelatório: %s\n' "$run_id" "$backup_dir" "$report_dir"
task_tmpdir="$(mktemp -d)"
rehearsal_env="$task_tmpdir/rehearsal.env"
rehearsal_project="delivery-rehearsal-${run_id,,}"
export REHEARSAL_REPORT_DIR="$report_dir"
compose=(docker compose --project-name "$rehearsal_project" --env-file "$rehearsal_env" -f "$project_root/compose.rehearsal.yml")
cleanup() {
  result=$?
  trap - EXIT
  set +e
  printf '\nRemovendo somente o ambiente temporário %s...\n' "$rehearsal_project"
  "${compose[@]}" down --timeout 15
  cleanup_result=$?
  rm -f -- "$rehearsal_env"
  rmdir -- "$task_tmpdir"
  if (( cleanup_result != 0 )); then
    printf 'Limpeza incompleta; projeto: %s\n' "$rehearsal_project"
    if (( result == 0 )); then result=3; fi
  fi
  if (( result == 0 )); then
    printf 'ENSAIO APROVADO: restauração, migração na cópia, preservação de dados e HTTP verificados.\n'
    printf 'O banco existente e a aplicação em execução não foram alterados.\n'
    printf 'Relatório agregado: %s/rehearsal.json\n' "$report_dir"
  else
    printf 'ENSAIO NÃO APROVADO (código %s). Nenhuma migração foi aplicada ao banco existente.\n' "$result"
  fi
  printf 'Log: %s/run.log\n' "$report_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
rehearsal_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
printf 'REHEARSAL_PASSWORD=%s\n' "$rehearsal_secret" > "$rehearsal_env"
unset rehearsal_secret
"${compose[@]}" config --quiet
"${compose[@]}" build runner
"${compose[@]}" up -d --wait --wait-timeout 240 mysql
printf '\nRestaurando o dump em delivery_rehearsal_test (agendador de eventos OFF)...\n'
gzip -dc "$backup_dir/backup.sql.gz" | "${compose[@]}" exec -T mysql sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --default-character-set=utf8mb4 --binary-mode=1 delivery_rehearsal_test
'
printf '\nExecutando migração e testes HTTP na cópia...\n'
"${compose[@]}" run --rm --no-deps runner
if [[ ! -s "$report_dir/rehearsal.json" ]]; then printf 'Relatório final ausente.\n' >&2; exit 4; fi
