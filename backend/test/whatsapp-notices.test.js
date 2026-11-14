'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateWithNotice, applyNoticeStatus, sender } = require('../src/whatsapp-notices');

test('transição e aviso com consentimento usam a mesma transação', async () => {
  const calls = [];
  let fail = false;
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) {
      if (sql.startsWith('UPDATE orders')) {
        calls.push('status');
        return [{ affectedRows: 1 }];
      }
      assert.match(sql, /consent.kind = 'consent'/);
      assert.match(sql, /fulfillment_method = 'pickup'/);
      assert.deepEqual(params, ['ready', 42, 7, 'ready', 'ready']);
      calls.push('notice');
      if (fail) throw new Error('queue error');
    },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
  const db = { async getConnection() { return conn; } };
  const run = () => updateWithNotice(db, 'UPDATE orders', [], { companyId: 42, orderId: 7, target: 'ready' }, true);
  await run();
  assert.deepEqual(calls.splice(0), ['begin', 'status', 'notice', 'commit', 'release']);
  fail = true;
  await assert.rejects(run(), /queue error/);
  assert.deepEqual(calls, ['begin', 'status', 'notice', 'rollback', 'release']);
});

test('webhook de falha não sobrescreve entrega confirmada e é restrito à loja e ao número', async () => {
  const db = { async execute(sql, args) {
    assert.match(sql, /company_id = \? AND phone_number_id = \?/);
    assert.match(sql, /state IN \('uncertain','accepted'\)/);
    assert.deepEqual(args, ['rejected', 'wamid.example', 42, '100', 'wamid.example', '7']);
  } };
  await applyNoticeStatus(db, { companyId: 42, phoneId: '100',
    status: { status: 'failed', id: 'wamid.example', biz_opaque_callback_data: 'notice:7' } });
  assert.equal(sender('(86) 99999-0000'), '5586999990000');
});
