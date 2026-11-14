'use strict';

const { createCipheriv, randomBytes } = require('node:crypto');
const { asyncRoute } = require('./auth');
const { requireRoles } = require('./middlewares/auth');
const { checkSubscription, loadSubscription, hasSubscriptionFeature, WHATSAPP_AUTOMATION } = require('./subscriptions');

const endpoint = '/api/tenant/whatsapp-connection';
const metaId = value => typeof value === 'string' && /^[0-9]{1,24}$/.test(value);

function configuration(env) {
  const { WHATSAPP_META_APP_ID: appId, WHATSAPP_META_CONFIG_ID: configId,
    WHATSAPP_META_APP_SECRET: appSecret, WHATSAPP_META_GRAPH_VERSION: version,
    WHATSAPP_CONNECTION_KEY: key } = env;
  if (!metaId(appId) || !metaId(configId) || !appSecret ||
      !/^v[0-9]+\.[0-9]+$/.test(version || '') || !/^[a-f0-9]{64}$/i.test(key || '')) return null;
  return { appId, configId, appSecret, version, key: Buffer.from(key, 'hex') };
}

function encryptToken(token, key, companyId, wabaId, phoneId) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify([String(companyId), wabaId, phoneId])));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}

async function graph(config, path, query, token, fetchGraph) {
  const url = new URL('https://graph.facebook.com/' + config.version + '/' + path);
  url.search = new URLSearchParams(query);
  const response = await fetchGraph(url, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Meta recusou a operação.');
  return response.json();
}

async function verifyConnection(config, { code, wabaId, phoneId }, fetchGraph) {
  const { access_token: token } = await graph(config, 'oauth/access_token', {
    client_id: config.appId, client_secret: config.appSecret, code
  }, null, fetchGraph);
  if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('Token inválido.');
  const appToken = config.appId + '|' + config.appSecret;
  const { data } = await graph(config, 'debug_token', { input_token: token }, appToken, fetchGraph);
  const requiredScopes = ['whatsapp_business_management', 'whatsapp_business_messaging'];
  if (data?.is_valid !== true || String(data.app_id) !== config.appId ||
      !requiredScopes.every(scope => data.scopes?.includes(scope)) ||
      !data.granular_scopes?.some(grant => grant.scope === 'whatsapp_business_management' &&
        grant.target_ids?.includes(wabaId))) throw new Error('Acesso à conta não confirmado.');

  let after;
  for (let page = 0; page < 20; page++) {
    const numbers = await graph(config, wabaId + '/phone_numbers', {
      fields: 'id,display_phone_number', limit: '100', ...(after ? { after } : {})
    }, token, fetchGraph);
    const phone = numbers.data?.find(item => item.id === phoneId);
    if (phone && typeof phone.display_phone_number === 'string' && phone.display_phone_number.length <= 48) {
      return { token, displayPhone: phone.display_phone_number };
    }
    after = numbers.paging?.next && numbers.paging?.cursors?.after;
    if (!after) break;
  }
  throw new Error('Número não pertence à conta autorizada.');
}

function installWhatsAppConnection(app, db, auth, { env = process.env, fetchGraph = fetch } = {}) {
  const config = configuration(env);
  const owner = requireRoles('tenant_owner');
  const directSession = (req, res, next) => {
    if (req.auth.impersonation) return res.status(403).json({ error: 'Entre com a conta do proprietário da loja.' });
    next();
  };

  app.get(endpoint, auth, owner, directSession, asyncRoute(async (req, res) => {
    const [[connection]] = await db.execute(
      'SELECT display_phone, connected_at FROM company_whatsapp_connections WHERE company_id = ?', [req.tenantId]);
    const subscription = await loadSubscription(db, req.tenantId);
    const eligible = hasSubscriptionFeature(subscription, WHATSAPP_AUTOMATION);
    res.json({
      connection: connection || null, eligible,
      signup: config && eligible && !connection ? {
        appId: config.appId, configId: config.configId, version: config.version
      } : null
    });
  }));

  app.post(endpoint, auth, owner, directSession, checkSubscription(db, WHATSAPP_AUTOMATION), asyncRoute(async (req, res) => {
    if (!config) return res.status(503).json({ error: 'Conexão com a Meta indisponível neste ambiente.' });
    const { code, wabaId, phoneId } = req.body || {};
    if (typeof code !== 'string' || !/^[!-~]{1,4096}$/.test(code) || !metaId(wabaId) || !metaId(phoneId)) {
      return res.status(400).json({ error: 'Autorização incompleta. Inicie a conexão novamente.' });
    }
    const [[existing]] = await db.execute(
      'SELECT company_id FROM company_whatsapp_connections WHERE company_id = ? OR phone_number_id = ? LIMIT 1',
      [req.tenantId, phoneId]);
    const duplicate = () => res.status(409).json({ error: 'A loja ou o número já tem uma conexão cadastrada.' });
    if (existing) return duplicate();
    let verified;
    try {
      verified = await verifyConnection(config, { code, wabaId, phoneId }, fetchGraph);
    } catch {
      return res.status(422).json({ error: 'A Meta não confirmou a autorização do número. Reinicie a conexão.' });
    }
    const encrypted = encryptToken(verified.token, config.key, req.tenantId, wabaId, phoneId);
    try {
      await db.execute(`INSERT INTO company_whatsapp_connections
        (company_id, waba_id, phone_number_id, display_phone, encrypted_token, connected_by)
        VALUES (?, ?, ?, ?, ?, ?)`, [req.tenantId, wabaId, phoneId, verified.displayPhone, encrypted, req.user.id]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return duplicate();
      // O erro do driver pode conter parâmetros da consulta.
      throw new Error('Não foi possível gravar a conexão do WhatsApp.');
    }
    res.status(201).json({ connection: { display_phone: verified.displayPhone } });
  }));
}

module.exports = { installWhatsAppConnection };
