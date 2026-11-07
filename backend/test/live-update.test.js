const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planUpdate, verifySnapshots } = require('../src/live-update');
function columns() {
  const fields = { companies: ['id','slug'], products: ['id','company_id'], orders: ['id','snapshot_source','customer_name','delivery_fee'], order_items: ['id','product_name','total_price'], users: ['id'], sessions: ['token_hash'], subscriptions: ['company_id'], checkout_requests: ['request_hash'] };
  return Object.entries(fields).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name, column_type: column_name === 'id' ? 'int' : 'varchar(160)' })));
}
function addOperations(schema) {
  return [...schema, ...Object.entries({ company_operations: ['company_id','config'], orders: ['fulfillment_method','fulfillment_address','estimated_minutes'] }).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name })))];
}
function addAddons(schema) {
  return [...schema, ...Object.entries({ product_addons: ['product_id','config','version'], order_items: ['addons_snapshot'] }).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name })))];
}
test('atualização reconhece fundação publicada com frete legado e aplica somente módulos pendentes', () => {
  assert.deepEqual(planUpdate(columns()).pending, ['004-store-operations.sql','005-product-addons.sql','006-coupons.sql','007-delivery-drivers.sql','008-menu-merchandising.sql','009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  assert.deepEqual(planUpdate(addOperations(columns())).pending, ['005-product-addons.sql','006-coupons.sql','007-delivery-drivers.sql','008-menu-merchandising.sql','009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  assert.deepEqual(planUpdate(addAddons(addOperations(columns()))).pending, ['006-coupons.sql','007-delivery-drivers.sql','008-menu-merchandising.sql','009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const couponColumns = { company_coupons: ['id','company_id','code','config','version','usage_count'], orders: ['coupon_code','discount_amount','coupon_snapshot','customer_phone_key'] };
  const complete = [...addAddons(addOperations(columns())), ...Object.entries(couponColumns).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name })))];
  assert.deepEqual(planUpdate(complete).pending, ['007-delivery-drivers.sql','008-menu-merchandising.sql','009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const driverColumns={delivery_drivers:['id','company_id','name','phone','active','version'],delivery_assignments:['order_id','company_id','driver_id','driver_name','driver_phone','version']};
  const all=[...complete,...Object.entries(driverColumns).flatMap(([table_name,names])=>names.map(column_name=>({table_name,column_name})))];
  assert.deepEqual(planUpdate(all).pending,['008-menu-merchandising.sql','009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const full=[...all,...['company_id','config','version'].map(column_name=>({table_name:'company_merchandising',column_name}))];
  assert.deepEqual(planUpdate(full).pending,['009-product-images.sql','010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const images=[...full,...['product_id','content_type','content','digest'].map(column_name=>({table_name:'product_images',column_name}))];
  assert.deepEqual(planUpdate(images).pending,['010-order-tracking.sql','011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const tracked=[...images,...['order_id','token'].map(column_name=>({table_name:'order_tracking',column_name}))];
  assert.deepEqual(planUpdate(tracked).pending,['011-order-reviews.sql','012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const reviewed=[...tracked,...['order_id','rating','comment','created_at'].map(column_name=>({table_name:'order_reviews',column_name}))];
  assert.deepEqual(planUpdate(reviewed).pending,['012-platform-master.sql','013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const masterFields={platform_tenant_profiles:['company_id','cnpj'],platform_admins:['id','name','email','password_hash','active','created_at'],platform_sessions:['token_hash','admin_id','expires_at'],platform_audit:['id','admin_id','action','entity_id','details','created_at']};
  const platform=[...reviewed,...Object.entries(masterFields).flatMap(([table_name,names])=>names.map(column_name=>({table_name,column_name})))];
  assert.deepEqual(planUpdate(platform).pending,['013-impersonation.sql','014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const assisted=[...platform,...['id','cookie_hash','admin_id','master_session_hash','company_id','owner_id','exchanged','expires_at','created_at'].map(column_name=>({table_name:'platform_impersonations',column_name}))];
  assert.deepEqual(planUpdate(assisted).pending,['014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  assert.deepEqual(planUpdate([...assisted,{table_name:'products',column_name:'image_url'}]).pending,['014-tenant-menu.sql','015-store-images.sql','016-item-instructions.sql']);
  const menu=[...assisted,{table_name:'categories',column_name:'created_at'},{table_name:'products',column_name:'created_at'},{table_name:'products',column_name:'image_url'},...['id','tenant_id','product_id','option_key','group_key','name','additional_price','max_quantity','is_active','created_at'].map(column_name=>({table_name:'product_options',column_name}))];
  assert.deepEqual(planUpdate(menu).pending,['015-store-images.sql','016-item-instructions.sql']);
  const storeAssets=[...menu,...['company_id','kind','content_type','content','digest'].map(column_name=>({table_name:'store_images',column_name}))];
  assert.deepEqual(planUpdate(storeAssets).pending,['016-item-instructions.sql']);
  assert.deepEqual(planUpdate([...storeAssets,{table_name:'order_items',column_name:'item_notes'}]).pending,[]);
  assert.throws(()=>planUpdate([...menu,{table_name:'store_images',column_name:'company_id'}]),/parcial/);
  assert.throws(()=>planUpdate([...assisted,{table_name:'categories',column_name:'created_at'}]),/parcial/);
  assert.throws(()=>planUpdate([...platform,{table_name:'platform_impersonations',column_name:'id'}]),/parcial/);
  assert.throws(()=>planUpdate([...reviewed,{table_name:'platform_admins',column_name:'id'}]),/parcial/);
  assert.throws(()=>planUpdate([...tracked,{table_name:'order_reviews',column_name:'order_id'}]),/parcial/);
  assert.throws(()=>planUpdate([...images,{table_name:'order_tracking',column_name:'order_id'}]),/parcial/);
  assert.throws(()=>planUpdate([...full,{table_name:'product_images',column_name:'product_id'}]),/parcial/);
  assert.throws(()=>planUpdate([...all,{table_name:'company_merchandising',column_name:'company_id'}]),/parcial/);
  assert.throws(()=>planUpdate([...complete,{table_name:'delivery_drivers',column_name:'id'}]),/parcial/);
  const unsigned = columns().map(column => ({ ...column, column_type: column.column_name === 'id' ? 'int unsigned' : column.column_type }));
  assert.equal(planUpdate(unsigned).pending.length, 13);
});
test('atualização recusa legado sem fundação, migração parcial, módulos fora de ordem e tipos não ensaiados', () => {
  for (const input of [
    columns().filter(column => column.table_name !== 'users'),
    [...columns(), { table_name: 'orders', column_name: 'fulfillment_method' }],
    addAddons(columns()),
    [...addAddons(addOperations(columns())), { table_name: 'orders', column_name: 'discount_amount' }],
    [...addOperations(columns()), { table_name: 'product_addons', column_name: 'product_id' }],
    columns().map(column => column.table_name === 'products' && column.column_name === 'id' ? { ...column, column_type: 'bigint unsigned' } : column)
  ]) assert.throws(() => planUpdate(input));
});
test('verificação impede abertura se qualquer registro original divergir', () => {
  const before = { orders: { rows: 3, sha256: 'original' } };
  verifySnapshots(before, structuredClone(before));
  assert.throws(() => verifySnapshots(before, { orders: { rows: 3, sha256: 'alterado' } }), /divergiram/);
  assert.throws(() => verifySnapshots(before, {}), /divergiram/);
});
