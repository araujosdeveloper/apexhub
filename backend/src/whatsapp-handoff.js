'use strict';

const { asyncRoute } = require('./auth');
const { requireRoles } = require('./middlewares/auth');
const { checkSubscription, loadSubscription, hasSubscriptionFeature, WHATSAPP_AUTOMATION } = require('./subscriptions');
const { withConversationLock } = require('./whatsapp-lock');
const { decryptToken, sendReply } = require('./whatsapp-reply');

const endpoint = '/api/tenant/whatsapp-attendance';
const senderFormat = /^[0-9]{6,20}$/;
const scope = 'company_id = ? AND phone_number_id = ? AND sender = ?';

function installWhatsAppHandoff(app, db, auth, { env = process.env, fetchGraph = fetch } = {}) {
  const access = [auth, requireRoles('tenant_owner', 'tenant_manager', 'tenant_operator'),
    (req, res, next) => req.auth.impersonation ? res.sendStatus(403) : next(),
    checkSubscription(db, WHATSAPP_AUTOMATION)];

  app.get(endpoint, ...access, asyncRoute(async (req, res) => {
    const [conversations] = await db.execute(`SELECT h.sender, h.state, h.actor_id, h.updated_at
      FROM whatsapp_handoffs h JOIN company_whatsapp_connections w
      ON w.company_id = h.company_id AND w.phone_number_id = h.phone_number_id
      WHERE h.company_id = ? AND h.state <> 'bot' ORDER BY h.updated_at DESC LIMIT 100`, [req.tenantId]);
    res.json({ conversations, actorId: req.user.id });
  }));

  async function connection(db, companyId) {
    const [[row]] = await db.execute(`SELECT company_id, phone_number_id, waba_id, encrypted_token
      FROM company_whatsapp_connections WHERE company_id = ?`, [companyId]);
    return row;
  }

  app.get(endpoint + '/:sender', ...access, asyncRoute(async (req, res) => {
    const { sender } = req.params;
    if (!senderFormat.test(sender)) return res.sendStatus(400);
    const account = await connection(db, req.tenantId);
    if (!account) return res.sendStatus(404);
    const args = [req.tenantId, account.phone_number_id, sender];
    const [[conversation]] = await db.execute('SELECT state, actor_id FROM whatsapp_handoffs WHERE ' + scope, args);
    if (!conversation) return res.sendStatus(404);
    const [messages] = await db.execute('SELECT body, message_type, received_at FROM company_whatsapp_inbox WHERE ' + scope + ' ORDER BY id DESC LIMIT 50', args);
    const [replies] = await db.execute('SELECT body, state, created_at FROM whatsapp_human_replies WHERE ' + scope + ' ORDER BY created_at DESC LIMIT 50', args);
    const [[cart]] = await db.execute('SELECT items FROM whatsapp_carts WHERE ' + scope + ' AND updated_at >= CURRENT_TIMESTAMP - INTERVAL 1 DAY', args);
    const items = (typeof cart?.items === 'string' ? JSON.parse(cart.items) : cart?.items) || [];
    const ids = [...new Set(items.map(item => item.product_id))];
    if (ids.length) {
      const [products] = await db.execute('SELECT id, name FROM products WHERE company_id = ? AND id IN (' +
        ids.map(() => '?').join(',') + ')', [req.tenantId, ...ids]);
      const names = new Map(products.map(product => [product.id, product.name]));
      for (const item of items) item.product_name = names.get(item.product_id);
    }
    res.json({ conversation, messages, replies, items, actorId: req.user.id });
  }));

  app.post(endpoint + '/:sender', ...access, asyncRoute(async (req, res) => {
    const { sender } = req.params;
    const { action, requestKey } = req.body || {};
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!senderFormat.test(sender) || !['claim', 'resume', 'reply'].includes(action) ||
      (action === 'reply' && (!body || body.length > 4096 || typeof requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestKey)))) return res.sendStatus(400);

    const status = await withConversationLock(db, req.tenantId, sender, async conn => {
      const subscription = await loadSubscription(conn, req.tenantId);
      if (!hasSubscriptionFeature(subscription, WHATSAPP_AUTOMATION)) return { status: 402, error: 'Seu plano não libera o WhatsApp.' };
      const account = await connection(conn, req.tenantId);
      if (!account) return { status: 404, error: 'Número comercial indisponível.' };
      const args = [req.tenantId, account.phone_number_id, sender];
      const [[handoff]] = await conn.execute('SELECT state, actor_id FROM whatsapp_handoffs WHERE ' + scope, args);
      const actor = req.user.id;
      if (!handoff) return { status: 404, error: 'Atendimento não encontrado.' };

      if (action === 'claim' && (handoff.state === 'waiting' || (handoff.state === 'human' && Number(handoff.actor_id) === Number(actor)))) {
        await conn.execute("UPDATE whatsapp_handoffs SET state = 'human', actor_id = ? WHERE " + scope, [actor, ...args]);
        return { status: 200, state: 'human' };
      }
      if (handoff.state !== 'human' || Number(handoff.actor_id) !== Number(actor) || action === 'claim') {
        return { status: 409, error: 'Assuma a conversa antes de responder ou retomar o bot.' };
      }
      if (action === 'resume') {
        const [[last]] = await conn.execute('SELECT COALESCE(MAX(id), 0) AS id FROM company_whatsapp_inbox WHERE ' + scope, args);
        await conn.execute("UPDATE whatsapp_handoffs SET state = 'bot', actor_id = NULL, skip_through = ? WHERE " + scope, [last.id, ...args]);
        return { status: 200, state: 'bot' };
      }
      const [[existing]] = await conn.execute('SELECT body, state FROM whatsapp_human_replies WHERE ' + scope + ' AND request_key = ?', [...args, requestKey]);
      if (existing) return existing.body === body ? { status: 200, state: existing.state } :
        { status: 409, error: 'Este identificador já foi usado em outra mensagem.' };
      const [[recent]] = await conn.execute('SELECT id FROM company_whatsapp_inbox WHERE ' + scope +
        ' AND received_at >= CURRENT_TIMESTAMP - INTERVAL 23 HOUR LIMIT 1', args);
      if (!recent) return { status: 409, error: 'Peça ao cliente que envie uma nova mensagem para retomar o atendimento.' };
      const version = env.WHATSAPP_META_GRAPH_VERSION || '';
      const hex = env.WHATSAPP_CONNECTION_KEY || '';
      if (!/^v[0-9]+\.[0-9]+$/.test(version) || !/^[a-f0-9]{64}$/i.test(hex) || !/^[0-9]{1,24}$/.test(account.phone_number_id)) {
        return { status: 503, error: 'Configuração de envio indisponível.' };
      }
      let token;
      try { token = decryptToken(account, Buffer.from(hex, 'hex')); }
      catch { return { status: 503, error: 'Conexão inválida. Revise a configuração da loja.' }; }
      await conn.execute(`INSERT INTO whatsapp_human_replies
        (company_id, phone_number_id, sender, request_key, actor_id, body, state)
        VALUES (?, ?, ?, ?, ?, ?, 'uncertain')`, [...args, requestKey, actor, body]);
      const [state, providerId] = await sendReply({ ...account, sender }, token, version, body, fetchGraph);
      await conn.execute('UPDATE whatsapp_human_replies SET state = ?, provider_message_id = ? WHERE ' +
        scope + ' AND request_key = ?', [state, providerId, ...args, requestKey]);
      return { status: 200, state };
    });
    if (!status) return res.status(409).json({ error: 'A conversa está em processamento. Tente novamente.' });
    const { status: code, ...result } = status;
    res.status(code).json(result);
  }));
}

module.exports = { installWhatsAppHandoff };
