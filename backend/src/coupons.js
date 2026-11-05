const { asyncRoute } = require('./auth');
const { normalizeLines } = require('./addons');
const { validItems, priceCart } = require('./cart-pricing');
const { availability, loadOperations, quoteDelivery } = require('./operations');
const cents = value => Math.round(Number(value) * 100);
const decimal = value => typeof value === 'string' && /^\d{1,7}(\.\d{1,2})?$/.test(value);
function couponCode(value) {
  if (typeof value !== 'string') throw new Error('Informe um código de cupom válido.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw new Error('Use um código de 3 a 32 letras, números, hífen ou sublinhado.');
  return code;
}
function phoneKey(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]{10,25}$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (/^\d{10,11}$/.test(digits) && !value.trim().startsWith('+')) return '55' + digits;
  return /^55\d{10,11}$/.test(digits) ? digits : null;
}
function validateCoupon(body) {
  if (!body || typeof body.active !== 'boolean' || typeof body.first_purchase !== 'boolean' || !['fixed','percent','free_delivery'].includes(body.kind)) throw new Error('Confira tipo, disponibilidade e regra de primeira compra.');
  if (!decimal(body.value) || (body.kind !== 'free_delivery' && cents(body.value) < 1) || (body.kind === 'percent' && cents(body.value) > 10000) || (body.kind === 'free_delivery' && cents(body.value) !== 0)) throw new Error('Confira o valor do desconto. Percentual deve ser maior que zero e até 100%.');
  if (!decimal(body.min_subtotal)) throw new Error('Informe o pedido mínimo em reais.');
  if (body.max_discount !== null && (!decimal(body.max_discount) || cents(body.max_discount) < 1 || body.kind === 'free_delivery')) throw new Error('Confira o teto do desconto; frete grátis não usa teto.');
  for (const key of ['total_limit','per_customer_limit']) if (body[key] !== null && (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 1000000)) throw new Error('Limites de uso devem ser inteiros de 1 a 1000000 ou ficar vazios.');
  const date = key => {
    if (body[key] === null) return null;
    if (typeof body[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body[key]) || !Number.isFinite(Date.parse(body[key]))) throw new Error('Confira as datas de validade.');
    const normalized = new Date(body[key]).toISOString();
    if (normalized.slice(0,19) !== body[key].slice(0,19)) throw new Error('Data de validade inválida.');
    return normalized;
  };
  const starts_at = date('starts_at'), ends_at = date('ends_at');
  if (starts_at && ends_at && starts_at >= ends_at) throw new Error('O término deve ser posterior ao início.');
  return { active: body.active, first_purchase: body.first_purchase, kind: body.kind, value: Number(body.value).toFixed(2), min_subtotal: Number(body.min_subtotal).toFixed(2), max_discount: body.max_discount === null ? null : Number(body.max_discount).toFixed(2), total_limit: body.total_limit, per_customer_limit: body.per_customer_limit, starts_at, ends_at };
}
function decodeCoupon(row) { return { ...row, config: validateCoupon(typeof row.config === 'string' ? JSON.parse(row.config) : row.config), usage_count: Number(row.usage_count), version: Number(row.version) }; }
function couponDiscount(config, subtotalCents, deliveryCents, method, now = Date.now()) {
  if (!config.active) throw new Error('Este cupom está pausado.');
  if (config.starts_at && now < Date.parse(config.starts_at)) throw new Error('Este cupom ainda não está válido.');
  if (config.ends_at && now >= Date.parse(config.ends_at)) throw new Error('Este cupom expirou.');
  if (subtotalCents < cents(config.min_subtotal)) throw new Error('O pedido mínimo para este cupom é R$ ' + config.min_subtotal.replace('.', ',') + ', sem o frete.');
  if (config.kind === 'free_delivery' && method !== 'delivery') throw new Error('Este cupom é exclusivo para delivery.');
  let discount = config.kind === 'free_delivery' ? deliveryCents : config.kind === 'fixed' ? cents(config.value) : Math.floor((subtotalCents * cents(config.value) + 5000) / 10000);
  if (config.kind !== 'free_delivery') discount = Math.min(discount, subtotalCents, config.max_discount === null ? Infinity : cents(config.max_discount));
  if (discount <= 0) throw new Error('Este cupom não gera desconto neste pedido.');
  return discount;
}
async function evaluateCoupon(conn, { companyId, code, phone, subtotalCents, deliveryCents, method, lock = false }) {
  const key = phoneKey(phone); if (!key) throw new Error('Para usar o cupom, informe um telefone brasileiro válido com DDD.');
  const [rows] = await conn.execute('SELECT id, code, config, version, usage_count FROM company_coupons WHERE company_id = ? AND code = ?' + (lock ? ' FOR UPDATE' : ''), [companyId, code]);
  if (!rows.length) throw new Error('Cupom não encontrado nesta loja.');
  const row = decodeCoupon(rows[0]), config = row.config;
  const discountCents = couponDiscount(config, subtotalCents, deliveryCents, method);
  if (config.total_limit !== null && row.usage_count >= config.total_limit) throw new Error('Este cupom atingiu o limite de usos.');
  if (config.per_customer_limit !== null) {
    const [[usage]] = await conn.execute('SELECT COUNT(*) AS total FROM orders WHERE company_id = ? AND coupon_code = ? AND customer_phone_key = ?', [companyId, code, key]);
    if (Number(usage.total) >= config.per_customer_limit) throw new Error('Este telefone já atingiu o limite de uso do cupom.');
  }
  if (config.first_purchase) {
    // Inclui formatos antigos com/sem 55 e pontuação, sem alterar os registros legados.
    const digits = "REGEXP_REPLACE(customer_phone, '[^0-9]', '')";
    const [previous] = await conn.execute(`SELECT id FROM orders WHERE company_id = ? AND status <> 'cancelled' AND (customer_phone_key = ? OR CASE WHEN CHAR_LENGTH(${digits}) IN (10,11) THEN CONCAT('55', ${digits}) ELSE ${digits} END = ?) LIMIT 1`, [companyId, key, key]);
    if (previous.length) throw new Error('Este cupom é válido somente na primeira compra deste telefone.');
  }
  return { id: row.id, code, key, discountCents, snapshot: { code, kind: config.kind, value: config.value, version: row.version, discount_amount: (discountCents / 100).toFixed(2), subtotal_amount: (subtotalCents / 100).toFixed(2), delivery_fee: (deliveryCents / 100).toFixed(2), rules: config } };
}
function installCoupons(app, db, auth, manage) {
  app.get('/api/admin/coupons', auth, asyncRoute(async (req, res) => {
    const offset = req.query.offset || '0';
    if (typeof offset !== 'string' || !/^\d{1,6}$/.test(offset) || Number(offset) > 100000) return res.status(400).json({ error: 'Página inválida.' });
    const [[count]] = await db.execute('SELECT COUNT(*) AS total FROM company_coupons WHERE company_id = ?', [req.tenantId]);
    const [rows] = await db.execute(`SELECT id, code, config, version, usage_count FROM company_coupons WHERE company_id = ? ORDER BY id DESC LIMIT 50 OFFSET ${Number(offset)}`, [req.tenantId]);
    res.json({ coupons: rows.map(decodeCoupon), total: Number(count.total), offset: Number(offset), limit: 50, server_time: new Date().toISOString() });
  }));
  async function save(req, res) {
    const id = req.params.id === undefined ? null : Number(req.params.id);
    let config, code;
    try {
      config = validateCoupon(req.body?.config); code = couponCode(req.body?.code);
      if (id !== null && (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(req.body.version) || req.body.version < 1 || req.body.version >= 2147483647)) throw new Error('Cupom ou versão inválida.');
    } catch (error) { return res.status(400).json({ error: error.message }); }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM companies WHERE id = ? FOR UPDATE', [req.tenantId]);
      if (id !== null) {
        const [rows] = await conn.execute('SELECT id, code, version FROM company_coupons WHERE id = ? AND company_id = ? FOR UPDATE', [id, req.tenantId]);
        if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Cupom não encontrado nesta loja.' }); }
        if (rows[0].code !== code) { await conn.rollback(); return res.status(400).json({ error: 'O código do cupom não pode ser alterado. Crie outro cupom.' }); }
        if (Number(rows[0].version) !== req.body.version) { await conn.rollback(); return res.status(409).json({ error: 'Outra edição foi salva. Recarregue a lista antes de editar.' }); }
        await conn.execute('UPDATE company_coupons SET config = ?, version = version + 1 WHERE id = ? AND company_id = ?', [JSON.stringify(config), id, req.tenantId]);
        await conn.commit(); return res.json({ success: true });
      }
      const [result] = await conn.execute('INSERT INTO company_coupons (company_id, code, config, version, usage_count) VALUES (?, ?, ?, 1, 0)', [req.tenantId, code, JSON.stringify(config)]);
      await conn.commit(); res.status(201).json({ id: result.insertId });
    } catch (error) { await conn.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este código já existe na sua loja.' }); throw error; }
    finally { conn.release(); }
  }
  app.post('/api/admin/coupons', auth, manage, asyncRoute(save));
  app.put('/api/admin/coupons/:id', auth, manage, asyncRoute(save));
  app.post('/api/coupons/quote', asyncRoute(async (req, res) => {
    const { company_id, items, phone, fulfillment_method = 'delivery', neighborhood = '' } = req.body || {};
    let code, normalized;
    try {
      code = couponCode(req.body?.coupon_code);
      if (!Number.isSafeInteger(company_id) || company_id < 1 || !validItems(items) || !['delivery','pickup'].includes(fulfillment_method) || typeof neighborhood !== 'string' || neighborhood.length > 160) throw new Error('Confira os itens e a modalidade do pedido.');
      normalized = normalizeLines(items);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [companies] = await conn.execute('SELECT id FROM companies WHERE id = ? AND active = 1 FOR SHARE', [company_id]);
      if (!companies.length) { await conn.rollback(); return res.status(404).json({ error: 'Restaurante indisponível.' }); }
      let response;
      try {
        const operations = availability(await loadOperations(conn, company_id));
        if (!operations.is_open) throw new Error(operations.status_message);
        const delivery = quoteDelivery(operations, fulfillment_method, neighborhood);
        const priced = await priceCart(conn, company_id, normalized.quantities, normalized.lines, cents(delivery.fee));
        const coupon = await evaluateCoupon(conn, { companyId: company_id, code, phone, subtotalCents: priced.subtotalCents, deliveryCents: cents(delivery.fee), method: fulfillment_method });
        response = { coupon_code: code, discount_amount: (coupon.discountCents / 100).toFixed(2), subtotal_amount: (priced.subtotalCents / 100).toFixed(2), delivery_fee: delivery.fee, total_amount: ((priced.grossCents - coupon.discountCents) / 100).toFixed(2) };
      } catch (error) { if (error.code) throw error; await conn.rollback(); return res.status(400).json({ error: error.message }); }
      await conn.commit(); res.json(response);
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }));
}
module.exports = { couponCode, phoneKey, validateCoupon, couponDiscount, evaluateCoupon, installCoupons };
