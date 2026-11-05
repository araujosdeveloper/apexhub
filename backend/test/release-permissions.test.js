const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restrictReleaseUser } = require('../src/release-permissions');
function mock(partialRevokes, extraGrant = false, nativeQuotes = false) {
  const calls = [];
  const schema = partialRevokes ? 'delivery_live_db' : 'delivery\\_live\\_db';
  const dml = "GRANT SELECT, INSERT, UPDATE, DELETE ON `" + schema + "`.* TO 'delivery_app'@'%'";
  const db = { query: async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT')) return [[{ partial_revokes: partialRevokes }]];
    if (sql.startsWith('SHOW')) {
      const encode = value => nativeQuotes ? value.replace(/ TO 'delivery_app'@'%'$/, ' TO `delivery_app`@`%`').replace(/\\/g, '\\\\') : value;
      return [[
      { grants: encode("GRANT USAGE ON *.* TO 'delivery_app'@'%'") }, { grants: encode(dml) },
      ...(extraGrant ? [{ grants: "GRANT CREATE ON *.* TO 'delivery_app'@'%'" }] : [])
    ]];
    }
    return [{}];
  } };
  return { db, calls, dml };
}
test('revoga permissões por conta e escapa underscores no GRANT padrão', async () => {
  const { db, calls, dml } = mock(0);
  await restrictReleaseUser(db);
  assert.equal(calls[1], "REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'delivery_app'@'%'");
  assert.equal(calls[2], dml);
  assert.ok(calls[2].includes('`delivery\\_live\\_db`'));
});
test('partial_revokes ativo usa nome literal sem escapes de wildcard', async () => {
  const { db, calls } = mock(1);
  await restrictReleaseUser(db);
  assert.ok(calls[2].includes('`delivery_live_db`'));
  assert.ok(!calls[2].includes('\\'));
});
test('permissão adicional impede a publicação mesmo após o GRANT', async () => {
  const { db } = mock(0, true);
  await assert.rejects(restrictReleaseUser(db), /diferem/);
});
test('erro de revogação interrompe o procedimento sem conceder permissões', async () => {
  const calls = [];
  await assert.rejects(restrictReleaseUser({ query: async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT')) return [[{ partial_revokes: 0 }]];
    throw new Error('revogação falhou');
  } }), /revogação falhou/);
  assert.ok(!calls.some(sql => sql.startsWith('GRANT')));
});

test('aceita SHOW GRANTS com conta em backticks e escapes de exibição do MySQL', async () => {
  const { db } = mock(0, false, true);
  await restrictReleaseUser(db);
});
