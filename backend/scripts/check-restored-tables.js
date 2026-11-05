const fs = require('node:fs');
const { parseTables, buildChecks, verifyChecks } = require('../src/restore-check');
try {
  const [mode, listFile, count, resultFile] = process.argv.slice(2);
  const tables = parseTables(fs.readFileSync(listFile, 'utf8'), Number(count));
  if (mode === '--sql' && !resultFile) process.stdout.write(buildChecks(tables));
  else if (mode === '--verify' && resultFile) {
    verifyChecks(tables, fs.readFileSync(resultFile, 'utf8'));
    console.log(`CHECK TABLE aprovado para ${tables.length} tabelas restauradas.`);
  } else throw new Error('Modo de verificação inválido.');
} catch (err) { console.error(err.message); process.exitCode = 1; }
