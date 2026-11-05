const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const configuration = overrides => ({ active: true, first_purchase: false, kind: 'fixed', value: '5.00', min_subtotal: '0.00', max_discount: null, total_limit: null, per_customer_limit: null, starts_at: null, ends_at: null, ...overrides });
async function verifyCoupons(db, request, { a, b, productId, json }) {
  const [[identity]] = await db.query('SELECT DATABASE() AS name'); assert.match(identity.name, /_test$/);
  const payload = phone => ({ company_id: a.id, customer: { name: 'Cupom teste', phone, street: 'Rua A', number: '10', neighborhood: 'Centro' }, fulfillment_method: 'delivery', delivery_fee: '4.50', payment_method: 'Dinheiro', items: [{ product_id: productId, quantity: 1, option_ids: ['ketchup'], addon_version: 3 }] });
  async function create(overrides = {}) {
    const code = 'C' + randomUUID().replaceAll('-', '').slice(0,12).toUpperCase(), config = configuration(overrides);
    const response = await request('/api/admin/coupons', json('POST', { code, config }, a.cookie)); assert.equal(response.status, 201); return { id: (await response.json()).id, code, config };
  }
  const quote = (coupon, body) => request('/api/coupons/quote', json('POST', { company_id: body.company_id, coupon_code: coupon.code, phone: body.customer.phone, items: body.items, fulfillment_method: body.fulfillment_method, neighborhood: body.customer.neighborhood }));
  async function redeem(coupon, body, key = randomUUID()) {
    const preview = await quote(coupon, body); assert.equal(preview.status, 200);
    const values = await preview.json();
    const submitted = { ...body, coupon_code: coupon.code, coupon_discount: values.discount_amount, coupon_subtotal: values.subtotal_amount };
    return { response: await request('/api/orders', json('POST', submitted, null, key)), submitted, key };
  }
  const limited = await create({ total_limit: 1 });
  const bodyA = payload('11977776666'), bodyB = payload('11977775555');
  const previews = await Promise.all([quote(limited, bodyA), quote(limited, bodyB)]); previews.forEach(response => assert.equal(response.status, 200));
  const values = await previews[0].json(), keys = [randomUUID(), randomUUID()];
  const bodies = [bodyA, bodyB].map(body => ({ ...body, coupon_code: limited.code, coupon_discount: values.discount_amount, coupon_subtotal: values.subtotal_amount }));
  const competing = await Promise.all(bodies.map((body, index) => request('/api/orders', json('POST', body, null, keys[index]))));
  assert.deepEqual(competing.map(response => response.status).sort(), [201,400]);
  const winner = competing.findIndex(response => response.status === 201), order = await competing[winner].json(); assert.equal(order.total_amount, 11.85);
  const [[used]] = await db.execute('SELECT usage_count FROM company_coupons WHERE id = ?', [limited.id]); assert.equal(used.usage_count, 1);
  assert.equal((await request('/api/orders', json('POST', bodies[winner], null, keys[winner]))).status, 200);
  assert.equal((await request('/api/admin/orders/' + order.order_id + '/status', json('PATCH', { status: 'cancelled', expected_status: 'pending' }, a.cookie))).status, 200);
  assert.equal((await quote(limited, bodyA)).status, 400);
  const perPhone = await create({ per_customer_limit: 1 });
  assert.equal((await redeem(perPhone, payload('(11) 97777-3333'))).response.status, 201);
  assert.equal((await quote(perPhone, payload('+55 (11) 97777-3333'))).status, 400);
  const oldPhone = payload('(11) 98888-2222'), oldOrder = await request('/api/orders', json('POST', oldPhone, null, randomUUID())); assert.equal(oldOrder.status, 201);
  await db.execute('UPDATE orders SET customer_phone_key = NULL WHERE id = ? AND company_id = ?', [(await oldOrder.json()).order_id, a.id]);
  const firstA = await create({ first_purchase: true }), firstB = await create({ first_purchase: true });
  assert.equal((await quote(firstA, payload('5511988882222'))).status, 400);
  const fresh = payload('11966665555'); const firstPreviews = await Promise.all([quote(firstA, fresh), quote(firstB, fresh)]); firstPreviews.forEach(response => assert.equal(response.status, 200));
  const firstValues = await firstPreviews[0].json();
  const firstRequests = await Promise.all([firstA,firstB].map(coupon => request('/api/orders', json('POST', { ...fresh, coupon_code: coupon.code, coupon_discount: firstValues.discount_amount, coupon_subtotal: firstValues.subtotal_amount }, null, randomUUID()))));
  assert.deepEqual(firstRequests.map(response => response.status).sort(), [201,400]);
  const free = await create({ kind: 'free_delivery', value: '0.00' }), freeResult = await redeem(free, payload('11955554444'));
  assert.equal(freeResult.response.status, 201); assert.equal((await freeResult.response.json()).total_amount, 12.35);
  assert.equal((await quote(free, { ...payload('11955554444'), fulfillment_method: 'pickup', delivery_fee: '0.00' })).status, 400);
  const percent = await create({ kind: 'percent', value: '12.50', max_discount: '2.00' }); const percentResult = await redeem(percent, payload('11944443333'));
  assert.equal(percentResult.response.status, 201); const discounted = await percentResult.response.json(); assert.equal(discounted.discount_amount, 1.54); assert.equal(discounted.total_amount, 15.31);
  assert.equal((await request('/api/admin/coupons/' + percent.id, json('PUT', { code: percent.code, config: { ...percent.config, active: false }, version: 1 }, a.cookie))).status, 200);
  assert.equal((await request('/api/orders', json('POST', percentResult.submitted, null, percentResult.key))).status, 200);
  assert.equal((await quote(percent, payload('11944443333'))).status, 400);
  assert.equal((await request('/api/admin/coupons/' + percent.id, json('PUT', { code: percent.code, config: percent.config, version: 1 }, b.cookie))).status, 404);
  const listB = await (await request('/api/admin/coupons', { headers: { Cookie: b.cookie } })).json(); assert.equal(listB.total, 0);
  const categoryB = await (await request('/api/admin/categories', json('POST', { name: 'Cupom teste' }, b.cookie))).json();
  const productB = await (await request('/api/admin/products', json('POST', { name: 'Produto B', description: '', category_id: categoryB.id, price: '10.00' }, b.cookie))).json();
  const foreign = await quote(free, { ...payload('11933332222'), company_id: b.id, items: [{ product_id: productB.id, quantity: 1 }] }); assert.equal(foreign.status, 400); assert.match((await foreign.json()).error, /não encontrado nesta loja/);
}
module.exports = { verifyCoupons };
