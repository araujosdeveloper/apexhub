const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/legacy-inventory.json');
const { validateLegacyInventory, verifySnapshots, migrateRestoredLegacy } = require('../src/legacy-migration');
const copy = () => JSON.parse(JSON.stringify(fixture));
test('esquema real inventariado é aceito sem alterar os metadados', () => {
 const inventory = copy(); validateLegacyInventory(inventory); assert.deepEqual(inventory, fixture);
});
test('mudanças de tipo e migrações parciais impedem aplicação do DDL', () => {
 const unsigned = copy(); unsigned.columns.find(c => c.table === 'companies' && c.name === 'id').type = 'int unsigned';
 assert.throws(() => validateLegacyInventory(unsigned), /Tipo de ID incompatível/);
 const partial = copy(); partial.columns.push({ table: 'order_items', name: 'total_price', type: 'decimal(10,2)' });
 assert.throws(() => validateLegacyInventory(partial), /Migração parcial/);
 const other = copy(); other.tables.push({ name: 'users', type: 'BASE TABLE', engine: 'InnoDB' });
 assert.throws(() => validateLegacyInventory(other), /conjunto de tabelas/);
});
test('verificação detecta alteração em qualquer registro original', () => {
 const snapshots = Object.fromEntries(fixture.tables.map(t => [t.name, { rows: 1, sha256: 'original' }]));
 verifySnapshots(snapshots, snapshots);
 const changed = structuredClone(snapshots); changed.orders.sha256 = 'alterado';
 assert.throws(() => verifySnapshots(snapshots, changed), /orders/);
 const removed = structuredClone(snapshots); removed.order_items.rows = 0;
 assert.throws(() => verifySnapshots(snapshots, removed), /order_items/);
});
test('executor recusa bancos comuns e agendador de eventos ativo antes de qualquer DDL', async () => {
 for (const identity of [{ name: 'delivery_saas_db', event_scheduler: 'OFF' }, { name: 'delivery_rehearsal_test', event_scheduler: 'ON' }]) {
  let queries = 0;
  await assert.rejects(migrateRestoredLegacy({ query: async sql => { queries++; assert.match(sql, /^SELECT/); return [[identity]]; } }), /somente na cópia/);
  assert.equal(queries, 1);
 }
});
test('executor recusa rotinas e triggers restauradas antes de alterar o esquema', async () => {
 let queries = 0;
 await assert.rejects(migrateRestoredLegacy({ query: async sql => { queries++; assert.match(sql, /^SELECT/); return queries === 1 ? [[{ name: 'delivery_rehearsal_test', event_scheduler: 'OFF' }]] : [[{ triggers_count: 1, routines_count: 0, events_count: 0 }]]; } }), /triggers, rotinas ou eventos/);
 assert.equal(queries, 2);
});
test('publicação exige cópia em outro servidor e identidade exata antes do DDL', async () => {
 const { migrateReleaseCopy } = require('../src/legacy-migration');
 const sourceUuid = '11111111-1111-1111-1111-111111111111';
 const targetUuid = '22222222-2222-2222-2222-222222222222';
 for (const options of [{}, { sourceUuid, targetUuid: sourceUuid }]) {
  await assert.rejects(migrateReleaseCopy({ query: () => { throw new Error('não deveria consultar'); } }, options), /distintos/);
 }
 for (const identity of [
  { name: 'delivery_saas_db', server_uuid: targetUuid, event_scheduler: 'OFF' },
  { name: 'delivery_live_db', server_uuid: sourceUuid, event_scheduler: 'OFF' },
  { name: 'delivery_live_db', server_uuid: targetUuid, event_scheduler: 'ON' }
 ]) {
  let calls = 0;
  await assert.rejects(migrateReleaseCopy({ query: async sql => { calls++; assert.match(sql, /^SELECT/); return [[identity]]; } }, { sourceUuid, targetUuid }), /destino/);
  assert.equal(calls, 1);
 }
});
