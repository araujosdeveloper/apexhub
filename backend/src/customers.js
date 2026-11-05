const {requireRoles}=require('./middlewares/auth');
const { asyncRoute } = require('./auth');
const { utcDate } = require('./order-board');

// Normalização somente de leitura: não funde cadastros nem reescreve pedidos.
const MEMBERS = `WITH raw_customers AS (
  SELECT c.*, REGEXP_REPLACE(c.phone, '[^0-9]', '') AS digits,
    REGEXP_REPLACE(c.phone, '^[[:space:]]+|[[:space:]]+$', '') AS clean_phone
  FROM customers c WHERE c.company_id = ?
), normalized_customers AS (
  SELECT r.*, CASE WHEN CHAR_LENGTH(clean_phone) BETWEEN 10 AND 25 AND clean_phone REGEXP '^[+0-9[:space:]().-]+$'
    THEN CASE WHEN CHAR_LENGTH(digits) IN (10,11) AND LEFT(clean_phone,1) <> '+' THEN CONCAT('55',digits)
      WHEN digits REGEXP '^55[0-9]{10,11}$' THEN digits ELSE NULL END
    ELSE NULL END AS phone_key FROM raw_customers r
), members AS (
  SELECT n.*, COALESCE(CONCAT('p:',phone_key),CONCAT('c:',id)) AS contact_key FROM normalized_customers n
)`;
const CRM = `${MEMBERS}, source_orders AS (
  SELECT o.id,o.company_id,o.customer_id,o.status,o.total_amount,o.discount_amount,o.created_at
  FROM orders o WHERE o.company_id = ?
), member_activity AS (
  SELECT customer_id, MAX(created_at) AS last_order_at FROM source_orders GROUP BY customer_id
), ranked_members AS (
  SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.contact_key ORDER BY a.last_order_at DESC,m.id DESC) AS member_rank,
    MIN(m.id) OVER (PARTITION BY m.contact_key) AS contact_id
  FROM members m LEFT JOIN member_activity a ON a.customer_id = m.id
), contact_totals AS (
  SELECT m.contact_key, COUNT(o.id) AS order_count,
    SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS purchase_count,
    SUM(CASE WHEN o.status IN ('pending','preparing','ready','delivering') THEN 1 ELSE 0 END) AS active_orders,
    SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
    SUM(CASE WHEN o.status = 'completed' AND o.total_amount >= 0 THEN o.total_amount ELSE 0 END) AS total_spent,
    SUM(CASE WHEN o.status = 'completed' AND o.total_amount >= 0 THEN 1 ELSE 0 END) AS valued_purchases,
    SUM(CASE WHEN o.status = 'completed' AND (o.total_amount IS NULL OR o.total_amount < 0) THEN 1 ELSE 0 END) AS unknown_value_orders,
    MIN(CASE WHEN o.status = 'completed' THEN o.created_at END) AS first_purchase_at,
    MAX(CASE WHEN o.status = 'completed' THEN o.created_at END) AS last_purchase_at,
    MAX(o.created_at) AS last_order_at
  FROM members m LEFT JOIN source_orders o ON o.customer_id = m.id AND o.company_id = m.company_id GROUP BY m.contact_key
), crm AS (
  SELECT r.contact_id AS id,r.contact_key,r.name,r.phone,r.phone_key,r.address_street,r.address_number,r.address_neighborhood,
    t.order_count,t.purchase_count,t.active_orders,t.cancelled_orders,t.total_spent,t.unknown_value_orders,
    CASE WHEN t.valued_purchases > 0 THEN ROUND(t.total_spent / t.valued_purchases,2) ELSE NULL END AS average_order,
    t.first_purchase_at,t.last_purchase_at,t.last_order_at,
    CASE WHEN t.last_purchase_at IS NULL THEN NULL ELSE GREATEST(0,TIMESTAMPDIFF(DAY,t.last_purchase_at,?)) END AS days_since_purchase
  FROM ranked_members r JOIN contact_totals t ON t.contact_key = r.contact_key WHERE r.member_rank = 1
)`;
const SEGMENTS = {
  all: '1 = 1', recent: 'purchase_count > 0 AND days_since_purchase < 15', repeat: 'purchase_count >= 2',
  no_purchases: 'purchase_count = 0', inactive15: 'purchase_count > 0 AND active_orders = 0 AND days_since_purchase >= 15',
  inactive30: 'purchase_count > 0 AND active_orders = 0 AND days_since_purchase >= 30',
  inactive60: 'purchase_count > 0 AND active_orders = 0 AND days_since_purchase >= 60'
};
function filters(query) {
  const { search = '', segment = 'all', sort = 'recent', offset = '0', limit = '50' } = query;
  if (typeof search !== 'string' || search.length > 80 || typeof segment !== 'string' || !Object.hasOwn(SEGMENTS,segment) ||
    !['recent','value','purchases','name'].includes(sort) || typeof offset !== 'string' || !/^\d{1,6}$/.test(offset) || Number(offset) > 100000 ||
    typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Filtros de clientes inválidos.');
  const conditions = [SEGMENTS[segment]], params = [];
  if (search.trim()) {
    const pattern = '%' + search.trim().replace(/[=%_]/g,'=$&') + '%';
    const digits = search.replace(/\D/g,'');
    conditions.push(`(name LIKE ? ESCAPE '=' OR phone LIKE ? ESCAPE '='${digits.length >= 3 ? " OR phone_key LIKE ? ESCAPE '='" : ''})`);
    params.push(pattern,pattern); if (digits.length >= 3) params.push('%' + digits + '%');
  }
  const order = { recent: 'last_order_at DESC,id DESC', value: 'total_spent DESC,id DESC', purchases: 'purchase_count DESC,id DESC', name: 'name ASC,id ASC' }[sort];
  return { where: conditions.join(' AND '), params, order, offset: Number(offset), limit: Number(limit) };
}
function customerView(row) {
  const { contact_key, ...customer } = row;
  for (const key of ['order_count','purchase_count','active_orders','cancelled_orders','unknown_value_orders']) customer[key] = Number(customer[key] || 0);
  customer.days_since_purchase = customer.days_since_purchase === null ? null : Number(customer.days_since_purchase);
  for (const key of ['first_purchase_at','last_purchase_at','last_order_at']) customer[key] = customer[key] ? utcDate(customer[key]) : null;
  return customer;
}
async function readSnapshot(db, action) {
  const conn = await db.getConnection();
  try { await conn.beginTransaction(); const result = await action(conn); await conn.commit(); return result; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
function installCustomers(app, db, auth) {
  const permitted = requireRoles('tenant_owner','tenant_manager');
  app.get('/api/admin/customers', auth, permitted, asyncRoute(async (req,res) => {
    let selection;
    try { selection = filters(req.query); } catch (error) { return res.status(400).json({ error: error.message }); }
    const now = new Date().toISOString(), args = [req.tenantId,req.tenantId,now.slice(0,19).replace('T',' ')];
    const data = await readSnapshot(db, async conn => {
      const [[summary]] = await conn.execute(`${CRM} SELECT COUNT(*) AS contacts,
        COALESCE(SUM(CASE WHEN purchase_count >= 2 THEN 1 ELSE 0 END),0) AS repeat_contacts,
        COALESCE(SUM(CASE WHEN purchase_count > 0 AND active_orders = 0 AND days_since_purchase >= 30 THEN 1 ELSE 0 END),0) AS inactive30,
        COALESCE(SUM(total_spent),0) AS total_spent, COALESCE(SUM(unknown_value_orders),0) AS unknown_value_orders FROM crm`, args);
      const [[count]] = await conn.execute(`${CRM} SELECT COUNT(*) AS total FROM crm WHERE ${selection.where}`, [...args,...selection.params]);
      const [rows] = await conn.execute(`${CRM} SELECT * FROM crm WHERE ${selection.where} ORDER BY ${selection.order} LIMIT ${selection.limit} OFFSET ${selection.offset}`, [...args,...selection.params]);
      return { customers: rows.map(customerView), total: Number(count.total), summary: { ...summary, contacts: Number(summary.contacts), repeat_contacts: Number(summary.repeat_contacts), inactive30: Number(summary.inactive30), unknown_value_orders: Number(summary.unknown_value_orders) } };
    });
    res.json({ ...data, company_id: req.tenantId, offset: selection.offset, limit: selection.limit, server_time: now });
  }));
  app.get('/api/admin/customers/:id', auth, permitted, asyncRoute(async (req,res) => {
    const id = Number(req.params.id); let page;
    try { page = filters({ offset: req.query.offset, limit: req.query.limit }); if (!Number.isSafeInteger(id) || id < 1) throw new Error('Cliente inválido.'); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const companyId = req.tenantId, now = new Date().toISOString();
    const data = await readSnapshot(db, async conn => {
      const [anchors] = await conn.execute(`${MEMBERS} SELECT contact_key FROM members WHERE id = ?`, [companyId,id]);
      if (!anchors.length) return null;
      const key = anchors[0].contact_key;
      const [profiles] = await conn.execute(`${CRM} SELECT * FROM crm WHERE contact_key = ?`, [companyId,companyId,now.slice(0,19).replace('T',' '),key]);
      if (!profiles.length) return null;
      const [orders] = await conn.execute(`${MEMBERS} SELECT o.id,o.total_amount,o.status,o.payment_method,o.notes,o.created_at,o.snapshot_source,
        o.customer_name,o.customer_phone,o.address_street,o.address_number,o.address_neighborhood,
        o.fulfillment_method,o.delivery_fee,o.fulfillment_address,o.estimated_minutes,o.coupon_code,o.discount_amount,o.coupon_snapshot
        FROM orders o JOIN members m ON m.id = o.customer_id AND m.company_id = o.company_id
        WHERE o.company_id = ? AND m.contact_key = ? ORDER BY o.created_at DESC,o.id DESC LIMIT ${page.limit} OFFSET ${page.offset}`, [companyId,companyId,key]);
      let items = [];
      if (orders.length) [items] = await conn.execute(`SELECT oi.id,oi.order_id,oi.product_id,oi.product_name,oi.quantity,oi.unit_price,oi.total_price,oi.addons_snapshot
        FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.company_id = ? AND o.id IN (${orders.map(() => '?').join(',')}) ORDER BY oi.id`, [companyId,...orders.map(order => order.id)]);
      const [favorites] = await conn.execute(`${MEMBERS} SELECT oi.product_id,oi.product_name,SUM(oi.quantity) AS quantity
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN members m ON m.id = o.customer_id AND m.company_id = o.company_id
        WHERE o.company_id = ? AND m.contact_key = ? AND o.status = 'completed' GROUP BY oi.product_id,oi.product_name ORDER BY quantity DESC,oi.product_name ASC LIMIT 5`, [companyId,companyId,key]);
      return { customer: customerView(profiles[0]), orders: orders.map(order => ({ ...order, created_at: utcDate(order.created_at), items: items.filter(item => item.order_id === order.id) })), favorites: favorites.map(item => ({ ...item, quantity: Number(item.quantity) })), total: Number(profiles[0].order_count) };
    });
    if (!data) return res.status(404).json({ error: 'Cliente não encontrado nesta loja.' });
    res.json({ ...data, company_id: companyId, offset: page.offset, limit: page.limit, server_time: now });
  }));
}
module.exports = { filters, customerView, installCustomers };
