'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  WHATSAPP_AUTOMATION, subscriptionState, hasSubscriptionFeature, checkSubscription
} = require('../src/subscriptions');

test('WhatsApp: só libera Pro ativo ou teste válido', () => {
  const allowed = row => hasSubscriptionFeature(subscriptionState(row), WHATSAPP_AUTOMATION);

  assert.equal(allowed({ plan_code: 'pro', status: 'active' }), true);
  assert.equal(allowed({ plan_code: 'trial', status: 'trialing', trial_valid: 1 }), true);
  assert.equal(allowed({ plan_code: 'essencial', status: 'active' }), false);
  assert.equal(allowed({ plan_code: 'trial', status: 'trialing', trial_valid: 0 }), false);
  assert.equal(allowed({ plan_code: 'pro', status: 'cancelled' }), false);
  assert.equal(allowed(null), false);
});

test('WhatsApp: a rota consulta o plano da empresa em cada ação e bloqueia após rebaixamento', async () => {
  let planCode = 'pro';
  const db = {
    async execute(_query, params) {
      assert.deepEqual(params, [42]);
      return [[{ plan_code: planCode, status: 'active' }]];
    }
  };
  const gate = checkSubscription(db, WHATSAPP_AUTOMATION);
  const request = { tenantId: 42 };
  let calls = 0;
  const response = {
    status(code) {
      assert.equal(code, 402);
      return this;
    },
    json(body) {
      assert.equal(body.code, 'plan_upgrade_required');
      assert.equal(body.data.feature, WHATSAPP_AUTOMATION);
    }
  };
  const next = error => {
    assert.ifError(error);
    calls++;
  };

  await gate(request, response, next);
  assert.equal(calls, 1);

  planCode = 'essencial';
  await gate(request, response, next);
  assert.equal(calls, 1);
});
