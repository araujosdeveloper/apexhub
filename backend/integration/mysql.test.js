const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const { serve } = require('../test-support/http');
const { analyzeInventory } = require('../src/migration-plan');
const { buildAuditSql } = require('../src/migration-audit');
test('MySQL: duas lojas, catálogo, isolamento e checkout concorrente', { timeout: 120000 }, async t => {
 t.diagnostic('Runtime da integração: ' + process.version);
 const database = process.env.DB_NAME;
 assert.match(database || '', /_test$/, 'A integração exige banco dedicado terminado em _test.');
 const db = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database, connectionLimit: 5 });
 const companyIds = [];
 t.after(async () => {
  try {
   for (const id of companyIds) {
    await db.execute('DELETE FROM checkout_requests WHERE company_id = ?', [id]);
    await db.execute('DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.company_id = ?', [id]);
    await db.execute('DELETE r FROM order_reviews r JOIN orders o ON r.order_id=o.id WHERE o.company_id=?',[id]);
    await db.execute('DELETE t FROM order_tracking t JOIN orders o ON t.order_id=o.id WHERE o.company_id=?',[id]);
    await db.execute('DELETE i FROM product_images i JOIN products p ON i.product_id=p.id WHERE p.company_id=?',[id]);
    await db.execute('DELETE a FROM product_addons a JOIN products p ON a.product_id = p.id WHERE p.company_id = ?', [id]);
    for (const table of ['platform_impersonations','platform_tenant_profiles', 'company_merchandising', 'delivery_assignments', 'delivery_drivers', 'orders', 'customers', 'products', 'categories', 'subscriptions', 'company_operations', 'company_coupons']) await db.execute(`DELETE FROM ${table} WHERE company_id = ?`, [id]);
    await db.execute('DELETE s FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.company_id = ?', [id]);
    await db.execute('DELETE FROM users WHERE company_id = ?', [id]);
    await db.execute('DELETE FROM companies WHERE id = ?', [id]);
   }
  } finally { await db.end(); }
 });
 for (const filename of ['001-initial.sql', '002-checkout-requests.sql']) {
  const sql = fs.readFileSync(path.join(__dirname, '../../database', filename), 'utf8').replace(/^--.*$/gm, '');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
 }
 t.diagnostic('Esquema inicial e tabela de idempotência aplicados no MySQL real.');
 const request = await serve(t, db,{jwt:require('../test-support/jwt').testJwt(),menuImportExtractor:async()=>({categories:[{name:'Prévia',products:[{name:'Produto da prévia',description:'',price:'1.00'}]}]})});
 const json = (method, body, cookie, key) => ({ method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
 async function register() {
  const slug = 'test-' + randomUUID();
  const response = await request('/api/auth/register', json('POST', { name: 'Teste', company_name: 'Restaurante Teste', slug, email: slug + '@example.com', password: 'teste-seguro-123456' }));
  assert.equal(response.status, 201);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  const me = await (await request('/api/auth/me', { headers: { Cookie: cookie } })).json();
  companyIds.push(me.user.company_id); return { cookie, id: me.user.company_id, slug };
 }
 const a = await register(); const b = await register();
 t.diagnostic('Cadastro, sessões e identificação de duas lojas validados.');
 const category = await (await request('/api/admin/categories', json('POST', { name: 'Lanches' }, a.cookie))).json();
 const productResponse = await request('/api/admin/products', json('POST', { name: 'Lanche', description: 'Teste', category_id: category.id, price: '12.35' }, a.cookie));
 assert.equal(productResponse.status, 201); const product = await productResponse.json();
 assert.equal((await request('/api/admin/products/' + product.id, json('PUT', { name: 'Invasão', description: '', category_id: category.id, price: '1.00' }, b.cookie))).status, 404);
 t.diagnostic('Criação de catálogo e bloqueio de edição entre lojas validados.');
 const payload = { company_id: a.id, customer: { name: 'Cliente', phone: '11999999999', street: 'Rua A', number: '10', neighborhood: 'Centro' }, items: [{ product_id: product.id, quantity: 2, price: 0.01 }], payment_method: 'Pix', total_amount: 0.02 };
 const key = randomUUID();
 const [first, repeat] = await Promise.all([request('/api/orders', json('POST', payload, null, key)), request('/api/orders', json('POST', payload, null, key))]);
 assert.deepEqual([first.status, repeat.status].sort(), [200, 201]);
 const orderA = await first.json(); const orderB = await repeat.json();
 assert.equal(orderA.tracking_url,orderB.tracking_url);assert.match(orderA.tracking_url,/^\/track.html#[a-f0-9]{64}$/);
 assert.equal(orderA.order_id, orderB.order_id); assert.equal(orderA.total_amount, 24.7);
 const [count] = await db.execute('SELECT COUNT(*) AS total FROM orders WHERE company_id = ?', [a.id]); assert.equal(count[0].total, 1);
 t.diagnostic('Checkout concorrente criou somente um pedido com preço calculado no servidor.');
 const hidden = await request('/api/admin/orders/' + orderA.order_id + '/status', json('PATCH', { status: 'preparing' }, b.cookie)); assert.equal(hidden.status, 404);
 assert.deepEqual(await (await request('/api/admin/orders', { headers: { Cookie: b.cookie } })).json(), []);
 const changed = await request('/api/orders', json('POST', { ...payload, customer: { ...payload.customer, number: '20' } }, null, key)); assert.equal(changed.status, 409);
 const invalid = await request('/api/orders', json('POST', { ...payload, company_id: b.id }, null, randomUUID())); assert.equal(invalid.status, 400);
 t.diagnostic('Isolamento dos pedidos e rejeição de reenvio com dados diferentes validados.');
 const { defaults } = require('../src/operations');
 const operations = { ...defaults(), pickup_enabled: true, pickup_address: 'Rua da Loja, 10', zones_enabled: true, zones: [{ name: 'Centro', fee: '4.50' }] };
 assert.equal((await request('/api/admin/operations', json('PUT', operations, a.cookie))).status, 200);
 const settingsB = await (await request('/api/admin/operations?company_id=' + a.id, { headers: { Cookie: b.cookie } })).json();
 assert.equal(settingsB.operations.zones_enabled, false);
 const paidKey = randomUUID();
 const delivery = await request('/api/orders', json('POST', { ...payload, delivery_fee: '4.50' }, null, paidKey));
 assert.equal(delivery.status, 201); assert.equal((await delivery.json()).total_amount, 29.2);
 assert.equal((await request('/api/orders', json('POST', payload, null, randomUUID()))).status, 409);
 assert.equal((await request('/api/orders', json('POST', { ...payload, customer: { ...payload.customer, neighborhood: 'Fora da área' }, delivery_fee: '4.50' }, null, randomUUID()))).status, 400);
 const pickup = await request('/api/orders', json('POST', { ...payload, fulfillment_method: 'pickup', customer: { name: 'Cliente', phone: payload.customer.phone } }, null, randomUUID()));
 assert.equal(pickup.status, 201); const pickupOrder = await pickup.json(); assert.equal(pickupOrder.delivery_fee, 0);
 const [[customer]] = await db.execute('SELECT address_street, address_number, address_neighborhood FROM customers WHERE company_id = ? AND phone = ?', [a.id, payload.customer.phone]);
 assert.equal(customer.address_street, 'Rua A'); assert.equal(customer.address_number, '10'); assert.equal(customer.address_neighborhood, 'Centro');
 assert.equal((await request('/api/admin/orders/' + pickupOrder.order_id + '/status', json('PATCH', { status: 'preparing' }, a.cookie))).status, 200);
 assert.equal((await request('/api/admin/orders/' + pickupOrder.order_id + '/status', json('PATCH', { status: 'ready' }, a.cookie))).status, 200);
 assert.equal((await request('/api/admin/orders/' + pickupOrder.order_id + '/status', json('PATCH', { status: 'delivering' }, a.cookie))).status, 409);
 assert.equal((await request('/api/admin/operations', json('PUT', { ...operations, mode: 'paused' }, a.cookie))).status, 200);
 assert.equal((await request('/api/orders', json('POST', { ...payload, delivery_fee: '4.50' }, null, randomUUID()))).status, 409);
 const replay = await request('/api/orders', json('POST', { ...payload, delivery_fee: '4.50' }, null, paidKey));
 assert.equal(replay.status, 200); assert.equal((await replay.json()).total_amount, 29.2);
 const [history] = await db.execute('SELECT fulfillment_method, delivery_fee, fulfillment_address FROM orders WHERE company_id = ? ORDER BY id', [a.id]);
 assert.equal(history[0].fulfillment_method, 'delivery'); assert.equal(Number(history[0].delivery_fee), 0);
 assert.equal(history[2].fulfillment_method, 'pickup'); assert.equal(history[2].fulfillment_address, operations.pickup_address);
 t.diagnostic('Taxas, retirada, pausa, reenvio e isolamento das configurações validados no MySQL.');
 const addonGroups = require('../test/fixtures/addons.json');
 const addonUrl = '/api/admin/products/' + product.id + '/addons';
 assert.equal((await request(addonUrl, json('PUT', { version: 0, groups: addonGroups }, b.cookie))).status, 404);
 assert.equal((await request(addonUrl, json('PUT', { version: 0, groups: addonGroups }, a.cookie))).status, 200);
 const newGroups = structuredClone(addonGroups); newGroups[1].options[0].name = 'Queijo especial';
 const edits = await Promise.all([request(addonUrl, json('PUT', { version: 1, groups: newGroups }, a.cookie)), request(addonUrl, json('PUT', { version: 1, groups: newGroups }, a.cookie))]);
 assert.deepEqual(edits.map(response => response.status).sort(), [200, 409]);
 assert.equal((await request('/api/admin/operations', json('PUT', operations, a.cookie))).status, 200);
 const variants = { ...payload, delivery_fee: '4.50', items: [
  { product_id: product.id, quantity: 2, option_ids: ['ketchup', 'cheese'], addon_version: 2, price: 0.01 },
  { product_id: product.id, quantity: 1, option_ids: ['mayo'], addon_version: 2 }
 ] };
 const variantKey = randomUUID();
 const variantRequests = await Promise.all([request('/api/orders', json('POST', variants, null, variantKey)), request('/api/orders', json('POST', variants, null, variantKey))]);
 assert.deepEqual(variantRequests.map(response => response.status).sort(), [200, 201]);
 const variantOrder = await variantRequests[0].json(); assert.equal(variantOrder.total_amount, 47.05);
 const [snapshots] = await db.execute('SELECT unit_price, total_price, addons_snapshot FROM order_items WHERE order_id = ?', [variantOrder.order_id]);
 assert.equal(snapshots.length, 2);
 const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
 const cheese = snapshots.find(row => decode(row.addons_snapshot).some(option => option.option_id === 'cheese'));
 assert.equal(cheese.unit_price, '14.85'); assert.equal(cheese.total_price, '29.70');
 assert.equal((await request('/api/orders', json('POST', { ...variants, items: [{ product_id: product.id, quantity: 1, option_ids: [], addon_version: 2 }] }, null, randomUUID()))).status, 400);
 const removedGroups = structuredClone(newGroups); removedGroups[1].options[0].active = false;
 assert.equal((await request(addonUrl, json('PUT', { version: 2, groups: removedGroups }, a.cookie))).status, 200);
 assert.equal((await request('/api/orders', json('POST', variants, null, randomUUID()))).status, 400);
 assert.equal((await request('/api/orders', json('POST', variants, null, variantKey))).status, 200);
 const [[originalSnapshot]] = await db.execute('SELECT addons_snapshot FROM order_items WHERE order_id = ? AND unit_price = 14.85', [variantOrder.order_id]);
 assert.equal(decode(originalSnapshot.addons_snapshot).find(option => option.option_id === 'cheese').name, 'Queijo especial');
 t.diagnostic('Adicionais: edição concorrente, isolamento, preços, variações, snapshots e checkout concorrente validados.');
 const { verifyOrderStream } = require('./order-stream');
 await verifyOrderStream(db, { cookie: a.cookie, otherCookie: b.cookie, orderId: variantOrder.order_id });
 t.diagnostic('Gestor/cozinha: SSE HTTP real, filtros, isolamento e conflito entre operadores validados.');
 const { verifyCoupons } = require('./coupons');
 await verifyCoupons(db, request, { a, b, productId: product.id, json });
 await require('./customers').verifyCustomers(db, request, { a, b, productId: product.id });
 await require('./drivers').verifyDrivers(db,request,{a,b,orderId:variantOrder.order_id,pickupId:pickupOrder.order_id,json});
 await require('./menu-import').verifyMenuImport(db,request,{a,b});
 await require('./tenant-menu').verifyTenantMenu(db,request,{a,b});
 await require('./reports').verifyReports(db,request,{a,b,productId:product.id});
 await require('./team').verifyTeam(db,request,{a,b,json});
 await require('./merchandising').verifyMerchandising(db,request,{a,b,json});
 await require('./product-images').verifyProductImages(db,request,{a,b,json,productId:product.id});
 await require('./order-tracking').verifyOrderTracking(db,request,{a,b,json,orderId:orderA.order_id,originalUrl:orderA.tracking_url});
 await require('./reviews').verifyReviews(db,request,{a,b,json});
 await require('./dashboard').verifyDashboard(db,request,{a,b});
 await require('./jwt-rbac').verifyJwtRbac(db,request,{a,b,json});
 t.diagnostic('JWT/RBAC: emissão, claims, tenant, IDOR, perfis e revogação aprovados.');
 await require('./master').verifyMaster(db,request,{a,b,json});
 t.diagnostic('Master: autenticação exclusiva, busca, revisão, suspensão, sessões e auditoria aprovados.');
 t.diagnostic('Acesso assistido: emissão, troca única, imagens, isolamento, suspensão e revogação pelo Master aprovados.');
 t.diagnostic('API Super Admin: cadastro transacional, paginação, status, revogação, métricas e restrição de perfil aprovados.');
 t.diagnostic('ApexHub: indicadores, receita bruta, origem, busca e isolamento aprovados.');
 t.diagnostic('Avaliações: conclusão, nota, idempotência, concorrência e isolamento aprovados.');
 t.diagnostic('Acompanhamento: checkout/reenvio, token privado, status, legado e isolamento aprovados.');
 t.diagnostic('Fotos: upload, leitura binária, categorias pausadas, remoção e isolamento aprovados.');
 t.diagnostic('Vitrine: popularidade, combinações, indisponibilidade, concorrência e isolamento aprovados.');
 t.diagnostic('Equipe: permissões, proteção do dono, bloqueio, senha, sessões e concorrência aprovados.');
 t.diagnostic('Relatórios: período/fuso, totais, pagamentos, produtos, dias vazios e isolamento aprovados.');
 t.diagnostic('Entregadores: concorrência, isolamento, snapshots e bloqueio durante entrega aprovados.');
 t.diagnostic('CRM: agrupamento por telefone, compras, inatividade e isolamento aprovados.');
 t.diagnostic('Cupons: limites concorrentes, telefone, primeira compra, frete grátis, percentual, histórico e isolamento aprovados.');


 // Exercita o DDL em tabelas exclusivas, com dados anteriores, sem tocar nas tabelas da aplicação.
 for (const type of ['INT', 'INT UNSIGNED']) for (const existingFee of [false, true]) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const names = {categories:'mig_categories_'+suffix,product_options:'mig_options_'+suffix, platform_impersonations:'mig_assisted_'+suffix,users:'mig_users_'+suffix,platform_admins:'mig_master_admins_'+suffix,platform_sessions:'mig_master_sessions_'+suffix,platform_audit:'mig_master_audit_'+suffix,platform_tenant_profiles:'mig_master_profiles_'+suffix,companies: 'mig_companies_' + suffix, orders: 'mig_orders_' + suffix, company_operations: 'mig_operations_' + suffix, products: 'mig_products_' + suffix, order_items: 'mig_items_' + suffix, product_addons: 'mig_addons_' + suffix, company_coupons: 'mig_coupons_' + suffix, delivery_drivers:'mig_drivers_'+suffix,delivery_assignments:'mig_assignments_'+suffix,company_merchandising:'mig_merch_'+suffix,product_images:'mig_images_'+suffix,order_tracking:'mig_tracking_'+suffix,order_reviews:'mig_reviews_'+suffix };
  const connection = await db.getConnection();
  try {
   await connection.query(`CREATE TABLE ${names.companies} (id ${type} PRIMARY KEY) ENGINE=InnoDB`);
   await connection.query(`CREATE TABLE ${names.orders} (id ${type} PRIMARY KEY, company_id ${type} NOT NULL DEFAULT 1, total_amount DECIMAL(10,2) NOT NULL${existingFee ? ', delivery_fee DECIMAL(10,2) NULL' : ''}) ENGINE=InnoDB`);
   await connection.query(`CREATE TABLE ${names.products} (id ${type} PRIMARY KEY) ENGINE=InnoDB`);
   await connection.query(`CREATE TABLE ${names.order_items} (id INT PRIMARY KEY, selected_options JSON NULL) ENGINE=InnoDB`);
   await connection.query(`INSERT INTO ${names.companies} VALUES (1)`);
   await connection.query(`INSERT INTO ${names.orders} (id, total_amount${existingFee ? ', delivery_fee' : ''}) VALUES (1, 12.35${existingFee ? ', 3.50' : ''})`);
   if (existingFee) await connection.query(`INSERT INTO ${names.orders} (id, total_amount, delivery_fee) VALUES (2, 10.00, NULL)`);
   await connection.query(`INSERT INTO ${names.products} VALUES (1)`);
   await connection.query(`INSERT INTO ${names.order_items} VALUES (1, '{"legacy":true}')`);
   let migration = fs.readFileSync(path.join(__dirname, '../../database/004-store-operations.sql'), 'utf8').replace(/^--.*$/gm, '');
   migration = migration.replace(/\b(companies|orders|company_operations)\b/g, name => names[name]).replaceAll('orders_delivery_fee_nonnegative', 'fee_' + suffix);
   for (const sql of migration.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(sql);
   const [[oldOrder]] = await connection.query(`SELECT * FROM ${names.orders} WHERE id = 1`);
   assert.equal(oldOrder.total_amount, '12.35'); assert.equal(oldOrder.fulfillment_method, 'delivery'); assert.equal(oldOrder.delivery_fee, existingFee ? '3.50' : '0.00'); assert.equal(oldOrder.estimated_minutes, null);
   if (existingFee) { const [[nullableFee]] = await connection.query(`SELECT delivery_fee FROM ${names.orders} WHERE id = 2`); assert.equal(nullableFee.delivery_fee, null); }
   await connection.execute(`INSERT INTO ${names.company_operations} (company_id, config) VALUES (?, ?)`, [1, JSON.stringify(operations)]);
   await assert.rejects(connection.execute(`INSERT INTO ${names.company_operations} (company_id, config) VALUES (?, ?)`, [999, JSON.stringify(operations)]), error => error.code === 'ER_NO_REFERENCED_ROW_2');
   const addonsMigration = fs.readFileSync(path.join(__dirname, '../../database/005-product-addons.sql'), 'utf8').replace(/^--.*$/gm, '').replace(/\b(products|order_items|product_addons)\b/g, name => names[name]);
   for (const sql of addonsMigration.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(sql);
   const [[oldItem]] = await connection.query(`SELECT selected_options, addons_snapshot FROM ${names.order_items} WHERE id = 1`);
   assert.deepEqual(decode(oldItem.selected_options), { legacy: true }); assert.equal(oldItem.addons_snapshot, null);
   await connection.execute(`INSERT INTO ${names.product_addons} (product_id, config, version) VALUES (?, ?, ?)`, [1, JSON.stringify(addonGroups), 1]);
   await assert.rejects(connection.execute(`INSERT INTO ${names.product_addons} (product_id, config, version) VALUES (?, ?, ?)`, [999, '[]', 1]), error => error.code === 'ER_NO_REFERENCED_ROW_2');
   const couponMigration = fs.readFileSync(path.join(__dirname, '../../database/006-coupons.sql'), 'utf8').replace(/^--.*$/gm, '').replace(/\b(companies|orders|company_coupons)\b/g, name => names[name]).replaceAll('orders_discount_nonnegative', 'discount_' + suffix);
   for (const sql of couponMigration.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(sql);
   const [[couponOrder]] = await connection.query(`SELECT total_amount, coupon_code, discount_amount, coupon_snapshot, customer_phone_key FROM ${names.orders} WHERE id = 1`);
   assert.equal(couponOrder.total_amount, '12.35'); assert.equal(couponOrder.coupon_code, ''); assert.equal(couponOrder.discount_amount, '0.00'); assert.equal(couponOrder.coupon_snapshot, null); assert.equal(couponOrder.customer_phone_key, null);
   await connection.execute(`INSERT INTO ${names.company_coupons} (company_id, code, config) VALUES (?, ?, ?)`, [1, 'TESTE', '{}']);
   await assert.rejects(connection.execute(`INSERT INTO ${names.company_coupons} (company_id, code, config) VALUES (?, ?, ?)`, [999, 'OUTRO', '{}']), error => error.code === 'ER_NO_REFERENCED_ROW_2');
   const driverMigration=fs.readFileSync(path.join(__dirname,'../../database/007-delivery-drivers.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(companies|orders|delivery_drivers|delivery_assignments)\b/g,name=>names[name]);
   for(const sql of driverMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   const [driver]=await connection.execute(`INSERT INTO ${names.delivery_drivers}(company_id,name,phone) VALUES (1,'Teste','5511999990000')`);
   await connection.execute(`INSERT INTO ${names.delivery_assignments}(order_id,company_id,driver_id,driver_name,driver_phone) VALUES (1,1,?,'Teste','5511999990000')`,[driver.insertId]);
   const [[preserved]]=await connection.query(`SELECT total_amount FROM ${names.orders} WHERE id=1`);assert.equal(preserved.total_amount,'12.35');
   await assert.rejects(connection.execute(`INSERT INTO ${names.delivery_assignments}(order_id,company_id) VALUES (999,1)`),error=>error.code==='ER_NO_REFERENCED_ROW_2');
   const merchMigration=fs.readFileSync(path.join(__dirname,'../../database/008-menu-merchandising.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(companies|company_merchandising)\b/g,name=>names[name]);
   for(const sql of merchMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   await connection.execute(`INSERT INTO ${names.company_merchandising}(company_id,config) VALUES (1,?)`,[JSON.stringify({popular_enabled:true,suggestions_enabled:true,recommendations:[]})]);
   await assert.rejects(connection.execute(`INSERT INTO ${names.company_merchandising}(company_id,config) VALUES (999,'{}')`),error=>error.code==='ER_NO_REFERENCED_ROW_2');
   const imageMigration=fs.readFileSync(path.join(__dirname,'../../database/009-product-images.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(products|product_images)\b/g,name=>names[name]);
   for(const sql of imageMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   const {png}=require('./product-images');await connection.execute(`INSERT INTO ${names.product_images}(product_id,content_type,content,digest) VALUES (1,'image/png',?,SHA2(?,256))`,[png,png]);
   const [[storedImage]]=await connection.query(`SELECT content FROM ${names.product_images} WHERE product_id=1`);assert.deepEqual(storedImage.content,png);
   const trackingMigration=fs.readFileSync(path.join(__dirname,'../../database/010-order-tracking.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(orders|order_tracking)\b/g,name=>names[name]);
   for(const sql of trackingMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   await connection.execute(`INSERT INTO ${names.order_tracking}(order_id,token) VALUES (1,?)`,['a'.repeat(64)]);
   await assert.rejects(connection.execute(`INSERT INTO ${names.order_tracking}(order_id,token) VALUES (999,?)`,['b'.repeat(64)]),error=>error.code==='ER_NO_REFERENCED_ROW_2');
   const reviewMigration=fs.readFileSync(path.join(__dirname,'../../database/011-order-reviews.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(orders|order_reviews)\b/g,name=>names[name]);
   for(const sql of reviewMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   await connection.execute(`INSERT INTO ${names.order_reviews}(order_id,rating,comment) VALUES (1,5,'Bom')`);
   await assert.rejects(connection.execute(`UPDATE ${names.order_reviews} SET rating=6 WHERE order_id=1`));
   const masterMigration=fs.readFileSync(path.join(__dirname,'../../database/012-platform-master.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(companies|platform_admins|platform_sessions|platform_audit|platform_tenant_profiles)\b/g,name=>names[name]);
   for(const sql of masterMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   await connection.execute(`INSERT INTO ${names.platform_tenant_profiles}(company_id,cnpj) VALUES (1,'MASTERTEST')`);
   await connection.query(`CREATE TABLE ${names.users}(id ${type} PRIMARY KEY) ENGINE=InnoDB`);await connection.execute(`INSERT INTO ${names.users} VALUES (1)`);
   const assistedMigration=fs.readFileSync(path.join(__dirname,'../../database/013-impersonation.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(companies|users|platform_admins|platform_sessions|platform_impersonations)\b/g,name=>names[name]);
   for(const sql of assistedMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   await connection.query(`CREATE TABLE ${names.categories}(id ${type} PRIMARY KEY,company_id ${type} NOT NULL,sort_order INT NOT NULL DEFAULT 0) ENGINE=InnoDB`);
   await connection.query(`ALTER TABLE ${names.products} ADD company_id ${type} NOT NULL DEFAULT 1`);
   if(existingFee){await connection.query(`ALTER TABLE ${names.products} ADD image_url VARCHAR(255) NULL`);await connection.query(`UPDATE ${names.products} SET image_url='https://images.example/legacy.jpg' WHERE id=1`);}
   const menuMigration=fs.readFileSync(path.join(__dirname,'../../database/014-tenant-menu.sql'),'utf8').replace(/^--.*$/gm,'').replace(/\b(companies|products|categories|product_addons|product_options)\b/g,name=>names[name]);
   for(const sql of menuMigration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql);
   if(existingFee){const [[oldImage]]=await connection.query(`SELECT image_url FROM ${names.products} WHERE id=1`);assert.equal(oldImage.image_url,'https://images.example/legacy.jpg');}
   const [[menuOption]]=await connection.query(`SELECT COUNT(*) AS total FROM ${names.product_options}`);assert.equal(Number(menuOption.total),addonGroups.flatMap(group=>group.options).length);
   await connection.query(`INSERT INTO ${names.companies} VALUES(2)`);
   await assert.rejects(connection.query(`INSERT INTO ${names.product_options}(tenant_id,product_id,group_key,option_key,name,additional_price) VALUES (2,1,'g','foreign','Outro',1.00)`),error=>error.code==='ER_NO_REFERENCED_ROW_2');
   const [master]=await connection.execute(`INSERT INTO ${names.platform_admins}(name,email,password_hash) VALUES ('Teste','master@example.com','fixture')`);
   await connection.execute(`INSERT INTO ${names.platform_sessions}(token_hash,admin_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`,['a'.repeat(64),master.insertId]);
   await connection.execute(`INSERT INTO ${names.platform_impersonations}(id,admin_id,master_session_hash,company_id,owner_id,expires_at) VALUES (?,?,?,1,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`,['b'.repeat(64),master.insertId,'a'.repeat(64)]);
   await connection.execute(`DELETE FROM ${names.platform_sessions} WHERE token_hash=?`,['a'.repeat(64)]);const [[children]]=await connection.execute(`SELECT COUNT(*) AS total FROM ${names.platform_impersonations}`);assert.equal(Number(children.total),0);
  } finally {
   try { for (const table of [names.product_options,names.categories,names.platform_impersonations,names.users,names.platform_tenant_profiles,names.platform_sessions,names.platform_audit,names.platform_admins,names.order_reviews,names.order_tracking,names.product_images,names.company_merchandising,names.delivery_assignments,names.delivery_drivers,names.company_coupons, names.product_addons, names.order_items, names.products, names.company_operations, names.orders, names.companies]) await connection.query(`DROP TABLE IF EXISTS ${table}`); }
   finally { connection.release(); }
  }
 }
 t.diagnostic('Migrações 004/005/006/007/008/009/010/011/012/013/014 preservaram pedidos, fretes e opções legadas para IDs INT e INT UNSIGNED.');
 const [metadata] = await db.query(fs.readFileSync(path.join(__dirname, '../../database/inventory.sql'), 'utf8'));
 const rawInventory = Object.values(metadata[0])[0];
 const inventory = typeof rawInventory === 'string' ? JSON.parse(rawInventory) : rawInventory;
 assert.equal(analyzeInventory(inventory).findings.length, 0);
 for (const sql of buildAuditSql(inventory).split(';').map(s => s.trim()).filter(Boolean)) {
  const [rows] = await db.query(sql);
  assert.equal(Number(rows[0].issues), 0, rows[0].check_name);
 }
 t.diagnostic('Inventário de metadados e consultas de auditoria validados no esquema e nos pedidos de teste.');
});
