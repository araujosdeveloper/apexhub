const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/orders.js'), 'utf8');
const makeOrder = (id = 12, status = 'pending', method = 'delivery') => ({ id, status, fulfillment_method: method, customer_name: 'Ana', customer_phone: '11999999999', address_street: 'Rua A', address_number: '10', address_neighborhood: 'Centro', fulfillment_address: 'Rua da Loja', estimated_minutes: 30,
  created_at: new Date(Date.now() - 60000).toISOString(), total_amount: '15.00', payment_method: 'Dinheiro', delivery_fee: '0.00', items: [{ product_name: 'Lanche', quantity: 1, total_price: '15.00', addons_snapshot: [{ group_name: 'Extras', name: 'Queijo', price: '2.50' }] }] });
async function page({ kitchen = false, orders = [makeOrder()], user = { company_id: 7, company_name: 'Loja A', slug: 'loja-a', role: 'owner' } } = {}) {
  const nodes = new Map(), calls = [], sources = [], timers = new Map(), windowEvents = new Map();
  let sequence = 0, failBoard = false, patchCode = 200, gate = null, prints = 0, redirected = null, beeps = 0;
  let currentOrders = structuredClone(orders), companyId = 7;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'status-filter' ? 'active' : id === 'fulfillment-filter' ? 'all' : '', hidden: ['error','feedback','new-orders'].includes(id), textContent: '', innerHTML: '', className: '', listeners: {}, disabled: false,
      addEventListener(type, callback) { this.listeners[type] = callback; }, setAttribute(key, value) { this[key] = value; }, replaceChildren() { this.innerHTML = ''; } });
    return nodes.get(id);
  };
  const fakeAudio = { currentTime: 0, destination: {}, resume: async () => {}, createOscillator: () => ({ frequency: {}, connect() {}, start() { beeps++; }, stop() {} }), createGain: () => ({ gain: {}, connect() {} }) };
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  class Source {
    constructor(url) { this.url = url; this.listeners = {}; sources.push(this); }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    close() { this.closed = true; }
  }
  const context = vm.createContext({ URLSearchParams, Date, console, EventSource: Source, confirm: () => true,
    document: { body: { dataset: { view: kitchen ? 'kitchen' : 'manager' } }, hidden: false, getElementById: node, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: { AudioContext: function () { return fakeAudio; }, print: () => { prints++; }, addEventListener: (type, handler) => windowEvents.set(type, handler) },
    location: { replace: path => { redirected = path; } },
    setInterval: callback => { timers.set(++sequence, callback); return sequence; }, clearInterval: id => timers.delete(id),
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/auth/me') return response({ user });
      if (url === '/api/admin/subscription') return response({ subscription: { status: 'legacy' } });
      if (url.startsWith('/api/admin/orders/board?')) {
        if (failBoard) throw new Error('Sem conexão');
        const query = new URLSearchParams(url.split('?')[1]), statuses = query.get('scope') === 'kitchen' ? ['pending','preparing','ready'] : query.get('scope') === 'history' ? ['completed','cancelled'] : ['pending','preparing','ready','delivering'];
        const filtered = currentOrders.filter(order => statuses.includes(order.status) && (query.get('status') === 'all' || order.status === query.get('status')) && (query.get('fulfillment') === 'all' || order.fulfillment_method === query.get('fulfillment')));
        const counts = Object.fromEntries(['pending','preparing','ready','delivering','completed','cancelled'].map(status => [status, currentOrders.filter(order => order.status === status).length]));
        const offset = Number(query.get('offset')), limit = Number(query.get('limit'));
        const payload = structuredClone({ company_id: companyId, orders: filtered.slice(offset, offset + limit), counts, total: filtered.length, limit, offset, server_time: new Date().toISOString(), latest_pending_id: Math.max(0, ...currentOrders.filter(order => order.status === 'pending').map(order => order.id)) });
        if (gate) { const pending = gate; gate = null; await pending.promise; }
        return response(payload);
      }
      if (options.method === 'PATCH') {
        if (patchCode !== 200) return response({ error: 'Outro operador já alterou o pedido.' }, patchCode);
        const id = Number(url.split('/')[4]); const order = currentOrders.find(order => order.id === id); if (order) order.status = JSON.parse(options.body).status;
        return response({ success: true });
      }
      return response({});
    }
  });
  await vm.runInContext(source, context);
  return { nodes, calls, sources, timers, windowEvents, run: code => vm.runInContext(code, context),
    setOrders: value => { currentOrders = structuredClone(value); }, fail: value => { failBoard = value; }, patch: value => { patchCode = value; }, company: value => { companyId = value; },
    prints: () => prints, beeps: () => beeps, redirected: () => redirected,
    defer: () => { let resolve; const promise = new Promise(done => { resolve = done; }); gate = { promise }; return resolve; }
  };
}
test('gestor preserva adicionais e distingue entrega de retirada nas ações', async () => {
  const ui = await page({ orders: [makeOrder(12, 'ready'), makeOrder(13, 'ready', 'pickup')] });
  assert.match(ui.nodes.get('orders-board').innerHTML, /Queijo/);
  assert.equal(ui.run("allowedActions(state.orders[0]).includes('delivering')"), true);
  assert.equal(ui.run("allowedActions(state.orders[1]).includes('delivering')"), false);
  await ui.run("updateStatus(12, 'delivering')");
  const patch = ui.calls.find(call => call.options.method === 'PATCH'); assert.deepEqual(JSON.parse(patch.options.body), { status: 'delivering', expected_status: 'ready' });
});
test('cozinha destaca itens e não mostra telefone, endereço ou total; impressão é manual', async () => {
  const ui = await page({ kitchen: true, orders: [makeOrder(12, 'ready')] }); const markup = ui.nodes.get('orders-board').innerHTML;
  assert.match(markup, /Queijo/); assert.doesNotMatch(markup, /11999999999|Rua A|Total:/);
  assert.deepEqual(Array.from(ui.run("allowedActions({...state.orders[0], status:'ready'})")), ['completed']);
  assert.match(markup, /Concluir \/ Entregue/);
  await ui.run("updateStatus(12, 'completed')");
  const patch = ui.calls.find(call => call.options.method === 'PATCH'); assert.deepEqual(JSON.parse(patch.options.body), { status: 'completed', expected_status: 'ready' });
  ui.run('printOrder(12)'); assert.equal(ui.prints(), 1); assert.match(ui.nodes.get('print-ticket').innerHTML, /Queijo/); assert.doesNotMatch(ui.nodes.get('print-ticket').innerHTML, /11999999999|Rua A|Total:/);
});
test('dados do cliente são escapados e pedido antigo sem itens não pode iniciar produção', async () => {
  const order = makeOrder(); order.customer_name = '<img src=x onerror=alert(1)>'; order.items = [];
  const ui = await page({ orders: [order] }); const markup = ui.nodes.get('orders-board').innerHTML;
  assert.doesNotMatch(markup, /<img/); assert.match(markup, /sem itens registrados/);
  assert.equal(ui.run("allowedActions(state.orders[0]).includes('preparing')"), false);
});
test('falha de leitura preserva cartões e bloqueia ações até reconectar', async () => {
  const ui = await page(); ui.fail(true); await ui.run('loadOrders()');
  assert.match(ui.nodes.get('orders-board').innerHTML, /Lanche/); assert.equal(ui.run('state.stale'), true);
  await ui.run("updateStatus(12, 'preparing')"); assert.equal(ui.calls.some(call => call.options.method === 'PATCH'), false);
  ui.fail(false); await ui.run('loadOrders()'); assert.equal(ui.run('state.stale'), false);
});
test('conflito de status informa o operador e não repete escrita', async () => {
  const ui = await page(); ui.patch(409); await ui.run("updateStatus(12, 'preparing')");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.match(ui.nodes.get('feedback').textContent, /Outro operador/);
});
test('troca de filtro descarta resposta antiga em andamento', async () => {
  const ui = await page({ orders: [makeOrder(), makeOrder(13,'completed')] });
  const release = ui.defer(); const pending = ui.run('loadOrders()');
  ui.nodes.get('status-filter').value = 'completed'; ui.run('changeFilter()'); release(); await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.run('state.orders.length'), 1); assert.equal(ui.run('state.orders[0].status'), 'completed');
});
test('alerta ignora primeira carga e reenvio do evento; só toca após ativação', async () => {
  const ui = await page(); assert.equal(ui.beeps(), 0);
  await ui.run('toggleSound()'); assert.equal(ui.beeps(), 1);
  ui.setOrders([makeOrder(), makeOrder(15)]); await ui.run('loadOrders()'); assert.equal(ui.beeps(), 2); assert.equal(ui.nodes.get('new-orders').hidden, false);
  await ui.run('loadOrders()'); assert.equal(ui.beeps(), 2);
  ui.sources[0].listeners['session-ended'](); assert.equal(ui.redirected(), '/login.html'); assert.equal(ui.sources[0].closed, true);
});
test('prazo usa horário UTC e previsão do pedido, sem inventar duração de etapas', async () => {
  const ui = await page();
  const result = ui.run("timing({created_at:'2026-11-03T18:00:00Z', status:'preparing', estimated_minutes:30}, Date.parse('2026-11-03T18:30:00Z'))");
  assert.equal(result.overdue, true); assert.match(result.text, /30 min/);
  assert.equal(ui.run("timing({created_at:'2026-11-03T18:00:00Z', status:'pending', estimated_minutes:null}).overdue"), false);
  ui.company(8); await ui.run('loadOrders()'); assert.equal(ui.redirected(), '/login.html');
});

