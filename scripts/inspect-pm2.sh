#!/usr/bin/env bash
# Seleciona somente metadados; nunca imprime o ambiente completo do PM2.
set -Eeuo pipefail
if ! command -v pm2 >/dev/null 2>&1; then
  printf 'PM2 não encontrado neste terminal.\n' >&2
  exit 2
fi
pm2 jlist | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
    const entries = JSON.parse(input);
    console.log(JSON.stringify(entries.map(entry => {
      const env = entry.pm2_env || {};
      return {
        name: entry.name, pm_id: entry.pm_id, pid: entry.pid,
        status: env.status, script: env.pm_exec_path, cwd: env.pm_cwd,
        interpreter: env.exec_interpreter, mode: env.exec_mode,
        instances: env.instances, restarts: env.restart_time
      };
    }), null, 2));
  } catch {
    console.error("Não foi possível interpretar a lista do PM2. Nenhum conteúdo bruto foi exibido.");
    process.exitCode = 2;
  }
});'
