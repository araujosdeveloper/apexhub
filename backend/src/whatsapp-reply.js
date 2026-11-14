'use strict';

const { createDecipheriv } = require('node:crypto');
const { withConversationLock } = require('./whatsapp-lock');
const { handleCart } = require('./whatsapp-cart');
const { configuredDomain, tenantSlugFromHost } = require('./public-hosts');
const { loadSubscription, hasSubscriptionFeature, WHATSAPP_AUTOMATION } = require('./subscriptions');

function decryptToken(row, key) {
  const packed = Buffer.from(row.encrypted_token, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(JSON.stringify([String(row.company_id), row.waba_id, row.phone_number_id])));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

async function sendReply(row, token, version, body, fetchGraph) {
  try {
    const response = await fetchGraph(
      'https://graph.facebook.com/' + version + '/' + row.phone_number_id + '/messages',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: row.sender,
          type: 'text',
          text: { body }
        })
      });
    if ([400, 401, 403, 404, 429].includes(response.status)) return ['rejected', null];
    if (!response.ok) return ['uncertain', null];
    const id = (await response.json()).messages?.[0]?.id;
    return typeof id === 'string' && id.length > 0 && id.length <= 255
      ? ['accepted', id] : ['uncertain', null];
  } catch {
    return ['uncertain', null];
  }
}

