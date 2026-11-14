'use strict';

const { createHash } = require('node:crypto');

async function withConversationLock(db, companyId, sender, work) {
  const lock = createHash('sha256').update('whatsapp-cart:' + companyId + ':' + sender).digest('hex');
  const conn = await db.getConnection();
  let reusable = true;
  try {
    const [[result]] = await conn.execute('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
    if (Number(result.acquired) !== 1) return null;
    try {
      return await work(conn);
    } finally {
      const [[release]] = await conn.execute('SELECT RELEASE_LOCK(?) AS released', [lock]);
      if (Number(release.released) !== 1) reusable = false;
    }
  } catch (error) {
    reusable = false;
    throw error;
  } finally {
    if (reusable) conn.release();
    else conn.destroy();
  }
}

module.exports = { withConversationLock };
