const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {trackingUrl,ensureTracking}=require('../src/order-tracking');
const token='a'.repeat(64),headers={Cookie:'delivery_session='+'b'.repeat(64)};
function fake({missing=false,status='preparing',method='delivery',fail=false}={}){const calls=[];let stored=null;
 async function execute(sql,args){calls.push({sql,args});if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role:'operator'}]];
  if(sql.startsWith('SELECT id FROM orders'))return [missing?[]:[{id:12}]];
  if(sql.startsWith('SELECT token FROM order_tracking'))return [stored?[{token:stored}]:[]];
  if(sql.startsWith('INSERT INTO order_tracking')){stored=args[1];return [{affectedRows:1}];}
  if(sql.includes('FROM order_tracking t JOIN orders')){if(fail)throw new Error('Falha');return [missing?[]:[{id:12,status,created_at:'2026-11-04 12:00:00',estimated_minutes:60,fulfillment_method:method,fulfillment_address:'Loja, rua 1',company_name:'Loja A',slug:'loja-a',total_amount:'20.00',delivery_fee:'3.00',discount_amount:'0.00',coupon_code:'',customer_name:'SEGREDO',customer_phone:'SEGREDO',address_street:'SEGREDO',notes:'SEGREDO'}]];}
  if(sql.startsWith('SELECT product_name'))return [[{product_name:'Lanche',quantity:1,total_price:'17.00',addons_snapshot:[{name:'Queijo'}]}]];throw new Error(sql);
 }
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
test('acompanhamento: link não é derivado do número e geração repetida mantém mesmo token',async()=>{
 const db=fake();const first=await ensureTracking(db,12),second=await ensureTracking(db,12);assert.match(first,/^\/track.html#[a-f0-9]{64}$/);assert.equal(first,second);assert.equal(db.calls.filter(c=>c.sql.startsWith('INSERT')).length,1);assert.equal(trackingUrl('12'),null);assert.equal(trackingUrl('<script>'),null);
});
test('acompanhamento: sem token válido não consulta banco nem aceita ID/empresa como alternativa',async t=>{
 const db=fake(),r=await serve(t,db);for(const url of ['/api/order-tracking','/api/order-tracking?order_id=12&company_id=7'])assert.equal((await r(url)).status,404);assert.equal((await r('/api/order-tracking',{headers:{'X-Order-Token':'12'}})).status,404);assert.deepEqual(db.calls,[]);
});
test('acompanhamento: consulta retorna somente dados permitidos e snapshot consistente',async t=>{
 const db=fake(),r=await serve(t,db),response=await r('/api/order-tracking?company_id=999',{headers:{'X-Order-Token':token}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');const data=await response.json();assert.equal(data.order.id,12);assert.equal(data.order.status,'preparing');assert.equal(data.order.estimated_at,'2026-11-04T13:00:00.000Z');assert.equal(data.order.pickup_address,'');assert.equal(data.order.items[0].product_name,'Lanche');assert.doesNotMatch(JSON.stringify(data),/SEGREDO/);assert.equal(db.calls.find(c=>c.sql?.includes('JOIN orders')).args[0],token);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('acompanhamento: retirada mostra endereço da loja, token desconhecido não revela pedido',async t=>{
 const r=await serve(t,fake({method:'pickup',status:'ready'}));const data=await(await r('/api/order-tracking',{headers:{'X-Order-Token':token}})).json();assert.equal(data.order.pickup_address,'Loja, rua 1');const missing=await serve(t,fake({missing:true}));assert.equal((await missing('/api/order-tracking',{headers:{'X-Order-Token':token}})).status,404);
});
test('acompanhamento: gestor gera link somente para pedido da própria loja com trava',async t=>{
 const db=fake(),r=await serve(t,db);assert.equal((await r('/api/admin/orders/12/tracking',{method:'POST'})).status,401);const response=await r('/api/admin/orders/12/tracking',{method:'POST',headers});assert.equal(response.status,200);assert.match((await response.json()).tracking_url,/^\/track.html#/);const check=db.calls.find(c=>c.sql?.startsWith('SELECT id FROM orders'));assert.deepEqual(check.args,[12,7]);assert.match(check.sql,/FOR UPDATE/);
 const missing=await serve(t,fake({missing:true}));assert.equal((await missing('/api/admin/orders/999/tracking',{method:'POST',headers})).status,404);
});
test('acompanhamento: falha de consulta libera conexão e desfaz transação',async t=>{
 const db=fake({fail:true}),r=await serve(t,db);assert.equal((await r('/api/order-tracking',{headers:{'X-Order-Token':token}})).status,500);assert.deepEqual(db.calls.slice(-2),['rollback','release']);
});
