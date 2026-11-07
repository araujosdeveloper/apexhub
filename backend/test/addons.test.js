const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateGroups, normalizeLines, priceLine, publicProduct } = require('../src/addons');
const { checkoutHash } = require('../src/checkout');
const { serve } = require('../test-support/http');
const groups = require('./fixtures/addons.json');
const product = { id: 1, name: 'Lanche', price: '12.35', addon_version: 2, addon_config: groups };
const item = (options, quantity = 1) => ({ product_id: 1, quantity, option_ids: options, addon_version: 2 });

test('adicionais cobram por unidade e preservam nomes e preços no histórico', () => {
 const { lines } = normalizeLines([item(['cheese', 'ketchup'], 2)]);
 const configured = structuredClone(product);
 const priced = priceLine(configured, lines[0]);
 assert.equal(priced.unitCents, 1485); assert.equal(priced.quantity, 2);
 assert.deepEqual(priced.snapshot.map(option => [option.group_name, option.name, option.price]), [['Escolha o molho', 'Ketchup', '0.00'], ['Extras', 'Queijo', '2.50']]);
 const snapshot = JSON.stringify(priced.snapshot); configured.addon_config[1].options[0].name = 'Outro';
 assert.equal(JSON.stringify(priced.snapshot), snapshot);
});
test('variações diferentes permanecem separadas; seleções equivalentes são agrupadas', () => {
 const normalized = normalizeLines([item(['cheese', 'ketchup']), item(['ketchup', 'cheese'], 2), item(['mayo'])]);
 assert.equal(normalized.lines.length, 2); assert.equal(normalized.quantities.get(1), 4);
 assert.equal(normalized.lines.find(line => line.option_ids.includes('cheese')).quantity, 3);
 assert.throws(() => normalizeLines([item(['mayo'], 50), item(['ketchup'], 50)]), /99 unidades/);
});
test('opções duplicadas, identificadores inválidos e versões inválidas são rejeitados', () => {
 for (const change of [{ option_ids: ['ketchup', 'ketchup'] }, { option_ids: ['<script>'] }, { option_ids: 'ketchup' }, { addon_version: -1 }, { addon_version: '2' }]) {
  assert.throws(() => normalizeLines([{ ...item(['ketchup']), ...change }]), /inválida/);
 }
});
test('checkout rejeita grupo obrigatório vazio, excesso, opção pausada, removida ou de outro produto', () => {
 for (const options of [[], ['ketchup', 'mayo'], ['ketchup', 'chili'], ['ketchup', 'foreign-option']]) {
  assert.throws(() => priceLine(product, normalizeLines([item(options)]).lines[0]));
 }
 assert.throws(() => priceLine(product, { ...normalizeLines([item(['ketchup'])]).lines[0], addon_version: 1 }), /mudaram/);
 assert.throws(() => priceLine(product, { ...normalizeLines([item(['ketchup'])]).lines[0], addon_version: 0 }), /mudaram/);
});
test('cadastro rejeita grupos impossíveis, preços negativos e identificadores repetidos', () => {
 for (const mutate of [
  copy => { copy[0].min = 2; }, copy => { copy[0].max = 3; },
  copy => { copy[0].options.forEach(option => { option.active = false; }); },
  copy => { copy[1].options[0].id = 'ketchup'; }, copy => { copy[1].options[0].price = '-1.00'; },
  copy => { copy[0].id = "bad'id"; }, copy => { copy[0].options = []; }
 ]) { const copy = structuredClone(groups); mutate(copy); assert.throws(() => validateGroups(copy)); }
 assert.deepEqual(validateGroups([]), []);
});
test('cardápio público omite opções pausadas e configuração interna', () => {
 const result = publicProduct(product);
 assert.equal(result.addon_config, undefined); assert.equal(result.addon_version, 2);
 assert.equal(result.addon_groups.flatMap(group => group.options).some(option => option.id === 'chili'), false);
});
test('hash identifica variações e versões; pedidos antigos sem adicionais mantêm o hash', () => {
 const customer = { name: 'Ana', phone: '11', street: 'Rua', number: '10', neighborhood: 'Centro' };
 const hash = items => { const { lines, quantities } = normalizeLines(items); return checkoutHash(7, customer, 'Pix', quantities, 'delivery', undefined, lines); };
 assert.equal(hash([item(['cheese', 'ketchup']), item(['mayo'])]), hash([item(['mayo']), item(['ketchup', 'cheese'])]));
 assert.notEqual(hash([item(['ketchup'])]), hash([item(['mayo'])]));
 assert.notEqual(hash([item(['ketchup'])]), hash([{ ...item(['ketchup']), addon_version: 3 }]));
 assert.equal(hash([{ product_id: 1, quantity: 2 }]), checkoutHash(7, customer, 'Pix', new Map([[1, 2]])));
});
function dbFor(role = 'owner', found = true, revision = 0) {
 const state = { writes: [], committed: false, rollback: false, released: false };
 const db = { execute: async (sql, args) => {
  if (sql.includes('FROM sessions s')) return [[{ id: 3, company_id: 7, role }]];
  assert.match(sql, /p\.id = \? AND p\.company_id = \?/); assert.deepEqual(args, [1, 7]);
  return [found ? [product] : []];
 }, getConnection: async () => ({
  beginTransaction: async () => {}, commit: async () => { state.committed = true; }, rollback: async () => { state.rollback = true; }, release: () => { state.released = true; },
  execute: async (sql, args) => {
   if (sql.startsWith('SELECT id FROM products')) { assert.match(sql, /company_id = \? FOR UPDATE/); assert.deepEqual(args, [1, 7]); return [found ? [{ id: 1 }] : []]; }
   if (sql.startsWith('SELECT version')) return [revision ? [{ version: revision }] : []];
   state.writes.push(args); return [{}];
  }
 }) };
 return { db, state };
}
const headers = { Cookie: 'delivery_session=' + 'a'.repeat(64), 'Content-Type': 'application/json' };
test('cadastro de adicionais deriva empresa da sessão e salva em transação', async t => {
 const { db, state } = dbFor(); const request = await serve(t, db);
 assert.equal((await request('/api/admin/products/1/addons?company_id=999', { headers })).status, 200);
 const response = await request('/api/admin/products/1/addons', { method: 'PUT', headers, body: JSON.stringify({ version: 0, groups, company_id: 999 }) });
 assert.equal(response.status, 200); assert.equal((await response.json()).version, 1);
 assert.equal(state.writes[0][0], 1); assert.equal(state.writes[0][2], 1); assert.equal(state.committed, true); assert.equal(state.released, true);
});
test('operador, produto de outra loja e edição desatualizada não alteram adicionais', async t => {
 for (const [role, found, revision, expected] of [['operator', true, 0, 403], ['owner', false, 0, 404], ['owner', true, 1, 409]]) {
  const { db, state } = dbFor(role, found, revision); const request = await serve(t, db);
  const response = await request('/api/admin/products/1/addons', { method: 'PUT', headers, body: JSON.stringify({ version: 0, groups }) });
  assert.equal(response.status, expected); assert.equal(state.writes.length, 0); assert.equal(state.committed, false);
  if (role !== 'operator') { assert.equal(state.rollback, true); assert.equal(state.released, true); }
 }
});

