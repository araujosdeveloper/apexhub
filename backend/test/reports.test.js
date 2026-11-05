const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {reportPeriod,dayBoundary,calendarDate,counts}=require('../src/reports');
const {defaults}=require('../src/operations');
const headers={Cookie:'delivery_session='+'a'.repeat(64)};
test('relatórios: datas reais, intervalo inclusivo e limite de 93 dias',()=>{
 const range=reportPeriod({start:'2026-11-01',end:'2026-11-04'},'America/Sao_Paulo');assert.equal(range.days.length,4);assert.equal(range.from,'2026-11-01 03:00:00');assert.equal(range.until,'2026-11-05 03:00:00');
 for(const query of [{start:'2026-02-29',end:'2026-03-01'},{start:'2026-11-04',end:'2026-11-01'},{start:'2026-01-01',end:'2026-04-04'},{start:['2026-01-01'],end:'2026-01-01'},{start:'2026-01-01'},{start:'1999-12-31',end:'2000-01-01'}])assert.throws(()=>reportPeriod(query,'UTC'));
 assert.equal(reportPeriod({start:'2024-02-29',end:'2024-02-29'},'UTC').days.length,1);assert.throws(()=>calendarDate('2026-2-01'));
});
test('relatórios: período padrão segue dia da loja e dias com mudança de horário preservam limites',()=>{
 const range=reportPeriod({},'America/Sao_Paulo',new Date('2026-11-04T01:00:00Z'));assert.equal(range.end,'2026-11-03');assert.equal(range.start,'2026-10-05');assert.equal(range.days.length,30);
 assert.equal(dayBoundary('2026-03-08','America/New_York'),'2026-03-08 05:00:00');assert.equal(dayBoundary('2026-03-09','America/New_York'),'2026-03-09 04:00:00');
 assert.equal(dayBoundary('2026-11-01','America/New_York'),'2026-11-01 04:00:00');assert.equal(dayBoundary('2026-11-02','America/New_York'),'2026-11-02 05:00:00');
 assert.equal(dayBoundary('2018-11-04','America/Sao_Paulo'),'2018-11-04 03:00:00');assert.equal(dayBoundary('2018-11-05','America/Sao_Paulo'),'2018-11-05 02:00:00');
});
function fake({role='owner',fail=false,empty=false}={}){
 const calls=[];
 const summary={orders:empty?'0':'5',completed:empty?null:'2',active:empty?null:'2',cancelled:empty?null:'1',total:empty?'0.00':'40.00',average_order:empty?null:'20.00',valued_orders:empty?null:'2',unknown_values:null,delivery_fees:'4.00',discounts:'2.00'};
 const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql,args)=>{
  calls.push({sql,args});if(sql.startsWith('SELECT config'))return [[{config:defaults()}]];if(fail)throw new Error('Falha simulada');
  if(sql.includes('SELECT COUNT(*) AS incomplete_orders'))return [[{incomplete_orders:'0'}]];
  if(sql.includes('FROM order_items oi JOIN sales'))return [empty?[]:[{product_name:'Lanche',quantity:'2',order_count:'1',gross_total:'40.00'}]];
  if(sql.includes('day_ranges AS'))return [[{day:'2026-11-01',orders:'5',completed:'2',active:'2',cancelled:'1',total:'40.00'}]];
  if(sql.includes('GROUP BY label'))return [empty?[]:[{...summary,label:'Pix'}]];
  if(sql.includes('GROUP BY fulfillment_method'))return [empty?[]:[{...summary,label:'delivery'}]];
  if(sql.endsWith('FROM sales'))return [[summary]];throw new Error(sql);
 }};
 return {calls,getConnection:async()=>conn,execute:async sql=>{assert.ok(sql.includes('FROM sessions s'));return [[{id:1,company_id:7,role}]];}};
}
test('relatórios: restrição por perfil e sessão antes de abrir conexão',async t=>{
 const db=fake({role:'operator'}),r=await serve(t,db);assert.equal((await r('/api/admin/reports/sales')).status,401);assert.equal((await r('/api/admin/reports/sales',{headers})).status,403);assert.deepEqual(db.calls,[]);
});
test('relatórios: consultas isoladas em snapshot, período UTC e dinheiro sem arredondamento JS',async t=>{
 const db=fake({role:'manager'}),r=await serve(t,db);const response=await r('/api/admin/reports/sales?start=2026-11-01&end=2026-11-01&company_id=999',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.company_id,7);assert.equal(data.timezone,'America/Sao_Paulo');assert.equal(data.summary.completed,2);assert.equal(data.summary.total,'40.00');assert.equal(data.products[0].quantity,2);assert.equal(data.basis,'created_at_current_status');
 for(const call of db.calls.filter(c=>c.sql?.startsWith('WITH sales'))){assert.deepEqual(call.args.slice(0,3),[7,'2026-11-01 03:00:00','2026-11-02 03:00:00']);assert.match(call.sql,/company_id=\? AND created_at>=\? AND created_at<\?/);}
 assert.equal(db.calls[0],'begin');assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('relatórios: base vazia não inventa ticket médio e contadores nulos viram zero',async t=>{
 const db=fake({empty:true}),r=await serve(t,db),data=await(await r('/api/admin/reports/sales?start=2026-11-01&end=2026-11-01',{headers})).json();assert.equal(data.summary.average_order,null);assert.equal(data.summary.completed,0);assert.deepEqual(data.products,[]);assert.equal(counts({unknown_values:null}).unknown_values,0);
});
test('relatórios: filtros inválidos não consultam pedidos e falhas sempre liberam conexão',async t=>{
 const db=fake(),r=await serve(t,db);assert.equal((await r('/api/admin/reports/sales?start=2026-02-30&end=2026-03-01',{headers})).status,400);assert.deepEqual(db.calls.slice(-2),['rollback','release']);assert.equal(db.calls.some(c=>c.sql?.includes('FROM orders')),false);
 const failed=fake({fail:true}),rr=await serve(t,failed);assert.equal((await rr('/api/admin/reports/sales?start=2026-11-01&end=2026-11-01',{headers})).status,500);assert.deepEqual(failed.calls.slice(-2),['rollback','release']);
});
