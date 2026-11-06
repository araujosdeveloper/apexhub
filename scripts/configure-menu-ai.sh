#!/usr/bin/env bash
# Configura somente a integração de importação, sem imprimir a chave nem reiniciar serviços.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077
[[ -t 0 ]] || { printf 'Execute em um terminal interativo.\n'; exit 2; }
read -r -s -p 'Chave da API OpenAI (oculta): ' menu_api_key
printf '\n'
[[ "$menu_api_key" =~ ^[a-zA-Z0-9._-]{20,512}$ ]] || { unset menu_api_key; printf 'Formato de chave inválido. Nada alterado.\n'; exit 2; }
read -r -p 'Modelo [gpt-4.1-mini]: ' menu_ai_model
menu_ai_model="${menu_ai_model:-gpt-4.1-mini}"
[[ "$menu_ai_model" =~ ^[a-zA-Z0-9._:-]{1,100}$ ]] || { unset menu_api_key; printf 'Modelo inválido. Nada alterado.\n'; exit 2; }
menu_config_tmp="$(mktemp .env.ai.XXXXXXXX)"
trap 'rm -f -- "$menu_config_tmp"' EXIT
printf 'OPENAI_API_KEY=%s\nMENU_IMPORT_AI_MODEL=%s\n' "$menu_api_key" "$menu_ai_model" > "$menu_config_tmp"
unset menu_api_key
chmod 600 "$menu_config_tmp"
mv -f -- "$menu_config_tmp" .env.ai
printf 'Configuração salva em .env.ai (privado). Execute scripts/update-live.sh para aplicar.\n'
