const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDriveConfig, recoveryText } = require('../src/drive-config');
const config = '[delivery_drive]\ntype = drive\nscope = drive.file\nclient_id = 1234-bebella.apps.googleusercontent.com\nclient_secret = example-secret\ntoken = {"access_token":"example-access","refresh_token":"example-refresh"}\n\n[delivery_crypt]\ntype = crypt\nremote = delivery_drive:Delivery-SaaS-Backups\nfilename_encryption = standard\ndirectory_name_encryption = true\npassword = example-encryption-key\npassword2 = example-salt-key\n';
test('aceita somente Drive limitado e crypt com as duas chaves', () => {
 assert.equal(validateDriveConfig(config).type, 'crypt');
 for (const changed of [config.replace('drive.file', 'drive'), config.replace('type = crypt', 'type = drive'), config.replace('password2 = example-salt-key', 'password2 = '), config.replace('filename_encryption = standard', 'filename_encryption = off')]) assert.throws(() => validateDriveConfig(changed));
});
test('exige autorização renovável antes de enviar dados', () => {
 assert.throws(() => validateDriveConfig(config.replace(',"refresh_token":"example-refresh"', '')), /renovação/);
 assert.throws(() => validateDriveConfig(config.replace('token = {"access_token":"example-access","refresh_token":"example-refresh"}', '')), /concluída/);
});
test('arquivo de recuperação preserva chaves sem incluir tokens OAuth', () => {
 const text = recoveryText(config);
 assert.ok(text.includes('example-encryption-key') && text.includes('example-salt-key'));
 assert.ok(!text.includes('example-access') && !text.includes('example-refresh'));
});

test('recusa ativação com cliente Google compartilhado ou ausente', () => {
 assert.throws(() => validateDriveConfig(config.replace('1234-bebella.apps.googleusercontent.com', '202264815644.apps.googleusercontent.com')), /próprio/);
 assert.throws(() => validateDriveConfig(config.replace('client_id = 1234-bebella.apps.googleusercontent.com', 'client_id = ')), /próprio/);
});
