const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateGoogleClient } = require('../src/google-client');
const config = '[delivery_drive]\ntype = drive\nscope = drive.file\ntoken = old-token\nteam_drive = old-team\n\n[delivery_crypt]\npassword = preserve-key\npassword2 = preserve-salt\n';
const installed = { client_id: '1234-bebella.apps.googleusercontent.com', client_secret: 'example-secret' };
test('importa cliente desktop e invalida token antigo sem trocar chaves de criptografia', () => {
 const next = updateGoogleClient(config, { installed });
 assert.ok(next.includes('client_id = ' + installed.client_id));
 assert.ok(!next.includes('old-token') && !next.includes('old-team'));
 assert.equal(next.split('[delivery_crypt]')[1], config.split('[delivery_crypt]')[1]);
});
test('recusa cliente web, compartilhado e valores que injetam configuração', () => {
 for (const value of [{ web: installed }, { installed: { ...installed, client_secret: 'bad\nkey' } }, { installed: { ...installed, client_id: '202264815644.apps.googleusercontent.com' } }]) assert.throws(() => updateGoogleClient(config, value));
});
