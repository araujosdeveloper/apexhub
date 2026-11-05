function updateGoogleClient(config, json) {
  const client = json?.installed;
  if (!client || typeof client.client_id !== 'string' || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(client.client_id) ||
      client.client_id === '202264815644.apps.googleusercontent.com' || typeof client.client_secret !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(client.client_secret)) {
    throw new Error('Use o JSON de um cliente OAuth próprio do tipo Aplicativo para computador.');
  }
  const parts = config.split(/(?=^\[)/m);
  const index = parts.findIndex(part => part.startsWith('[delivery_drive]'));
  if (index < 0) throw new Error('Configuração Drive ainda não criada.');
  const lines = parts[index].split('\n').filter(line => !/^\s*(client_id|client_secret|token|team_drive|root_folder_id)\s*=/.test(line));
  parts[index] = lines.join('\n').trimEnd() + '\nclient_id = ' + client.client_id + '\nclient_secret = ' + client.client_secret + '\n\n';
  return parts.join('');
}
module.exports = { updateGoogleClient };
