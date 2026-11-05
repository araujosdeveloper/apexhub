const {configuration}=require('./jwt');
const {requireRoles}=require('./middlewares/auth');
const { installMaster } = require('./master');
const { installAppShell } = require('./app-shell');
const { installDashboard } = require('./dashboard');
const { installReviews } = require('./reviews');
const { ensureTracking, installOrderTracking } = require('./order-tracking');
const { withImage, installProductImages } = require('./product-images');
const { decorateMenu, installMerchandising } = require('./merchandising');
const { installTeam } = require('./team');
const { installReports } = require('./reports');
const { installDrivers } = require('./drivers');
const express = require('express');
const { installCustomers } = require('./customers');
const { installCoupons, couponCode, phoneKey, evaluateCoupon } = require('./coupons');
const { priceCart } = require('./cart-pricing');
const { createOrderEvents } = require('./order-events');
const { installOrderBoard } = require('./order-board');
const { installAddons, normalizeLines, priceLine, publicProduct } = require('./addons');
const path = require('node:path');
const { installAuth, asyncRoute } = require('./auth');
const { installCatalogEditing } = require('./catalog');
const { checkoutHash, reserveCheckout } = require('./checkout');
const { loadOperations, availability, quoteDelivery, installOperations } = require('./operations');
function createApp(db, options = {}) {
  const app = express();
  app.locals.jwt=options.jwt===undefined?configuration():options.jwt;
  const orderEvents = options.orderEvents || createOrderEvents();
  app.locals.orderEvents = orderEvents;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    // Requisições de escrita do navegador devem ser da mesma origem.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return res.sendStatus(403); }
      if (origin.host !== req.get('host')) return res.status(403).json({ error: 'Origem não permitida.' });
    }
    next();
  });
  const auth = installAuth(app, db, options);
  // Toda rota administrativa, inclusive novas rotas, exige identidade e tenant.
  app.use('/api/admin',auth);
  installMaster(app, db, options);
  app.get('/api/health', asyncRoute(async (req, res) => {
    await db.execute('SELECT 1');
    res.json({ status: 'ok' });
  }));
  app.get('/api/menu/:slug', asyncRoute(async (req, res) => {
    const [companies] = await db.execute('SELECT id, name, slug, whatsapp_phone FROM companies WHERE slug = ? AND active = 1', [req.params.slug]);
    if (!companies.length) return res.status(404).json({ error: 'Restaurante não encontrado.' });
    const company = companies[0];
    const [categories] = await db.execute('SELECT id, name, sort_order FROM categories WHERE company_id = ? AND active = 1 ORDER BY sort_order, id', [company.id]);
    const [products] = await db.execute(`SELECT p.id, p.category_id, p.name, p.description, p.price, i.digest AS image_digest, a.config AS addon_config, a.version AS addon_version FROM products p LEFT JOIN product_addons a ON a.product_id = p.id
      LEFT JOIN product_images i ON i.product_id=p.id JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
      WHERE p.company_id = ? AND p.active = 1 AND c.active = 1 ORDER BY p.id`, [company.id]);
    const menu = await decorateMenu(db, company.id, products.map(product => withImage(publicProduct(product))));
    res.json({ company, categories, ...menu, operations: availability(await loadOperations(db, company.id)) });
  }));
  const manage = requireRoles('tenant_owner','tenant_manager');
  installCatalogEditing(app, db, auth, manage);
  installProductImages(app, db, auth, manage);
  installMerchandising(app, db, auth, manage);
  installOperations(app, db, auth, manage);
  installAddons(app, db, auth, manage);
  installOrderBoard(app, db, auth, orderEvents);
  installOrderTracking(app, db, auth);
  installReviews(app, db, auth);
  installDashboard(app, db, auth);
  installCoupons(app, db, auth, manage);
  installCustomers(app, db, auth);
  installReports(app, db, auth);
  installTeam(app, db, auth);
  installDrivers(app, db, auth, orderEvents);
  app.get('/api/admin/catalog', auth, asyncRoute(async (req, res) => {
    const [categories] = await db.execute('SELECT id, name, sort_order, active FROM categories WHERE company_id = ? ORDER BY sort_order, id', [req.tenantId]);
    const [products] = await db.execute('SELECT p.id,p.category_id,p.name,p.description,p.price,p.active,i.digest AS image_digest FROM products p LEFT JOIN product_images i ON i.product_id=p.id WHERE p.company_id = ? ORDER BY p.id DESC', [req.tenantId]);
    res.json({ categories, products: products.map(product => withImage(product,true)) });
  }));
  app.post('/api/admin/categories', auth, manage, asyncRoute(async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: 'Informe uma categoria de até 120 caracteres.' });
    const [result] = await db.execute('INSERT INTO categories (company_id, name) VALUES (?, ?)', [req.tenantId, name.trim()]);
    res.status(201).json({ id: result.insertId });
  }));
  app.post('/api/admin/products', auth, manage, asyncRoute(async (req, res) => {
    const { name, description = '', category_id, price } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || typeof description !== 'string' || description.length > 4000 ||
        !Number.isSafeInteger(category_id) || category_id < 1 || typeof price !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(price)) return res.status(400).json({ error: 'Confira nome, categoria e preço (ex.: 25.90).' });
    const [categories] = await db.execute('SELECT id FROM categories WHERE id = ? AND company_id = ? AND active = 1', [category_id, req.tenantId]);
    if (!categories.length) return res.status(400).json({ error: 'Categoria indisponível.' });
    const [result] = await db.execute('INSERT INTO products (company_id, category_id, name, description, price) VALUES (?, ?, ?, ?, ?)', [req.tenantId, category_id, name.trim(), description.trim(), price]);
    res.status(201).json({ id: result.insertId });
  }));
  app.patch('/api/admin/products/:id/availability', auth, manage, asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Dados inválidos.' });
    const [result] = await db.execute('UPDATE products SET active = ? WHERE id = ? AND company_id = ?', [req.body.active, id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json({ success: true });
  }));
  app.patch('/api/admin/settings', auth, manage, asyncRoute(async (req, res) => {
    const { whatsapp_phone } = req.body || {};
    if (typeof whatsapp_phone !== 'string' || (whatsapp_phone !== '' && !/^\d{10,15}$/.test(whatsapp_phone))) return res.status(400).json({ error: 'Informe o WhatsApp com código do país e apenas números.' });
    await db.execute('UPDATE companies SET whatsapp_phone = ? WHERE id = ?', [whatsapp_phone, req.tenantId]);
    res.json({ success: true });
  }));
  app.get('/api/admin/subscription', auth, asyncRoute(async (req, res) => {
    const [rows] = await db.execute('SELECT plan_code, status, trial_ends_at FROM subscriptions WHERE company_id = ?', [req.tenantId]);
    res.json({ subscription: rows[0] || null });
  }));
  app.get('/api/admin/orders', auth, asyncRoute(async (req, res) => {
    const [orders] = await db.execute(`SELECT id, total_amount, status, payment_method, notes, created_at, snapshot_source,
      customer_name, customer_phone, address_street, address_number, address_neighborhood,
      fulfillment_method, delivery_fee, fulfillment_address, estimated_minutes, coupon_code, discount_amount, coupon_snapshot
      FROM orders WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [req.tenantId]);
    if (!orders.length) return res.json([]);
    const [items] = await db.execute(`SELECT oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, oi.total_price, oi.addons_snapshot
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.company_id = ? AND o.id IN (${orders.map(() => '?').join(',')})`, [req.tenantId, ...orders.map(o => o.id)]);
    res.json(orders.map(order => ({ ...order, items: items.filter(i => i.order_id === order.id) })));
  }));
  app.patch('/api/admin/orders/:id/status', auth, asyncRoute(async (req, res) => {
    const transitions = { pending: ['preparing', 'cancelled'], preparing: ['ready', 'completed', 'cancelled'], ready: ['delivering', 'completed', 'cancelled'], delivering: ['completed', 'cancelled'] };
    const status = req.body?.status;
    const expected = req.body?.expected_status;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !['preparing', 'ready', 'delivering', 'completed', 'cancelled'].includes(status) || (expected !== undefined && !['pending','preparing','ready','delivering','completed','cancelled'].includes(expected))) return res.status(400).json({ error: 'Pedido ou status inválido.' });
    const allowed = Object.keys(transitions).filter(key => transitions[key].includes(status));
    const [result] = await db.execute(`UPDATE orders SET status = ? WHERE id = ? AND company_id = ? AND status IN (${allowed.map(() => '?').join(',')})${status === 'delivering' ? " AND fulfillment_method = 'delivery'" : ''}${expected !== undefined ? ' AND status = ?' : ''}`, [status, id, req.tenantId, ...allowed, ...(expected !== undefined ? [expected] : [])]);
    if (!result.affectedRows) {
      const [rows] = await db.execute('SELECT id FROM orders WHERE id = ? AND company_id = ?', [id, req.tenantId]);
      return res.status(rows.length ? 409 : 404).json({ error: rows.length ? 'Transição de status não permitida. Atualize o painel.' : 'Pedido não encontrado.' });
    }
    orderEvents.publish(req.tenantId);
    res.json({ success: true });
  }));
  app.post('/api/orders', asyncRoute(async (req, res) => {
    const { company_id, items, payment_method, fulfillment_method = 'delivery', delivery_fee } = req.body || {};
    let code = '';
    try { if (req.body?.coupon_code !== undefined && req.body.coupon_code !== '') code = couponCode(req.body.coupon_code); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const couponDiscount = req.body?.coupon_discount;
    const couponSubtotal = req.body?.coupon_subtotal;
    if ((code && (typeof couponDiscount !== 'string' || !/^\d{1,7}\.\d{2}$/.test(couponDiscount) || typeof couponSubtotal !== 'string' || !/^\d{1,7}\.\d{2}$/.test(couponSubtotal))) || (!code && couponDiscount !== undefined && couponDiscount !== '0.00')) return res.status(400).json({ error: 'Aplique o cupom e confira o desconto antes de confirmar.' });
    const inputCustomer = req.body?.customer;
    const customer = inputCustomer && { ...inputCustomer };
    if (customer && fulfillment_method === 'pickup') {
      customer.street = ''; customer.number = ''; customer.neighborhood = '';
    }
    const requestKey = req.get('Idempotency-Key');
    if (!requestKey || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestKey)) return res.status(400).json({ error: 'Identificador de envio ausente ou inválido. Atualize a loja antes de enviar.' });
    const fields = ['name', 'phone', 'street', 'number', 'neighborhood'];
    if (!['delivery', 'pickup'].includes(fulfillment_method) ||
      (delivery_fee !== undefined && (typeof delivery_fee !== 'string' || !/^\d{1,4}\.\d{2}$/.test(delivery_fee))) ||
      !Number.isSafeInteger(company_id) || company_id < 1 || !customer || fields.some(f => typeof customer[f] !== 'string' || (fulfillment_method === 'delivery' || ['name', 'phone'].includes(f)) && !customer[f].trim() || customer[f].length > 160) ||
      !Array.isArray(items) || !items.length || items.length > 100 || !['Pix', 'Cartão de Crédito', 'Dinheiro'].includes(payment_method) ||
      items.some(i => !i || !Number.isSafeInteger(i.product_id || i.id) || (i.product_id || i.id) < 1 || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)) {
      return res.status(400).json({ error: 'Confira os dados de entrega, os itens e a forma de pagamento.' });
    }
    let quantities, lines;
    try { ({ quantities, lines } = normalizeLines(items)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [companies] = await conn.execute('SELECT id FROM companies WHERE id = ? AND active = 1 FOR UPDATE', [company_id]);
      if (!companies.length) { await conn.rollback(); return res.status(404).json({ error: 'Restaurante indisponível.' }); }
      const reservation = await reserveCheckout(conn, company_id, requestKey, checkoutHash(company_id, customer, payment_method, quantities, fulfillment_method, delivery_fee, lines, code, couponDiscount, couponSubtotal));
      if (reservation.conflict) { await conn.rollback(); return res.status(409).json({ error: 'Este envio já foi usado com outros dados. Confira o pedido antes de tentar novamente.' }); }
      if (reservation.order) {
        const tracking_url=await ensureTracking(conn,reservation.order.id);
        await conn.commit();
        return res.json({ success: true, replayed: true, tracking_url, order_id: reservation.order.id, total_amount: Number(reservation.order.total_amount), delivery_fee: Number(reservation.order.delivery_fee), fulfillment_method: reservation.order.fulfillment_method, fulfillment_address: reservation.order.fulfillment_address, estimated_minutes: reservation.order.estimated_minutes, coupon_code: reservation.order.coupon_code || '', discount_amount: Number(reservation.order.discount_amount || 0) });
      }
      const operations = availability(await loadOperations(conn, company_id));
      if (!operations.is_open) { await conn.rollback(); return res.status(409).json({ error: operations.status_message + '. Não estamos recebendo pedidos agora.' }); }
      let quote;
      try { quote = quoteDelivery(operations, fulfillment_method, customer.neighborhood); }
      catch (error) { await conn.rollback(); return res.status(400).json({ error: error.message }); }
      if (Number(delivery_fee ?? '0.00') !== Number(quote.fee)) {
        await conn.rollback(); return res.status(409).json({ error: 'A taxa de entrega mudou. Atualize o cardápio e confira o total antes de confirmar.' });
      }
      let priced, coupon = null;
      try {
        priced = await priceCart(conn, company_id, quantities, lines, Math.round(Number(quote.fee) * 100));
        if (code) coupon = await evaluateCoupon(conn, { companyId: company_id, code, phone: customer.phone, subtotalCents: priced.subtotalCents, deliveryCents: Math.round(Number(quote.fee) * 100), method: fulfillment_method, lock: true });
        if (coupon && (Number(couponDiscount) !== coupon.discountCents / 100 || Number(couponSubtotal) !== priced.subtotalCents / 100)) { await conn.rollback(); return res.status(409).json({ error: 'O desconto mudou. Aplique o cupom novamente e confira o total.' }); }
      } catch (error) { if (error.code) throw error; await conn.rollback(); return res.status(400).json({ error: error.message }); }
      const { pricedLines } = priced;
      const discountCents = coupon?.discountCents || 0, totalCents = priced.grossCents - discountCents;
      await conn.execute(`INSERT INTO customers (company_id, name, phone, address_street, address_number, address_neighborhood) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), address_street = IF(VALUES(address_street) = '', address_street, VALUES(address_street)), address_number = IF(VALUES(address_street) = '', address_number, VALUES(address_number)), address_neighborhood = IF(VALUES(address_street) = '', address_neighborhood, VALUES(address_neighborhood))`,
      [company_id, ...fields.map(f => customer[f].trim())]);
      const [customers] = await conn.execute('SELECT id FROM customers WHERE company_id = ? AND phone = ?', [company_id, customer.phone.trim()]);
      const [order] = await conn.execute(`INSERT INTO orders (company_id, customer_id, total_amount, status, payment_method,
        customer_name, customer_phone, address_street, address_number, address_neighborhood,
        fulfillment_method, delivery_fee, fulfillment_address, estimated_minutes, discount_amount, coupon_code, coupon_snapshot, customer_phone_key) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_id, customers[0].id, (totalCents / 100).toFixed(2), payment_method, ...fields.map(f => customer[f].trim()),
        fulfillment_method, quote.fee, fulfillment_method === 'pickup' ? operations.pickup_address : '',
        fulfillment_method === 'pickup' ? operations.pickup_minutes : operations.delivery_minutes,
        (discountCents / 100).toFixed(2), code, coupon ? JSON.stringify(coupon.snapshot) : null, phoneKey(customer.phone)]);
      for (const line of pricedLines) {
        await conn.execute('INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price, addons_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [order.insertId, line.product_id, line.name, line.quantity, (line.unitCents / 100).toFixed(2), (line.unitCents * line.quantity / 100).toFixed(2), JSON.stringify(line.snapshot)]);
      }
      if (coupon) await conn.execute('UPDATE company_coupons SET usage_count = usage_count + 1 WHERE id = ? AND company_id = ?', [coupon.id, company_id]);
      const tracking_url=await ensureTracking(conn,order.insertId);
      await conn.execute('UPDATE checkout_requests SET order_id = ? WHERE company_id = ? AND request_key = ?', [order.insertId, company_id, requestKey]);
      await conn.commit();
      orderEvents.publish(company_id);
      res.status(201).json({ success: true, tracking_url, order_id: order.insertId, total_amount: totalCents / 100, delivery_fee: Number(quote.fee), fulfillment_method, coupon_code: code, discount_amount: discountCents / 100,
        fulfillment_address: fulfillment_method === 'pickup' ? operations.pickup_address : '',
        estimated_minutes: fulfillment_method === 'pickup' ? operations.pickup_minutes : operations.delivery_minutes });
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  installAppShell(app);
  app.use(express.static(path.join(__dirname, '../../frontend')));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição muito grande.' });
    console.error('Falha na API:', err.code || err.name);
    res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
  });
  return app;
}
module.exports = { createApp };
