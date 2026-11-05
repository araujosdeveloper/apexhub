const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { completedBackups, enforceRetention } = require('../src/backup-retention');
function createBackup(root, day) {
  const name = `live-202610${String(day).padStart(2, '0')}T000000Z-1`;
  const directory = path.join(root, name); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ status: 'BACKUP_COMPLETE', database: 'delivery_live_db' }));
  fs.writeFileSync(path.join(directory, '.delivery-live-backup'), 'delivery-live-backup-v1\n');
  fs.writeFileSync(path.join(directory, 'backup.sql.gz'), 'fixture');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), 'fixture');
  return directory;
}
test('retenção remove somente os backups concluídos mais antigos', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let day = 1; day <= 10; day++) createBackup(root, day);
  assert.equal(enforceRetention(root, 7).length, 3);
  assert.equal(completedBackups(root).length, 7);
  assert.ok(fs.existsSync(path.join(root, 'live-20261010T000000Z-1')));
});
test('retenção preserva arquivos estranhos, symlinks, backups incompletos e de outro banco', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const foreign = createBackup(root, 1);
  fs.writeFileSync(path.join(foreign, 'keep.txt'), 'preservar');
  const other = createBackup(root, 2);
  fs.writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ status: 'BACKUP_COMPLETE', database: 'outro_banco' }));
  fs.mkdirSync(path.join(root, '.partial-1'));
  fs.symlinkSync(foreign, path.join(root, 'live-20261003T000000Z-1'));
  for (let day = 4; day <= 12; day++) createBackup(root, day);
  enforceRetention(root, 7);
  assert.ok(fs.existsSync(path.join(foreign, 'keep.txt')));
  assert.ok(fs.existsSync(other));
  assert.ok(fs.lstatSync(path.join(root, 'live-20261003T000000Z-1')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(root, '.partial-1')));
});
test('retenção mínima protege contra configuração que apaga todas as cópias', () => {
  assert.throws(() => enforceRetention('/unused', 0), /mínima/);
});
