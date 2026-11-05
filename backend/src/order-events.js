const { sessionUser } = require('./auth');
function createOrderEvents({ maxPerCompany = 20, interval = setInterval, clear = clearInterval } = {}) {
  const subscribers = new Map();
  let stopped = false;
  function publish(companyId) {
    for (const client of [...(subscribers.get(companyId) || [])]) client.send('event: orders-changed\ndata: {}\n\n');
  }
  function stream(db) {
    return (req, res) => {
      if (stopped) return res.status(503).json({ error: 'Aplicação reiniciando. A atualização periódica tentará novamente.' });
      const companyId = req.user.company_id;
      const clients = subscribers.get(companyId) || new Set();
      if (clients.size >= maxPerCompany) return res.status(429).json({ error: 'Limite de telas ao vivo atingido. A atualização periódica continua disponível.' });
      let closed = false, checking = false, timer;
      const finish = () => {
        if (closed) return;
        closed = true; clear(timer); clients.delete(client);
        if (!clients.size) subscribers.delete(companyId);
      };
      const client = { send(message) {
        if (closed) return;
        try { if (!res.write(message)) client.end(); }
        catch { client.end(); }
      }, end() { finish(); try { res.end(); } catch {} } };
      clients.add(client); subscribers.set(companyId, clients);
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.on('close', finish); req.on('aborted', finish);
      res.flushHeaders();
      timer = interval(async () => {
        if (closed || checking) return;
        checking = true;
        try {
          const user = await sessionUser(db, req);
          if (!user || user.company_id !== companyId) {
            client.send('event: session-ended\ndata: {}\n\n'); client.end();
          } else client.send(': keepalive\n\n');
        } catch { client.end(); }
        finally { checking = false; }
      }, 15000);
      timer.unref?.();
      client.send('retry: 3000\nevent: connected\ndata: {}\n\n');
    };
  }
  function closeAll() { stopped = true; for (const clients of [...subscribers.values()]) for (const client of [...clients]) client.end(); }
  return { publish, stream, closeAll };
}
module.exports = { createOrderEvents };
