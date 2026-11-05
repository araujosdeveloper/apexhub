const mysql = require('mysql2/promise');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { inspectOwner, provisionOwner } = require('../src/provision-owner');
async function readPassword(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use um terminal interativo para definir a senha.');
  process.stdout.write(label);
  const output = new Writable({ write(chunk, encoding, done) { done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  try {
    return await new Promise((resolve, reject) => {
      rl.once('SIGINT', () => reject(new Error('Operação cancelada.')));
      rl.question('', resolve);
      rl.once('close', () => reject(new Error('Entrada encerrada.')));
    });
  } finally { rl.close(); process.stdout.write('\n'); }
}
async function main() {
  const [mode, id, slug, name, email, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !id || !slug || !name || !email || extra.length) throw new Error('Uso: node --env-file=.env scripts/provision-owner.js --check|--apply ID SLUG "NOME" EMAIL');
  if (!process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error('Configure DB_NAME, DB_USER e DB_PASSWORD no ambiente local.');
  const input = { companyId: Number(id), slug, name, email };
  const db = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 1 });
  try {
    const company = await inspectOwner(db, input);
    console.log(JSON.stringify({ database: process.env.DB_NAME, company, email: email.trim().toLowerCase(), mode }, null, 2));
    if (mode === '--check') { console.log('Consulta concluída. Nenhuma conta criada.'); return; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!process.stdin.isTTY) { rl.close(); throw new Error('Use um terminal interativo.'); }
    const answer = await new Promise(resolve => rl.question(`Confirme o slug ${slug}: `, resolve)); rl.close();
    if (answer !== slug) throw new Error('Confirmação divergente; operação cancelada.');
    const password = await readPassword('Senha de 12 a 128 caracteres (oculta): ');
    const confirmation = await readPassword('Repita a senha (oculta): ');
    if (password !== confirmation) throw new Error('As senhas não coincidem.');
    const result = await provisionOwner(db, input, password);
    console.log(`Proprietário criado: usuário ${result.userId}, empresa ${result.companyId}.`);
  } finally { await db.end(); }
}
main().catch(err => { console.error('Proprietário não criado:', err.code || err.message); process.exitCode = 1; });
