const { hashPassword } = require('./security');
function validateOwner({ companyId, slug, name, email }) {
  if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof slug !== 'string' || !slug || slug.length > 80 ||
      typeof name !== 'string' || !name.trim() || name.length > 120 || typeof email !== 'string' ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe ID, slug, nome e e-mail válidos.');
}
async function inspectOwner(conn, input, lock = false) {
  validateOwner(input);
  const [companies] = await conn.execute(`SELECT id, name, slug, active FROM companies WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [input.companyId]);
  const company = companies[0];
  if (!company || company.slug !== input.slug || Number(company.active) !== 1) throw new Error('Empresa ausente, inativa ou slug diferente do confirmado.');
  const [users] = await conn.execute("SELECT id FROM users WHERE company_id = ? AND role = 'owner'", [input.companyId]);
  if (users.length) throw new Error('A empresa já possui proprietário; nenhuma conta foi alterada.');
  const [emails] = await conn.execute('SELECT id FROM users WHERE email = ?', [input.email.trim().toLowerCase()]);
  if (emails.length) throw new Error('E-mail já cadastrado; nenhuma conta foi alterada.');
  return company;
}
async function provisionOwner(pool, input, password) {
  validateOwner(input);
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('A senha deve ter de 12 a 128 caracteres.');
  const encoded = await hashPassword(password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const company = await inspectOwner(conn, input, true);
    const [result] = await conn.execute("INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'owner')", [input.companyId, input.name.trim(), input.email.trim().toLowerCase(), encoded]);
    await conn.commit();
    return { userId: result.insertId, companyId: company.id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}
module.exports = { inspectOwner, provisionOwner };
