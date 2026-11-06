#!/usr/bin/env bash
# Usa as variáveis do app em execução; não lê nem imprime arquivos de credenciais.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
backup_require
backup_release
{
 printf 'const menuAIErrorTools = (() => { const module = {exports:{}};\n'
 cat "$backup_project_root/backend/src/menu-ai-errors.js"
 printf '\nreturn module.exports;})();\n'
 cat "$backup_project_root/scripts/check-menu-ai.js"
 printf '\ndiagnoseMenuAI().then(ok=>{process.exitCode=ok?0:1;}).catch(()=>{console.error("Diagnóstico não concluído.");process.exitCode=1;});\n'
} | bash "$backup_release_dir/manage.sh" exec -T app node -
