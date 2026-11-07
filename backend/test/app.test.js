const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serve: createRequester } = require('../test-support/http');
async function serve(t, db, options) {
 const request = await createRequester(t, db, options);
 return (url, options = {}) => request(url, { ...options, headers: { ...(url === '/api/orders' ? { 'Idempotency-Key': 'test-order-key-0001' } : {}), ...options.headers } });
}
const { hashPassword, verifyPassword, tokenHash } = require('../src/security');
const cookie = 'delivery_session=' + 'a'.repeat(64);
const user = { id: 3, company_id: 7, role: 'owner', name: 'Ana', company_name: 'Loja A', slug: 'loja-a' };
function authenticated(handler, account = user) {
 return { execute: async (sql, args) => {
  if (sql.includes('FROM sessions s')) { assert.equal(args[0], tokenHash('a'.repeat(64))); return [[account]]; }
  return handler(sql, args);
 } };
}
test('senhas usam salt e hash verificável, sem armazenar texto puro', async () => {
 const a = await hashPassword('senha-segura-1234');
 const b = await hashPassword('senha-segura-1234');
 assert.notEqual(a, b);
 assert.equal(await verifyPassword('senha-segura-1234', a), true);
 assert.equal(await verifyPassword('senha-incorreta', a), false);
 assert.equal(await verifyPassword('teste', 'invalido'), false);
});
test('rotas administrativas rejeitam ausência de sessão e o antigo token compartilhado', async t => {
 const request = await serve(t, { execute: () => { throw new Error('Não deve consultar banco'); } });
 for (const url of ['/api/admin/orders', '/api/admin/catalog', '/api/admin/subscription']) {
  const response = await request(url, { headers: { Authorization: 'Bearer bebella-admin-2026' } });
  assert.equal(response.status, 401);
 }
});
test('listagem deriva empresa da sessão e ignora company_id informado pelo cliente', async t => {
 const request = await serve(t, authenticated(async (sql, args) => {
  assert.match(sql, /WHERE company_id = \?/);
  assert.deepEqual(args, [7]); return [[]];
 }));
 const response = await request('/api/admin/orders?company_id=999', { headers: { Cookie: cookie } });
 assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
});
test('alterar pedido de outra empresa retorna 404 e sempre filtra por empresa', async t => {
 const request = await serve(t, authenticated(async (sql, args) => {
  if (sql.startsWith('UPDATE orders')) { assert.match(sql, /company_id = \?/); assert.equal(args[2], 7); return [{ affectedRows: 0 }]; }
  assert.match(sql, /id = \? AND company_id = \?/); assert.deepEqual(args, [99, 7]); return [[]];
 }));
 const response = await request('/api/admin/orders/99/status', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'preparing', company_id: 999 }) });
 assert.equal(response.status, 404);
});
test('transição incompatível retorna conflito', async t => {
 const request = await serve(t, authenticated(async sql => sql.startsWith('UPDATE') ? [{ affectedRows: 0 }] : [[{ id: 10 }]]));
 const response = await request('/api/admin/orders/10/status', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
 assert.equal(response.status, 409);
});
test('operador não pode cadastrar produtos', async t => {
 const request = await serve(t, authenticated(() => { throw new Error('Não deve escrever'); }, { ...user, role: 'operator' }));
 assert.equal((await request('/api/admin/products', { method: 'POST', headers: { Cookie: cookie } })).status, 403);
});
test('produto só pode ser criado em categoria do próprio restaurante', async t => {
 const request = await serve(t, authenticated(async (sql, args) => { assert.match(sql, /company_id = \?/); assert.deepEqual(args, [999, 7]); return [[]]; }));
 const response = await request('/api/admin/products', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pizza', category_id: 999, price: '20.00' }) });
 assert.equal(response.status, 400);
});
test('escrita originada de outro site é bloqueada', async t => {
 const request = await serve(t, {});
 assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://outro-site.example' } })).status, 403);
});
const payload = { company_id: 7, customer: { name: 'Ana', phone: '11999999999', street: 'Rua A', number: '10', neighborhood: 'Centro' }, items: [{ id: 1, quantity: 2, price: 0.01 }], payment_method: 'Pix', total_amount: 0.02 };
function orderDb({ products = [{ id: 1, name: 'Produto', price: '12.35' }], failItems = false, operations, couponRow = null, phoneUsage = 0, previousOrders = [] } = {}) {
 const state = { committed: false, rolledBack: false, released: false, orderArgs: null, itemArgs: null, itemWrites: [], requestHash: null, orderWrites: 0, couponWrites: 0, trackingToken:null };
 const conn = {
  beginTransaction: async () => {}, commit: async () => { state.committed = true; }, rollback: async () => { state.rolledBack = true; }, release: () => { state.released = true; },
  execute: async (sql, args) => {
   if(sql.startsWith('SELECT token FROM order_tracking'))return [state.trackingToken?[{token:state.trackingToken}]:[]];
   if(sql.startsWith('INSERT INTO order_tracking')){state.trackingToken=args[1];return [{affectedRows:1}];}
   if (sql.startsWith('SELECT id FROM companies')) return [[{ id: 7 }]];
   if (sql.startsWith('SELECT config FROM company_operations')) return [operations ? [{ config: operations }] : []];
   if (sql.startsWith('INSERT INTO checkout_requests')) {
    if (state.orderWrites && !state.rolledBack) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
    state.requestHash = args[2]; return [{}];
   }
   if (sql.startsWith('SELECT request_hash')) return [[{ request_hash: state.requestHash, order_id: 22 }]];
   if (sql.startsWith('SELECT id, total_amount,')) return [[{ id: 22, total_amount: state.orderArgs[2], fulfillment_method: state.orderArgs[9], delivery_fee: state.orderArgs[10], discount_amount: state.orderArgs[13], coupon_code: state.orderArgs[14] }]];
   if (sql.startsWith('UPDATE checkout_requests')) return [{ affectedRows: 1 }];
   if (sql.startsWith('SELECT id, code, config')) return [couponRow && couponRow.code === args[1] ? [couponRow] : []];
   if (sql.startsWith('SELECT COUNT(*) AS total FROM orders')) return [[{ total: phoneUsage }]];
   if (sql.startsWith('SELECT id FROM orders')) return [previousOrders];
   if (sql.startsWith('UPDATE company_coupons')) { state.couponWrites++; return [{ affectedRows: 1 }]; }
   if (sql.startsWith('SELECT p.id')) { assert.equal(args[0], 7); return [products]; }
   if (sql.startsWith('INSERT INTO customers')) return [{ insertId: 11 }];
   if (sql.startsWith('SELECT id FROM customers')) return [[{ id: 11 }]];
   if (sql.startsWith('INSERT INTO orders')) { state.orderWrites++; state.orderArgs = args; return [{ insertId: 22 }]; }
   if (sql.startsWith('INSERT INTO order_items')) { if (failItems) throw Object.assign(new Error('Segredo do banco'), { code: 'ER_TEST' }); state.itemArgs = args; state.itemWrites.push(args); return [{}]; }
   throw new Error(sql);
  }
 };
 return { db: { getConnection: async () => conn }, state };
}
test('checkout calcula valores pelo banco e preserva produto e endereço', async t => {
 const { db, state } = orderDb(); const request = await serve(t, db);
 const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
 assert.equal(response.status, 201);
 assert.equal((await response.json()).total_amount, 24.7);
 assert.equal(state.orderArgs[2], '24.70'); assert.deepEqual(state.orderArgs.slice(4), ['Ana', '11999999999', 'Rua A', '10', 'Centro', 'delivery', '0.00', '', 60, '0.00', '', null, '5511999999999']);
 assert.deepEqual(state.itemArgs, [22, 1, 'Produto', 2, '12.35', '24.70', '[]', '']);
 assert.equal(state.committed, true); assert.equal(state.released, true);
});
test('produto indisponível desfaz transação sem criar pedido', async t => {
 const { db, state } = orderDb({ products: [] }); const request = await serve(t, db);
 assert.equal((await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 400);
 assert.equal(state.rolledBack, true); assert.equal(state.committed, false); assert.equal(state.orderArgs, null); assert.equal(state.released, true);
});
test('falha ao gravar itens desfaz pedido e não expõe detalhes SQL', async t => {
 const { db, state } = orderDb({ failItems: true }); const request = await serve(t, db);
 const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
 assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /Segredo|ER_TEST/);
 assert.equal(state.rolledBack, true); assert.equal(state.committed, false); assert.equal(state.released, true);
});
test('quantidades negativas e inválidas são rejeitadas antes do banco', async t => {
 const request = await serve(t, {});
 for (const quantity of [0, -1, 1.5, '2', 100]) {
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, items: [{ id: 1, quantity }] }) });
  assert.equal(response.status, 400);
 }
});
test('cadastro cria loja, proprietário e teste em uma transação', async t => {
 const calls = []; let committed = false; let released = false;
 const conn = {
  beginTransaction: async () => calls.push('begin'), commit: async () => { committed = true; }, rollback: async () => { throw new Error('Não deveria reverter'); }, release: () => { released = true; },
  execute: async (sql, args) => {
   calls.push(sql);
   if (sql.startsWith('INSERT INTO companies')) { assert.deepEqual(args, ['Restaurante Teste', 'restaurante-teste']); return [{ insertId: 40 }]; }
   if (sql.startsWith('INSERT INTO users')) { assert.equal(args[0], 40); assert.equal(args[2], 'ana@example.com'); assert.match(args[3], /^scrypt:/); return [{ insertId: 50 }]; }
   if (sql.startsWith('INSERT INTO subscriptions')) { assert.deepEqual(args, [40]); return [{}]; }
   throw new Error(sql);
  }
 };
 const request = await serve(t, { getConnection: async () => conn, execute: async (sql, args) => { assert.equal(committed, true); assert.match(sql, /INSERT INTO sessions/); assert.equal(args[1], 50); assert.match(args[0], /^[a-f0-9]{64}$/); return [{}]; } });
 const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', company_name: 'Restaurante Teste', slug: 'restaurante-teste', email: 'ANA@example.com', password: 'uma-senha-segura-123' }) });
 assert.equal(response.status, 201); assert.equal(committed, true); assert.equal(released, true);
 assert.match(String(response.headers['set-cookie']), /HttpOnly/); assert.match(String(response.headers['set-cookie']), /SameSite=Lax/);
});
test('e-mail ou slug duplicado reverte cadastro', async t => {
 let rolledBack = false; let released = false;
 const request = await serve(t, { getConnection: async () => ({ beginTransaction: async () => {}, execute: async () => { throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' }); }, rollback: async () => { rolledBack = true; }, release: () => { released = true; } }) });
 const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', company_name: 'Restaurante', slug: 'restaurante', email: 'ana@example.com', password: 'uma-senha-segura-123' }) });
 assert.equal(response.status, 409); assert.equal(rolledBack, true); assert.equal(released, true);
});
test('logout invalida sessão no servidor e remove cookie', async t => {
 let deleted = false;
 const request = await serve(t, { execute: async (sql, args) => { assert.match(sql, /DELETE FROM sessions/); assert.equal(args[0], tokenHash('a'.repeat(64))); deleted = true; return [{}]; } });
 const response = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
 assert.equal(response.status, 200); assert.equal(deleted, true); assert.match(String(response.headers['set-cookie']), /Expires=Thu, 01 Jan 1970/);
});
test('sessão inexistente ou expirada não autoriza acesso', async t => {
 const request = await serve(t, { execute: async sql => { assert.match(sql, /s.expires_at > NOW\(\)/); assert.match(sql, /u.active = 1 AND c.active = 1/); return [[]]; } });
 assert.equal((await request('/api/auth/me', { headers: { Cookie: cookie } })).status, 401);
});
test('login válido cria sessão; senha incorreta não cria sessão', async t => {
 const passwordHash = await hashPassword('senha-segura-1234'); let sessions = 0;
 const execute=async sql=>{
  if (sql.startsWith('SELECT u.id')) return [[{ id: 3, password_hash: passwordHash }]];
  assert.match(sql, /INSERT INTO sessions/); sessions++; return [{}];
 };
 const request=await serve(t,{execute,getConnection:async()=>({execute,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})});
 const login = password => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com', password }) });
 assert.equal((await login('incorreta')).status, 401); assert.equal(sessions, 0);
 const response = await login('senha-segura-1234'); assert.equal(response.status, 200); assert.equal(sessions, 1);
 assert.match(String(response.headers['set-cookie']), /HttpOnly/);
});
test('cadastro inválido não acessa banco', async t => {
 const request = await serve(t, {});
 const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', company_name: 'Restaurante', slug: '../outra-loja', email: 'ana@example.com', password: 'curta' }) });
 assert.equal(response.status, 400);
});
test('reenviar checkout com mesma chave devolve o mesmo pedido sem nova gravação', async t => {
 const { db, state } = orderDb(); const request = await serve(t, db);
 const send = () => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
 const first = await send(); const second = await send();
 assert.equal(first.status, 201); assert.equal(second.status, 200);
 const replay = await second.json(); assert.equal(replay.replayed, true); assert.equal(replay.order_id, 22); assert.equal(replay.total_amount, 24.7);
 assert.equal(state.orderWrites, 1);
});
test('chave de checkout não pode ser reutilizada com endereço diferente', async t => {
 const { db, state } = orderDb(); const request = await serve(t, db);
 const send = body => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 assert.equal((await send(payload)).status, 201);
 const response = await send({ ...payload, customer: { ...payload.customer, number: '20' } });
 assert.equal(response.status, 409); assert.equal(state.orderWrites, 1);
});
test('checkout exige identificador de envio válido', async t => {
 const request = await serve(t, {});
 for (const key of ['', 'curto', 'x'.repeat(81), 'inválido-id-00000000']) {
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  assert.equal(response.status, 400);
 }
});
test('edição de produto só altera produto e categoria da empresa autenticada', async t => {
 let argsUsed;
 const request = await serve(t, authenticated(async (sql, args) => { assert.match(sql, /c.company_id = p.company_id/); assert.match(sql, /p.company_id = \?/); argsUsed = args; return [{ affectedRows: 0 }]; }));
 const response = await request('/api/admin/products/999', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: 100, name: 'Pizza', description: '', price: '15.00', company_id: 999 }) });
 assert.equal(response.status, 404); assert.deepEqual(argsUsed, [100, 'Pizza', '', 100, '15.00', 999, 7]);
});
test('edição de categoria valida ordenação e filtra por empresa', async t => {
 let writes = 0;
 const request = await serve(t, authenticated(async (sql, args) => { writes++; assert.match(sql, /WHERE id = \? AND company_id = \?/); assert.deepEqual(args, ['Lanches', 2, false, 8, 7]); return [{ affectedRows: 1 }]; }));
 const send = sort_order => request('/api/admin/categories/8', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lanches', sort_order, active: false }) });
 assert.equal((await send(-1)).status, 400); assert.equal(writes, 0);
 assert.equal((await send(2)).status, 200); assert.equal(writes, 1);
});
test('hash de checkout ignora ordem dos produtos e preços enviados pelo cliente', () => {
 const { checkoutHash } = require('../src/checkout');
 const a = checkoutHash(7, payload.customer, 'Pix', new Map([[1, 2], [3, 1]]));
 const b = checkoutHash(7, payload.customer, 'Pix', new Map([[3, 1], [1, 2]]));
 assert.equal(a, b);
 assert.notEqual(a, checkoutHash(8, payload.customer, 'Pix', new Map([[1, 2], [3, 1]])));
});

test('checkout soma taxa do bairro ao total e salva o frete como histórico', async t => {
 const { defaults } = require('../src/operations');
 const operations = { ...defaults(), zones_enabled: true, zones: [{ name: 'Centro', fee: '4.50' }] };
 const { db, state } = orderDb({ operations }); const request = await serve(t, db);
 const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, delivery_fee: '4.50', total_amount: 0.01 }) });
 assert.equal(response.status, 201); const order = await response.json();
 assert.equal(order.total_amount, 29.2); assert.equal(order.delivery_fee, 4.5);
 assert.equal(state.orderArgs[10], '4.50'); assert.equal(state.orderArgs[2], '29.20');
});
test('fora da área, frete adulterado, modalidade desativada e loja pausada não geram pedidos', async t => {
 const { defaults } = require('../src/operations');
 const base = { ...defaults(), zones_enabled: true, zones: [{ name: 'Centro', fee: '4.50' }] };
 for (const [operations, body, expected] of [
  [base, { ...payload, customer: { ...payload.customer, neighborhood: 'Fora da área' }, delivery_fee: '4.50' }, 400],
  [base, { ...payload, delivery_fee: '0.01' }, 409],
  [base, payload, 409],
  [base, { ...payload, fulfillment_method: 'pickup' }, 400],
  [{ ...base, mode: 'paused' }, { ...payload, delivery_fee: '4.50' }, 409]
 ]) {
  const { db, state } = orderDb({ operations }); const request = await serve(t, db);
  assert.equal((await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, expected);
  assert.equal(state.orderWrites, 0); assert.equal(state.rolledBack, true); assert.equal(state.released, true);
 }
});
test('retirada exige apenas nome e telefone, salva endereço da loja e não cobra frete', async t => {
 const { defaults } = require('../src/operations');
 const operations = { ...defaults(), pickup_enabled: true, pickup_address: 'Rua da Loja, 10', pickup_minutes: 25 };
 const { db, state } = orderDb({ operations }); const request = await serve(t, db);
 const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, fulfillment_method: 'pickup', customer: { name: 'Ana', phone: '11999999999' } }) });
 assert.equal(response.status, 201); assert.equal((await response.json()).delivery_fee, 0);
 assert.deepEqual(state.orderArgs.slice(4), ['Ana', '11999999999', '', '', '', 'pickup', '0.00', 'Rua da Loja, 10', 25, '0.00', '', null, '5511999999999']);
});
test('reenvio após pausa preserva pedido, frete e modalidade originais', async t => {
 const { defaults } = require('../src/operations'); const operations = { ...defaults() };
 const { db, state } = orderDb({ operations }); const request = await serve(t, db);
 const send = () => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
 assert.equal((await send()).status, 201); operations.mode = 'paused';
 const response = await send(); assert.equal(response.status, 200);
 const result = await response.json(); assert.equal(result.replayed, true); assert.equal(result.fulfillment_method, 'delivery'); assert.equal(result.delivery_fee, 0); assert.equal(state.orderWrites, 1);
});
test('operação é lida e salva somente para a empresa autenticada e operador não pode alterar', async t => {
 const { defaults } = require('../src/operations'); const writes = [];
 const config = defaults();
 const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute: async (sql, args) => { writes.push({ sql, args }); return [{}]; } };
 const db = authenticated(async (sql, args) => { assert.match(sql, /company_operations WHERE company_id = \?/); assert.deepEqual(args, [7]); return [[]]; }); db.getConnection = async () => conn;
 const request = await serve(t, db);
 assert.equal((await request('/api/admin/operations?company_id=999', { headers: { Cookie: cookie } })).status, 200);
 const response = await request('/api/admin/operations', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, company_id: 999 }) });
 assert.equal(response.status, 200); assert.deepEqual(writes[0].args, [7]); assert.match(writes[0].sql, /FOR UPDATE/); assert.equal(writes[1].args[0], 7);
 const operator = await serve(t, authenticated(() => { throw new Error('Não deve escrever'); }, { ...user, role: 'operator' }));
 assert.equal((await operator('/api/admin/operations', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(config) })).status, 403);
 assert.equal((await request('/api/admin/operations', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, mode: 'schedule' }) })).status, 400);
 assert.equal(writes.length, 2);
});
test('retirada não pode receber transição saiu para entrega', async t => {
 const request = await serve(t, authenticated(async (sql, args) => {
  if (sql.startsWith('UPDATE')) { assert.match(sql, /fulfillment_method = 'delivery'/); assert.equal(args[2], 7); return [{ affectedRows: 0 }]; }
  return [[{ id: 10 }]];
 }));
 assert.equal((await request('/api/admin/orders/10/status', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'delivering' }) })).status, 409);
});

