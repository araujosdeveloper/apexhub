'use strict';
const { asyncRoute } = require('./auth');
const { adminErrorHandler, success } = require('./platform-admin-http');
const { utcDate } = require('./utc-date');

const ACTIVE = ['pending', 'preparing', 'ready', 'delivering'];
const FILTERABLE = [...ACTIVE, 'delivered', 'cancelled'];
const DB_STATUS = { delivered: 'completed' };
function installTenantOrders(app, db, auth, events) {
  const route = require('express').Router();
  route.use(auth);
  route.get('/events', events.stream(db));
  route.get('/', asyncRoute(async (req, res) => {
    const status = req.query.status === undefined ? 'all' : req.query.status;
    const rawLimit = req.query.limit === undefined ? '60' : req.query.limit;
    const rawOffset = req.query.offset === undefined ? '0' : req.query.offset;
    if (typeof status !== 'string' || (status !== 'all' && !FILTERABLE.includes(status)) ||
      typeof rawLimit !== 'string' || !/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100 ||
      typeof rawOffset !== 'string' || !/^\d{1,6}$/.test(rawOffset) || Number(rawOffset) > 100000) {
      return res.status(400).json({ success: false, data: null, message: 'Filtros ou paginação de pedidos inválidos.' });
    }
    const statuses = status === 'all' ? ACTIVE : [DB_STATUS[status] || status];
    const where = `company_id = ? AND status IN (${statuses.map(() => '?').join(',')})`;
    const params = [req.tenantId, ...statuses];
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`, params);
    const limit = Number(rawLimit), offset = Number(rawOffset);
    const [orders] = await db.execute(`SELECT id, company_id AS tenant_id, customer_name, customer_phone,
      CASE WHEN fulfillment_method = 'pickup' THEN fulfillment_address ELSE CONCAT_WS(', ',NULLIF(address_street,''),NULLIF(address_number,''),NULLIF(address_neighborhood,'')) END AS delivery_address,
      total_amount,status,payment_method,notes,created_at,fulfillment_method,delivery_fee,fulfillment_address,estimated_minutes
      FROM orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    let items = [];
    if (orders.length) {
      [items] = await db.execute(`SELECT oi.id,oi.order_id,oi.product_id,oi.product_name,oi.quantity,oi.item_notes,oi.unit_price,oi.total_price,oi.addons_snapshot
        FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.company_id=? AND o.id IN (${orders.map(() => '?').join(',')}) ORDER BY oi.id`, [req.tenantId, ...orders.map(order => order.id)]);
    }
    const normalized = orders.map(order => ({ ...order, status: order.status === 'completed' ? 'delivered' : order.status,
      created_at: utcDate(order.created_at), items: items.filter(item => item.order_id === order.id) }));
    return success(res, { tenant_id: req.tenantId, orders: normalized, pagination: { total: Number(total), limit, offset } }, 'Pedidos carregados.');
  }));
  route.patch('/:id/status', asyncRoute(async (req, res) => {
    const id = Number(req.params.id), requested = req.body?.status;
    const expectedInput = req.body?.expected_status;
    const expected = expectedInput === 'delivered' ? 'completed' : expectedInput;
    const target = DB_STATUS[requested] || requested;
    const transitions = { preparing: ['pending'], ready: ['preparing'], completed: ['ready', 'delivering'], cancelled: ['pending', 'preparing', 'ready', 'delivering'] };
    if (!Number.isSafeInteger(id) || id < 1 || !['preparing','ready','delivered','cancelled'].includes(requested) ||
      (expectedInput !== undefined && !['pending','preparing','ready','delivering','delivered'].includes(expectedInput))) {
      return res.status(400).json({ success: false, data: null, message: 'Pedido ou status inválido.' });
    }
    const sources = transitions[target];
    const result = await db.execute(`UPDATE orders SET status=? WHERE id=? AND company_id=? AND status IN (${sources.map(() => '?').join(',')})${target === 'completed' ? " AND (fulfillment_method='pickup' OR status='delivering')" : ''}${expected !== undefined ? ' AND status=?' : ''}`,
      [target, id, req.tenantId, ...sources, ...(expected !== undefined ? [expected] : [])]);
    if (!result[0].affectedRows) {
      const [own] = await db.execute('SELECT id FROM orders WHERE id=? AND company_id=?', [id, req.tenantId]);
      return res.status(own.length ? 409 : 404).json({ success: false, data: null, message: own.length ? 'Transição de status não permitida; atualize os pedidos.' : 'Pedido não encontrado.' });
    }
    events.publish(req.tenantId);
    return success(res, { tenant_id: req.tenantId, order_id: id, status: requested }, 'Status do pedido atualizado.');
  }));
  route.all('/', (req, res) => res.set('Allow', 'GET, HEAD').status(405).json({ success: false, data: null, message: 'Método não permitido para este recurso.' }));
  route.use((req, res) => res.status(404).json({ success: false, data: null, message: 'Rota de pedidos não encontrada.' }));
  route.use(adminErrorHandler(app.locals.logger));
  app.use('/api/tenant/orders', route);
}
module.exports = { installTenantOrders };
