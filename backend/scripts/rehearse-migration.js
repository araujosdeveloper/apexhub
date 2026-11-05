const fs = require('node:fs');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/security');
const { migrateRestoredLegacy, snapshotRows, verifySnapshots } = require('../src/legacy-migration');
async function rehearse() {
 if (!/rehearsal_test$/.test(process.env.DB_NAME || '')) throw new Error('Configure somente o banco isolado rehearsal_test.');
 const db = mysql.createPool({ host: process.env.DB_HOST || 'mysql', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 5, timezone: 'Z', dateStrings: true });
 let server;
 try {
  const result = await migrateRestoredLegacy(db);
  console.log('Migração na cópia concluída; hashes dos registros originais preservados.');
  server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', body, cookie, key) => fetch(base + url, {
   method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
   ...(body ? { body: JSON.stringify(body) } : {})
  });
  assert.equal((await request('/api/health')).status, 200);
  const [[company]] = await db.query('SELECT id, slug FROM companies WHERE active = 1 ORDER BY id LIMIT 1');
  if (!company) throw new Error('Não há loja ativa para testar a autenticação do legado.');
  const email = randomUUID() + '@rehearsal.example'; const password = randomBytes(24).toString('hex');
  await db.execute("INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, 'Proprietário de ensaio', ?, ?, 'owner')", [company.id, email, await hashPassword(password)]);
  const login = await request('/api/auth/login', 'POST', { email, password }); assert.equal(login.status, 200);
  const oldCookie = login.headers.get('set-cookie').split(';')[0];
  const me = await (await request('/api/auth/me', 'GET', null, oldCookie)).json(); assert.equal(me.user.company_id, company.id);
  const legacyOrders = await request('/api/admin/orders', 'GET', null, oldCookie); assert.equal(legacyOrders.status, 200);
  const orderList = await legacyOrders.json();
  assert.ok(orderList.every(o => o.snapshot_source === 'legacy_customer_record'));
  const subscription = await (await request('/api/admin/subscription', 'GET', null, oldCookie)).json(); assert.equal(subscription.subscription.status, 'legacy');
  assert.equal((await request('/api/menu/' + encodeURIComponent(company.slug))).status, 200);
  console.log('HTTP real: login de ensaio, loja existente, pedidos históricos e assinatura legada verificados.');
  const slug = 'ensaio-' + randomUUID();
  const registration = await request('/api/auth/register', 'POST', { name: 'Teste', email: randomUUID() + '@rehearsal.example', password, company_name: 'R'.repeat(160), slug });
  assert.equal(registration.status, 201); const cookie = registration.headers.get('set-cookie').split(';')[0];
  const account = await (await request('/api/auth/me', 'GET', null, cookie)).json(); assert.notEqual(account.user.company_id, company.id);
  const categoryResponse = await request('/api/admin/categories', 'POST', { name: 'C'.repeat(120) }, cookie); assert.equal(categoryResponse.status, 201); const category = await categoryResponse.json();
  const productResponse = await request('/api/admin/products', 'POST', { name: 'P'.repeat(160), description: 'Produto de ensaio', category_id: category.id, price: '15.50' }, cookie); assert.equal(productResponse.status, 201); const product = await productResponse.json();
  const payload = { company_id: account.user.company_id, customer: { name: 'N'.repeat(160), phone: '1199999999999', street: 'S'.repeat(160), number: '1'.repeat(160), neighborhood: 'B'.repeat(160) }, items: [{ product_id: product.id, quantity: 2, price: 0.01 }], payment_method: 'Pix' };
  const key = randomUUID();
  const responses = await Promise.all([request('/api/orders', 'POST', payload, null, key), request('/api/orders', 'POST', payload, null, key)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  const [first, second] = await Promise.all(responses.map(r => r.json()));
  assert.equal(first.order_id, second.order_id); assert.equal(first.total_amount, 31);
  assert.equal((await request(`/api/admin/orders/${first.order_id}/status`, 'PATCH', { status: 'preparing' }, oldCookie)).status, 404);
  assert.equal((await request(`/api/admin/orders/${first.order_id}/status`, 'PATCH', { status: 'preparing' }, cookie)).status, 200);
  const freshOrders = await (await request('/api/admin/orders', 'GET', null, cookie)).json(); assert.equal(freshOrders.length, 1); assert.equal(freshOrders[0].snapshot_source, 'checkout');
  const afterSmoke = await snapshotRows(db, result.inventory, result.before); verifySnapshots(result.before, afterSmoke);
  const report = { status: 'REHEARSAL_PASSED', production_changed: false, runtime: process.version, ...result.summary,
   original_data_preserved_after_http_tests: true, http_tests: ['health', 'legacy_owner_login', 'legacy_menu', 'legacy_orders', 'legacy_subscription', 'new_restaurant_registration', 'catalog_at_validation_limits', 'concurrent_checkout', 'tenant_isolation', 'order_status_transition'],
   limitations: ['Proprietário de ensaio criado somente na cópia; associação real ainda pendente.', 'Endereços históricos preenchidos com cadastro atual; não reconstitui histórico perdido.', 'Pedidos antigos sem itens foram preservados sem fabricação de linhas.', 'Migração de produção e troca da aplicação não executadas.'] };
  fs.writeFileSync('/output/rehearsal.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('APROVADO: restauração, migração na cópia e testes HTTP concluídos.');
  console.log('Pedidos históricos sem itens:', report.legacy_orders_without_items);
 } finally {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await db.end();
 }
}
rehearse().catch(err => { console.error('ENSAIO NÃO APROVADO:', err.code || err.message); process.exitCode = 1; });