test('checkout grava variações separadas e calcula adicionais por unidade sem confiar no preço enviado', async t => {
 const groups = require('./fixtures/addons.json');
 const { db, state } = orderDb({ products: [{ id: 1, name: 'Lanche', price: '12.35', addon_config: groups, addon_version: 2 }] });
 const request = await serve(t, db);
 const body = { ...payload, items: [{ product_id: 1, quantity: 2, option_ids: ['cheese', 'ketchup'], addon_version: 2, price: 0.01 }, { product_id: 1, quantity: 1, option_ids: ['mayo'], addon_version: 2 }] };
 const send = value => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
 const response = await send(body);
 assert.equal(response.status, 201); assert.equal((await response.json()).total_amount, 42.55);
 assert.equal(state.itemWrites.length, 2);
 const cheese = state.itemWrites.find(args => JSON.parse(args[6]).some(option => option.option_id === 'cheese'));
 assert.equal(cheese[3], 2); assert.equal(cheese[4], '14.85'); assert.equal(cheese[5], '29.70');
 const replay = await send({ ...body, items: [...body.items].reverse() }); assert.equal(replay.status, 200); assert.equal(state.itemWrites.length, 2);
 const changed = await send({ ...body, items: [{ product_id: 1, quantity: 3, option_ids: ['ketchup'], addon_version: 2 }] }); assert.equal(changed.status, 409);
});
test('checkout não grava pedido com adicionais obrigatórios ausentes, inválidos ou desatualizados', async t => {
 const groups = require('./fixtures/addons.json');
 for (const selection of [{ option_ids: [], addon_version: 2 }, { option_ids: ['ketchup', 'chili'], addon_version: 2 }, { option_ids: ['ketchup', 'foreign'], addon_version: 2 }, { option_ids: ['ketchup'], addon_version: 1 }]) {
  const { db, state } = orderDb({ products: [{ id: 1, name: 'Lanche', price: '12.35', addon_config: groups, addon_version: 2 }] });
  const request = await serve(t, db);
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, items: [{ product_id: 1, quantity: 1, ...selection }] }) });
  assert.equal(response.status, 400); assert.equal(state.orderWrites, 0); assert.equal(state.rolledBack, true);
 }
});