test('gestor e via de entrega exibem cupom e desconto; cozinha preserva foco na produção', async () => {
  const order = { ...makeOrder(), coupon_code: 'TESTE', discount_amount: '5.00', total_amount: '10.00' };
  const manager = await page({ orders: [order] }); assert.match(manager.nodes.get('orders-board').innerHTML, /Cupom TESTE/);
  manager.run('printOrder(12)'); assert.match(manager.nodes.get('print-ticket').innerHTML, /Cupom TESTE/);
  const kitchen = await page({ kitchen: true, orders: [order] }); assert.doesNotMatch(kitchen.nodes.get('orders-board').innerHTML, /Cupom TESTE/);
});
test('lista de pedidos é padrão e mantém quadro, ações e detalhes disponíveis',async()=>{
 const ui=await page();assert.match(ui.nodes.get('orders-board').innerHTML,/order-list-table/);assert.match(ui.nodes.get('orders-board').innerHTML,/data-action="details"/);assert.match(ui.nodes.get('orders-board').innerHTML,/Iniciar preparo/);ui.run("orderLayout='board';state.fingerprint='';render()");assert.doesNotMatch(ui.nodes.get('orders-board').innerHTML,/order-list-table/);assert.match(ui.nodes.get('orders-board').innerHTML,/stage-heading/);
});

test('observação por item aparece escapada na cozinha e no comprovante', async () => {
 const order = makeOrder();
 order.items[0].item_notes = 'Sem milho <img src=x>';
 const p = await page({ kitchen: true, orders: [order] });
 const rendered = p.run('itemsHtml(state.orders[0])');
 assert.match(rendered, /Sem milho &lt;img/);
 assert.doesNotMatch(rendered, /<img src=x>/);
 p.run('printOrder(12)');
 assert.match(p.nodes.get('print-ticket').innerHTML, /Sem milho &lt;img/);
});


test('cozinha e impressão exibem a quantidade histórica de cada adicional', async () => {
 const order=makeOrder();order.items[0].addons_snapshot[0].quantity=2;
 const p=await page({kitchen:true,orders:[order]});
 assert.match(p.run('itemsHtml(state.orders[0])'),/2× Queijo/);
 p.run('printOrder(12)');assert.match(p.nodes.get('print-ticket').innerHTML,/2× Queijo/);
});
