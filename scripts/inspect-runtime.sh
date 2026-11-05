#!/usr/bin/env bash
# Inventário somente de leitura; não coleta ambientes, senhas ou argumentos.
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_root/reports"
report="$project_root/reports/runtime-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
{
  printf 'INVENTÁRIO DO AMBIENTE — SOMENTE LEITURA\n'
  date -u
  printf '\nContainers e portas publicadas:\n'
  if command -v docker >/dev/null 2>&1; then
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' || printf 'Docker indisponível nesta sessão.\n'
  fi
  printf '\nPortas TCP em escuta:\n'
  if command -v ss >/dev/null 2>&1; then ss -ltnp || true; fi
  printf '\nProcessos de aplicação/proxy (sem argumentos):\n'
  ps -eo pid,ppid,user,comm | awk 'NR == 1 || /node|npm|PM2|nginx|apache|caddy|docker-proxy|traefik/'
  printf '\nServiços em execução relacionados:\n'
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '/delivery|node|pm2|nginx|apache|caddy|docker|traefik/' || true
  fi
  printf '\nVersões locais:\n'
  if command -v node >/dev/null 2>&1; then node --version; fi
  if command -v npm >/dev/null 2>&1; then npm --version; fi
  printf '\nFim. Nenhuma configuração foi alterada.\n'
} > "$report" 2>&1
cat "$report"
printf '\nRelatório: %s\n' "$report"