test('checkout só notifica após commit; reenvios e transações desfeitas não notificam', async t => {
 for (const failItems of [false, true]) {
  const { db, state } = orderDb({ failItems }); const notifications = [];
  const events = { stream: () => () => {}, publish: company => { assert.equal(state.committed, true); notifications.push(company); } };
  const request = await serve(t, db, { orderEvents: events });
  const send = () => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await send()).status, failItems ? 500 : 201);
  if (!failItems) { assert.equal((await send()).status, 200); assert.deepEqual(notifications, [7]); }
  else assert.deepEqual(notifications, []);
 }
});

test('checkout calcula cupom, salva histórico, conta uma vez e reenvia mesmo após pausa do cupom', async t => {
 const config = { active: true, first_purchase: false, kind: 'fixed', value: '5.00', min_subtotal: '0.00', max_discount: null, total_limit: 1, per_customer_limit: 1, starts_at: null, ends_at: null };
 const couponRow = { id: 3, code: 'TESTE', config, version: 1, usage_count: 0 };
 const { db, state } = orderDb({ couponRow }); const request = await serve(t, db);
 const body = { ...payload, coupon_code: 'teste', coupon_discount: '5.00', coupon_subtotal: '24.70' };
 const send = value => request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
 const first = await send(body); assert.equal(first.status, 201); assert.equal((await first.json()).total_amount, 19.7);
 assert.equal(state.orderArgs[13], '5.00'); assert.equal(state.orderArgs[14], 'TESTE'); assert.equal(JSON.parse(state.orderArgs[15]).kind, 'fixed'); assert.equal(state.couponWrites, 1);
 config.active = false; const replay = await send(body); assert.equal(replay.status, 200); assert.equal((await replay.json()).discount_amount, 5); assert.equal(state.couponWrites, 1);
 assert.equal((await send({ ...body, coupon_discount: '6.00' })).status, 409);
});
test('cupom inválido, limite atingido ou desconto adulterado desfazem o checkout sem consumir uso', async t => {
 const config = { active: true, first_purchase: false, kind: 'fixed', value: '5.00', min_subtotal: '0.00', max_discount: null, total_limit: 1, per_customer_limit: null, starts_at: null, ends_at: null };
 for (const [row, discount, subtotal, expected] of [[null,'5.00','24.70',400], [{ id:3, code:'TESTE', config, version:1, usage_count:1 },'5.00','24.70',400], [{ id:3, code:'TESTE', config, version:1, usage_count:0 },'6.00','24.70',409], [{ id:3, code:'TESTE', config, version:1, usage_count:0 },'5.00','23.00',409]]) {
  const { db, state } = orderDb({ couponRow: row }); const request = await serve(t, db);
  const response = await request('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...payload, coupon_code:'TESTE', coupon_discount:discount, coupon_subtotal:subtotal }) });
  assert.equal(response.status, expected); assert.equal(state.rolledBack, true); assert.equal(state.orderWrites, 0); assert.equal(state.couponWrites, 0);
 }
});

test('prévia calcula desconto sem reservar uso ou criar pedido', async t => {
 const config = { active:true, first_purchase:false, kind:'fixed', value:'5.00', min_subtotal:'0.00', max_discount:null, total_limit:1, per_customer_limit:null, starts_at:null, ends_at:null };
 const { db, state } = orderDb({ couponRow: { id:3, code:'TESTE', config, version:1, usage_count:0 } }); const request = await serve(t, db);
 const response = await request('/api/coupons/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company_id:7, coupon_code:'teste', phone:payload.customer.phone, items:payload.items, fulfillment_method:'delivery', neighborhood:'Centro' }) });
 assert.equal(response.status, 200); const quote = await response.json(); assert.equal(quote.total_amount, '19.70'); assert.equal(quote.subtotal_amount, '24.70'); assert.equal(state.couponWrites, 0); assert.equal(state.orderWrites, 0);
});
test('checkout devolve o mesmo acompanhamento privado após reenvio idempotente',async t=>{
 const {db,state}=orderDb(),request=await serve(t,db);const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)};
 const first=await(await request('/api/orders',options)).json(),again=await(await request('/api/orders',options)).json();assert.match(first.tracking_url,/^\/track.html#[a-f0-9]{64}$/);assert.equal(first.tracking_url,again.tracking_url);assert.equal(state.orderWrites,1);assert.equal(again.replayed,true);
});

test('checkout grava observação por linha e recusa reutilizar chave com outro preparo', async t => {
 const { db, state } = orderDb();
 const request = await serve(t, db);
 const body = { ...payload, items: [{ id: 1, quantity: 1, notes: 'Sem milho' }, { id: 1, quantity: 1, notes: 'Com milho' }] };
 const options = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'item-notes-regression-123' }, body: JSON.stringify(data) });
 assert.equal((await request('/api/orders', options(body))).status, 201);
 assert.equal(state.itemWrites.length, 2);
 assert.deepEqual(state.itemWrites.map(args => args[7]).sort(), ['Com milho', 'Sem milho']);
 assert.equal((await request('/api/orders', options(body))).status, 200);
 assert.equal(state.itemWrites.length, 2);
 assert.equal((await request('/api/orders', options({ ...body, items: [{ id: 1, quantity: 2, notes: 'Sem milho' }] }))).status, 409);
});

test('checkout calcula adicionais repetidos no servidor e protege reenvio com outra quantidade', async t => {
 const groups=[{id:'extras',name:'Extras',min:0,max:3,options:[{id:'cheese',name:'Queijo',price:'2.50',active:true,max_quantity:3}]}];
 const {db,state}=orderDb({products:[{id:1,name:'Lanche',price:'12.35',addon_version:1,addon_config:groups}]});
 const request=await serve(t,db);
 const body={...payload,items:[{id:1,quantity:2,addon_version:1,option_quantities:{cheese:2},price:0.01}]};
 const options=data=>({method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'repeated-addons-checkout-1'},body:JSON.stringify(data)});
 const created=await request('/api/orders',options(body));assert.equal(created.status,201);assert.equal((await created.json()).total_amount,34.7);
 assert.equal(state.itemArgs[4],'17.35');assert.equal(JSON.parse(state.itemArgs[6])[0].quantity,2);
 assert.equal((await request('/api/orders',options(body))).status,200);assert.equal(state.orderWrites,1);
 assert.equal((await request('/api/orders',options({...body,items:[{...body.items[0],option_quantities:{cheese:1}}]}))).status,409);
});
