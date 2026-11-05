// Somente leitura: recebe inventory.json e emite recomendações, nunca aplica SQL.
const fs = require('node:fs');
const { analyzeInventory } = require('../src/migration-plan');
const { buildAuditSql } = require('../src/migration-audit');
try {
 const source = process.argv[2];
 if (!source) throw new Error('Uso: node scripts/plan-migration.js inventory.json (ou - para stdin).');
 const input = fs.readFileSync(source === '-' ? 0 : source, 'utf8');
 const inventory = JSON.parse(input);
 if (process.argv.includes('--audit-sql')) process.stdout.write(buildAuditSql(inventory));
 else console.log(JSON.stringify(analyzeInventory(inventory), null, 2));
} catch (err) { console.error('Falha ao analisar inventário:', err.message); process.exitCode = 1; }
