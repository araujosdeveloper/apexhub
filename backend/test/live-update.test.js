'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planUpdate, verifySnapshots, subscriptionRequestMigrationSql } = require('../src/live-update');

function fullColumns() {
 const schema = {
  companies:['id','slug'], products:['id','company_id','image_url','created_at'], orders:['id','snapshot_source','customer_name','delivery_fee','fulfillment_method','fulfillment_address','estimated_minutes','coupon_code','discount_amount','coupon_snapshot','customer_phone_key'],
  order_items:['id','product_name','total_price','addons_snapshot','item_notes'], users:['id'],sessions:['token_hash'],subscriptions:['company_id'],checkout_requests:['request_hash'],
  company_operations:['company_id','config'],product_addons:['product_id','config','version'],company_coupons:['id','company_id','code','config','version','usage_count'],
  delivery_drivers:['id','company_id','name','phone','active','version'],delivery_assignments:['order_id','company_id','driver_id','driver_name','driver_phone','version'],
  company_merchandising:['company_id','config','version'],product_images:['product_id','content_type','content','digest'],order_tracking:['order_id','token'],
  order_reviews:['order_id','rating','comment','created_at'],platform_tenant_profiles:['company_id','cnpj'],
  platform_admins:['id','name','email','password_hash','active','created_at'],platform_sessions:['token_hash','admin_id','expires_at'],
  platform_audit:['id','admin_id','action','entity_id','details','created_at'],
  platform_impersonations:['id','cookie_hash','admin_id','master_session_hash','company_id','owner_id','exchanged','expires_at','created_at'],
  categories:['created_at'],product_options:['id','tenant_id','product_id','option_key','group_key','name','additional_price','max_quantity','is_active','created_at'],
  whatsapp_handoffs:['company_id','phone_number_id','sender','state','actor_id','skip_through','updated_at'],
  whatsapp_human_replies:['company_id','phone_number_id','sender','request_key','actor_id','body','state','provider_message_id','created_at'],
  whatsapp_carts:['company_id','phone_number_id','sender','items','quote','updated_at'],
  whatsapp_initial_replies:['inbox_id','state','provider_message_id','created_at'],
  company_whatsapp_inbox:['id','company_id','phone_number_id','message_id','sender','message_type','body','received_at'],
  company_whatsapp_connections:['company_id','waba_id','phone_number_id','display_phone','encrypted_token','connected_by','connected_at'],
  store_images:['company_id','kind','content_type','content','digest'],subscription_plan_requests:['company_id','plan_code','status','created_at','updated_at']
 };
 return Object.entries(schema).flatMap(([table_name,names])=>names.map(column_name=>({table_name,column_name,column_type:column_name==='id'?'int unsigned':'varchar(500)'})));
}
const rangeConstraint=[{table_name:'product_options',constraint_name:'product_options_quantity_range'}];

test('o atualizador detecta separadamente migrations 016, 017 e 018',()=>{
 const base=fullColumns();
 assert.deepEqual(planUpdate(base,rangeConstraint).pending,[]);
 assert.ok(planUpdate(base.filter(c=>!(c.table_name==='order_items'&&c.column_name==='item_notes')),rangeConstraint).pending.includes('016-item-instructions.sql'));
 assert.ok(planUpdate(base,[]).pending.includes('017-addon-quantities.sql'));
 assert.ok(planUpdate(base.filter(c=>c.table_name!=='subscription_plan_requests'),rangeConstraint).pending.includes('018-subscription-plans.sql'));
 assert.ok(!planUpdate(base,rangeConstraint).pending.some(file=>file.includes('subscription-plans')));
});
test('migração de planos replica o tipo real do FK da empresa',()=>{
 assert.match(subscriptionRequestMigrationSql('int unsigned'),/company_id INT UNSIGNED PRIMARY KEY/);
 assert.match(subscriptionRequestMigrationSql('int'),/company_id INT PRIMARY KEY/);
 assert.throws(()=>subscriptionRequestMigrationSql('bigint unsigned'),/não suportado/);
});
test('o atualizador recusa módulos parciais ou fora de ordem',()=>{
 const base=fullColumns();
 assert.throws(()=>planUpdate(base.filter(c=>!(c.table_name==='store_images'&&c.column_name==='digest'))),/parcial/);
 assert.throws(()=>planUpdate(base.filter(c=>!(c.table_name==='platform_admins'&&c.column_name==='id'))),/parcial/);
});
test('verificação da migração exige preservação integral dos snapshots',()=>{
 const before={orders:{rows:2,sha256:'old'}};
 verifySnapshots(before,structuredClone(before));
 assert.throws(()=>verifySnapshots(before,{orders:{rows:2,sha256:'changed'}}),/divergiram/);
});
