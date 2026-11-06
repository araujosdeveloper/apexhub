#!/usr/bin/env bash
# Atualização da loja já publicada. Não repete o corte nem usa o banco legado.
set +x
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if (( $# )); then printf 'Uso: bash scripts/update-live.sh\n' >&2; exit 2; fi
backup_require
backup_release
for executable in curl timeout; do command -v "$executable" >/dev/null || exit 2; done
cd "$backup_project_root"
exec 9>"$backup_project_root/reports/.publish.lock"
flock -n 9 || { printf 'Já existe publicação/atualização em andamento.\n' >&2; exit 2; }
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
update_dir="$backup_project_root/reports/update-$run_id"
mkdir "$update_dir"
exec > >(tee "$update_dir/update.log") 2>&1
printf 'Atualização: %s\nRelatório: %s\n' "$run_id" "$update_dir"
release_project="delivery-live-${backup_release_run,,}"
export RELEASE_REPORT_DIR="$update_dir"
export DELIVERY_UPDATE_IMAGE="delivery-saas-update:${run_id,,}"
candidate_image="$DELIVERY_UPDATE_IMAGE"
rollback_image="delivery-saas-rollback:${run_id,,}"
compose=(docker compose --project-name "$release_project" --env-file "$backup_release_dir/release.env" -f "$backup_project_root/compose.release.yml" -f "$backup_project_root/compose.update.yml")
edge=(docker compose --env-file "$backup_project_root/.env.public-edge" -f "$backup_project_root/compose.edge.yml")
public_get() { curl --fail --silent --show-error --noproxy '*' --max-time 15 --resolve '179.198.120.188:443:127.0.0.1' "https://179.198.120.188$1"; }
reload_edge() { "${edge[@]}" exec -T edge caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; }
restore_route() {
 cp "$update_dir/previous-route.caddy" "$backup_project_root/deploy/public-edge/routes/.active-update-next"
 mv "$backup_project_root/deploy/public-edge/routes/.active-update-next" "$backup_project_root/deploy/public-edge/routes/active.caddy"
 reload_edge
}
maintenance=false
app_stopped=false
traffic_may_be_open=false
completed=false
temporary_dir=''
rehearsal_container="delivery-upgrade-${run_id,,}"
rehearsal_network="delivery-upgrade-${run_id,,}"
cleanup() {
 result=$?
 trap - EXIT
 set +e
 if [[ "$completed" != true && "$maintenance" == true ]]; then
  if [[ "$traffic_may_be_open" == true ]]; then
   printf '\nPUBLICAÇÃO PRECISA DE VERIFICAÇÃO. A nova versão pode ter recebido pedidos.\n'
   printf 'Banco, imagem e relatórios preservados; não retornar ao banco antigo.\n'
   printf 'VERIFICAR\n' > "$update_dir/STATUS.txt"
  else
   recovered=true
   if [[ "$app_stopped" == true ]]; then
    export DELIVERY_UPDATE_IMAGE="$rollback_image"
    docker image tag "$old_image" "$base_image" || recovered=false
    "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 app || recovered=false
   fi
   if [[ "$recovered" == true ]] && restore_route; then
    printf 'Versão anterior e rota restabelecidas. Migrações aditivas preservadas; backup não foi restaurado sobre dados atuais.\n'
    printf 'RETORNOU_VERSAO_ANTERIOR\n' > "$update_dir/STATUS.txt"
   else
    printf 'Não foi possível confirmar a recuperação. Verifique a aplicação antes de reabrir tráfego.\n' >&2
    printf 'RECUPERACAO_PENDENTE\n' > "$update_dir/STATUS.txt"
   fi
  fi
 elif [[ "$completed" != true ]]; then printf 'FALHOU_ANTES_DA_MANUTENCAO\n' > "$update_dir/STATUS.txt"; fi
 if docker container inspect "$rehearsal_container" >/dev/null 2>&1; then docker rm -f "$rehearsal_container" >/dev/null || result=4; fi
 if docker network inspect "$rehearsal_network" >/dev/null 2>&1; then docker network rm "$rehearsal_network" >/dev/null || result=4; fi
 if [[ -n "$temporary_dir" ]]; then rm -f -- "$temporary_dir/mysql.env"; rmdir -- "$temporary_dir" || result=4; fi
 if (( result )); then printf 'ATUALIZAÇÃO NÃO CONFIRMADA (código %s). Relatório: %s\n' "$result" "$update_dir"; fi
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node scripts/ensure-jwt-keys.js
public_get /api/health >/dev/null
app_container="$(bash "$backup_release_dir/manage.sh" ps -q app)"
mysql_container="$(bash "$backup_release_dir/manage.sh" ps -q mysql)"
[[ -n "$app_container" && -n "$mysql_container" ]] || { printf 'Aplicação/banco publicados não identificados.\n'; exit 2; }
old_image="$(docker inspect --format '{{.Image}}' "$app_container")"
mysql_image="$(docker inspect --format '{{.Image}}' "$mysql_container")"
base_image="$(bash "$backup_release_dir/manage.sh" config --format json app | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const c=JSON.parse(s);if(!c.services?.app||!c.name)process.exit(2);console.log(c.services.app.image||c.name+"-app")}catch{process.exit(2)}})')"
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ && "$mysql_image" =~ ^sha256:[a-f0-9]{64}$ && "$base_image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$ && "$base_image" != *'@'* && "$base_image" != sha256:* ]] || exit 2
docker image tag "$old_image" "$rollback_image"
printf '%s\n' "$old_image" > "$update_dir/previous-image.txt"
printf '%s\n' "$base_image" > "$update_dir/base-image.txt"
cp deploy/public-edge/routes/active.caddy "$update_dir/previous-route.caddy"
printf 'Construindo e validando a imagem candidata; loja continua atendendo...\n'
docker build --tag "$candidate_image" .
docker run --rm --network none "$candidate_image" npm run check
docker run --rm --network none "$candidate_image" npm test
bash scripts/validate-mysql.sh
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps prepare node scripts/upgrade-live.js --check
bash scripts/backup-live.sh | tee "$update_dir/rehearsal-backup.log"
source_backup="$(sed -n 's/^BACKUP CONCLUÍDO: //p' "$update_dir/rehearsal-backup.log")"
[[ "$source_backup" == "$backup_root"/live-* && -f "$source_backup/manifest.json" ]] || exit 3
printf '%s\n' "$source_backup" > "$update_dir/rehearsal-backup.path"
(cd "$source_backup" && sha256sum --check SHA256SUMS)
source_uuid="$(node -e 'console.log(require(process.argv[1]).source_server_uuid)' "$source_backup/manifest.json")"
[[ "$source_uuid" =~ ^[a-f0-9-]{36}$ ]] || exit 3
temporary_dir="$(mktemp -d)"
rehearsal_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_ROOT_HOST=%%\nMYSQL_DATABASE=delivery_upgrade_test\nDB_HOST=%s\nDB_USER=root\nDB_PASSWORD=%s\nDB_NAME=delivery_upgrade_test\n' "$rehearsal_secret" "$rehearsal_container" "$rehearsal_secret" > "$temporary_dir/mysql.env"
unset rehearsal_secret
docker network create --internal "$rehearsal_network" >/dev/null
docker run --detach --name "$rehearsal_container" --network "$rehearsal_network" --memory 1g --memory-swap 1g --tmpfs /var/lib/mysql:size=512m --env-file "$temporary_dir/mysql.env" "$mysql_image" --event-scheduler=OFF --local-infile=OFF --skip-log-bin >/dev/null
ready=false
for attempt in {1..60}; do
 if docker exec "$rehearsal_container" sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql --user=root --batch --skip-column-names -e "SELECT 1" delivery_upgrade_test' >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[[ "$ready" == true ]] || { printf 'Cópia de ensaio não iniciou no prazo.\n'; exit 3; }
gzip -dc "$source_backup/backup.sql.gz" | docker exec -i "$rehearsal_container" sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --default-character-set=utf8mb4 --binary-mode=1 delivery_upgrade_test'
docker run --rm --user 0:0 --read-only --tmpfs /tmp --network "$rehearsal_network" --env-file "$temporary_dir/mysql.env" -v "$update_dir:/output" "$candidate_image" node scripts/upgrade-live.js --rehearse
docker rm -f "$rehearsal_container" >/dev/null
docker network rm "$rehearsal_network" >/dev/null
printf 'Ensaio aprovado. Preparando manutenção breve para backup final e atualização...\n'
mkdir -p "$update_dir/caddy-candidate/routes"
cp deploy/public-edge/Caddyfile "$update_dir/caddy-candidate/Caddyfile"
{
 printf '@delivery_update_block not path /deployment-health\nhandle @delivery_update_block {\n header Retry-After 30\n respond "A loja está em atualização. Tente novamente em instantes." 503\n}\n'
 cat "$update_dir/previous-route.caddy"
} > "$update_dir/caddy-candidate/routes/active.caddy"
"${edge[@]}" run --rm --no-deps -v "$update_dir/caddy-candidate:/etc/caddy:ro" edge caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
maintenance=true
cp "$update_dir/caddy-candidate/routes/active.caddy" deploy/public-edge/routes/.active-update-next
mv deploy/public-edge/routes/.active-update-next deploy/public-edge/routes/active.caddy
reload_edge
for probe in read write; do
 probe_args=()
 if [[ "$probe" == write ]]; then probe_args=(--request POST --header 'Content-Type: application/json' --data '{}'); fi
 maintenance_status="$(curl --silent --show-error --noproxy '*' --max-time 15 --resolve '179.198.120.188:443:127.0.0.1' --output "$update_dir/maintenance-$probe.txt" --write-out '%{http_code}' "${probe_args[@]}" "https://179.198.120.188/api/$([[ "$probe" == write ]] && printf orders || printf health)")"
 [[ "$maintenance_status" == 503 ]] || { printf 'Bloqueio de manutenção não confirmado.\n'; exit 3; }
done
app_stopped=true
bash "$backup_release_dir/manage.sh" stop --timeout 30 app
[[ "$(docker inspect --format '{{.State.Running}}' "$app_container")" == false ]] || { printf 'A aplicação não parou. Não migrar.\n'; exit 3; }
bash scripts/backup-live.sh | tee "$update_dir/final-backup.log"
final_backup="$(sed -n 's/^BACKUP CONCLUÍDO: //p' "$update_dir/final-backup.log")"
[[ "$final_backup" == "$backup_root"/live-* && -f "$final_backup/manifest.json" ]] || exit 3
[[ "$(node -e 'console.log(require(process.argv[1]).source_server_uuid)' "$final_backup/manifest.json")" == "$source_uuid" ]] || exit 3
printf '%s\n' "$final_backup" > "$update_dir/final-backup.path"
# Impede backup/restauração agendados durante DDL; o backup final já concluiu.
exec 8>"$backup_root/.lock"
flock -w 600 8
"${compose[@]}" run --rm --no-deps -e UPDATE_APP_STOPPED=true -e "UPDATE_EXPECTED_UUID=$source_uuid" prepare node scripts/upgrade-live.js --apply
"${compose[@]}" run --rm --no-deps app node scripts/check-update-http.js --canary
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 app
"${compose[@]}" exec -T app node scripts/check-update-http.js --running
# O manage.sh original continuará usando esta mesma versão em recriações futuras.
docker image tag "$candidate_image" "$base_image"
printf '%s\n' "$candidate_image" > "$update_dir/published-image.txt"
# A partir da troca da rota, não retornar automaticamente: pode haver pedidos novos.
traffic_may_be_open=true
restore_route
public_get /api/health > "$update_dir/public-health.json"
public_get /api/menu/cachorro-quente-bebella | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const m=JSON.parse(s);if(!m.operations||!Array.isArray(m.products)||m.products.some(p=>!Array.isArray(p.addon_groups)))process.exit(1)})'
public_get /operations.html >/dev/null
public_get /addons.html >/dev/null
public_get /kitchen.html >/dev/null
public_get /orders.js >/dev/null
public_get /coupons.html >/dev/null
public_get /customers.html >/dev/null
public_get /customers.js >/dev/null
public_get /drivers.html >/dev/null
public_get /drivers.js >/dev/null
public_get /reports.html >/dev/null
public_get /reports.js >/dev/null
public_get /team.html >/dev/null
public_get /team.js >/dev/null
public_get /merchandising.html >/dev/null
public_get /merchandising.js >/dev/null
public_get /product-image.js >/dev/null
public_get /track.html >/dev/null
public_get /track.js >/dev/null
public_get /order-review.js >/dev/null
public_get /reviews.html >/dev/null
public_get /reviews.js >/dev/null
public_get /dashboard.html >/dev/null
public_get /dashboard.css >/dev/null
public_get /dashboard.js >/dev/null
public_get /app-shell.js >/dev/null
public_get /app-shell.css >/dev/null
public_get /admin-theme.css >/dev/null
public_get /frame-bridge.js >/dev/null
public_get /finance.html >/dev/null
public_get /master.html >/dev/null
public_get /master-login.html >/dev/null
public_get /master.css >/dev/null
public_get /master.js >/dev/null
public_get /master-login.js >/dev/null
public_get /tenant/dashboard >/dev/null
public_get /assisted-context.js >/dev/null
public_get /impersonation-entry.js >/dev/null
public_get /apex-tokens.css >/dev/null
printf 'PUBLICADO\n' > "$update_dir/STATUS.txt"
printf '%s\n' "$update_dir" > deploy/latest-update.path
completed=true
printf '\nATUALIZAÇÃO PUBLICADA: gestão de cardápio multi-tenant ApexHub.\n'
printf 'Painel: https://179.198.120.188/login.html\nMaster: https://179.198.120.188/master-login.html\nBackup final: %s\nRelatório: %s\n' "$final_backup" "$update_dir"
