function validateDriveConfig(text, requireToken = true) {
  const sections = {}; let current;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { current = sections[header[1]] = {}; continue; }
    const field = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (current && field) current[field[1].trim()] = field[2].trim();
  }
  const drive = sections.delivery_drive || {}, crypt = sections.delivery_crypt || {};
  if (drive.type !== 'drive' || drive.scope !== 'drive.file' || crypt.type !== 'crypt' ||
      crypt.remote !== 'delivery_drive:Delivery-SaaS-Backups' || crypt.filename_encryption !== 'standard' ||
      crypt.directory_name_encryption !== 'true' || !crypt.password || !crypt.password2) {
    throw new Error('Configuração Drive/criptografia divergente. Nenhum backup será enviado.');
  }
  if (requireToken && (!drive.client_id || drive.client_id === '202264815644.apps.googleusercontent.com' || !drive.client_secret)) {
    throw new Error('Configure um cliente OAuth Google próprio antes de ativar backups automáticos.');
  }
  if (requireToken) {
    let token;
    try { token = JSON.parse(drive.token); } catch { throw new Error('Autorização Google ainda não concluída.'); }
    if (!token.access_token || !token.refresh_token) throw new Error('A autorização Google não permite renovação automática.');
  }
  return crypt;
}
function recoveryText(text) {
  const crypt = validateDriveConfig(text);
  return 'CHAVES PRIVADAS DE RECUPERAÇÃO — NÃO COMPARTILHAR\nGuarde fora da VPS em local privado. Estas chaves permitem ler os backups.\nPara recuperar: configure delivery_drive com OAuth novamente no rclone e acrescente esta seção ao rclone.conf.\n\n[delivery_crypt]\n' +
    ['type', 'remote', 'filename_encryption', 'directory_name_encryption', 'password', 'password2'].map(key => key + ' = ' + crypt[key]).join('\n') + '\n';
}
module.exports = { validateDriveConfig, recoveryText };
