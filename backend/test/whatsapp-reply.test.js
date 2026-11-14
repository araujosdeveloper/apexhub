'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv } = require('node:crypto');
const { processInitialReplies } = require('../src/whatsapp-reply');

test('a resposta usa o número da loja e uma tentativa incerta não é repetida', async () => {
  const key = Buffer.alloc(32, 1);
  const nonce = Buffer.alloc(12, 2);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(['42', '300', '400'])));
  const token = Buffer.concat([cipher.update('fixture-token'), cipher.final()]);
  const row = {
    id: 1, company_id: 42, waba_id: '300', phone_number_id: '400', sender: '558600000000', slug: 'bebella',
    encrypted_token: Buffer.concat([nonce, cipher.getAuthTag(), token]).toString('base64')
  };
  let reserved = false;
  const sends = [];
  const db = { async execute(sql, params) {
    if (sql.includes('FROM company_whatsapp_inbox')) return [[row]];
    if (sql.includes('SELECT 1 AS enabled')) return [[{ enabled: 1 }]];
    if (sql.includes('FROM subscriptions')) return [[{ plan_code: 'pro', status: 'active' }]];
    if (sql.startsWith('INSERT')) {
      if (reserved) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
      reserved = true;
    } else {
      assert.deepEqual(params, ['uncertain', null, 1]);
    }
  } };
  const options = { companyId: 42, sender: row.sender, key, version: 'v25.0', async fetchGraph(url, request) {
    sends.push({ url, request });
    throw new Error('conexão interrompida');
  } };
  await Promise.all([processInitialReplies(db, options), processInitialReplies(db, options)]);
  assert.equal(sends.length, 1);
  const [{ url, request }] = sends;
  assert.match(url, /\/400\/messages$/);
  assert.equal(request.headers.Authorization, 'Bearer fixture-token');
  assert.equal(JSON.parse(request.body).to, row.sender);
});

test('pedido de atendente pausa a conversa sem processar o próximo comando da fila', async () => {
  const key = Buffer.alloc(32, 1);
  const nonce = Buffer.alloc(12, 2);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(['42', '300', '400'])));
  const token = Buffer.concat([cipher.update('fixture-token'), cipher.final()]);
  const row = {
    id: 1, company_id: 42, waba_id: '300', phone_number_id: '400', sender: '558600000000', slug: 'bebella',
    body: 'Quero falar com um atendente',
    encrypted_token: Buffer.concat([nonce, cipher.getAuthTag(), token]).toString('base64')
  };
  let waiting = false;
  let reservations = 0;
  const db = { async execute(sql, params) {
    if (sql.includes('FROM company_whatsapp_inbox')) {
      assert.match(sql, /h.state = 'bot' AND i.id > h.skip_through/);
      return [waiting ? [] : [row, { ...row, id: 2, body: 'CONFIRMAR abc' }]];
    }
    if (sql.includes('SELECT 1 AS enabled')) return [[{ enabled: 1 }]];
    if (sql.includes('FROM subscriptions')) return [[{ plan_code: 'pro', status: 'active' }]];
    if (sql.startsWith('INSERT INTO whatsapp_initial_replies')) reservations++;
    if (sql.startsWith('INSERT INTO whatsapp_handoffs')) {
      assert.deepEqual(params, [42, '400', '558600000000']);
      waiting = true;
    }
  } };
  const replies = [];
  const options = { companyId: 42, sender: row.sender, key, version: 'v25.0',
    placeOrder: () => assert.fail('O pedido não pode ser processado durante a pausa'),
    async fetchGraph(_url, request) {
      assert.equal(waiting, true);
      replies.push(JSON.parse(request.body).text.body);
      return { ok: true, async json() { return { messages: [{ id: 'wamid.example' }] }; } };
    }
  };
  await processInitialReplies(db, options);
  await processInitialReplies(db, options);
  assert.equal(reservations, 1);
  assert.match(replies[0], /Solicitei atendimento/);
});
