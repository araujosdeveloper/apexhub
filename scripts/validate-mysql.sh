#!/usr/bin/env bash
# Executar no terminal do host com acesso autorizado ao Docker.
# Cria somente um projeto temporário; não usa o Compose/volume do banco existente.
set +x
set -Eeuo pipefail
umask 077

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="$project_root/reports"
mkdir -p -- "$report_dir"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
report_path="$report_dir/mysql-validation-$run_id.log"
exec > >(tee "$report_path") 2>&1
printf 'Validação MySQL — %s\n' "$run_id"
printf 'Relatório: %s\n' "$report_path"

if ! command -v docker >/dev/null 2>&1; then
  printf 'BLOQUEADO: Docker CLI não está instalado neste terminal.\n'
  exit 2
fi
if ! docker info >/dev/null; then
  printf '\nBLOQUEADO: este terminal não consegue acessar o serviço Docker.\n'
  printf 'Execute este script em um terminal do servidor com acesso autorizado ao Docker.\n'
  printf 'Nenhum container ou banco foi alterado.\n'
  exit 2
fi
if ! docker compose version; then
  printf 'BLOQUEADO: o plugin Docker Compose é necessário.\n'
  exit 2
fi

task_tmpdir="$(mktemp -d)"
validation_env="$task_tmpdir/validation.env"
validation_project="delivery-validation-${run_id,,}"
compose=(docker compose --project-name "$validation_project" --env-file "$validation_env" -f "$project_root/compose.dev.yml" --profile test)
cleanup() {
  result=$?
  trap - EXIT
  set +e
  printf '\nRemovendo somente os serviços temporários do projeto %s...\n' "$validation_project"
  "${compose[@]}" down --timeout 15
  cleanup_result=$?
  rm -f -- "$validation_env"
  rmdir -- "$task_tmpdir"
  if (( cleanup_result != 0 )); then
    printf 'ATENÇÃO: limpeza dos containers temporários não foi concluída. Projeto: %s\n' "$validation_project"
    if (( result == 0 )); then result=3; fi
  fi
  if (( result == 0 )); then
    printf 'APROVADO: integração executada com MySQL real e ambiente temporário removido.\n'
  else
    printf 'NÃO APROVADO: execução terminou com código %s. Consulte o relatório.\n' "$result"
  fi
  printf 'Relatório: %s\n' "$report_path"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# As senhas existem apenas no arquivo temporário privado, nunca no relatório.
root_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
app_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
printf 'MYSQL_ROOT_PASSWORD=%s\nDB_PASSWORD=%s\n' "$root_secret" "$app_secret" > "$validation_env"
unset root_secret app_secret
"${compose[@]}" config --quiet
printf '\nConstruindo a aplicação e iniciando somente o banco de testes...\n'
"${compose[@]}" up --build --abort-on-container-exit --exit-code-from integration integration
