#!/usr/bin/env bash
# Consulta somente nomes de arquivos e metadados de commits.
set -Eeuo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
printf 'Histórico Git disponível para o backend:\n'
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git log -8 --format='%h %ad' --date=iso-strict -- backend/server.js
  printf '\nSituação dos arquivos de código:\n'
  git status --short -- backend/server.js backend/src frontend
else
  printf 'Nenhum histórico Git acessível.\n'
fi
printf '\nPossíveis cópias de código (somente caminhos):\n'
find /root /opt /srv -maxdepth 4 -type f \( -name 'server.js*' -o -name '*delivery*.tar*' -o -name '*delivery*.zip' -o -name '*backend*.tar*' -o -name '*backend*.zip' \) -not -path '*/node_modules/*' -not -path '*/.cache/*' 2>/dev/null || true
printf '\nConsulta concluída. Nenhum processo foi reiniciado.\n'
