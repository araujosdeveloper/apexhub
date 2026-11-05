#!/usr/bin/env bash
# Leitura do banco legado e backup local privado. Não aplica migrações.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
legacy_container="${LEGACY_CONTAINER:-saas_mysql}"
legacy_database="${LEGACY_DATABASE:-delivery_saas_db}"
if [[ ! "$legacy_container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ || ! "$legacy_database" =~ ^[a-zA-Z0-9_]+$ ]]; then
  printf 'Container ou banco com identificador inválido.\n' >&2; exit 2
fi
for executable in docker gzip sha256sum; do
  if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no terminal do host com acesso autorizado ao Docker.\n' >&2; exit 2; fi
if [[ "$(docker inspect --format '{{.State.Running}}' "$legacy_container")" != true ]]; then
  printf 'BLOQUEADO: o container de origem não está em execução.\n' >&2; exit 2
fi
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
artifact_dir="$project_root/backups/legacy-$run_id"
mkdir -p -- "$artifact_dir"
printf 'Coleta do banco: %s | Container: %s\n' "$legacy_database" "$legacy_container"
printf 'Pasta privada: %s\n' "$artifact_dir"

# A senha é obtida dentro do container e não é impressa nem passada no argv.
mysql_read() {
  docker exec -i "$legacy_container" sh -c '
    set -eu
    if [ -n "${MYSQL_ROOT_PASSWORD_FILE:-}" ]; then
      MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")"
    else
      MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?Credencial root não disponível no ambiente do container}"
    fi
    export MYSQL_PWD
    exec mysql --user=root --batch --raw --skip-column-names --default-character-set=utf8mb4 "$@"
  ' sh "$legacy_database"
}
mysql_dump() {
  docker exec "$legacy_container" sh -c '
    set -eu
    if [ -n "${MYSQL_ROOT_PASSWORD_FILE:-}" ]; then
      MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")"
    else
      MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?Credencial root não disponível no ambiente do container}"
    fi
    export MYSQL_PWD
    exec mysqldump --user=root --default-character-set=utf8mb4 --single-transaction --quick --hex-blob --no-tablespaces --set-gtid-purged=OFF --skip-lock-tables "$@"
  ' sh "$@" "$legacy_database"
}
complete=false
finish() {
  result=$?
  if [[ "$complete" != true ]]; then
    printf '\nCOLETA INCOMPLETA (código %s). Arquivos parciais não comprovam um backup válido.\n' "$result" >&2
    printf 'Pasta preservada para diagnóstico: %s\n' "$artifact_dir" >&2
  fi
}
trap finish EXIT

mysql_read < "$project_root/database/inventory.sql" > "$artifact_dir/inventory.json"
# Não declarar backup transacional consistente quando há tabelas não transacionais.
nontransactional="$(printf '%s\n' "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND ENGINE <> 'InnoDB';" | mysql_read)"
if [[ "$nontransactional" != 0 ]]; then
  printf 'REVISÃO NECESSÁRIA: existem tabelas fora de InnoDB; planejar backup consistente para esse engine.\n' >&2
  exit 3
fi
mysql_dump --no-data --skip-triggers --skip-comments --skip-add-drop-table > "$artifact_dir/schema.sql"
printf 'Gerando backup transacional. Não execute alterações de esquema durante esta coleta.\n'
mysql_dump --routines --events --triggers | gzip > "$artifact_dir/backup.sql.gz.partial"
gzip -t "$artifact_dir/backup.sql.gz.partial"
mv -- "$artifact_dir/backup.sql.gz.partial" "$artifact_dir/backup.sql.gz"
(cd -- "$artifact_dir" && sha256sum backup.sql.gz schema.sql inventory.json > SHA256SUMS && sha256sum --check SHA256SUMS)

analyze() {
  if command -v node >/dev/null 2>&1; then
    node "$project_root/backend/scripts/plan-migration.js" - "$@"
  else
    # Sem rede; o backup não é montado no container do analisador.
    docker run --rm -i --network none --read-only \
      --mount "type=bind,src=$project_root/backend,dst=/analysis,readonly" \
      node:22-alpine node /analysis/scripts/plan-migration.js - "$@"
  fi
}
analyze < "$artifact_dir/inventory.json" > "$artifact_dir/migration-plan.json"
analyze --audit-sql < "$artifact_dir/inventory.json" > "$artifact_dir/audit.sql"
printf 'Conferindo duplicados, órfãos, vínculos entre empresas e totais (somente contagens)...\n'
mysql_read < "$artifact_dir/audit.sql" > "$artifact_dir/audit.tsv"
(cd -- "$artifact_dir" && sha256sum backup.sql.gz schema.sql inventory.json migration-plan.json audit.sql audit.tsv > SHA256SUMS && sha256sum --check SHA256SUMS)
cat > "$artifact_dir/STATUS.txt" <<STATUS
Coleta: $run_id
Origem: $legacy_container / $legacy_database
Backup gzip e SHA-256 verificados. Restauração ainda não ensaiada.
Nenhuma migração aplicada. As contagens do inventário são estimativas.
Não houve bloqueio de DDL: a coleta pressupõe ausência de alterações do esquema durante o dump.
Não compartilhe backup.sql.gz: contém dados e pode conter definições sensíveis de rotinas/eventos.
O plano é preliminar; audit.tsv contém contagens de possíveis inconsistências, sem correção automática.
STATUS
complete=true
printf '\nCOLETA CONCLUÍDA: backup e inventário gerados; restauração ainda pendente.\n'
printf 'Para análise, envie somente a saída deste comando:\n'
printf "cat '%s/migration-plan.json' '%s/audit.tsv'\n" "$artifact_dir" "$artifact_dir"
printf 'Mantenha o backup completo privado. Nenhum dado de origem foi alterado.\n'
