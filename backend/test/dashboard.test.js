const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {defaults}=require('../src/operations');
const headers={Cookie:'delivery_session='+'a'.repeat(64)};
function fake({role='owner',fail=false}={}) {
 const calls=[];
 async function execute(sql,args) {
  calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(sql.startsWith('SELECT config'))return [[{config:defaults()}]];
  if(fail)throw new Error('Falha');
  if(sql.startsWith('WITH scoped'))return [[{day:'2026-11-04',orders:'3',gross_revenue:'50.00',unknown_values:'0'}]];
  if(sql.startsWith('SELECT CASE WHEN cr.order_id'))return [[{source:'digital_menu',total:'3'}]];
  if(sql.includes('AVG(r.rating)'))return [[{total:'2',average:'4.50'}]];
  if(sql.startsWith('SELECT status,COUNT'))return [[{status:'pending',total:'1'},{status:'ready',total:'2'}]];
  if(sql.startsWith('SELECT o.id,o.customer_name'))return [[{id:12,customer_name:'Ana',status:'pending',fulfillment_method:'delivery',total_amount:'20.00',created_at:'2026-11-04 12:00:00',item_count:'2'}]];
  if(sql.startsWith('SELECT id,customer_name'))return [[{id:12,customer_name:'Ana',status:'pending'}]];
  if(sql.startsWith('SELECT id,name FROM products'))return [[{id:4,name:'Lanche'}]];
  if(sql.startsWith('SELECT id,name FROM customers'))return [[{id:5,name:'Ana'}]];
  throw new Error(sql);
 }
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
test('dashboard: dados financeiros e busca exigem dono/gerente',async t=>{
 const db=fake({role:'operator'}),r=await serve(t,db);
 for(const url of ['/api/admin/dashboard','/api/admin/dashboard/search?q=Ana']){assert.equal((await r(url)).status,401);assert.equal((await r(url,{headers})).status,403);}
 assert.equal(db.calls.some(call=>call==='begin'),false);
});
test('dashboard: resumo em snapshot por loja, dinheiro decimal e tempo não inventado',async t=>{
 const db=fake({role:'manager'}),r=await serve(t,db),response=await r('/api/admin/dashboard?company_id=999',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.company_id,7);assert.equal(data.kpis.orders,3);assert.equal(data.kpis.gross_revenue,'50.00');assert.equal(data.kpis.average_minutes,null);assert.equal(data.kpis.review_average,'4.50');assert.equal(data.queue.pending,1);assert.equal(data.queue.preparing,0);assert.equal(data.latest[0].created_at,'2026-11-04T12:00:00Z');
 for(const call of db.calls.filter(c=>c.sql&&!c.sql.includes('FROM sessions')))assert.equal(call.args[0],7);
 assert.deepEqual(db.calls.slice(-2),['commit','release']);
 const daily=db.calls.find(c=>c.sql?.startsWith('WITH scoped'));assert.match(daily.sql,/total_amount\+o.discount_amount/);assert.equal(daily.args.length,24);
});
test('dashboard: falha desfaz snapshot e libera conexão',async t=>{
 const db=fake({fail:true}),r=await serve(t,db);assert.equal((await r('/api/admin/dashboard',{headers})).status,500);assert.deepEqual(db.calls.slice(-2),['rollback','release']);
});
test('busca global: trata curingas como texto e gera URLs locais para a loja da sessão',async t=>{
 const db=fake(),r=await serve(t,db),response=await r('/api/admin/dashboard/search?q=10%25_%3D&company_id=999',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.company_id,7);assert.deepEqual(data.results.map(r=>r.type),['Pedido','Produto','Cliente']);assert.match(data.results[0].url,/search=%2312/);
 for(const call of db.calls.filter(c=>!c.sql.includes('FROM sessions'))){assert.equal(call.args[0],7);assert.equal(call.args[1],'%10=%=_==%');}
 for(const q of ['', 'a', 'x'.repeat(81)])assert.equal((await r('/api/admin/dashboard/search?q='+q,{headers})).status,400);
});
