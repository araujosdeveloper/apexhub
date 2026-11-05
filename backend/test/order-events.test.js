const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOrderEvents } = require('../src/order-events');
function environment(options = {}) {
  const timers = [], cleared = [];
  const events = createOrderEvents({ ...options, interval: callback => { timers.push(callback); return { id: timers.length, unref() {} }; }, clear: timer => cleared.push(timer?.id) });
  const connect = (company, { user = { company_id: company }, backpressure = false, broken = false } = {}) => {
    const req = Object.assign(new EventEmitter(), { user: { company_id: company }, headers: { cookie: 'delivery_session=' + 'a'.repeat(64) } });
    const res = Object.assign(new EventEmitter(), { messages: [], statusCode: 0, ended: false,
      status(code) { this.statusCode = code; return this; }, set(headers) { this.headers = headers; return this; }, flushHeaders() {}, json(value) { this.value = value; return this; },
      write(message) { if (broken) throw new Error('socket'); this.messages.push(message); return !backpressure; }, end() { this.ended = true; this.emit('close'); }
    });
    events.stream({ execute: async () => [[...(user ? [user] : [])]] })(req, res);
    return res;
  };
  return { events, connect, timers, cleared };
}
test('eventos de uma loja não chegam a outra e fechamento remove inscrição e timer', () => {
  const env = environment(); const a = env.connect(7), b = env.connect(8);
  assert.match(a.headers['Content-Type'], /text\/event-stream/);
  env.events.publish(7); assert.equal(a.messages.length, 2); assert.equal(b.messages.length, 1);
  assert.match(a.messages[1], /orders-changed/); assert.doesNotMatch(a.messages[1], /customer|phone|total/);
  a.emit('close'); env.events.publish(7); assert.equal(a.messages.length, 2); assert.equal(env.cleared[0], 1);
  env.events.closeAll(); assert.equal(b.ended, true);
});
test('sessão expirada ou movida para outra empresa encerra o stream', async () => {
  for (const user of [null, { company_id: 8 }]) {
    const env = environment(); const client = env.connect(7, { user });
    await env.timers[0](); assert.equal(client.ended, true); assert.match(client.messages[1], /session-ended/);
    env.events.publish(7); assert.equal(client.messages.length, 2);
  }
});
test('limite por loja, clientes lentos e sockets quebrados não bloqueiam o checkout', () => {
  const env = environment({ maxPerCompany: 1 }); const client = env.connect(7);
  assert.equal(env.connect(7).statusCode, 429); client.emit('close'); assert.equal(env.connect(7).statusCode, 200);
  const slow = environment(); assert.equal(slow.connect(7, { backpressure: true }).ended, true);
  const broken = environment(); broken.connect(7, { broken: true }); assert.doesNotThrow(() => broken.events.publish(7));
  env.events.closeAll(); slow.events.closeAll(); broken.events.closeAll();
});