test('observações separam preparos e conservam o contrato de itens antigos', () => {
 const { lines, quantities } = normalizeLines([
  { product_id: 1, quantity: 1, notes: ' Sem milho ' },
  { product_id: 1, quantity: 1, notes: 'Com milho' },
  { product_id: 1, quantity: 2, notes: 'Sem milho' }
 ]);
 assert.equal(lines.length, 2);
 assert.equal(quantities.get(1), 4);
 assert.equal(lines.find(line => line.notes === 'Sem milho').quantity, 3);
 assert.deepEqual(normalizeLines([{ product_id: 1, quantity: 1 }]).lines,
  [{ product_id: 1, option_ids: [], addon_version: 0, quantity: 1 }]);
 for (const notes of [null, 12, {}, 'x'.repeat(501), 'sem\u0000milho']) {
  assert.throws(() => normalizeLines([{ product_id: 1, quantity: 1, notes }]), /Observação/);
 }
});
test('hash preserva reenvio antigo e detecta alteração da observação', () => {
 const customer = { name: 'Ana', phone: '11999999999', street: 'Rua', number: '1', neighborhood: 'Centro' };
 const hash = items => { const normalized = normalizeLines(items); return checkoutHash(1, customer, 'Pix', normalized.quantities, 'delivery', undefined, normalized.lines); };
 assert.equal(hash([{ product_id: 1, quantity: 1 }]), hash([{ product_id: 1, quantity: 1, notes: ' ' }]));
 assert.notEqual(hash([{ product_id: 1, quantity: 1, notes: 'Sem milho' }]), hash([{ product_id: 1, quantity: 1, notes: 'Com milho' }]));
 assert.notEqual(hash([{ product_id: 1, quantity: 1, notes: 'Sem milho' }, { product_id: 1, quantity: 1 }]), hash([{ product_id: 1, quantity: 2, notes: 'Sem milho' }]));
});
