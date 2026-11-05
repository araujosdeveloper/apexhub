#!/usr/bin/env bash
# Prepara só HTTPS e página de manutenção. Não altera PM2/MySQL/n8n.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
public_ip="${1:-179.198.120.188}"
contact_email="${2:-bebellahotdog@gmail.com}"
if (( $# > 2 )); then printf 'Uso: bash scripts/prepare-public-https.sh [IP EMAIL]\n' >&2; exit 2; fi
for executable in docker node curl; do
  if ! command -v "$executable" >/dev/null 2>&1; then printf 'Comando necessário: %s\n' "$executable" >&2; exit 2; fi
done
node -e 'const [ip,email] = process.argv.slice(1); if (require("node:net").isIP(ip) !== 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\r\n$#]/.test(email)) process.exit(2)' "$public_ip" "$contact_email"
if ! docker info >/dev/null; then printf 'BLOQUEADO: execute no terminal do host com acesso ao Docker.\n' >&2; exit 2; fi
edge_env="$project_root/.env.public-edge"
if [[ ! -f "$edge_env" ]]; then
  (set -o noclobber; printf 'PUBLIC_IP=%s\nACME_EMAIL=%s\n' "$public_ip" "$contact_email" > "$edge_env")
else
  # Não trocar a identidade de um serviço HTTPS que já existe.
  if ! node -e 'const fs=require("node:fs");const lines=fs.readFileSync(process.argv[1],"utf8").trim().split("\n");if(lines.length!==2||lines[0]!=="PUBLIC_IP="+process.argv[2]||lines[1]!=="ACME_EMAIL="+process.argv[3]) process.exit(2)' "$edge_env" "$public_ip" "$contact_email"; then
    printf 'Configuração HTTPS existente difere dos parâmetros; revise localmente antes de continuar.\n' >&2; exit 2
  fi
fi
compose=(docker compose --env-file "$edge_env" -f "$project_root/compose.edge.yml")
"${compose[@]}" config --quiet
"${compose[@]}" pull edge
"${compose[@]}" run --rm --no-deps edge caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
"${compose[@]}" up -d edge
printf '\nAguardando certificado público; sem ignorar validação TLS...\n'
ready=false
for attempt in {1..24}; do
  if response="$(curl --silent --show-error --fail --noproxy '*' --connect-timeout 3 --max-time 5 --resolve "$public_ip:443:127.0.0.1" "https://$public_ip/deployment-health" 2>/dev/null)" && [[ "$response" == 'delivery-https-ready' ]]; then
    ready=true
    break
  fi
  sleep 5
done
if [[ "$ready" != true ]]; then
  printf '\nHTTPS AINDA NÃO VALIDADO. Veja o diagnóstico abaixo.\n'
  "${compose[@]}" ps
  "${compose[@]}" logs --tail 60 edge
  printf '\nConfira a liberação das portas TCP 80 e 443 no provedor/firewall. Nenhuma regra foi alterada pelo script.\n'
  printf 'A loja da porta 3000 permanece independente. O serviço HTTPS foi preservado para diagnóstico.\n'
  exit 3
fi
printf '\nHTTPS VALIDADO: https://%s/deployment-health\n' "$public_ip"
printf 'Abra esse endereço no navegador do seu computador: deve mostrar delivery-https-ready sem aviso de certificado.\n'
printf 'O endereço principal ainda mostra manutenção. A loja antiga e a prévia não foram alteradas.\n'
printf 'Gerenciamento: docker compose --env-file %q -f %q ps\n' "$edge_env" "$project_root/compose.edge.yml"
