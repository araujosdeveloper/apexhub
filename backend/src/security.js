const { randomBytes, scrypt: derive, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(derive);
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = String(encoded).split(':');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
function sessionToken() { return randomBytes(32).toString('hex'); }
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
module.exports = { hashPassword, verifyPassword, sessionToken, tokenHash };
