const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildAuditSql } = require('./migration-audit');
const legacyTables = ['categories', 'companies', 'customers', 'option_groups', 'options', 'order_items', 'orders', 'products'];
function validateLegacyInventory(inventory) {
 const tables = inventory.tables.map(t => t.name).sort();
 if (JSON.stringify(tables) !== JSON.stringify([...legacyTables].sort())) throw new Error('O conjunto de tabelas difere do legado inventariado. Refaça a análise.');
 for (const table of inventory.tables) if (table.type !== 'BASE TABLE' || table.engine !== 'InnoDB') throw new Error('O ensaio exige somente tabelas InnoDB.');
 const required = {
  companies: ['id', 'name', 'whatsapp_phone', 'subscription_status'], categories: ['id', 'company_id', 'name'],
  products: ['id', 'company_id', 'category_id', 'name'], customers: ['id', 'company_id', 'name', 'phone', 'address_street', 'address_number', 'address_neighborhood'],
  orders: ['id', 'company_id', 'customer_id', 'status', 'total_amount'], order_items: ['id', 'order_id', 'product_id', 'quantity', 'unit_price', 'selected_options'],
  option_groups: ['id'], options: ['id']
 };
 for (const [table, names] of Object.entries(required)) for (const name of names) {
  const col = inventory.columns.find(c => c.table === table && c.name === name);
  if (!col) throw new Error(`Coluna esperada ausente: ${table}.${name}`);
  if ((name === 'id' || name.endsWith('_id')) && !/^int(?:\(\d+\))?$/.test(col.type)) throw new Error(`Tipo de ID incompatível em ${table}.${name}`);
 }
 if (inventory.columns.some(c => (c.table === 'orders' && ['snapshot_source', 'customer_name'].includes(c.name)) || (c.table === 'order_items' && ['product_name', 'total_price'].includes(c.name)))) throw new Error('Migração parcial ou já aplicada; não repetir o DDL.');
}
async function inventoryFromDb(db) {
 const sql = fs.readFileSync(path.join(__dirname, '../../database/inventory.sql'), 'utf8');
 const [rows] = await db.query(sql); const value = Object.values(rows[0])[0];
 return typeof value === 'string' ? JSON.parse(value) : value;
}
async function runAudit(db, inventory) {
 const results = [];
 for (const sql of buildAuditSql(inventory).split(';').map(s => s.trim()).filter(Boolean)) {
  const [rows] = await db.query(sql); results.push({ check: rows[0].check_name, issues: Number(rows[0].issues) });
 }
 return results;
}
async function snapshotRows(db, inventory, original) {
 const snapshots = {};
 for (const table of legacyTables) {
  const columns = inventory.columns.filter(c => c.table === table).sort((a, b) => a.position - b.position).map(c => c.name);
  // Identificadores vindos do inventário são validados antes de entrar em SQL.
  if (columns.some(name => !/^[a-zA-Z0-9_]+$/.test(name))) throw new Error('Identificador inesperado no inventário.');
  const ids = original?.[table].ids;
  const filter = ids ? (ids.length ? ` WHERE id IN (${ids.map(() => '?').join(',')})` : ' WHERE 1 = 0') : '';
  const [rows] = await db.query(`SELECT ${columns.map(c => `\`${c}\``).join(',')} FROM \`${table}\`${filter} ORDER BY id`, ids || []);
  snapshots[table] = { rows: rows.length, ids: rows.map(r => r.id), sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
 }
 return snapshots;
}
function verifySnapshots(before, after) {
 for (const table of legacyTables) if (before[table].rows !== after[table].rows || before[table].sha256 !== after[table].sha256) throw new Error(`Dados originais alterados durante o ensaio: ${table}`);
}
async function migrateRestoredLegacy(db) {
 const [[identity]] = await db.query('SELECT DATABASE() AS name, @@event_scheduler AS event_scheduler');
 if (!/rehearsal_test$/.test(identity.name || '') || String(identity.event_scheduler).toUpperCase() !== 'OFF') throw new Error('Migração permitida somente na cópia rehearsal_test com event_scheduler OFF.');
 return migrateValidatedCopy(db);
}
async function migrateReleaseCopy(db, { sourceUuid, targetUuid } = {}) {
 const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 if (!uuid.test(sourceUuid || '') || !uuid.test(targetUuid || '') || sourceUuid === targetUuid) throw new Error('A migração de publicação exige servidores de origem e destino distintos e identificados.');
 const [[identity]] = await db.query('SELECT DATABASE() AS name, @@event_scheduler AS event_scheduler, @@server_uuid AS server_uuid');
 if (identity.name !== 'delivery_live_db' || identity.server_uuid !== targetUuid || String(identity.event_scheduler).toUpperCase() !== 'OFF') throw new Error('O destino não é a cópia persistente de publicação confirmada.');
 return migrateValidatedCopy(db);
}
async function migrateValidatedCopy(db) {
 const [[objects]] = await db.query(`SELECT
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()) AS triggers_count,
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()) AS routines_count,
  (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()) AS events_count`);
 if (Object.values(objects).some(n => Number(n) > 0)) throw new Error('Cópia contém triggers, rotinas ou eventos; revisar seus efeitos antes do ensaio.');
 const inventory = await inventoryFromDb(db); validateLegacyInventory(inventory);
 const auditBefore = await runAudit(db, inventory);
 if (auditBefore.some(r => r.issues && r.check !== 'review_order_total')) throw new Error('Auditoria encontrou inconsistências; não aplicar DDL antes de revisá-las.');
 const [[options]] = await db.query('SELECT COUNT(*) AS n FROM order_items WHERE selected_options IS NOT NULL AND JSON_LENGTH(selected_options) > 0');
 if (Number(options.n)) throw new Error('Itens com adicionais exigem revisão do cálculo histórico antes da migração.');
 const [[invalid]] = await db.query('SELECT COUNT(*) AS n FROM order_items WHERE quantity <= 0 OR unit_price < 0 OR quantity * unit_price > 99999999.99');
 if (Number(invalid.n)) throw new Error('Itens com valores inválidos impedem o preenchimento do subtotal.');
 const [[missing]] = await db.query('SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)');
 const before = await snapshotRows(db, inventory);
 const migrationConnection = await db.getConnection();
 try {
  for (const filename of ['migrations/003-legacy-foundation.sql', '004-store-operations.sql', '005-product-addons.sql', '006-coupons.sql']) {
   const sql = fs.readFileSync(path.join(__dirname, '../../database', filename), 'utf8').replace(/^--.*$/gm, '');
   for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await migrationConnection.query(statement);
  }
 } finally { migrationConnection.release(); }
 const after = await snapshotRows(db, inventory, before); verifySnapshots(before, after);
 const [[incomplete]] = await db.query(`SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.snapshot_source <> 'legacy_customer_record' OR NOT (o.customer_name <=> COALESCE(c.name, ''))
  OR NOT (o.customer_phone <=> COALESCE(c.phone, '')) OR NOT (o.address_street <=> COALESCE(c.address_street, ''))
  OR NOT (o.address_number <=> COALESCE(c.address_number, '')) OR NOT (o.address_neighborhood <=> COALESCE(c.address_neighborhood, ''))`);
 if (Number(incomplete.n)) throw new Error('Preenchimento do histórico divergiu do cadastro de origem.');
 return { inventory, before, summary: {
  original_data_preserved: true, source_tables: Object.fromEntries(Object.entries(before).map(([table, value]) => [table, { rows: value.rows, sha256: value.sha256 }])),
  legacy_orders_without_items: Number(missing.n), historical_address_source: 'current_customer_record',
  legacy_subscription_policy: 'legacy; sem presumir cobrança ou pagamento confirmado', audit_before: auditBefore,
  audit_after: await runAudit(db, await inventoryFromDb(db))
 } };
}
module.exports = { validateLegacyInventory, inventoryFromDb, snapshotRows, verifySnapshots, migrateRestoredLegacy, migrateReleaseCopy };
