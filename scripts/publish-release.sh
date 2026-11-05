#!/usr/bin/env bash
# Publica em banco NOVO. A origem fica preservada e somente para leitura.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
if (( $# != 0 )); then printf 'Uso: bash scripts/publish-release.sh\n' >&2; exit 2; fi
if [[ ! -t 0 || ! -t 1 ]]; then printf 'Execute em terminal interativo para definir a senha do proprietário.\n' >&2; exit 2; fi
for executable in docker node curl gzip sha256sum timeout flock; do
 if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
if ! docker info >/dev/null; then printf 'BLOQUEADO: Docker sem acesso nesta sessão.\n' >&2; exit 2; fi
mkdir -p "$project_root/reports"
exec 9>"$project_root/reports/.publish.lock"
if ! flock -n 9; then printf 'Já existe uma publicação em execução.\n' >&2; exit 2; fi
edge=(docker compose --env-file "$project_root/.env.public-edge" -f "$project_root/compose.edge.yml")
# Só publicar a primeira vez, a partir da página de preparação validada.
if ! grep -q 'respond "A loja está sendo preparada' deploy/public-edge/routes/active.caddy || grep -q 'reverse_proxy' deploy/public-edge/routes/active.caddy; then
 printf 'A rota pública não está na preparação inicial. Não repetir publicação sobre uma loja ativa.\n' >&2; exit 2
fi
if [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 10 --resolve '179.198.120.188:443:127.0.0.1' https://179.198.120.188/deployment-health)" != delivery-https-ready ]]; then
 printf 'HTTPS público ainda não validado.\n' >&2; exit 2
fi
source_sql() {
 timeout 45 docker exec -i saas_mysql sh -c '
  set -eu
  if [ -n "${MYSQL_ROOT_PASSWORD_FILE:-}" ]; then export MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")"; else export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?}"; fi
  exec mysql --user=root --batch --raw --skip-column-names --connect-timeout=10 delivery_saas_db
 '
}
# Não congelar um servidor compartilhado com outros bancos de usuário.
extra_databases="$(printf '%s\n' "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','sys','information_schema','performance_schema','delivery_saas_db');" | source_sql)"
if [[ "$extra_databases" != 0 ]]; then printf 'O MySQL de origem contém outros bancos; revisar o bloqueio de gravações antes de continuar.\n' >&2; exit 2; fi
writable="$(printf '%s\n' 'SELECT @@global.read_only + @@global.super_read_only;' | source_sql)"
persisted="$(printf '%s\n' "SELECT COUNT(*) FROM performance_schema.persisted_variables WHERE VARIABLE_NAME IN ('read_only','super_read_only');" | source_sql)"
if [[ "$writable" != 0 || "$persisted" != 0 ]]; then printf 'Origem já possui configuração de somente leitura; revisar antes de continuar.\n' >&2; exit 2; fi
export SOURCE_SERVER_UUID="$(printf '%s\n' 'SELECT @@server_uuid;' | source_sql)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_project="delivery-live-${run_id,,}"
export RELEASE_ALIAS="delivery-app-${run_id,,}"
export RELEASE_REPORT_DIR="$project_root/reports/release-$run_id"
mkdir -p "$RELEASE_REPORT_DIR"
release_env="$RELEASE_REPORT_DIR/release.env"
{
 printf 'RELEASE_ROOT_PASSWORD=%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
 printf 'RELEASE_APP_PASSWORD=%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
 printf 'RELEASE_ALIAS=%s\n' "$RELEASE_ALIAS"
} > "$release_env"
compose=(docker compose --project-name "$release_project" --env-file "$release_env" -f "$project_root/compose.release.yml")
{
 printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
 printf 'export RELEASE_REPORT_DIR=%q\n' "$RELEASE_REPORT_DIR"
 printf 'exec docker compose --project-name %q --env-file %q -f %q "$@"\n' "$release_project" "$release_env" "$project_root/compose.release.yml"
} > "$RELEASE_REPORT_DIR/manage.sh"
source_frozen=false
publication_attempted=false
completed=false
finish() {
 result=$?
 trap - EXIT
 set +e
 if [[ "$completed" != true ]]; then
  if [[ "$publication_attempted" == true ]]; then
   printf '\nPUBLICAÇÃO PRECISA DE VERIFICAÇÃO. Não reabrir gravações na origem.\n' >&2
   printf 'A nova loja pode ter recebido pedidos; o novo banco foi preservado.\n' >&2
  elif [[ "$source_frozen" == true ]]; then
   if printf '%s\n' 'RESET PERSIST IF EXISTS super_read_only; RESET PERSIST IF EXISTS read_only; SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;' | source_sql; then
    printf '\nFalha antes da publicação: gravações da origem reabertas. PM2 não foi reiniciado.\n' >&2
   else
    printf '\nNão foi possível reabrir gravações da origem. Diagnosticar antes de prosseguir.\n' >&2
   fi
  fi
  printf 'Ambiente novo e artefatos preservados para diagnóstico: %s\n' "$RELEASE_REPORT_DIR" >&2
 fi
 exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Preparando imagem e banco persistente NOVO: %s\n' "$release_project"
"${compose[@]}" config --quiet
"${compose[@]}" build prepare app
"${compose[@]}" up -d --wait --wait-timeout 240 mysql
export TARGET_SERVER_UUID="$("${compose[@]}" exec -T mysql sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --skip-column-names -e "SELECT @@server_uuid"')"
node -e 'const [a,b]=process.argv.slice(1);const re=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;if(!re.test(a)||!re.test(b)||a===b) process.exit(2)' "$SOURCE_SERVER_UUID" "$TARGET_SERVER_UUID"
printf '\nINICIANDO CORTE: bloqueando gravações no MySQL antigo até finalizar.\n'
printf 'Não reinicie o servidor nem interrompa este terminal durante a publicação.\n'
source_frozen=true
printf '%s\n' 'SET GLOBAL super_read_only=ON;' | source_sql
if [[ "$(printf '%s\n' 'SELECT @@global.super_read_only;' | source_sql)" != 1 ]]; then printf 'Bloqueio da origem não confirmado.\n' >&2; exit 3; fi
for table in categories companies customers option_groups options order_items orders products; do
 printf "SELECT '%s', COUNT(*) FROM %s;\n" "$table" "$table"
done | source_sql > "$RELEASE_REPORT_DIR/source-counts.tsv"
bash "$project_root/scripts/inventory-legacy.sh" | tee "$RELEASE_REPORT_DIR/backup.log"
backup_dir="$(sed -n 's/^Pasta privada: //p' "$RELEASE_REPORT_DIR/backup.log")"
if [[ "$backup_dir" != "$project_root"/backups/legacy-* || ! -f "$backup_dir/STATUS.txt" ]]; then printf 'Backup final não identificado.\n' >&2; exit 3; fi
printf '%s\n' "$backup_dir" > "$RELEASE_REPORT_DIR/source-backup-path.txt"
(cd -- "$backup_dir" && sha256sum --check SHA256SUMS)
gzip -t "$backup_dir/backup.sql.gz"
printf '\nRestaurando backup final SOMENTE no banco novo...\n'
gzip -dc "$backup_dir/backup.sql.gz" | "${compose[@]}" exec -T mysql sh -c '
 set -eu
 export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
 exec mysql --user=root --default-character-set=utf8mb4 --binary-mode=1 delivery_live_db
'
"${compose[@]}" run --rm --no-deps prepare
printf '\nDefina agora a senha REAL do proprietário. Ela não é a senha SSH.\n'
"${compose[@]}" run --rm --no-deps -it app node scripts/provision-owner.js --apply 1 cachorro-quente-bebella 'Proprietário da loja' bebellahotdog@gmail.com
"${compose[@]}" up -d --wait --wait-timeout 120 app
"${compose[@]}" exec -T app node -e '
(async()=>{
 const health=await fetch("http://127.0.0.1:3000/api/health");if(!health.ok)throw Error("health");
 const admin=await fetch("http://127.0.0.1:3000/api/admin/orders");if(admin.status!==401)throw Error("auth");
 const menu=await fetch("http://127.0.0.1:3000/api/menu/cachorro-quente-bebella");if(!menu.ok)throw Error("menu");
 console.log("Health, catálogo e exigência de autenticação aprovados.");
})().catch(e=>{console.error(e.message);process.exit(1)})'
# Persiste o bloqueio antigo também após reboot; o banco novo é a origem de gravações.
printf '%s\n' 'SET PERSIST read_only=ON; SET PERSIST super_read_only=ON;' | source_sql
cp deploy/public-edge/routes/active.caddy "$RELEASE_REPORT_DIR/previous-route.caddy"
{
 printf 'handle /deployment-health {\n\theader Cache-Control no-store\n\trespond "delivery-https-ready" 200\n}\n'
 printf 'handle {\n\treverse_proxy %s:3000 {\n\t\theader_up Host {http.request.host}\n\t}\n}\n' "$RELEASE_ALIAS"
} > "$RELEASE_REPORT_DIR/public-route.caddy"
# Valida a configuração candidata em uma montagem separada, antes de trocar o arquivo ativo.
mkdir -p "$RELEASE_REPORT_DIR/caddy-candidate/routes"
cp deploy/public-edge/Caddyfile "$RELEASE_REPORT_DIR/caddy-candidate/Caddyfile"
cp "$RELEASE_REPORT_DIR/public-route.caddy" "$RELEASE_REPORT_DIR/caddy-candidate/routes/active.caddy"
"${edge[@]}" run --rm --no-deps -v "$RELEASE_REPORT_DIR/caddy-candidate:/etc/caddy:ro" edge caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Desde a troca do arquivo, um reload/reboot pode tornar a nova rota pública.
publication_attempted=true
cp "$RELEASE_REPORT_DIR/public-route.caddy" deploy/public-edge/routes/.active.next
mv deploy/public-edge/routes/.active.next deploy/public-edge/routes/active.caddy
# A partir da tentativa de reload podem existir gravações novas: nunca reabrir a origem automaticamente.
"${edge[@]}" exec -T edge caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
curl --fail --show-error --silent --noproxy '*' --max-time 15 --resolve '179.198.120.188:443:127.0.0.1' https://179.198.120.188/api/health
printf '\n'
printf 'PUBLICADO\n' > "$RELEASE_REPORT_DIR/STATUS.txt"
completed=true
printf '\nLOJA PUBLICADA: https://179.198.120.188/?loja=cachorro-quente-bebella\n'
printf 'Painel: https://179.198.120.188/login.html\n'
printf 'E-mail: bebellahotdog@gmail.com. Use a senha REAL definida nesta execução.\n'
printf 'Banco antigo preservado somente para leitura. PM2 e n8n não foram reiniciados.\n'
printf 'Integrações antigas continuam sem gravar na origem; não reativá-las sem adaptação.\n'
printf 'Gerenciamento: bash %s/manage.sh ps\n' "$RELEASE_REPORT_DIR"
printf 'Backup final: %s\n' "$backup_dir"
printf 'NÃO remova o ambiente release nem seus volumes: eles contêm os pedidos reais.\n'
