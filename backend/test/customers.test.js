const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filters, customerView } = require('../src/customers');
const { serve } = require('../test-support/http');
const headers = {Cookie:'delivery_session='+'a'.repeat(64)};
function fakeDb({role='owner',missing=false,fail=false}={}) {
 const calls=[];
 const profile={id:12,name:'Ana',phone:'11999990000',contact_key:'p:5511999990000',order_count:'1',purchase_count:'1',total_spent:'29.90',last_purchase_at:'2026-10-01 12:00:00',days_since_purchase:34};
 const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql,args)=>{
  calls.push({sql,args}); if(fail) throw new Error('Falha simulada');
  if(sql.includes('SELECT COUNT(*) AS contacts')) return [[{contacts:1,repeat_contacts:0,inactive30:1,total_spent:'29.90',unknown_value_orders:0}]];
  if(sql.includes('SELECT COUNT(*) AS total')) return [[{total:1}]];
  if(sql.includes('SELECT contact_key FROM members WHERE id')) return [missing?[]:[{contact_key:profile.contact_key}]];
  if(sql.includes('SELECT * FROM crm')) return [[profile]];
  if(sql.includes('SELECT o.id,o.total_amount')) return [[{id:31,created_at:'2026-10-01 12:00:00',status:'completed',coupon_code:'TESTE'}]];
  if(sql.startsWith('SELECT oi.id')) return [[{id:51,order_id:31,product_name:'Lanche',addons_snapshot:[{name:'Queijo'}]}]];
  if(sql.includes('SUM(oi.quantity)')) return [[{product_name:'Lanche',quantity:'2'}]];
  throw new Error(sql);
 }};
 return {calls,getConnection:async()=>conn,execute:async sql=>{assert.ok(sql.includes('FROM sessions s'));return [[{id:1,company_id:7,role}]];}};
}
test('clientes: filtros limitados, curingas literais e telefone normalizado na busca',()=>{
 const f=filters({search:'(11) 999%_='}); assert.deepEqual(f.params,['%(11) 999=%=_==%','%(11) 999=%=_==%','%11999%']);
 for(const query of [{segment:'constructor'},{sort:'x'},{offset:'100001'},{limit:'0'},{limit:'101'},{search:['a']},{search:'x'.repeat(81)}]) assert.throws(()=>filters(query));
 const c=customerView({contact_key:'secret',purchase_count:'2',days_since_purchase:null,last_order_at:'2026-11-01 12:00:00'});
 assert.equal(c.contact_key,undefined);assert.equal(c.purchase_count,2);assert.equal(c.last_order_at,'2026-11-01T12:00:00Z');assert.equal(c.days_since_purchase,null);
});
test('clientes: sessão e perfil restringem leitura sem abrir conexão',async t=>{
 const db=fakeDb({role:'operator'}),request=await serve(t,db);
 for(const url of ['/api/admin/customers','/api/admin/customers/12']) {assert.equal((await request(url)).status,401);assert.equal((await request(url,{headers})).status,403);}
 assert.deepEqual(db.calls,[]);
});
test('clientes: resumo e lista usam snapshot e loja da sessão',async t=>{
 const db=fakeDb({role:'manager'}),request=await serve(t,db);
 const response=await request('/api/admin/customers?company_id=999&segment=inactive30&limit=20&offset=40',{headers});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.company_id,7);assert.equal(result.customers[0].purchase_count,1);assert.equal(result.customers[0].contact_key,undefined);
 assert.equal(db.calls[0],'begin');assert.deepEqual(db.calls.slice(-2),['commit','release']);
 for(const {sql,args} of db.calls.filter(c=>typeof c==='object')) {assert.equal(args[0],7);assert.equal(args[1],7);assert.match(sql,/FROM orders o WHERE o.company_id = \?/);}
 assert.match(db.calls.find(c=>c.sql?.includes('SELECT * FROM crm')).sql,/active_orders = 0.*days_since_purchase >= 30.*LIMIT 20 OFFSET 40/s);
});
test('clientes: histórico e itens isolados; cadastro de outra loja retorna 404',async t=>{
 const db=fakeDb(),request=await serve(t,db),response=await request('/api/admin/customers/12',{headers});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.orders[0].items[0].product_name,'Lanche');assert.equal(data.favorites[0].quantity,2);assert.equal(data.orders[0].coupon_code,'TESTE');
 for(const call of db.calls.filter(c=>typeof c==='object')) assert.equal(call.args[0],7);
 assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('SELECT oi.id')).args,[7,31]);
 const missing=fakeDb({missing:true}),other=await serve(t,missing);assert.equal((await other('/api/admin/customers/999',{headers})).status,404);assert.deepEqual(missing.calls.slice(-2),['commit','release']);
});
test('clientes: falhas liberam conexão; filtros inválidos não consultam base',async t=>{
 const db=fakeDb({fail:true}),request=await serve(t,db);assert.equal((await request('/api/admin/customers',{headers})).status,500);assert.deepEqual(db.calls.slice(-2),['rollback','release']);
 const clean=fakeDb(),r=await serve(t,clean);for(const url of ['/api/admin/customers?limit=101','/api/admin/customers/abc','/api/admin/customers/12?offset=-1']) assert.equal((await r(url,{headers})).status,400);assert.deepEqual(clean.calls,[]);
});
