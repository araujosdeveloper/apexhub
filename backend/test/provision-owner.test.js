const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectOwner, provisionOwner } = require('../src/provision-owner');
const { verifyPassword } = require('../src/security');
const input = { companyId: 1, slug: 'loja', name: 'Responsável', email: 'OWNER@example.com' };
function fixture({ owners = [], emails = [], slug = 'loja', failInsert = false } = {}) {
  const events = [];
  const conn = {
    beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'), release: () => events.push('release'),
    execute: async (sql, params) => {
      events.push({ sql, params });
      if (sql.includes('FROM companies')) return [[{ id: 1, slug, active: 1 }]];
      if (sql.includes("role = 'owner'")) return [owners];
      if (sql.includes('FROM users')) return [emails];
      if (failInsert) throw new Error('falha de inserção');
      return [{ insertId: 7 }];
    }
  };
  return { events, conn, pool: { getConnection: async () => conn } };
}
test('consulta do proprietário não faz gravações', async () => {
  const { conn, events } = fixture(); await inspectOwner(conn, input);
  assert.ok(events.every(e => e.sql.startsWith('SELECT')));
});
test('empresa divergente, proprietário existente e e-mail ocupado impedem inserção', async () => {
  for (const options of [{ slug: 'outra' }, { owners: [{ id: 2 }] }, { emails: [{ id: 3 }] }]) {
    const { pool, events } = fixture(options);
    await assert.rejects(provisionOwner(pool, input, 'senha-longa-para-teste'));
    assert.ok(!events.some(e => e.sql?.startsWith('INSERT')));
    assert.deepEqual(events.slice(-2), ['rollback', 'release']);
  }
});
test('criação trava empresa e grava somente hash da senha na empresa confirmada', async () => {
  const { pool, events } = fixture(); const password = 'senha-longa-para-teste';
  assert.deepEqual(await provisionOwner(pool, input, password), { userId: 7, companyId: 1 });
  assert.ok(events.some(e => e.sql?.endsWith('FOR UPDATE')));
  const insert = events.find(e => e.sql?.startsWith('INSERT'));
  assert.deepEqual(insert.params.slice(0, 3), [1, 'Responsável', 'owner@example.com']);
  assert.ok(await verifyPassword(password, insert.params[3]));
  assert.ok(!JSON.stringify(events).includes(password));
  assert.deepEqual(events.slice(-2), ['commit', 'release']);
});
test('falha de inserção reverte transação e libera conexão', async () => {
  const { pool, events } = fixture({ failInsert: true });
  await assert.rejects(provisionOwner(pool, input, 'senha-longa-para-teste'), /falha/);
  assert.deepEqual(events.slice(-2), ['rollback', 'release']);
});
