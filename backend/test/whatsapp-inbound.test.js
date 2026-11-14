'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHmac } = require('node:crypto');
const { installWhatsAppInbound } = require('../src/whatsapp-inbound');

test('webhook exige assinatura e encaminha apenas mensagens da conta e do número vinculados, com plano elegível', async t => {
  const app = express();
  const inbox = new Map();
  let plan = 'pro';
  const db = { async execute(sql, params) {
    if (sql.includes('FROM subscriptions')) {
      assert.deepEqual(params, [42]);
      return [[{ plan_code: plan, status: 'active' }]];
    }
    if (sql.startsWith('SELECT w.company_id')) {
      return [params.join(':') === '100:200' ? [{ company_id: 42 }] : []];
    }
    assert.match(sql, /ON DUPLICATE KEY UPDATE/);
    assert.deepEqual(params.slice(-3), [42, '100', '200']);
    inbox.set(params[0], params[3]);
  } };
  installWhatsAppInbound(app, db, { env: {
    WHATSAPP_META_APP_SECRET: 'fixture-secret', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fixture-verify'
  } });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/webhooks/whatsapp';
  assert.equal(await (await fetch(url + '?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=123')).text(), '123');
  assert.equal((await fetch(url + '?hub.mode=subscribe&hub.verify_token=other&hub.challenge=123')).status, 403);

  function post({ waba = '100', id = 'wamid.example', signed = true } = {}) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{
      field: 'messages', value: { metadata: { phone_number_id: '200' },
        messages: [{ id, from: '558600000000', type: 'text', text: { body: 'Quero dois lanches' } }] }
    }] }] });
    const signature = 'sha256=' + createHmac('sha256', signed ? 'fixture-secret' : 'other').update(body).digest('hex');
    return fetch(url, { method: 'POST', body, headers: {
      'content-type': 'application/json', 'x-hub-signature-256': signature
    } });
  }
  assert.equal((await post({ signed: false })).status, 403);
  assert.equal((await post({ waba: '101' })).status, 200);
  assert.equal(inbox.size, 0);
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  plan = 'essencial';
  assert.equal((await post({ id: 'wamid.other' })).status, 200);
  assert.deepEqual([...inbox], [['wamid.example', 'Quero dois lanches']]);
});