async function processInitialReplies(db, { companyId, sender, key, version, fetchGraph = fetch, placeOrder, activeOnly = false }) {
  const [rows] = await db.execute(
    `SELECT i.id, i.company_id, i.phone_number_id, i.sender, i.body, w.waba_id, w.encrypted_token, c.slug
       FROM company_whatsapp_inbox i
       JOIN company_whatsapp_connections w ON w.company_id = i.company_id AND w.phone_number_id = i.phone_number_id
       JOIN companies c ON c.id = i.company_id AND c.active = 1
       LEFT JOIN whatsapp_handoffs h ON h.company_id = i.company_id AND h.phone_number_id = i.phone_number_id AND h.sender = i.sender
       LEFT JOIN whatsapp_initial_replies r ON r.inbox_id = i.id
       WHERE i.company_id = ? AND i.sender = ? AND i.message_type = 'text'
         AND i.body IS NOT NULL
         ${activeOnly ? 'AND w.automation_enabled = 1 AND i.received_at > w.enabled_at' : ''}
         AND (h.state IS NULL OR (h.state = 'bot' AND i.id > h.skip_through))
         ${placeOrder ? '' : "AND LOWER(TRIM(i.body)) IN ('oi', 'olá', 'ola', 'cardápio', 'cardapio', 'menu')"}
         AND i.received_at >= CURRENT_TIMESTAMP - INTERVAL 2 MINUTE AND r.inbox_id IS NULL
       ORDER BY i.id LIMIT 10`, [companyId, sender]);

  for (const row of rows) {
    const subscription = await loadSubscription(db, row.company_id);
    if (!hasSubscriptionFeature(subscription, WHATSAPP_AUTOMATION)) continue;
    const host = row.slug + '.' + configuredDomain();
    if (tenantSlugFromHost(host) !== row.slug || !/^[0-9]{1,24}$/.test(row.phone_number_id)) continue;
    if (placeOrder) {
      const [[active]] = await db.execute(`SELECT 1 AS enabled FROM company_whatsapp_connections
        WHERE company_id = ? AND phone_number_id = ? AND BINARY encrypted_token = ? AND (automation_enabled = 1 OR (? = 0 AND enabled_at IS NULL))`,
      [row.company_id, row.phone_number_id, row.encrypted_token, Number(activeOnly)]);
      if (!active) break;
    }
    let token;
    try { token = decryptToken(row, key); }
    catch { continue; }
    try {
      await db.execute("INSERT INTO whatsapp_initial_replies (inbox_id, state) VALUES (?, 'uncertain')", [row.id]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') continue;
      throw error;
    }
    const link = 'https://' + host + '/';
    let body = 'Olá! Veja o cardápio e faça seu pedido aqui: ' + link;
    const handoff = placeOrder && /^(atendente|(?:quero )?falar com (?:um )?atendente)[.! ]*$/iu.test(row.body.trim());
    if (handoff) {
      await db.execute(`INSERT INTO whatsapp_handoffs (company_id, phone_number_id, sender, state)
        VALUES (?, ?, ?, 'waiting') ON DUPLICATE KEY UPDATE state = 'waiting', actor_id = NULL`,
      [row.company_id, row.phone_number_id, row.sender]);
      body = 'Solicitei atendimento da equipe. Seu carrinho ficou salvo.';
    } else if (placeOrder) {
      try {
        body = await handleCart(db, row, placeOrder, link);
      } catch (error) {
        body = error.code ? 'Não consegui atualizar o pedido. Tente novamente.' : error.message;
      }
    }
    if (body.length > 4096) body = 'O resumo é longo demais. Remova uma linha ou consulte o cardápio: ' + link;
    const [state, id] = await sendReply(row, token, version, body, fetchGraph);
    await db.execute('UPDATE whatsapp_initial_replies SET state = ?, provider_message_id = ? WHERE inbox_id = ?',
      [state, id, row.id]);
    if (handoff) break;
  }
}

function startWhatsAppReplies(db, env = process.env, placeOrder) {
  const { WHATSAPP_REPLY_PILOT_COMPANY_ID: companyId, WHATSAPP_REPLY_PILOT_SENDER: sender,
    WHATSAPP_CONNECTION_KEY: hexKey, WHATSAPP_META_GRAPH_VERSION: version } = env;
  if (!/^[a-f0-9]{64}$/i.test(hexKey || '') || !/^v[0-9]+\.[0-9]+$/.test(version || '')) return () => {};

  const pilot = /^[1-9][0-9]{0,9}$/.test(companyId || '') && /^[0-9]{6,20}$/.test(sender || '');
  const options = { version, key: Buffer.from(hexKey, 'hex'), placeOrder };
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const [conversations] = await db.execute(`SELECT i.company_id, i.sender, MIN(i.id) AS first_id
        FROM company_whatsapp_inbox i JOIN company_whatsapp_connections w
          ON w.company_id = i.company_id AND w.phone_number_id = i.phone_number_id
        JOIN companies c ON c.id = i.company_id AND c.active = 1
        LEFT JOIN whatsapp_handoffs h ON h.company_id = i.company_id AND h.phone_number_id = i.phone_number_id AND h.sender = i.sender
        LEFT JOIN whatsapp_initial_replies r ON r.inbox_id = i.id
        WHERE i.received_at >= CURRENT_TIMESTAMP - INTERVAL 2 MINUTE AND i.message_type = 'text'
          AND i.body IS NOT NULL AND r.inbox_id IS NULL
          AND (h.state IS NULL OR (h.state = 'bot' AND i.id > h.skip_through))
          AND ((w.automation_enabled = 1 AND i.received_at > w.enabled_at)
               OR (w.enabled_at IS NULL AND ? = 1 AND i.company_id = ? AND i.sender = ?))
        GROUP BY i.company_id, i.sender ORDER BY first_id LIMIT 20`, [Number(pilot), companyId || 0, sender || '']);
      for (const conversation of conversations) {
        const activeOnly = !(pilot && String(conversation.company_id) === companyId && conversation.sender === sender);
        await withConversationLock(db, conversation.company_id, conversation.sender, conn => processInitialReplies(conn, {
          ...options, companyId: conversation.company_id, sender: conversation.sender, activeOnly
        }));
      }
    } catch {
      console.error('Falha ao processar respostas iniciais do WhatsApp.');
    } finally {
      running = false;
    }
  }, 5000);
  return () => clearInterval(timer);
}

module.exports = { sendReply, decryptToken, processInitialReplies, startWhatsAppReplies };
