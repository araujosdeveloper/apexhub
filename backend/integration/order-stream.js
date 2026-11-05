const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
// Usado somente pela integração no MySQL temporário; não recebe o banco real.
async function verifyOrderStream(db, { cookie, otherCookie, orderId }) {
  const app = createApp(db), controller = new AbortController();
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  let reader;
  try {
    const stream = await fetch(base + '/api/admin/orders/events', { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(stream.status, 200); assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    reader = stream.body.getReader();
    async function until(marker) {
      const timeout = setTimeout(() => controller.abort(), 5000);
      let text = '';
      try {
        while (!text.includes(marker)) { const chunk = await reader.read(); assert.equal(chunk.done, false); text += new TextDecoder().decode(chunk.value); }
        return text;
      } finally { clearTimeout(timeout); }
    }
    await until('event: connected');
    const change = expected => fetch(base + '/api/admin/orders/' + orderId + '/status', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(expected) });
    assert.equal((await change({ status: 'preparing', expected_status: 'pending' })).status, 200);
    const notification = await until('event: orders-changed'); assert.doesNotMatch(notification, /customer|phone|total_amount/);
    assert.equal((await change({ status: 'ready', expected_status: 'pending' })).status, 409);
    const board = await (await fetch(base + '/api/admin/orders/board?scope=kitchen&status=preparing&search=' + encodeURIComponent('#' + orderId), { headers: { Cookie: cookie } })).json();
    assert.equal(board.orders.length, 1); assert.equal(board.orders[0].id, orderId); assert.equal(board.orders[0].status, 'preparing');
    const hidden = await (await fetch(base + '/api/admin/orders/board', { headers: { Cookie: otherCookie } })).json();
    assert.equal(hidden.total, 0); assert.equal(hidden.counts.pending, 0);
  } finally {
    controller.abort(); app.locals.orderEvents.closeAll();
    if (reader) await reader.cancel().catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { verifyOrderStream };
