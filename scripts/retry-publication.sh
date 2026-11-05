#!/usr/bin/env bash
# Testa a correção apenas na cópia que falhou; depois publica com backup NOVO.
set +x
set -Eeuo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
if (( $# != 0 )); then printf 'Uso: bash scripts/retry-publication.sh\n' >&2; exit 2; fi
if [[ ! -t 0 || ! -t 1 ]]; then printf 'Execute em terminal interativo.\n' >&2; exit 2; fi
failed_dir="$project_root/reports/release-20261103T025137Z-313960"
if [[ ! -f "$failed_dir/manage.sh" || -f "$failed_dir/STATUS.txt" ]]; then
 printf 'O ambiente esperado da tentativa que falhou não está disponível. Não continuar.\n' >&2; exit 2
fi
if ! grep -q 'respond "A loja está sendo preparada' deploy/public-edge/routes/active.caddy || grep -q reverse_proxy deploy/public-edge/routes/active.caddy; then
 printf 'A rota pública já foi alterada. Não repetir a publicação.\n' >&2; exit 2
fi
if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no terminal do host com acesso ao Docker.\n' >&2; exit 2; fi
# Evita teste/stop da cópia em paralelo com uma publicação já em andamento.
exec 8>"$project_root/reports/.publish.lock"
if ! flock -n 8; then printf 'Já existe publicação em execução.\n' >&2; exit 2; fi
printf 'Atualizando a imagem do teste de permissões, sem alterar a origem...\n'
bash "$failed_dir/manage.sh" build prepare
printf '\nValidando permissões no MySQL real da cópia que falhou...\n'
bash "$failed_dir/manage.sh" run --rm --no-deps prepare node -e '
const mysql = require("mysql2/promise");
const { restrictReleaseUser } = require("./src/release-permissions");
(async () => {
 const db = await mysql.createConnection({host:"mysql",user:"root",password:process.env.DB_PASSWORD,database:"delivery_live_db"});
 try {
  await db.query("SELECT company_id, password_hash FROM users LIMIT 0");
  await restrictReleaseUser(db);
  console.log("PERMISSÕES VALIDADAS EM MYSQL REAL. Nenhuma mudança na origem.");
 } finally { await db.end(); }
})().catch(err => { console.error("Teste de permissões falhou:", err.code || err.message); process.exitCode=1; });'
printf '\nParando somente a cópia que falhou; volume e artefatos preservados.\n'
bash "$failed_dir/manage.sh" stop
flock -u 8
exec 8>&-
printf '\nIniciando publicação corrigida com banco novo e backup atualizado...\n'
exec bash "$project_root/scripts/publish-release.sh"
