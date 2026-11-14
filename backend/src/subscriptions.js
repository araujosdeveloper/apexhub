'use strict';

const { asyncRoute } = require('./auth');
const { requireRoles } = require('./middlewares/auth');

const WHATSAPP_AUTOMATION = 'whatsapp_automation';

const FEATURES = Object.freeze({
  trial: ['ai_menu_import', 'coupons', 'automations', 'kds', WHATSAPP_AUTOMATION],
  essencial: ['kds'],
  pro: ['ai_menu_import', 'coupons', 'automations', 'kds', WHATSAPP_AUTOMATION]
});

function normalizePlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  if (['trial', 'trialing'].includes(plan)) return 'trial';
  if (['pro', 'professional'].includes(plan)) return 'pro';
  // Compatibilidade com os planos legados: starter/legacy têm acesso básico.
  return 'essencial';
}

function subscriptionState(row) {
  if (!row) return { plan_type: 'trial', status: 'missing', trial_ends_at: null, trial_valid: false, access_state: 'inactive' };
  const plan_type = String(row.plan_code).toLowerCase() === 'starter' && row.status === 'trialing' ? 'trial' : normalizePlan(row.plan_code);
  const trial_valid = plan_type === 'trial' && row.status === 'trialing' && Number(row.trial_valid) === 1;
  const active = plan_type === 'trial' ? trial_valid : row.status === 'active' || (row.status === 'legacy' && String(row.plan_code).toLowerCase() === 'legacy');
  return {
    plan_type,
    status: row.status,
    trial_ends_at: row.trial_ends_at || null,
    trial_valid,
    access_state: active ? (plan_type === 'trial' ? 'trial' : 'active') : (plan_type === 'trial' ? 'trial_expired' : 'inactive'),
    features: active ? FEATURES[plan_type] : []
  };
}

async function loadSubscription(db, companyId) {
  const [rows] = await db.execute(`SELECT plan_code, status, trial_ends_at,
    (trial_ends_at IS NOT NULL AND trial_ends_at > UTC_TIMESTAMP()) AS trial_valid
    FROM subscriptions WHERE company_id = ? LIMIT 1`, [companyId]);
  return subscriptionState(rows[0]);
}

function hasSubscriptionFeature(subscription, feature) {
  return subscription.features?.includes(feature) === true;
}

function subscriptionRequired(res, subscription, feature) {
  const message = subscription.access_state === 'trial_expired'
    ? 'Seu período de teste terminou. Escolha um plano para continuar usando o painel.'
    : subscription.plan_type === 'essencial'
      ? 'Este recurso faz parte do plano Pro. Conheça os planos disponíveis.'
      : 'A assinatura desta loja precisa ser ativada para acessar este recurso.';
  return res.status(402).json({
    success: false,
    code: subscription.access_state === 'trial_expired' ? 'trial_expired' : 'plan_upgrade_required',
    error: message,
    data: { plan_type: subscription.plan_type, feature, subscription },
    redirect_url: '/plans.html'
  });
}

function checkSubscription(db, feature) {
  if (!Object.values(FEATURES).some(items => items.includes(feature))) {
    throw new Error('Recurso de assinatura desconhecido.');
  }
  return asyncRoute(async (req, res, next) => {
    const subscription = await loadSubscription(db, req.tenantId);
    req.subscription = subscription;
    if (!hasSubscriptionFeature(subscription, feature)) return subscriptionRequired(res, subscription, feature);
    next();
  });
}

function installSubscriptions(app, db, auth) {
  app.get('/api/tenant/subscription', auth, requireRoles('tenant_owner', 'tenant_manager', 'tenant_operator'), asyncRoute(async (req, res) => {
    const subscription = await loadSubscription(db, req.tenantId);
    const [requests] = await db.execute("SELECT plan_code, status, created_at FROM subscription_plan_requests WHERE company_id = ? LIMIT 1", [req.tenantId]);
    res.json({ success: true, subscription, plans: [
      { plan_type: 'essencial', features: FEATURES.essencial },
      { plan_type: 'pro', features: FEATURES.pro }
    ], plan_request: requests[0] || null });
  }));
  app.post('/api/tenant/subscription/choose', auth, requireRoles('tenant_owner'), asyncRoute(async (req, res) => {
    const plan = req.body?.plan_type;
    if (!['essencial', 'pro'].includes(plan)) return res.status(400).json({ success: false, error: 'Escolha o plano Essencial ou Pro.' });
    await db.execute(`INSERT INTO subscription_plan_requests (company_id, plan_code, status)
      VALUES (?, ?, 'pending') ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code), status = 'pending', updated_at = CURRENT_TIMESTAMP`, [req.tenantId, plan]);
    res.status(201).json({ success: true, message: 'Solicitação registrada. O acesso ao plano será liberado após a ativação da assinatura.', plan_request: { plan_code: plan, status: 'pending' } });
  }));
}

module.exports = {
  FEATURES, WHATSAPP_AUTOMATION, normalizePlan, subscriptionState,
  loadSubscription, hasSubscriptionFeature, checkSubscription, installSubscriptions
};
