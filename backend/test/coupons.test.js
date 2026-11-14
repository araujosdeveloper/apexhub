const { test } = require('node:test');
const assert = require('node:assert/strict');
const { couponCode, phoneKey, validateCoupon, couponDiscount, evaluateCoupon, tenantCouponConfig } = require('../src/coupons');
const { serve } = require('../test-support/http');
const config = overrides => ({ active: true, first_purchase: false, kind: 'fixed', value: '5.00', min_subtotal: '0.00', max_discount: null, total_limit: null, per_customer_limit: null, starts_at: null, ends_at: null, ...overrides });
test('códigos e telefones são normalizados; configuração e validade inválidas são rejeitadas', () => {
  assert.equal(couponCode(' bemvindo10 '), 'BEMVINDO10');
  for (const phone of ['(11) 99999-9999','11999999999','+55 (11) 99999-9999','5511999999999']) assert.equal(phoneKey(phone), '5511999999999');
  assert.equal(phoneKey('telefone'), null);
  for (const value of ['x','<script>',null]) assert.throws(() => couponCode(value));
  for (const change of [{ value: '-1.00' }, { kind: 'percent', value: '100.01' }, { per_customer_limit: 0 }, { total_limit: 1.5 }, { starts_at: '2026-02-31T10:00:00Z' }, { starts_at: '2026-11-04T12:00:00Z', ends_at: '2026-11-04T11:00:00Z' }, { kind: 'free_delivery', value: '1.00' }]) assert.throws(() => validateCoupon(config(change)));
});
test('contrato de cupom tenant adapta percentage/fixed e rejeita valores ou limites inválidos', () => {
 const percent = tenantCouponConfig({ discount_type: 'percentage', discount_value: '10', min_order_amount: '25.00', expires_at: '2026-12-01', usage_limit: 20, is_active: true });
 assert.equal(percent.kind, 'percent'); assert.equal(percent.value, '10.00'); assert.equal(percent.min_subtotal, '25.00'); assert.equal(percent.ends_at, '2026-12-01T23:59:59.999Z'); assert.equal(percent.total_limit, 20);
 const fixed = tenantCouponConfig({ discount_type: 'fixed', discount_value: 5, is_active: false });
 assert.equal(fixed.kind, 'fixed'); assert.equal(fixed.value, '5.00'); assert.equal(fixed.min_subtotal, '0.00'); assert.equal(fixed.active, false);
 assert.throws(() => tenantCouponConfig({ discount_type: 'percentage', discount_value: '110', usage_limit: 0 }));
});
test('desconto fixo/percentual nunca ultrapassa os produtos; frete grátis cobre somente frete', () => {
  assert.equal(couponDiscount(validateCoupon(config({ value: '50.00' })), 1235, 450, 'delivery'), 1235);
  assert.equal(couponDiscount(validateCoupon(config({ kind: 'percent', value: '12.50' })), 1235, 450, 'delivery'), 154);
  assert.equal(couponDiscount(validateCoupon(config({ kind: 'percent', value: '50.00' })), 101, 0, 'pickup'), 51);
  assert.equal(couponDiscount(validateCoupon(config({ kind: 'percent', value: '100.00', max_discount: '3.00' })), 1235, 450, 'delivery'), 300);
  const free = validateCoupon(config({ kind: 'free_delivery', value: '0.00' }));
  assert.equal(couponDiscount(free, 1235, 450, 'delivery'), 450);
  assert.throws(() => couponDiscount(free, 1235, 0, 'delivery'), /não gera/);
  assert.throws(() => couponDiscount(free, 1235, 450, 'pickup'), /exclusivo/);
});
test('mínimo exclui frete e validade tem início inclusivo e término exclusivo', () => {
  const bounded = validateCoupon(config({ min_subtotal: '20.00', starts_at: '2026-11-04T10:00:00Z', ends_at: '2026-11-04T11:00:00Z' }));
  assert.throws(() => couponDiscount(bounded, 1500, 1000, 'delivery', Date.parse('2026-11-04T10:00:00Z')), /mínimo/);
  assert.equal(couponDiscount(bounded, 2000, 0, 'pickup', Date.parse('2026-11-04T10:00:00Z')), 500);
  assert.throws(() => couponDiscount(bounded, 2000, 0, 'pickup', Date.parse('2026-11-04T11:00:00Z')), /expirou/);
  assert.throws(() => couponDiscount({ ...bounded, active: false }, 2000, 0, 'pickup'), /pausado/);
});
test('uso total, por telefone, primeira compra e empresa são conferidos antes de conceder desconto', async () => {
  for (const scenario of ['total','phone','first','foreign','valid']) {
    const calls = [];
    const db = { execute: async (sql, args) => {
      calls.push({ sql, args }); assert.equal(args[0], 7);
      if (sql.includes('FROM company_coupons')) return [scenario === 'foreign' ? [] : [{ id: 3, code: 'TESTE', version: 1, usage_count: scenario === 'total' ? 1 : 0, config: JSON.stringify(config({ total_limit: 1, per_customer_limit: 1, first_purchase: true })) }]];
      if (sql.startsWith('SELECT COUNT')) { assert.equal(args[2], '5511999999999'); return [[{ total: scenario === 'phone' ? 1 : 0 }]]; }
      assert.match(sql, /REGEXP_REPLACE/); assert.deepEqual(args, [7,'5511999999999','5511999999999']); return [scenario === 'first' ? [{ id: 10 }] : []];
    } };
    const evaluate = () => evaluateCoupon(db, { companyId: 7, code: 'TESTE', phone: '(11) 99999-9999', subtotalCents: 1235, deliveryCents: 0, method: 'pickup', lock: true });
    if (scenario !== 'valid') await assert.rejects(evaluate());
    else { const result = await evaluate(); assert.equal(result.discountCents, 500); assert.equal(result.snapshot.code, 'TESTE'); }
    assert.match(calls[0].sql, /FOR UPDATE$/);
  }
});
const headers = { Cookie: 'delivery_session=' + 'a'.repeat(64), 'Content-Type': 'application/json' };
test('cadastro isola por sessão, bloqueia operador e recusa edição desatualizada sem alterar contador', async t => {
  for (const [role, found, version, expected] of [['operator',true,1,403], ['owner',false,1,404], ['owner',true,2,409], ['manager',true,1,200]]) {
    const writes = []; let committed = false, released = false;
    const db = { execute: async sql => sql.includes('FROM sessions s') ? [[{ id: 3, company_id: 7, role }]] : [[{plan_code:'trial',status:'trialing',trial_ends_at:'2026-12-07 00:00:00',trial_valid:1}]], getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => { released = true; }, execute: async (sql, args) => {
      if (sql.startsWith('SELECT id FROM companies')) { assert.deepEqual(args, [7]); return [[{ id: 7 }]]; }
      if (sql.startsWith('SELECT id, code, version')) { assert.deepEqual(args, [9,7]); return [found ? [{ id: 9, code: 'TESTE', version }] : []]; }
      assert.match(sql, /WHERE id = \? AND company_id = \?/); assert.doesNotMatch(sql, /usage_count/); assert.equal(args[2], 7); writes.push(args); return [{}];
    } }) };
    const request = await serve(t, db);
    assert.equal((await request('/api/admin/coupons/9', { method: 'PUT', headers, body: JSON.stringify({ code: 'teste', config: config(), version: 1, company_id: 999, usage_count: 0 }) })).status, expected);
    assert.equal(writes.length, expected === 200 ? 1 : 0); assert.equal(committed, expected === 200); if (role !== 'operator') assert.equal(released, true);
  }
});
test('API tenant lista isolada e cadastra cupom com contrato direto', async t => {
 const calls = [], writes = [];
 const db = { execute: async (sql, args) => {
  calls.push({ sql, args });
  if (sql.includes('FROM sessions s')) return [[{ id: 3, company_id: 7, role: 'owner' }]];
  if (sql.includes('FROM subscriptions WHERE company_id = ?')) return [[{plan_code:'trial',status:'trialing',trial_ends_at:'2026-12-07 00:00:00',trial_valid:1}]];
  if (sql.startsWith('SELECT COUNT(*) AS total FROM company_coupons')) return [[{ total: 0 }]];
  if (sql.startsWith('SELECT id, code, config, version, usage_count FROM company_coupons')) return [[]];
  throw Error(sql);
 }, getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, execute: async (sql, args) => {
  writes.push({ sql, args });
  if (sql.startsWith('SELECT id FROM companies')) return [[{ id: 7 }]];
  if (sql.startsWith('INSERT INTO company_coupons')) return [{ insertId: 19 }];
  throw Error(sql);
 } }) };
 const request = await serve(t, db);
 const listed = await request('/api/tenant/coupons?tenant_id=999', { headers });
 assert.equal(listed.status, 200); assert.equal((await listed.json()).data.total, 0);
 assert.deepEqual(calls.filter(call => !call.sql.includes('sessions')&&!call.sql.includes('subscriptions')).map(call => call.args[0]), [7, 7]);
 const created = await request('/api/tenant/coupons', { method: 'POST', headers, body: JSON.stringify({ code: 'BEBELLA10', discount_type: 'percentage', discount_value: '10.00', min_order_amount: '25.00', expires_at: null, usage_limit: 30, is_active: true, tenant_id: 999 }) });
 assert.equal(created.status, 201); const coupon = (await created.json()).data;
 assert.equal(coupon.tenant_id, 7); assert.equal(coupon.discount_type, 'percentage'); assert.equal(coupon.discount_value, '10.00'); assert.equal(coupon.usage_limit, 30);
 assert.equal(writes[1].args[0], 7); assert.equal(JSON.parse(writes[1].args[2]).kind, 'percent');
 const legacy = await request('/api/admin/coupons', { method: 'POST', headers, body: JSON.stringify({ code: 'LEGADO5', config: config() }) });
 assert.equal(legacy.status, 201); assert.equal((await legacy.json()).id, 19);
});
