const { createHash } = require('node:crypto');
function checkoutHash(companyId, customer, payment, quantities, method = 'delivery', fee, lines = [], couponCode = '', couponDiscount, couponSubtotal, cashCents) {
  const value = { company_id: companyId, customer: ['name', 'phone', 'street', 'number', 'neighborhood'].map(key => customer[key].trim()),
    payment_method: payment, items: [...quantities].sort((a, b) => a[0] - b[0]) };
  // Mantém o hash de pedidos antigos de delivery sem cotação explícita.
  if (method !== 'delivery') value.fulfillment_method = method;
  if (fee !== undefined) value.delivery_fee = fee;
  if (lines.some(line => line.option_ids.length || line.addon_version)) value.variants = lines.map(line => [line.product_id, line.quantity, line.option_ids, line.addon_version]);
  if (lines.some(line => line.notes)) value.instructions = lines.map(line => [line.product_id, line.quantity, line.option_ids, line.addon_version, line.notes || '']);
  if (lines.some(line => line.option_quantities && Object.values(line.option_quantities).some(quantity => quantity > 1))) value.addon_quantities = lines.map(line => line.option_ids.map(id => [id, line.option_quantities?.[id] || 1]));
  if (couponCode) value.coupon = [couponCode, couponDiscount, couponSubtotal];
  if (cashCents !== undefined) value.cash_cents = cashCents;
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function reserveCheckout(conn, companyId, key, hash) {
  try {
    await conn.execute('INSERT INTO checkout_requests (company_id, request_key, request_hash) VALUES (?, ?, ?)', [companyId, key, hash]);
    return { fresh: true };
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    // A restrição única aguarda o commit do primeiro pedido antes de permitir a leitura.
    const [rows] = await conn.execute('SELECT request_hash, order_id FROM checkout_requests WHERE company_id = ? AND request_key = ? FOR UPDATE', [companyId, key]);
    if (!rows[0] || rows[0].request_hash !== hash || !rows[0].order_id) return { conflict: true };
    const [orders] = await conn.execute('SELECT id, total_amount, fulfillment_method, delivery_fee, fulfillment_address, estimated_minutes, coupon_code, discount_amount FROM orders WHERE id = ? AND company_id = ? FOR UPDATE', [rows[0].order_id, companyId]);
    if (!orders.length) return { conflict: true };
    return { order: orders[0] };
  }
}
module.exports = { checkoutHash, reserveCheckout };
