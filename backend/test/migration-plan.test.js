const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeInventory } = require('../src/migration-plan');
function inventory() {
 return { database: 'delivery_saas_db', server_version: '8.0', tables: [{ name: 'companies', type: 'BASE TABLE', engine: 'InnoDB' }, { name: 'orders', type: 'BASE TABLE', engine: 'InnoDB' }],
  columns: [{ table: 'companies', name: 'id', type: 'bigint unsigned' }, { table: 'companies', name: 'slug', type: 'varchar(80)' }, { table: 'orders', name: 'company_id', type: 'int unsigned' }, { table: 'orders', name: 'status', type: "enum('pending','preparing','completed','cancelled')" }], indexes: [], foreign_keys: [] };
}
test('plano detecta tabelas novas e campos históricos sem aplicar mudanças', () => {
 const input = inventory(); const original = JSON.stringify(input); const plan = analyzeInventory(input);
 assert.equal(plan.applied, false); assert.equal(plan.status, 'REVIEW_REQUIRED'); assert.equal(JSON.stringify(input), original);
 assert.ok(plan.findings.some(f => f.code === 'CREATE_TABLE' && f.table === 'users'));
 assert.ok(plan.findings.some(f => f.code === 'BACKFILL_HISTORY' && f.table === 'orders'));
 assert.ok(plan.findings.some(f => f.code === 'ASSOCIATE_OWNERS'));
});
test('plano distingue bigint, signed e unsigned ao avaliar relacionamentos', () => {
 const input = inventory(); assert.ok(analyzeInventory(input).findings.some(f => f.code === 'REVIEW_ID_TYPE'));
 input.columns[0].type = 'int(11) unsigned';
 assert.equal(analyzeInventory(input).findings.some(f => f.code === 'REVIEW_ID_TYPE'), false);
 input.columns[0].type = 'int';
 assert.ok(analyzeInventory(input).findings.some(f => f.code === 'REVIEW_ID_TYPE'));
});
test('índice com prefixo não equivale à unicidade completa necessária', () => {
 const input = inventory(); input.indexes = [{ table: 'companies', name: 'slug_unique', column: 'slug', position: 1, unique: 1, prefix: 10 }];
 assert.ok(analyzeInventory(input).findings.some(f => f.code === 'REVIEW_UNIQUE' && f.table === 'companies'));
 input.indexes[0].prefix = null;
 assert.equal(analyzeInventory(input).findings.some(f => f.code === 'REVIEW_UNIQUE' && f.table === 'companies'), false);
});
test('status incompleto e engine não transacional exigem revisão', () => {
 const input = inventory(); input.tables[1].engine = 'MyISAM';
 const codes = analyzeInventory(input).findings.map(f => f.code);
 assert.ok(codes.includes('REVIEW_STORAGE')); assert.ok(codes.includes('REVIEW_ORDER_STATUS'));
});
test('inventário inválido é rejeitado', () => {
 for (const input of [null, {}, { ...inventory(), columns: null }, { ...inventory(), database: '' }]) assert.throws(() => analyzeInventory(input), /Inventário inválido/);
});
test('auditoria ignora tabelas/colunas ausentes e emite somente consultas agregadas', () => {
 const { buildAuditSql } = require('../src/migration-audit');
 const sql = buildAuditSql(inventory());
 assert.match(sql, /duplicate_company_slug/); assert.match(sql, /orphan_orders_company_id/); assert.match(sql, /unknown_order_status/);
 assert.doesNotMatch(sql, /cross_company_order_customer|invalid_order_item_amount/);
 for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) assert.match(statement, /^SELECT /);
 assert.doesNotMatch(sql, /SELECT \*|INSERT |UPDATE |DELETE |ALTER |DROP /);
});
test('auditoria identifica vínculos cruzados e totais divergentes quando o esquema permite', () => {
 const { buildAuditSql } = require('../src/migration-audit'); const input = inventory();
 for (const [table, names] of [['orders', ['id', 'customer_id', 'total_amount']], ['customers', ['id', 'company_id']], ['products', ['id', 'company_id', 'category_id', 'price']], ['categories', ['id', 'company_id']], ['order_items', ['order_id', 'product_id', 'quantity', 'unit_price', 'total_price']]]) {
  input.columns.push(...names.map(name => ({ table, name, type: 'int' })));
 }
 const sql = buildAuditSql(input);
 for (const code of ['cross_company_order_customer', 'cross_company_order_product', 'cross_company_product_category', 'review_order_total', 'invalid_order_item_amount']) assert.ok(sql.includes(code));
 assert.doesNotMatch(sql, /o\.delivery_fee/);
 input.columns.push({ table: 'orders', name: 'delivery_fee', type: 'decimal(10,2)' });
 const updated = buildAuditSql(input);
 assert.match(updated, /o\.total_amount - i\.items_total - COALESCE\(o\.delivery_fee, 0\)/);
 assert.match(updated, /invalid_delivery_fee/);
 assert.doesNotMatch(updated, /delivery_fee IS NULL/);
 input.columns.push({ table: 'orders', name: 'discount_amount', type: 'decimal(10,2)' });
 assert.match(buildAuditSql(input), /COALESCE\(o\.delivery_fee, 0\) \+ o\.discount_amount/);
});
