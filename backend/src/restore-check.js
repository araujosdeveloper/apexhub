function parseTables(text, expectedCount) {
  const tables = text.trim().split('\n').filter(Boolean);
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || tables.length !== expectedCount ||
      new Set(tables).size !== tables.length || tables.some(name => !/^[a-zA-Z0-9_]+$/.test(name))) {
    throw new Error('Lista de tabelas restauradas inválida ou incompleta.');
  }
  return tables;
}
function buildChecks(tables) {
  return tables.map(name => `CHECK TABLE \`delivery_restore_test\`.\`${name}\`;`).join('\n') + '\n';
}
function verifyChecks(tables, text) {
  const expected = new Set(tables.map(name => 'delivery_restore_test.' + name));
  const rows = text.trim().split('\n').filter(Boolean).map(line => line.split('\t'));
  const passed = new Set();
  for (const row of rows) {
    const [table, operation, type, message] = row;
    if (row.length !== 4 || !expected.has(table) || operation !== 'check' || type !== 'status' ||
        !['OK', 'Table is already up to date'].includes(message) || passed.has(table)) {
      throw new Error('CHECK TABLE não confirmou a integridade de todas as tabelas.');
    }
    passed.add(table);
  }
  if (passed.size !== expected.size) throw new Error('Resultado CHECK TABLE incompleto.');
}
module.exports = { parseTables, buildChecks, verifyChecks };
