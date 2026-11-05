// Conta exclusiva, criada no MySQL novo pelo entrypoint oficial.
async function restrictReleaseUser(db) {
  const [[settings]] = await db.query('SELECT @@partial_revokes AS partial_revokes');
  // Sem partial_revokes, _ e % têm significado de wildcard em GRANT.
  const schema = Number(settings.partial_revokes) ? 'delivery_live_db' : 'delivery\\_live\\_db';
  // Revogação por conta funciona mesmo que o grant inicial use underscores escapados.
  await db.query("REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'delivery_app'@'%'");
  await db.query("GRANT SELECT, INSERT, UPDATE, DELETE ON `" + schema + "`.* TO 'delivery_app'@'%'");
  const [rows] = await db.query("SHOW GRANTS FOR 'delivery_app'@'%'");
  const grants = rows.map(row => String(Object.values(row)[0])
    .replace(/ TO (?:'delivery_app'@'%'|`delivery_app`@`%`)$/, '')
    .replace(/\\{2}/g, '\\'));
  const usage = 'GRANT USAGE ON *.*';
  const dml = 'GRANT SELECT, INSERT, UPDATE, DELETE ON `' + schema + '`.*';
  if (grants.length !== 2 || !grants.includes(usage) || !grants.includes(dml)) {
    throw new Error('Permissões efetivas da aplicação diferem das quatro permissões esperadas. Não publicar.');
  }
}
module.exports = { restrictReleaseUser };
