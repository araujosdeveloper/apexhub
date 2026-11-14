'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {testJwt}=require('../test-support/jwt');

function fake({role='owner',ownOrder=true}={}){
 const calls=[],events=[];
 async function execute(sql,args){calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(sql.startsWith('SELECT COUNT(*) AS total FROM orders'))return [[{total:1}]];
  if(sql.startsWith('SELECT id, company_id AS tenant_id'))return [[{id:21,tenant_id:7,customer_name:'Ana',customer_phone:'11999990000',delivery_address:'Rua A, 9, Centro',total_amount:'32.00',status:'pending',created_at:'2026-11-07 12:00:00',fulfillment_method:'delivery'}]];
  if(sql.includes('FROM order_items oi JOIN orders o'))return [[{id:3,order_id:21,product_id:8,product_name:'Hot dog',quantity:1,item_notes:'Sem cebola',addons_snapshot:[]}]];
  if(sql.startsWith('UPDATE orders SET status='))return [{affectedRows:ownOrder?1:0}];
  if(sql.startsWith('SELECT id FROM orders WHERE id=? AND company_id=?'))return [ownOrder?[{id:21}]:[]];
  throw Error(sql);
 }
 const db={calls,execute};
 const appEvents={publish:id=>events.push(id),stream:()=>()=>{}};
 return {db,events,appEvents};
}
const jwt=testJwt(),headers={Cookie:'delivery_session='+'a'.repeat(64)};
test('pedidos tenant: autenticação, paginação e resposta usa tenant da sessão',async t=>{
 const f=fake(),r=await serve(t,f.db,{jwt,orderEvents:f.appEvents});
 assert.equal((await r('/api/tenant/orders')).status,401);
 const response=await r('/api/tenant/orders?tenant_id=999&status=pending&limit=20&offset=0',{headers});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.success,true);assert.equal(body.data.tenant_id,7);assert.equal(body.data.orders[0].tenant_id,7);assert.equal(body.data.orders[0].items[0].item_notes,'Sem cebola');
 const tenantQueries=f.db.calls.filter(call=>!call.sql.includes('FROM sessions s'));
 for(const call of tenantQueries)assert.equal(call.args[0],7);
 assert.match(tenantQueries.find(call=>call.sql.startsWith('SELECT id, company_id AS tenant_id')).sql,/ORDER BY created_at DESC,id DESC/);
});
test('pedidos tenant: operador autorizado, filtros inválidos e status isolado',async t=>{
 const operator=fake({role:'operator'}),other=await serve(t,operator.db,{jwt,orderEvents:operator.appEvents});
 assert.equal((await other('/api/tenant/orders',{headers})).status,200);
 const f=fake({ownOrder:false}),r=await serve(t,f.db,{jwt,orderEvents:f.appEvents});
 assert.equal((await r('/api/tenant/orders?status=unknown',{headers})).status,400);
 const result=await r('/api/tenant/orders/21/status',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'preparing',expected_status:'pending'})});
 assert.equal(result.status,404);assert.deepEqual(f.events,[]);
 const update=f.db.calls.find(call=>call.sql.startsWith('UPDATE orders SET status='));assert.equal(update.args[1],21);assert.equal(update.args[2],7);
});
test('pedidos tenant: transição altera status e publica atualização do KDS',async t=>{
 const f=fake(),r=await serve(t,f.db,{jwt,orderEvents:f.appEvents});
 const response=await r('/api/tenant/orders/21/status',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'preparing',expected_status:'pending'})});
 assert.equal(response.status,200);assert.equal((await response.json()).data.status,'preparing');assert.deepEqual(f.events,[7]);
});
test('API mapeia delivered para completed no banco e preserva o estado público',async t=>{
 const f=fake(),r=await serve(t,f.db,{jwt,orderEvents:f.appEvents});
 const response=await r('/api/tenant/orders/21/status',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'delivered',expected_status:'delivering'})});
 assert.equal(response.status,200);assert.equal((await response.json()).data.status,'delivered');
 const update=f.db.calls.find(call=>call.sql.startsWith('UPDATE orders SET status='));
 assert.equal(update.args[0],'completed');assert.equal(update.args[2],7);assert.equal(update.args.at(-1),'delivering');
});
