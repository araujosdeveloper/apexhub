const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { migrateReleaseCopy } = require('../src/legacy-migration');
const { restrictReleaseUser } = require('../src/release-permissions');
async function main() {
  const db = mysql.createPool({ host: 'mysql', user: 'root', password: process.env.DB_PASSWORD, database: 'delivery_live_db', connectionLimit: 1, timezone: 'Z', dateStrings: true });
  try {
    const result = await migrateReleaseCopy(db, { sourceUuid: process.env.SOURCE_SERVER_UUID, targetUuid: process.env.TARGET_SERVER_UUID });
    const sourceCounts = fs.readFileSync('/output/source-counts.tsv', 'utf8').trim().split('\n').map(line => line.split('\t'));
    if (sourceCounts.length !== Object.keys(result.summary.source_tables).length) throw new Error('Contagens de origem incompletas.');
    for (const [table, count] of sourceCounts) {
      if (!/^\d+$/.test(count) || result.summary.source_tables[table]?.rows !== Number(count)) throw new Error('Contagem restaurada divergiu da origem: ' + table);
    }
    const [companies] = await db.execute('SELECT id, name, slug FROM companies WHERE active = 1 ORDER BY id');
    if (companies.length !== 1 || companies[0].id !== 1 || companies[0].slug !== 'cachorro-quente-bebella') throw new Error('Loja de destino diverge da loja validada; revisar antes de publicar.');
    // A aplicação usa conta exclusiva, sem DDL ou privilégios administrativos.
    await restrictReleaseUser(db);
    fs.writeFileSync('/output/release.json', JSON.stringify({ status: 'RELEASE_COPY_MIGRATED', source_database_changed: false, company: companies[0], ...result.summary }, null, 2) + '\n', { mode: 0o600 });
    console.log('Cópia persistente migrada; contagens da origem e hashes dos registros conferidos.');
    console.log('Conta da aplicação limitada a SELECT, INSERT, UPDATE e DELETE.');
  } finally { await db.end(); }
}
main().catch(err => { console.error('Cópia não preparada:', err.code || err.message); process.exitCode = 1; });
