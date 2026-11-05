const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { migrateRestoredLegacy } = require('../src/legacy-migration');
async function main() {
  if (process.env.DB_NAME !== 'delivery_preview_rehearsal_test') throw new Error('Permitido somente no banco da prévia.');
  const db = mysql.createPool({ host: process.env.DB_HOST || 'mysql', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 1, timezone: 'Z', dateStrings: true });
  try {
    const result = await migrateRestoredLegacy(db);
    const [companies] = await db.execute('SELECT id, name, slug FROM companies WHERE active = 1 ORDER BY id');
    if (companies.length !== 1) throw new Error('A prévia automática exige exatamente uma loja ativa; revisar a seleção do proprietário.');
    fs.writeFileSync('/output/preview.json', JSON.stringify({ status: 'PREVIEW_MIGRATED', production_changed: false, company: companies[0], ...result.summary }, null, 2) + '\n', { mode: 0o600 });
    console.log('Cópia migrada e dados originais preservados. Loja da prévia:');
    console.log(JSON.stringify(companies[0], null, 2));
  } finally { await db.end(); }
}
main().catch(err => { console.error('Prévia não preparada:', err.code || err.message); process.exitCode = 1; });
