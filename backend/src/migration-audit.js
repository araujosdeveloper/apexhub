// Gera somente SELECTs agregados, sem valores identificáveis dos registros.
function buildAuditSql(inventory) {
 if (!Array.isArray(inventory?.columns)) throw new Error('Inventário sem colunas.');
 const has = (table, ...columns) => columns.every(name => inventory.columns.some(c => c.table === table && c.name === name));
 const checks = [];
 const add = (code, query) => checks.push(`SELECT '${code}' AS check_name, COUNT(*) AS issues FROM ${query};`);
 for (const [table, cols, code] of [
  ['companies', ['slug'], 'duplicate_company_slug'], ['customers', ['company_id', 'phone'], 'duplicate_customer_phone'],
  ['users', ['email'], 'duplicate_user_email'], ['subscriptions', ['company_id'], 'duplicate_subscription']
 ]) {
  if (has(table, ...cols)) add(code, `(SELECT 1 FROM \`${table}\` GROUP BY ${cols.map(c => `\`${c}\``).join(', ')} HAVING COUNT(*) > 1) duplicates`);
 }
 const relations = [
  ['categories', 'company_id', 'companies'], ['products', 'company_id', 'companies'], ['products', 'category_id', 'categories'],
  ['customers', 'company_id', 'companies'], ['orders', 'company_id', 'companies'], ['orders', 'customer_id', 'customers'],
  ['order_items', 'order_id', 'orders'], ['order_items', 'product_id', 'products'], ['users', 'company_id', 'companies']
 ];
 for (const [table, fk, parent] of relations) {
  if (has(table, fk) && has(parent, 'id')) add(`orphan_${table}_${fk}`, `\`${table}\` c LEFT JOIN \`${parent}\` p ON p.id = c.\`${fk}\` WHERE p.id IS NULL`);
 }
 if (has('products', 'category_id', 'company_id') && has('categories', 'id', 'company_id')) add('cross_company_product_category', 'products p JOIN categories c ON c.id = p.category_id WHERE p.company_id <> c.company_id');
 if (has('orders', 'customer_id', 'company_id') && has('customers', 'id', 'company_id')) add('cross_company_order_customer', 'orders o JOIN customers c ON c.id = o.customer_id WHERE o.company_id <> c.company_id');
 if (has('order_items', 'order_id', 'product_id') && has('orders', 'id', 'company_id') && has('products', 'id', 'company_id')) add('cross_company_order_product', 'order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id WHERE o.company_id <> p.company_id');
 if (has('products', 'price')) add('invalid_product_price', 'products WHERE price IS NULL OR price < 0');
 if (has('order_items', 'quantity', 'unit_price', 'total_price')) add('invalid_order_item_amount', 'order_items WHERE quantity IS NULL OR quantity <= 0 OR unit_price IS NULL OR unit_price < 0 OR total_price IS NULL OR total_price < 0 OR ABS(total_price - quantity * unit_price) > 0.005');
 if (has('orders', 'status')) add('unknown_order_status', "orders WHERE status IS NULL OR status NOT IN ('pending','preparing','ready','delivering','completed','cancelled')");
 if (has('orders', 'delivery_fee')) add('invalid_delivery_fee', 'orders WHERE delivery_fee < 0');
 if (has('orders', 'id', 'total_amount') && has('order_items', 'order_id', 'total_price')) add('review_order_total', `orders o LEFT JOIN (SELECT order_id, SUM(total_price) AS items_total FROM order_items GROUP BY order_id) i ON i.order_id = o.id WHERE o.total_amount IS NULL OR i.order_id IS NULL OR ABS(o.total_amount - i.items_total${has('orders', 'delivery_fee') ? ' - COALESCE(o.delivery_fee, 0)' : ''}${has('orders', 'discount_amount') ? ' + o.discount_amount' : ''}) > 0.005`);
 if (has('orders', 'discount_amount')) add('invalid_order_discount', 'orders WHERE discount_amount IS NULL OR discount_amount < 0');
 if (has('company_coupons', 'company_id', 'code', 'usage_count') && has('orders', 'company_id', 'coupon_code')) add('coupon_usage_mismatch', `company_coupons c LEFT JOIN (SELECT company_id, coupon_code, COUNT(*) AS n FROM orders WHERE coupon_code <> '' GROUP BY company_id, coupon_code) u ON u.company_id = c.company_id AND u.coupon_code = c.code WHERE c.usage_count <> COALESCE(u.n, 0)`);
 if (has('delivery_assignments','company_id','order_id') && has('orders','company_id')) add('cross_company_delivery_order','delivery_assignments a JOIN orders o ON o.id=a.order_id WHERE a.company_id<>o.company_id');
 if (has('delivery_assignments','company_id','driver_id') && has('delivery_drivers','company_id')) add('cross_company_delivery_driver','delivery_assignments a JOIN delivery_drivers d ON d.id=a.driver_id WHERE a.company_id<>d.company_id');
 if (has('companies', 'slug')) add('missing_company_slug', "companies WHERE slug IS NULL OR TRIM(slug) = ''");
 return checks.length ? checks.join('\n') + '\n' : "SELECT 'no_compatible_checks' AS check_name, 0 AS issues;\n";
}
module.exports = { buildAuditSql };
