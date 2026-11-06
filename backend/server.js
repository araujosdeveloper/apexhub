const mysql = require('mysql2/promise');
const { createApp } = require('./src/app');
const {configuration}=require('./src/jwt');
const jwt=configuration(process.env,{required:process.env.NODE_ENV==='production'});
if (!process.env.DB_PASSWORD) throw new Error('Configure DB_PASSWORD antes de iniciar a API. Consulte .env.example.');
if (process.env.NODE_ENV === 'production' && process.env.SECURE_COOKIES !== 'true') throw new Error('Produção exige HTTPS e SECURE_COOKIES=true.');
const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'delivery_app',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'delivery_saas_db',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
});
async function start() {
  await db.execute('SELECT 1');
  // Falha antes de aceitar tráfego quando o banco ainda não recebeu a migração.
  for (const sql of [
    'SELECT id,cookie_hash,admin_id,master_session_hash,company_id,owner_id,exchanged,expires_at FROM platform_impersonations LIMIT 0',
    'SELECT id,name,email,password_hash,active FROM platform_admins LIMIT 0',
    'SELECT token_hash,admin_id,expires_at FROM platform_sessions LIMIT 0',
    'SELECT id,admin_id,action,entity_id,details FROM platform_audit LIMIT 0',
    'SELECT id, company_id, code, config, version, usage_count FROM company_coupons LIMIT 0',
    'SELECT product_id, config, version FROM product_addons LIMIT 0',
    'SELECT id,tenant_id,product_id,option_key,group_key,name,additional_price,max_quantity,is_active,created_at FROM product_options LIMIT 0',
    'SELECT created_at,image_url FROM products LIMIT 0',
    'SELECT created_at FROM categories LIMIT 0',
    'SELECT company_id,kind,content_type,content,digest FROM store_images LIMIT 0',
    'SELECT company_id, config FROM company_operations LIMIT 0',
    'SELECT id, name, slug, whatsapp_phone, active FROM companies LIMIT 0',
    'SELECT id, company_id, name, email, password_hash, role, active FROM users LIMIT 0',
    'SELECT token_hash, user_id, expires_at FROM sessions LIMIT 0',
    'SELECT company_id, plan_code, status, trial_ends_at FROM subscriptions LIMIT 0',
    'SELECT id, company_id, name, sort_order, active FROM categories LIMIT 0',
    'SELECT id, company_id, category_id, name, description, price, active FROM products LIMIT 0',
    'SELECT id, company_id, name, phone, address_street, address_number, address_neighborhood FROM customers LIMIT 0',
    'SELECT id, company_id, customer_id, total_amount, coupon_code, discount_amount, coupon_snapshot, customer_phone_key, fulfillment_method, delivery_fee, fulfillment_address, estimated_minutes, status, payment_method, notes, snapshot_source, customer_name, customer_phone, address_street, address_number, address_neighborhood, created_at FROM orders LIMIT 0',
    'SELECT order_id, product_id, product_name, quantity, unit_price, total_price, addons_snapshot FROM order_items LIMIT 0',
    'SELECT company_id, request_key, request_hash, order_id FROM checkout_requests LIMIT 0'
  ]) await db.execute(sql);
  const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === 'true',jwt });
  const server = app.listen(Number(process.env.PORT || 3000), () => console.log('Delivery SaaS: API iniciada.'));
  const shutdown = () => { app.locals.orderEvents.closeAll(); server.close(async () => { await db.end(); process.exit(0); }); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
start().catch(err => { console.error('Falha ao iniciar a API:', err.code || err.name); console.error('Confira as credenciais e o esquema do banco conforme README.md.'); process.exit(1); });
