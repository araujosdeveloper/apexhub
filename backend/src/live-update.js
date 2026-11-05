const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const identifier = name => {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Identificador de banco inesperado.');
  return '`' + name + '`';
};
function planUpdate(columns) {
  const has = (table, column) => columns.some(c => c.table_name === table && c.column_name === column);
  for (const [table, names] of Object.entries({ companies: ['id', 'slug'], products: ['id', 'company_id'],
    orders: ['id', 'snapshot_source', 'customer_name'], order_items: ['id', 'product_name', 'total_price'],
    users: ['id'], sessions: ['token_hash'], subscriptions: ['company_id'], checkout_requests: ['request_hash'] })) {
    if (names.some(name => !has(table, name))) throw new Error('A atualização exige a fundação SaaS completa: ' + table);
  }
  const state = (fields, name) => {
    const present = fields.filter(([table, field]) => has(table, field)).length;
    if (present && present !== fields.length) throw new Error('Migração parcial detectada: ' + name + '. Inspecionar antes de continuar.');
    return present === fields.length;
  };
  // delivery_fee já existe no legado; não indica aplicação de 004.
  const operations = state([['company_operations','company_id'], ['company_operations','config'], ['orders','fulfillment_method'], ['orders','fulfillment_address'], ['orders','estimated_minutes']], '004');
  const addons = state([['product_addons','product_id'], ['product_addons','config'], ['product_addons','version'], ['order_items','addons_snapshot']], '005');
  const coupons = state([['company_coupons','id'], ['company_coupons','company_id'], ['company_coupons','code'], ['company_coupons','config'], ['company_coupons','version'], ['company_coupons','usage_count'], ['orders','coupon_code'], ['orders','discount_amount'], ['orders','coupon_snapshot'], ['orders','customer_phone_key']], '006');
  const drivers = state([['delivery_drivers','id'],['delivery_drivers','company_id'],['delivery_drivers','name'],['delivery_drivers','phone'],['delivery_drivers','active'],['delivery_drivers','version'],['delivery_assignments','order_id'],['delivery_assignments','company_id'],['delivery_assignments','driver_id'],['delivery_assignments','driver_name'],['delivery_assignments','driver_phone'],['delivery_assignments','version']], '007');
  const merchandising=state([['company_merchandising','company_id'],['company_merchandising','config'],['company_merchandising','version']], '008');
  const images=state([['product_images','product_id'],['product_images','content_type'],['product_images','content'],['product_images','digest']], '009');
  const tracking=state([['order_tracking','order_id'],['order_tracking','token']], '010');
  const reviews=state([['order_reviews','order_id'],['order_reviews','rating'],['order_reviews','comment'],['order_reviews','created_at']], '011');
  const master=state([['platform_tenant_profiles','company_id'],['platform_tenant_profiles','cnpj'],['platform_admins','id'],['platform_admins','name'],['platform_admins','email'],['platform_admins','password_hash'],['platform_admins','active'],['platform_admins','created_at'],['platform_sessions','token_hash'],['platform_sessions','admin_id'],['platform_sessions','expires_at'],['platform_audit','id'],['platform_audit','admin_id'],['platform_audit','action'],['platform_audit','entity_id'],['platform_audit','details'],['platform_audit','created_at']], '012');
  if(master&&!reviews)throw new Error('Master sem migração de avaliações.');
  if(reviews&&!tracking)throw new Error('Avaliações sem acompanhamento.');
  if(tracking&&!images)throw new Error('Acompanhamento sem migração de imagens.');
  if(images&&!merchandising)throw new Error('Imagens sem migração da vitrine.');
  if(merchandising&&!drivers)throw new Error('Vitrine sem migração de entregadores.');
  if (drivers && !coupons) throw new Error('Entregadores sem migração de cupons.');
  if (operations && !has('orders', 'delivery_fee')) throw new Error('Operação sem coluna de frete.');
  if (addons && !operations) throw new Error('Adicionais sem a migração de operação.');
  if (coupons && !addons) throw new Error('Cupons sem a migração de adicionais.');
  for (const [table, column] of [['companies','id'], ['products','id'], ['orders','id']]) {
    const type = columns.find(c => c.table_name === table && c.column_name === column)?.column_type;
    if (!/^int(?:\(\d+\))?(?: unsigned)?$/i.test(type || '')) throw new Error('Tipo de ID não suportado nesta atualização: ' + table);
  }
  return { pending: [...(!operations ? ['004-store-operations.sql'] : []), ...(!addons ? ['005-product-addons.sql'] : []), ...(!coupons ? ['006-coupons.sql'] : []), ...(!drivers ? ['007-delivery-drivers.sql'] : []), ...(!merchandising ? ['008-menu-merchandising.sql'] : []), ...(!images ? ['009-product-images.sql'] : []), ...(!tracking ? ['010-order-tracking.sql'] : []), ...(!reviews ? ['011-order-reviews.sql'] : []), ...(!master ? ['012-platform-master.sql'] : [])], operations, addons, coupons, drivers, merchandising, images, tracking, reviews, master, rollback_before_open_only: true };
}
async function inspect(db) {
  const [columns] = await db.query('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
  const [tables] = await db.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  if (tables.some(table => table.engine !== 'InnoDB')) throw new Error('Há tabela não InnoDB; revisar antes de migrar.');
  return { columns, tables, plan: planUpdate(columns) };
}
async function snapshot(db, schema) {
  const result = {};
  for (const table of schema.tables) {
    const columns=schema.columns.filter(column=>column.table_name===table.name);
    const names=columns.map(column=>/^(?:tiny|medium|long)?blob$/i.test(column.column_type)?`SHA2(${identifier(column.column_name)},256) AS ${identifier(column.column_name)}`:identifier(column.column_name));
    const [keys] = await db.query("SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX", [table.name]);
    if (!keys.length) throw new Error('Tabela sem chave primária: ' + table.name);
    const [rows] = await db.query(`SELECT ${names.join(',')} FROM ${identifier(table.name)} ORDER BY ${keys.map(key => identifier(key.name)).join(',')}`);
    result[table.name] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return result;
}
function verifySnapshots(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Registros anteriores divergiram após a migração. Não abrir tráfego.');
}
async function applyUpdate(db) {
  const schema = await inspect(db), before = await snapshot(db, schema);
  const [[invalidFee]] = await db.query('SELECT COUNT(*) AS n FROM orders WHERE delivery_fee < 0').catch(error => {
    if (error.code === 'ER_BAD_FIELD_ERROR' && !schema.columns.some(column => column.table_name === 'orders' && column.column_name === 'delivery_fee')) return [[{ n: 0 }]];
    throw error;
  });
  if (Number(invalidFee.n)) throw new Error('Frete negativo no histórico exige revisão.');
  for (const filename of schema.plan.pending) {
    const sql = fs.readFileSync(path.join(__dirname, '../../database', filename), 'utf8').replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
  }
  const after = await snapshot(db, schema); verifySnapshots(before, after);
  const updated = await inspect(db);
  if (updated.plan.pending.length) throw new Error('Migração não concluiu o esquema esperado.');
  for (const table of updated.tables) {
    const [checks] = await db.query('CHECK TABLE ' + identifier(table.name));
    if (!checks.length || checks.some(check => check.Msg_type !== 'status' || !['OK', 'Table is already up to date'].includes(check.Msg_text))) throw new Error('CHECK TABLE não aprovou: ' + table.name);
  }
  return { applied: schema.plan.pending, original_data_preserved: true, original_tables: before, checked_tables: updated.tables.length };
}
module.exports = { planUpdate, inspect, snapshot, verifySnapshots, applyUpdate };
