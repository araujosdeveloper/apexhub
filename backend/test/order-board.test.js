const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boardFilter, utcDate } = require('../src/order-board');
const { serve } = require('../test-support/http');
const headers = { Cookie: 'delivery_session=' + 'a'.repeat(64), 'Content-Type': 'application/json' };
function fakeDb({ empty = false, affected = 1 } = {}) {
  const calls = [];
  return { calls, execute: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes('FROM sessions s')) return [[{ id: 3, company_id: 7, role: 'operator' }]];
    if (sql.startsWith('SELECT status,')) return [empty ? [] : [{ status: 'pending', count: '1', latest_id: 12 }, { status: 'completed', count: '20', latest_id: 99 }]];
    if (sql.startsWith('SELECT COUNT')) return [[{ total: empty ? 0 : 1 }]];
    if (sql.startsWith('SELECT o.id')) return [empty ? [] : [{ id: 12, status: 'pending', created_at: '2026-11-03 18:00:00', fulfillment_method: 'pickup', customer_name: 'Ana' }]];
    if (sql.startsWith('SELECT oi.id')) return [[{ id: 15, order_id: 12, product_name: 'Lanche', quantity: 1, addons_snapshot: [{ name: 'Queijo' }] }]];
    if (sql.startsWith('UPDATE orders')) return [{ affectedRows: affected }];
    if (sql.startsWith('SELECT id FROM orders')) return [[{ id: 12 }]];
    throw new Error(sql);
  } };
}
test('painel isola resumo, pedidos e itens pela sessão e serializa recebimento em UTC', async t => {
  const db = fakeDb(); const request = await serve(t, db);
  const response = await request('/api/admin/orders/board?company_id=999&fulfillment=pickup&search=Ana', { headers });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.company_id, 7); assert.equal(result.total, 1); assert.equal(result.counts.pending, 1); assert.equal(result.counts.completed, 20);
  assert.equal(result.latest_pending_id, 12); assert.equal(result.orders[0].created_at, '2026-11-03T18:00:00Z');
  assert.equal(result.orders[0].items[0].addons_snapshot[0].name, 'Queijo');
  for (const call of db.calls.filter(call => !call.sql.includes('FROM sessions s'))) assert.equal(call.args[0], 7);
  assert.match(db.calls.find(call => call.sql.startsWith('SELECT o.id')).sql, /ORDER BY o.created_at ASC, o.id ASC/);
  assert.deepEqual(db.calls.find(call => call.sql.startsWith('SELECT oi.id')).args, [7, 12]);
});
test('cozinha usa apenas etapas de produção; histórico usa ordem decrescente e paginação limitada', async t => {
  const kitchen = boardFilter({ scope: 'kitchen' }, 7); assert.deepEqual(kitchen.params, [7,'pending','preparing','ready']);
  const db = fakeDb(); const request = await serve(t, db);
  assert.equal((await request('/api/admin/orders/board?scope=history&limit=20&offset=40', { headers })).status, 200);
  const query = db.calls.find(call => call.sql.startsWith('SELECT o.id'));
  assert.match(query.sql, /ORDER BY o.created_at DESC, o.id DESC LIMIT 20 OFFSET 40/);
  assert.deepEqual(query.args, [7,'completed','cancelled']);
});
test('busca trata curingas como texto e filtros inválidos não consultam pedidos', async t => {
  const filter = boardFilter({ search: '10%_=' }, 7); assert.equal(filter.params.at(-1), '%10=%=_==%');
  assert.ok(boardFilter({ search: '#123' }, 7).params.includes(123));
  const db = fakeDb(); const request = await serve(t, db);
  for (const query of ['scope=constructor','scope=kitchen&status=delivering','status=cancelled','limit=101','limit=-1','offset=0&offset=1','fulfillment=mesa','search=' + 'a'.repeat(81)]) {
    assert.equal((await request('/api/admin/orders/board?' + query, { headers })).status, 400, query);
  }
  assert.equal(db.calls.some(call => call.sql.includes('FROM orders')), false);
});
test('painel vazio mantém contadores e não consulta itens; telas sem sessão não abrem stream', async t => {
  const db = fakeDb({ empty: true }); const request = await serve(t, db);
  const result = await (await request('/api/admin/orders/board', { headers })).json();
  assert.deepEqual(result.orders, []); assert.equal(result.counts.ready, 0);
  assert.equal(db.calls.some(call => call.sql.startsWith('SELECT oi.id')), false);
  assert.equal((await request('/api/admin/orders/events')).status, 401);
  assert.equal((await request('/api/admin/orders/board')).status, 401);
  assert.equal(utcDate(new Date('2026-11-03T18:00:00Z')), '2026-11-03T18:00:00.000Z');
});
test('transição compara status esperado e notifica somente a empresa após sucesso', async t => {
  const db = fakeDb(), notifications = [];
  const events = { stream: () => () => {}, publish: company => notifications.push(company) };
  const request = await serve(t, db, { orderEvents: events });
  assert.equal((await request('/api/admin/orders/12/status', { method: 'PATCH', headers, body: JSON.stringify({ status: 'preparing', expected_status: 'pending' }) })).status, 200);
  const query = db.calls.find(call => call.sql.startsWith('UPDATE orders'));
  assert.match(query.sql, /AND status = \?$/); assert.equal(query.args.at(-1), 'pending'); assert.equal(query.args[2], 7);
  assert.deepEqual(notifications, [7]);
  const conflicted = await serve(t, fakeDb({ affected: 0 }), { orderEvents: events });
  assert.equal((await conflicted('/api/admin/orders/12/status', { method: 'PATCH', headers, body: JSON.stringify({ status: 'ready', expected_status: 'pending' }) })).status, 409);
  assert.deepEqual(notifications, [7]);
});
