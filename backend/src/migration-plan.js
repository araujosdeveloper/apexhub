const expected = {
 companies: ['id', 'name', 'slug', 'whatsapp_phone', 'active'],
 company_operations: ['company_id', 'config'],
 company_coupons: ['id', 'company_id', 'code', 'config', 'version', 'usage_count'],
 product_addons: ['product_id', 'config', 'version'],
 categories: ['id', 'company_id', 'name', 'sort_order', 'active'],
 products: ['id', 'company_id', 'category_id', 'name', 'description', 'price', 'active'],
 customers: ['id', 'company_id', 'name', 'phone', 'address_street', 'address_number', 'address_neighborhood'],
 orders: ['id', 'company_id', 'customer_id', 'total_amount', 'status', 'payment_method', 'notes', 'snapshot_source', 'customer_name', 'customer_phone', 'address_street', 'address_number', 'address_neighborhood', 'created_at', 'fulfillment_method', 'delivery_fee', 'fulfillment_address', 'estimated_minutes', 'coupon_code', 'discount_amount', 'coupon_snapshot', 'customer_phone_key'],
 order_items: ['id', 'order_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'total_price', 'addons_snapshot','item_notes'],
 users: ['id', 'company_id', 'name', 'email', 'password_hash', 'role', 'active'],
 sessions: ['token_hash', 'user_id', 'expires_at'],
 subscriptions: ['id', 'company_id', 'plan_code', 'status', 'trial_ends_at'],
 checkout_requests: ['company_id', 'request_key', 'request_hash', 'order_id']
};
const uniqueRequirements = [
 ['companies', ['slug']], ['customers', ['company_id', 'phone']], ['users', ['email']],
 ['sessions', ['token_hash']], ['subscriptions', ['company_id']], ['checkout_requests', ['company_id', 'request_key']], ['company_operations', ['company_id']], ['product_addons', ['product_id']], ['company_coupons', ['company_id', 'code']]
];
function normalizeInteger(type) {
 return String(type).toLowerCase().replace(/\(\d+\)/g, '').replace(/\s+/g, ' ').trim();
}
function analyzeInventory(inventory) {
 if (!inventory || typeof inventory.database !== 'string' || !inventory.database ||
     !Array.isArray(inventory.tables) || !Array.isArray(inventory.columns) || !Array.isArray(inventory.indexes) || !Array.isArray(inventory.foreign_keys)) throw new Error('Inventário inválido ou incompleto.');
 const tables = new Map(inventory.tables.map(t => [t.name, t]));
 const column = (table, name) => inventory.columns.find(c => c.table === table && c.name === name);
 const findings = [];
 const add = (code, table, detail) => findings.push({ code, table, detail });
 for (const [table, columns] of Object.entries(expected)) {
  if (!tables.has(table)) { add('CREATE_TABLE', table, 'Tabela ausente; gerar DDL compatível com os tipos reais das tabelas referenciadas.'); continue; }
  if (tables.get(table).type !== 'BASE TABLE' || tables.get(table).engine !== 'InnoDB') add('REVIEW_STORAGE', table, 'Exige revisão do tipo/engine antes de migração e backup transacional.');
  const missing = columns.filter(name => !column(table, name));
  if (missing.length) add('ADD_COLUMNS', table, missing.join(', '));
 }
 for (const [table, names] of uniqueRequirements) {
  if (!tables.has(table)) continue;
  const groups = new Map();
  for (const index of inventory.indexes.filter(i => i.table === table && Number(i.unique) === 1)) {
   if (!groups.has(index.name)) groups.set(index.name, []);
   groups.get(index.name).push(index);
  }
  const found = [...groups.values()].some(parts => {
   parts.sort((a, b) => a.position - b.position);
   return parts.length === names.length && parts.every((p, n) => p.column === names[n] && p.prefix == null);
  });
  if (!found) add('REVIEW_UNIQUE', table, `Validar duplicados antes de criar UNIQUE (${names.join(', ')}).`);
 }
 const links = [
  ['categories', 'company_id', 'companies', 'id'], ['products', 'company_id', 'companies', 'id'],
  ['company_operations', 'company_id', 'companies', 'id'],
  ['company_coupons', 'company_id', 'companies', 'id'],
  ['product_addons', 'product_id', 'products', 'id'],
  ['products', 'category_id', 'categories', 'id'], ['customers', 'company_id', 'companies', 'id'],
  ['orders', 'company_id', 'companies', 'id'], ['orders', 'customer_id', 'customers', 'id'],
  ['order_items', 'order_id', 'orders', 'id'], ['order_items', 'product_id', 'products', 'id'],
  ['users', 'company_id', 'companies', 'id'], ['sessions', 'user_id', 'users', 'id'],
  ['subscriptions', 'company_id', 'companies', 'id'], ['checkout_requests', 'company_id', 'companies', 'id'],
  ['checkout_requests', 'order_id', 'orders', 'id']
 ];
 for (const [table, name, parent, parentName] of links) {
  const child = column(table, name); const target = column(parent, parentName);
  if (!child || !target) continue;
  if (normalizeInteger(child.type) !== normalizeInteger(target.type)) add('REVIEW_ID_TYPE', table, `${name} (${child.type}) difere de ${parent}.${parentName} (${target.type}).`);
  if (!inventory.foreign_keys.some(f => f.table === table && f.column === name && f.referenced_table === parent && f.referenced_column === parentName)) add('REVIEW_FOREIGN_KEY', table, `Conferir órfãos antes de vincular ${name} a ${parent}.${parentName}.`);
 }
 const status = column('orders', 'status');
 if (status && /^enum\(/i.test(status.type) && !['pending', 'preparing', 'ready', 'delivering', 'completed', 'cancelled'].every(value => String(status.type).includes(`'${value}'`))) add('REVIEW_ORDER_STATUS', 'orders', 'Conferir valores existentes e ampliar o domínio para o fluxo completo.');
 const historical = ['customer_name', 'customer_phone', 'address_street', 'address_number', 'address_neighborhood'].filter(n => !column('orders', n));
 if (tables.has('orders') && historical.length) add('BACKFILL_HISTORY', 'orders', 'Pedidos antigos só podem receber o endereço atualmente disponível no cadastro; registrar essa limitação e preservar o backup original.');
 if (tables.has('order_items') && !column('order_items', 'product_name')) add('BACKFILL_HISTORY', 'order_items', 'Preencher nome a partir do produto atual, preservando preço e quantidade originais.');
 if (tables.has('companies') && !tables.has('users')) add('ASSOCIATE_OWNERS', 'users', 'Associar proprietários às empresas existentes; não permitir que cadastro público reivindique uma loja.');
 return {
  database: inventory.database, server_version: inventory.server_version,
  status: 'REVIEW_REQUIRED', applied: false,
  scope: 'Análise de metadados; não verifica integridade dos dados nem autoriza aplicação automática.',
  tables_found: inventory.tables.length, findings,
  next_steps: ['Verificar backup e ensaiar restauração em banco isolado.', 'Conferir DDL completo, índices, duplicados, órfãos, valores e vínculos entre empresas.', 'Gerar migração específica e executá-la na cópia restaurada.', 'Comparar contagens e totais e testar autenticação e pedidos antes de agendar a troca.']
 };
}
module.exports = { analyzeInventory };
