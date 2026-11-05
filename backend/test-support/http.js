const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const { createApp } = require('../src/app');
async function serve(t, db, options = {}) {
 const app = createApp(db, options);
 // Pipeline do Express em memória, sem portas de rede.
 return (url, options = {}) => new Promise((resolve, reject) => {
  const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
  const req = new IncomingMessage(socket);
  req._destroy = (err, callback) => callback(err);
  req.method = options.method || 'GET'; req.url = url;
  req.headers = { host: 'localhost',  ...Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])) };
  if (options.body) req.headers['content-length'] = Buffer.byteLength(options.body).toString();
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  const chunks = [];
  const write = res.write.bind(res); const end = res.end.bind(res);
  res.write = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return write(chunk, ...args); };
  res.end = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return end(chunk, ...args); };
  res.on('error', reject);
  res.on('finish', () => {
   const body = Buffer.concat(chunks).toString();
   resolve({ status: res.statusCode, headers: res.getHeaders(), text: async () => body, json: async () => JSON.parse(body), arrayBuffer: async () => Buffer.concat(chunks) });
   socket.destroy();
  });
  app(req, res);
  if (options.body) req.push(Buffer.from(options.body));
  req.push(null);
 });
}
module.exports = { serve };
