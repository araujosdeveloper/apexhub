const { hashPassword, verifyPassword, sessionToken, tokenHash } = require('./security');
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const cookieName = 'delivery_session';
function cookieToken(req) {
  const part = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`));
  const token = part?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
async function sessionUser(db, req) {
  const token = cookieToken(req);
  if (!token) return null;
  const [rows] = await db.execute(`SELECT u.id, u.company_id, u.name, u.email, u.role, c.name AS company_name, c.slug
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = 1 AND c.active = 1`, [tokenHash(token)]);
  return rows[0] || null;
}
function installAuth(app, db, { secureCookies = false } = {}) {
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/', maxAge: 7 * 86400000 };
  const attempts = new Map();
  const limiter = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60000 };
    entry.count++;
    attempts.set(req.ip, entry);
    if (entry.count > 30) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    next();
  };
  async function persistSession(userId, executor = db) {
    const token = sessionToken();
    await executor.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))', [tokenHash(token), userId]);
    return token;
  }
  async function createSession(res,userId) { res.cookie(cookieName,await persistSession(userId),cookieOptions); }
  const authenticate = asyncRoute(async (req, res, next) => {
    const token = cookieToken(req);
    if (!token) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    const user = await sessionUser(db, req);
    if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    req.user = user;
    next();
  });
  app.post('/api/auth/register', limiter, asyncRoute(async (req, res) => {
    const { name, email, password, company_name, slug } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || typeof company_name !== 'string' || !company_name.trim() || company_name.length > 160 ||
        typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < 12 || password.length > 128 ||
        typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 80) {
      return res.status(400).json({ error: 'Informe nome, restaurante, e-mail válido, senha de 12 a 128 caracteres e endereço da loja de 3 a 80 caracteres (letras minúsculas, números e hífens).' });
    }
    const passwordHash = await hashPassword(password);
    const conn = await db.getConnection();
    let userId;
    try {
      await conn.beginTransaction();
      const [company] = await conn.execute('INSERT INTO companies (name, slug, active) VALUES (?, ?, 1)', [company_name.trim(), slug]);
      const [user] = await conn.execute("INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'owner')", [company.insertId, name.trim(), email.trim().toLowerCase(), passwordHash]);
      userId = user.insertId;
      await conn.execute("INSERT INTO subscriptions (company_id, plan_code, status, trial_ends_at) VALUES (?, 'starter', 'trialing', DATE_ADD(NOW(), INTERVAL 14 DAY))", [company.insertId]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'E-mail ou endereço da loja já cadastrado.' });
      throw err;
    } finally { conn.release(); }
    await createSession(res, userId);
    res.status(201).json({ success: true });
  }));
  app.post('/api/auth/login', limiter, asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Informe e-mail e senha.' });
    const [users] = await db.execute('SELECT u.id, u.password_hash FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ? AND u.active = 1 AND c.active = 1', [email.trim().toLowerCase()]);
    // Executa scrypt também para contas inexistentes, reduzindo diferenças de tempo.
    const dummy = `scrypt:00000000000000000000000000000000:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, users[0]?.password_hash || dummy);
    if (!users.length || !valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    // Serializa criação da sessão com bloqueio/redefinição de senha da equipe.
    const conn=await db.getConnection();let token;
    try {
      await conn.beginTransaction();
      const [[current]]=await conn.execute('SELECT u.id,u.password_hash FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND u.email=? AND u.active=1 AND c.active=1 FOR UPDATE',[users[0].id,email.trim().toLowerCase()]);
      if(!current||current.password_hash!==users[0].password_hash){await conn.rollback();return res.status(401).json({error:'E-mail ou senha incorretos.'});}
      token=await persistSession(current.id,conn);await conn.commit();
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
    res.cookie(cookieName,token,cookieOptions);res.json({ success: true });
  }));
  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    const token = cookieToken(req);
    if (token) await db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json({ success: true });
  }));
  return authenticate;
}
module.exports = { installAuth, asyncRoute, sessionUser };
