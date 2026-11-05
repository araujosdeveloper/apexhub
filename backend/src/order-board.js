const { asyncRoute } = require('./auth');
const SCOPES = { active: ['pending','preparing','ready','delivering'], kitchen: ['pending','preparing','ready'], history: ['completed','cancelled'] };
function boardFilter(query, companyId) {
  const { scope = 'active', status = 'all', fulfillment = 'all', search = '', offset = '0', limit = '60' } = query;
  if (typeof scope !== 'string' || !Object.hasOwn(SCOPES, scope) || typeof status !== 'string' || (status !== 'all' && !SCOPES[scope].includes(status)) ||
    !['all','delivery','pickup'].includes(fulfillment) || typeof search !== 'string' || search.length > 80 ||
    typeof offset !== 'string' || !/^\d{1,6}$/.test(offset) || Number(offset) > 100000 ||
    typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Filtros de pedidos inválidos.');
  const statuses = status === 'all' ? SCOPES[scope] : [status];
  const conditions = ['o.company_id = ?', `o.status IN (${statuses.map(() => '?').join(',')})`];
  const params = [companyId, ...statuses];
  if (fulfillment !== 'all') { conditions.push('o.fulfillment_method = ?'); params.push(fulfillment); }
  if (search.trim()) {
    const pattern = '%' + search.trim().replace(/[=%_]/g, '=$&') + '%';
    const id = Number(search.trim().replace(/^#/, ''));
    const byId = Number.isSafeInteger(id) && id > 0;
    conditions.push(`(o.customer_name LIKE ? ESCAPE '=' OR o.customer_phone LIKE ? ESCAPE '='${byId ? ' OR o.id = ?' : ''})`);
    params.push(pattern, pattern); if (byId) params.push(id);
  }
  return { where: conditions.join(' AND '), params, offset: Number(offset), limit: Number(limit), scope };
}
function utcDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return value.replace(' ', 'T') + 'Z';
  return value;
}
function installOrderBoard(app, db, auth, events) {
  app.get('/api/admin/orders/events', auth, events.stream(db));
  app.get('/api/admin/orders/board', auth, asyncRoute(async (req, res) => {
    let filter;
    try { filter = boardFilter(req.query, req.tenantId); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const [summary] = await db.execute('SELECT status, COUNT(*) AS count, MAX(id) AS latest_id FROM orders WHERE company_id = ? GROUP BY status', [req.tenantId]);
    const counts = Object.fromEntries([...SCOPES.active, ...SCOPES.history].map(status => [status, 0]));
    for (const row of summary) if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.count);
    const latestPendingId = Number(summary.find(row => row.status === 'pending')?.latest_id || 0);
    const [[total]] = await db.execute(`SELECT COUNT(*) AS total FROM orders o WHERE ${filter.where}`, filter.params);
    const direction = filter.scope === 'history' ? 'DESC' : 'ASC';
    // Inteiros validados: evita diferenças de prepared LIMIT entre drivers.
    const [orders] = await db.execute(`SELECT o.id, o.total_amount, o.status, o.payment_method, o.notes, o.created_at, o.snapshot_source,
      o.customer_name, o.customer_phone, o.address_street, o.address_number, o.address_neighborhood,
      o.fulfillment_method, o.delivery_fee, o.fulfillment_address, o.estimated_minutes, o.coupon_code, o.discount_amount, o.coupon_snapshot, a.driver_name, a.driver_phone, t.token AS tracking_token
      FROM orders o LEFT JOIN delivery_assignments a ON a.order_id = o.id AND a.company_id = o.company_id LEFT JOIN order_tracking t ON t.order_id=o.id WHERE ${filter.where} ORDER BY o.created_at ${direction}, o.id ${direction} LIMIT ${filter.limit} OFFSET ${filter.offset}`, filter.params);
    let items = [];
    if (orders.length) {
      [items] = await db.execute(`SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, oi.total_price, oi.addons_snapshot
        FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.company_id = ? AND o.id IN (${orders.map(() => '?').join(',')}) ORDER BY oi.id`, [req.tenantId, ...orders.map(order => order.id)]);
    }
    res.json({ company_id: req.tenantId, orders: orders.map(order => { const {tracking_token,...data}=order;return { ...data, tracking_url:typeof tracking_token==='string'&&/^[a-f0-9]{64}$/.test(tracking_token)?'/track.html#'+tracking_token:null, created_at: utcDate(order.created_at), items: items.filter(item => item.order_id === order.id) }; }),
      counts, latest_pending_id: latestPendingId, total: Number(total.total), offset: filter.offset, limit: filter.limit, server_time: new Date().toISOString() });
  }));
}
module.exports = { boardFilter, utcDate, installOrderBoard };
