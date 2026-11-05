// Somente leitura. Execute antes de preparar a migração do banco existente.
const mysql = require('mysql2/promise');
async function inspect() {
  if (!process.env.DB_PASSWORD) throw new Error('Configure DB_PASSWORD em .env.');
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'delivery_app', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'delivery_saas_db' });
  try {
    const [tables] = await conn.execute(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    const [constraints] = await conn.execute(`SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`);
    console.log(JSON.stringify({ tables, constraints }, null, 2));
  } finally { await conn.end(); }
}
inspect().catch(err => { console.error('Falha ao inspecionar esquema:', err.code || err.message); process.exitCode = 1; });
