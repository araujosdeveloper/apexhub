const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTables, buildChecks, verifyChecks } = require('../src/restore-check');
test('gera CHECK TABLE somente no banco temporário e valida resultados completos', () => {
 const tables = parseTables('orders\nusers\n', 2);
 assert.equal(buildChecks(tables), 'CHECK TABLE `delivery_restore_test`.`orders`;\nCHECK TABLE `delivery_restore_test`.`users`;\n');
 verifyChecks(tables, 'delivery_restore_test.orders\tcheck\tstatus\tOK\ndelivery_restore_test.users\tcheck\tstatus\tOK\n');
});
test('recusa identificadores inesperados, tabelas duplicadas e lista incompleta', () => {
 for (const text of ['orders; DROP TABLE users\n', 'users\nusers\n', 'users\n']) assert.throws(() => parseTables(text, 2), /inválida/);
});
test('recusa erros SQL, status ausente e retorno de banco diferente', () => {
 for (const text of ['delivery_restore_test.orders\tcheck\terror\tCorrupt', '', 'delivery_live_db.orders\tcheck\tstatus\tOK']) assert.throws(() => verifyChecks(['orders'], text));
});
