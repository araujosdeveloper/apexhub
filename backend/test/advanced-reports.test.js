const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {defaults}=require('../src/operations');
const {testJwt}=require('../test-support/jwt');
const {issue}=require('../src/jwt');
const {tokenHash}=require('../src/security');
const {windowFor,monthWindow,revenueGrowth}=require('../src/advanced-reports');
const jwt=testJwt(),sid=tokenHash('a'.repeat(64)),owner={Cookie:'delivery_session='+'a'.repeat(64)};
const master={Authorization:'Bearer '+issue(jwt,{scope:'master',id:2,role:'super_admin',sid})};
const stats={orders:'4',completed_orders:'2',cancelled_orders:'1',gross_revenue:'52.00',order_revenue:'50.00',average_ticket:'25.00',incomplete_amount_orders:'0'};
function fake({role='owner',fail,empty=false}={}){
 const calls=[];
 const execute=async(sql,args)=>{calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(sql.includes('FROM platform_sessions s'))return [[{id:2,name:'Master'}]];
  if(sql.startsWith('SELECT config'))return [[{config:defaults()}]];
  if(fail){const e=new Error('MYSQL_PASSWORD=secret SELECT private');e.code='ECONNRESET';throw e;}
  if(sql.includes('COUNT(*) AS total FROM subscriptions'))return [[{plan_code:'starter',total:'2'}]];
  if(sql.includes('snapshot_source'))return [empty?[]:[{origin:'digital_menu',orders:'3'},{origin:'other_legacy',orders:'1'}]];
  if(sql.includes('WITH day_ranges'))return [[{...stats,day:'2026-11-05'}]];
  if(sql.includes('COUNT(o.id)'))return [[empty?{orders:'0',completed_orders:'0',cancelled_orders:'0',gross_revenue:'0.00',order_revenue:'0.00',average_ticket:null}:stats]];
  throw Error(sql);
 };
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
const options=(logs=[])=>({jwt,planPrices:{starter:'99.90'},logger:{error:line=>logs.push(line)}});
test('BI: calendário de sete dias, ano bissexto, mês UTC e validação',()=>{
 const p=windowFor({},'America/Sao_Paulo',new Date('2026-11-06T01:00:00Z'));assert.equal(p.start,'2026-10-30');assert.equal(p.end,'2026-11-05');assert.equal(p.days.length,7);
 assert.throws(()=>windowFor({start:'2026-02-30',end:'2026-03-01'},'UTC'));
 assert.throws(()=>windowFor({start:'2026-01-01'},'UTC',new Date(),true));
 assert.deepEqual(monthWindow(new Date('2024-03-12Z')),{previous:'2024-02-01 00:00:00',from:'2024-03-01 00:00:00',until:'2024-04-01 00:00:00'});
 assert.equal(revenueGrowth('150.00','100.00'),50);assert.equal(revenueGrowth('0.00','100.00'),-100);assert.equal(revenueGrowth('10.00','0.00'),null);
});
test('BI: rotas exigem sessão e segregam tenant, operador e Master',async t=>{
 const db=fake(),r=await serve(t,db,options());
 for(const endpoint of ['summary','sales-chart','origin-chart']){
  assert.equal((await r('/api/tenant/reports/'+endpoint)).status,401);
  assert.equal((await r('/api/tenant/reports/'+endpoint,{headers:master})).status,401);
 }
 assert.equal((await r('/api/admin/reports/global-financial',{headers:owner})).status,401);
 const other=await serve(t,fake({role:'operator'}),options());assert.equal((await other('/api/tenant/reports/summary',{headers:owner})).status,403);
 assert.equal(db.calls.includes('begin'),false);
});
test('BI: resumo, parâmetros de tenant ignorados, valores e consultas indexáveis',async t=>{
 const db=fake(),r=await serve(t,db,options()),res=await r('/api/tenant/reports/summary?start=2026-11-05&end=2026-11-05&tenant_id=999',{headers:owner});assert.equal(res.status,200);const body=await res.json();assert.equal(body.success,true);assert.equal(body.data.tenant_id,7);assert.equal(body.data.summary.gross_revenue,'52.00');assert.equal(body.data.summary.average_ticket,'25.00');assert.equal(body.data.summary.cancellation_rate,25);
 const agg=db.calls.filter(c=>c.sql?.includes('FROM orders o'));assert.equal(agg.length,2);for(const c of agg)assert.equal(c.args[0],7);
 const day=db.calls.find(c=>c.sql?.includes('WITH day_ranges'));assert.equal(day.args.at(-1),7);assert.match(day.sql,/o.company_id=\? AND o.created_at>=d.starts/);assert.match(day.sql,/DATE\(\?\)/);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('BI: origem usa snapshot real, inclui legados e base vazia tem percentual zero',async t=>{
 for(const empty of [false,true]){const db=fake({empty}),r=await serve(t,db,options()),res=await r('/api/tenant/reports/origin-chart?start=2026-11-05&end=2026-11-05',{headers:owner});assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.total_orders,empty?0:4);assert.equal(data.series[0].percentage,empty?0:75);assert.equal(data.series[1].percentage,empty?0:25);const call=db.calls.find(c=>c.sql?.includes('snapshot_source'));assert.equal(call.args[0],7);}
});
test('BI: gráfico semanal fixa sete dias e rejeita override e datas inválidas',async t=>{
 const db=fake(),r=await serve(t,db,options());assert.equal((await r('/api/tenant/reports/sales-chart',{headers:owner})).status,200);const range=db.calls.find(c=>c.sql?.includes('WITH day_ranges'));assert.equal(range.args.length,22);
 for(const url of ['/api/tenant/reports/sales-chart?start=2026-11-05','/api/tenant/reports/summary?start=2026-02-30&end=2026-03-01'])assert.equal((await r(url,{headers:owner})).status,400);
});
test('BI: financeiro restringe empresas ativas, separa GMV e MRR sem inventar histórico',async t=>{
 const db=fake(),r=await serve(t,db,options()),res=await r('/api/admin/reports/global-financial',{headers:master});assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.mrr_estimate,'199.80');assert.equal(data.mrr_growth_percent,null);assert.equal(data.current_month.gross_revenue,'52.00');assert.equal(data.gross_revenue_growth_percent,0);
 const calls=db.calls.filter(c=>c.sql?.includes('FROM companies c JOIN orders'));assert.equal(calls.length,2);for(const c of calls)assert.match(c.sql,/c.active=1/);
 assert.equal((await r('/api/admin/reports/global-financial',{headers:master,method:'POST'})).status,405);
});
test('BI: falhas de conexão revertem snapshot e não expõem SQL ou credenciais',async t=>{
 const db=fake({fail:true}),logs=[],r=await serve(t,db,options(logs)),res=await r('/api/tenant/reports/summary',{headers:owner});assert.equal(res.status,503);assert.equal((await res.json()).success,false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);assert.equal(logs.join('').includes('secret'),false);assert.ok(logs.join('').includes('ECONNRESET'));
});
