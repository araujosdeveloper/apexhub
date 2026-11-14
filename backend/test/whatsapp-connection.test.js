'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDecipheriv } = require('node:crypto');
const { installWhatsAppConnection } = require('../src/whatsapp-connection');

function harness({ matches = true, duplicate = false } = {}) {
  const app = { get() {}, patch(_path, ...handlers) { this.change = handlers.at(-1); }, post(_path, ...handlers) { this.save = handlers.at(-1); } };
  const env = {
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
    WHATSAPP_META_APP_ID: '100',
    WHATSAPP_META_CONFIG_ID: '200',
    WHATSAPP_META_APP_SECRET: 'fixture',
    WHATSAPP_META_GRAPH_VERSION: 'v25.0',
    WHATSAPP_CONNECTION_KEY: 'a'.repeat(64)
  };
  const db = { async execute(sql, params) {
    if (sql.includes('FROM subscriptions')) return [[{ plan_code: 'pro', status: 'active' }]];
    if (sql.includes('SELECT company_id, phone_number_id, waba_id, encrypted_token')) {
      return [[{ company_id: 42, phone_number_id: '400', waba_id: '300', encrypted_token: this.saved[4] }]];
    }
    if (sql.startsWith('SELECT')) return [[]];
    if (sql.startsWith('UPDATE')) { this.update = sql; return [{ affectedRows: 1 }]; }
    this.saved = params;
    if (duplicate) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
  } };
  const fetchGraph = async url => ({
    ok: true,
    async json() {
      if (url.pathname.endsWith('/400')) return { id: '400' };
      if (url.pathname.endsWith('/subscribed_apps')) return { success: true };
      if (url.pathname.endsWith('/oauth/access_token')) return { access_token: 'private-token' };
      if (url.pathname.endsWith('/debug_token')) return { data: {
        is_valid: true,
        app_id: '100',
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['300'] }]
      } };
      return { data: [{ id: matches ? '400' : '401', display_phone_number: '+55 00 00000-0000' }] };
    }
  });
  installWhatsAppConnection(app, db, () => {}, { env, fetchGraph });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  const run = () => app.save({ tenantId: 42, user: { id: 7 },
    body: { code: 'one-time-code', wabaId: '300', phoneId: '400' } }, response, error => { throw error; });
  const change = action => app.change({ tenantId: 42, body: { action } }, response, error => { throw error; });
  return { db, response, run, env, change };
}

test('WhatsApp armazena a autorização cifrada e devolve somente o número público', async () => {
  const { db, response, run, env } = harness();
  await run();
  assert.equal(response.code, 201);
  assert.deepEqual(response.body, { connection: { display_phone: '+55 00 00000-0000' } });
  const [company, waba, number, , token, actor] = db.saved;
  assert.deepEqual([company, waba, number, actor], [42, '300', '400', 7]);
  const packed = Buffer.from(token, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(env.WHATSAPP_CONNECTION_KEY, 'hex'), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(JSON.stringify(['42', '300', '400'])));
  decipher.setAuthTag(packed.subarray(12, 28));
  assert.equal(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString(), 'private-token');
});

test('WhatsApp rejeita número que a Meta não confirmou e conflito simultâneo de vínculo', async () => {
  const mismatch = harness({ matches: false });
  await mismatch.run();
  assert.equal(mismatch.response.code, 422);
  assert.equal(mismatch.db.saved, undefined);
  const race = harness({ duplicate: true });
  await race.run();
  assert.equal(race.response.code, 409);
});


test('testar a inscrição mantém o bot pausado até a ativação explícita', async () => {
  const { db, run, change } = harness();
  await run();
  await change('test');
  assert.doesNotMatch(db.update, /automation_enabled = 1/);
  await change('activate');
  assert.match(db.update, /automation_enabled = 1/);
  await change('pause');
  assert.match(db.update, /automation_enabled = 0/);
});
