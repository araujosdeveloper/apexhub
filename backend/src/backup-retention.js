const fs = require('node:fs');
const path = require('node:path');
const backupName = /^live-\d{8}T\d{6}Z-\d+$/;
function completedBackups(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Pasta de backup não pode ser symlink.');
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => {
    if (!entry.isDirectory() || !backupName.test(entry.name)) return false;
    const directory = path.join(root, entry.name);
    try {
      const allowed = new Set(['backup.sql.gz', 'manifest.json', 'SHA256SUMS', '.delivery-live-backup', 'restore-check.json']);
      if (fs.readdirSync(directory).some(name => !allowed.has(name) || !fs.lstatSync(path.join(directory, name)).isFile())) return false;
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      return manifest.status === 'BACKUP_COMPLETE' && manifest.database === 'delivery_live_db' &&
        fs.readFileSync(path.join(directory, '.delivery-live-backup'), 'utf8') === 'delivery-live-backup-v1\n' &&
        ['backup.sql.gz', 'SHA256SUMS'].every(name => fs.statSync(path.join(directory, name)).size > 0);
    } catch { return false; }
  }).map(entry => entry.name).sort().reverse();
}
function enforceRetention(root, keep = 30) {
  if (!Number.isInteger(keep) || keep < 7) throw new Error('Retenção mínima: sete backups concluídos.');
  const remove = completedBackups(root).slice(keep);
  for (const name of remove) fs.rmSync(path.join(root, name), { recursive: true });
  return remove;
}
module.exports = { completedBackups, enforceRetention };
