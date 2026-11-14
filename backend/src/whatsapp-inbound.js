'use strict';

const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { asyncRoute } = require('./auth');
const { loadSubscription, hasSubscriptionFeature, WHATSAPP_AUTOMATION } = require('./subscriptions');

const endpoint = '/api/webhooks/whatsapp';

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifiedEvent(body, signature, secret) {
  if (!Buffer.isBuffer(body) || !secret) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return sameSecret(signature, expected);
}

const asList = value => Array.isArray(value) ? value : [];
const metaId = value => typeof value === 'string' && /^[0-9]{1,24}$/.test(value);

async function receive(db, event) {
  if (event?.object !== 'whatsapp_business_account') return;
  for (const entry of asList(event.entry)) {
    if (!metaId(entry?.id)) continue;
    for (const change of asList(entry.changes)) {
      const phoneId = change?.value?.metadata?.phone_number_id;
      const messages = asList(change?.value?.messages);
      if (change?.field !== 'messages' || !metaId(phoneId) || !messages.length) continue;

      const [[connection]] = await db.execute(
        `SELECT w.company_id FROM company_whatsapp_connections w
         JOIN companies c ON c.id = w.company_id AND c.active = 1
         WHERE w.waba_id = ? AND w.phone_number_id = ?`, [entry.id, phoneId]);
      if (!connection) continue;
      const subscription = await loadSubscription(db, connection.company_id);
      if (!hasSubscriptionFeature(subscription, WHATSAPP_AUTOMATION)) continue;

      for (const message of messages) {
        if (typeof message?.id !== 'string' || !/^[!-~]{1,255}$/.test(message.id) ||
            typeof message.from !== 'string' || !/^[0-9]{6,20}$/.test(message.from)) continue;
        const type = typeof message.type === 'string' && /^[a-z_]{1,32}$/.test(message.type)
          ? message.type : 'unknown';
        const body = type === 'text' && typeof message.text?.body === 'string'
          ? [...message.text.body].slice(0, 4096).join('') : null;

        await db.execute(
          `INSERT INTO company_whatsapp_inbox
           (company_id, phone_number_id, message_id, sender, message_type, body)
           SELECT w.company_id, w.phone_number_id, ?, ?, ?, ?
           FROM company_whatsapp_connections w JOIN companies c ON c.id = w.company_id AND c.active = 1
           WHERE w.company_id = ? AND w.waba_id = ? AND w.phone_number_id = ?
           ON DUPLICATE KEY UPDATE message_id = company_whatsapp_inbox.message_id`,
          [message.id, message.from, type, body, connection.company_id, entry.id, phoneId]);
      }
    }
  }
}

function installWhatsAppInbound(app, db, { env = process.env } = {}) {
  const secret = env.WHATSAPP_META_APP_SECRET;
  const verifyToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const configured = Boolean(secret && verifyToken);

  app.get(endpoint, (req, res) => {
    if (!configured) return res.sendStatus(503);
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode !== 'subscribe' || !sameSecret(token, verifyToken) ||
        typeof challenge !== 'string' || !/^[0-9]{1,64}$/.test(challenge)) return res.sendStatus(403);
    res.type('text/plain').send(challenge);
  });

  app.post(endpoint, express.raw({ type: 'application/json', limit: '1mb', inflate: false }),
    asyncRoute(async (req, res) => {
      if (!configured) return res.sendStatus(503);
      if (!verifiedEvent(req.body, req.get('X-Hub-Signature-256'), secret)) return res.sendStatus(403);
      let event;
      try {
        event = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.sendStatus(400);
      }
      try {
        await receive(db, event);
      } catch {
        // Uma falha transitória pede reentrega. Evita registrar corpos e telefones.
        return res.sendStatus(503);
      }
      res.sendStatus(200);
    }));
}

module.exports = { installWhatsAppInbound };
