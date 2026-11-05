// Executado em container temporário da imagem candidata, nunca pelo servidor web.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { inspect, applyUpdate } = require('../src/live-update');
async function main() {
  const mode = process.argv[2];
  if (!['--check', '--rehearse', '--apply'].includes(mode) || process.argv.length !== 3) throw new Error('Uso: node scripts/upgrade-live.js --check|--rehearse|--apply');
  const database = process.env.DB_NAME || 'delivery_live_db';
  if (mode === '--rehearse' ? database !== 'delivery_upgrade_test' : database !== 'delivery_live_db') throw new Error('Banco não autorizado para este modo.');
  const db = await mysql.createConnection({ host: process.env.DB_HOST || 'mysql', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database, dateStrings: true, timezone: 'Z' });
  try {
    const [[identity]] = await db.query('SELECT DATABASE() AS name, @@server_uuid AS uuid, @@event_scheduler AS scheduler');
    if (String(identity.scheduler).toUpperCase() !== 'OFF') throw new Error('Agendador de eventos deve estar OFF.');
    if (mode === '--apply' && (process.env.UPDATE_APP_STOPPED !== 'true' || identity.uuid !== process.env.UPDATE_EXPECTED_UUID)) throw new Error('Aplicação parada e UUID esperado são obrigatórios para aplicar no banco real.');
    if (mode === '--check') { console.log(JSON.stringify((await inspect(db)).plan)); return; }
    const result = await applyUpdate(db);
    if (mode === '--rehearse') {
      const { verifyUpgradeSmoke } = require('../src/upgrade-smoke');
      await verifyUpgradeSmoke(db); result.api_smoke_passed = true;
    }
    const report = { status: 'PASSED', mode, database, server_uuid: identity.uuid, completed_at: new Date().toISOString(), ...result };
    const directory = process.env.UPDATE_REPORT_DIR || '/output';
    fs.writeFileSync(path.join(directory, mode === '--rehearse' ? 'rehearsal.json' : 'migration.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log('Migração e preservação dos dados aprovadas' + (mode === '--rehearse' ? '; smoke da API na cópia aprovado.' : '.'));
  } finally { await db.end(); }
}
main().catch(error => { console.error('Atualização recusada:', error.code || error.message); process.exitCode = 1; });
