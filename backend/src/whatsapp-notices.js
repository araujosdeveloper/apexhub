'use strict';

const { decryptToken, sendReply } = require('./whatsapp-reply');
const { configuredDomain } = require('./public-hosts');
const { loadSubscription, hasSubscriptionFeature, WHATSAPP_AUTOMATION } = require('./subscriptions');

const kinds = ['preparing', 'ready', 'delivering', 'cancelled'];
const labels = { preparing: 'em preparo', ready: 'pronto para retirada', delivering: 'saiu para entrega', cancelled: 'cancelado' };
const sender = input => {
  const digits = String(input || '').replace(/\D/g, '');
  return /^55[1-9][0-9]{9,10}$/.test(digits) ? digits :
    /^[1-9][0-9]{9,10}$/.test(digits) ? '55' + digits : null;
};
const enabled = (env = process.env) => env.WHATSAPP_ORDER_NOTICES === 'true';

async function grantNoticeConsent(conn, companyId, orderId) {
  await conn.execute("INSERT INTO whatsapp_order_notices (company_id, order_id, kind, state) VALUES (?, ?, 'consent', 'suppressed')",
    [companyId, orderId]);
}

async function updateWithNotice(db, sql, params, { companyId, orderId, target }, active = enabled()) {
  if (!active || !kinds.includes(target)) return db.execute(sql, params);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await conn.execute(sql, params);
    if (result[0].affectedRows) {
      await conn.execute(`INSERT INTO whatsapp_order_notices (company_id, order_id, kind, state)
        SELECT o.company_id, o.id, ?, 'queued' FROM orders o JOIN whatsapp_order_notices consent
          ON consent.company_id = o.company_id AND consent.order_id = o.id AND consent.kind = 'consent'
        WHERE o.company_id = ? AND o.id = ?
          AND (? <> 'ready' OR o.fulfillment_method = 'pickup')
          AND (? <> 'delivering' OR o.fulfillment_method = 'delivery')
        ON DUPLICATE KEY UPDATE id = whatsapp_order_notices.id`, [target, companyId, orderId, target, target]);
    }
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function applyNoticeStatus(db, { companyId, phoneId, status }) {
  if (!['delivered', 'read', 'failed'].includes(status?.status) ||
      typeof status.id !== 'string' || !/^[!-~]{1,255}$/.test(status.id)) return;
  const noticeId = typeof status.biz_opaque_callback_data === 'string' && /^notice:[1-9][0-9]{0,19}$/.test(status.biz_opaque_callback_data)
    ? status.biz_opaque_callback_data.slice(7) : null;
  const delivered = status.status !== 'failed';
  await db.execute(`UPDATE whatsapp_order_notices SET state = ?, provider_message_id = ?
    WHERE company_id = ? AND phone_number_id = ? AND
      (provider_message_id = ? OR (id = ? AND provider_message_id IS NULL))
      AND state IN (${delivered ? "'uncertain','accepted','rejected'" : "'uncertain','accepted'"})`,
  [delivered ? 'delivered' : 'rejected', status.id, companyId, phoneId, status.id, noticeId]);
}

async function processNotices(db, { version, key, template, language, fetchGraph = fetch }) {
  const [rows] = await db.execute(`SELECT n.id, n.company_id, n.kind, n.order_id,
      o.status, o.customer_phone, c.name, c.active, w.waba_id, w.phone_number_id,
      w.encrypted_token, w.automation_enabled, t.token AS tracking
    FROM whatsapp_order_notices n JOIN orders o ON o.id = n.order_id AND o.company_id = n.company_id
    JOIN companies c ON c.id = n.company_id
    LEFT JOIN company_whatsapp_connections w ON w.company_id = n.company_id
    LEFT JOIN order_tracking t ON t.order_id = n.order_id
    WHERE n.state = 'queued' ORDER BY n.id LIMIT 20`);
  for (const row of rows) {
    const to = sender(row.customer_phone);
    const subscription = await loadSubscription(db, row.company_id);
    const valid = to && row.active && Number(row.automation_enabled) === 1 &&
      hasSubscriptionFeature(subscription, WHATSAPP_AUTOMATION) && row.status === row.kind &&
      /^[a-f0-9]{64}$/.test(row.tracking || '') && /^[0-9]{1,24}$/.test(row.phone_number_id || '');
    const [[optout]] = valid ? await db.execute(
      'SELECT 1 FROM whatsapp_notice_optouts WHERE company_id = ? AND sender = ?', [row.company_id, to]) : [[]];
    if (!valid || optout) {
      await db.execute("UPDATE whatsapp_order_notices SET state = 'suppressed' WHERE id = ? AND state = 'queued'", [row.id]);
      continue;
    }
    let token;
    try { token = decryptToken(row, key); }
    catch {
      await db.execute("UPDATE whatsapp_order_notices SET state = 'rejected' WHERE id = ? AND state = 'queued'", [row.id]);
      continue;
    }
    const [claimed] = await db.execute(`UPDATE whatsapp_order_notices n
      JOIN orders o ON o.id = n.order_id AND o.company_id = n.company_id
      JOIN company_whatsapp_connections w ON w.company_id = n.company_id
      LEFT JOIN whatsapp_notice_optouts s ON s.company_id = n.company_id AND s.sender = ?
      SET n.state = 'uncertain', n.phone_number_id = w.phone_number_id
      WHERE n.id = ? AND n.state = 'queued' AND o.status = n.kind AND w.automation_enabled = 1
        AND w.phone_number_id = ? AND BINARY w.encrypted_token = ? AND s.sender IS NULL`,
    [to, row.id, row.phone_number_id, row.encrypted_token]);
    if (!claimed.affectedRows) continue;
    const link = 'https://' + configuredDomain() + '/track.html#' + row.tracking;
    const [state, providerId] = await sendReply({ ...row, sender: to }, token, version, null, fetchGraph, {
      type: 'template', biz_opaque_callback_data: 'notice:' + row.id,
      template: { name: template, language: { code: language }, components: [{
        type: 'body', parameters: [row.name, String(row.order_id), labels[row.kind], link].map(text => ({ type: 'text', text }))
      }] }
    });
    await db.execute("UPDATE whatsapp_order_notices SET state = ?, provider_message_id = ? WHERE id = ? AND state = 'uncertain'",
      [state, providerId, row.id]);
  }
}

function startWhatsAppNotices(db, env = process.env) {
  const version = env.WHATSAPP_META_GRAPH_VERSION || '';
  const hex = env.WHATSAPP_CONNECTION_KEY || '';
  const template = env.WHATSAPP_ORDER_NOTICE_TEMPLATE || '';
  const language = env.WHATSAPP_ORDER_NOTICE_LANGUAGE || 'pt_BR';
  if (!enabled(env) || !/^v[0-9]+\.[0-9]+$/.test(version) || !/^[a-f0-9]{64}$/i.test(hex) ||
      !/^[a-z][a-z0-9_]{0,127}$/.test(template) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) return () => {};
  let processing = false;
  const timer = setInterval(async () => {
    if (processing) return;
    processing = true;
    try { await processNotices(db, { version, key: Buffer.from(hex, 'hex'), template, language }); }
    catch { console.error('Falha ao processar avisos WhatsApp.'); }
    finally { processing = false; }
  }, 5000);
  return () => clearInterval(timer);
}

module.exports = { enabled, sender, grantNoticeConsent, updateWithNotice, applyNoticeStatus, processNotices, startWhatsAppNotices };
