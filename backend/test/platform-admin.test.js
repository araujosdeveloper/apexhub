const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {tokenHash,verifyPassword}=require('../src/security');
const {testJwt}=require('../test-support/jwt');
const {issue}=require('../src/jwt');
const {planPrices,estimatedMrr}=require('../src/platform-plan-prices');
const {createInput}=require('../src/controllers/platform-admin');
const config=testJwt(),sid=tokenHash('a'.repeat(64));
const headers={Authorization:'Bearer '+issue(config,{scope:'master',id:2,role:'super_admin',sid})};
const ownerToken=role=>issue(config,{scope:'tenant',id:3,role,tenantId:7,sid});
const payload={name:'Loja API',slug:'loja-api',cnpj:'12.ABC.345/01DE-00',plan_code:'starter',owner:{name:'Responsável',email:'OWNER@example.com',password:'Senha-proprietario-1234'}};
const requestBody=(method,body,h=headers)=>({method,headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fake({fail,missing=false,inactive=false,revoked=false,duplicate=false,failAudit=false}={}){
 const calls=[];const row={id:8,name:'Loja API',slug:'loja-api',active:1,created_at:'2026-11-05 10:00:00',cnpj:'12ABC34501DE00',owner_id:3,owner_name:'Responsável',owner_email:'owner@example.com',plan_code:'starter',subscription_status:'trialing',trial_ends_at:'2026-11-19 10:00:00'};
 async function execute(sql,args){calls.push({sql,args});
  if(fail==='auth'){const e=new Error('password=NAO_LOGAR SELECT tudo');e.code='ECONNREFUSED';throw e;}
  if(sql.includes('FROM platform_sessions s'))return [[{id:2,name:'Master',email:'master@example.com'}]];
  if(sql.startsWith('SELECT id FROM platform_admins'))return [inactive?[]:[{id:2}]];
  if(sql.startsWith('SELECT token_hash FROM platform_sessions'))return [revoked?[]:[{token_hash:sid}]];
  if(sql.startsWith('SELECT COUNT(*) AS total,COALESCE(SUM(active'))return [[{total:'5',active:'4'}]];
  if(sql.startsWith('SELECT COUNT(*) AS total,COALESCE(SUM(created_at'))return [[{total:'50',today:'3',completed:'40',completed_gmv:'900.50',unknown_amounts:'1'}]];
  if(sql.startsWith('SELECT plan_code,COUNT(*)'))return [[{plan_code:'starter',total:'3'},{plan_code:'pro',total:'1'}]];
  if(sql.startsWith('SELECT COUNT(*) AS total'))return [[{total:'21'}]];
  if(sql.startsWith('SELECT c.id,c.name'))return [[row]];
  if(sql.startsWith('INSERT INTO companies')){if(duplicate){const e=new Error('Duplicate secret');e.code='ER_DUP_ENTRY';throw e;}return [{insertId:8}];}
  if(sql.startsWith('INSERT INTO users'))return [{insertId:3}];
  if(sql.startsWith('SELECT c.created_at'))return [[{created_at:row.created_at,trial_ends_at:row.trial_ends_at}]];
  if(sql.startsWith('SELECT id,active FROM companies'))return [missing?[]:[{id:8,active:1}]];
  if(sql.startsWith('INSERT INTO platform_audit')&&failAudit)throw new Error('Falha na auditoria');
  if(/^(INSERT|UPDATE|DELETE)/.test(sql))return [{affectedRows:1,insertId:9}];
  throw new Error(sql);
 }
 return {calls,execute,getConnection:async()=>{if(fail==='connection'){const e=new Error('MYSQL_PASSWORD=NAO_LOGAR SELECT tudo');e.code='ECONNREFUSED';throw e;}return {execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')};}};
}
function options(logs=[]){return {jwt:config,planPrices:{starter:'99.90',pro:'149.90'},logger:{error:line=>logs.push(JSON.parse(line))}};}
function assertEnvelope(data,success){assert.equal(data.success,success);assert.ok(Object.hasOwn(data,'data'));assert.equal(typeof data.message,'string');}
test('Admin global: todas as rotas recusam anonimato, donos, gerentes e operadores sem interceptar rotas da loja',async t=>{
 const db=fake(),r=await serve(t,db,options());const cases=[['GET','/api/admin/tenants'],['POST','/api/admin/tenants'],['PUT','/api/admin/tenants/8/status'],['GET','/api/admin/metrics']];
 for(const [method,path]of cases)for(const h of [{},{Authorization:'Bearer '+ownerToken('tenant_owner')},{Authorization:'Bearer '+ownerToken('tenant_manager')},{Authorization:'Bearer '+ownerToken('tenant_operator')},{Cookie:'delivery_session='+'a'.repeat(64)}]){const response=await r(path,requestBody(method,{},h));assert.equal(response.status,401);assertEnvelope(await response.json(),false);}
 assert.equal(db.calls.length,0);
 assert.equal((await r('/api/admin/catalog',{headers})).status,401);
 const res=await r('/api/admin/tenants',{headers});assert.equal(res.status,200);assertEnvelope(await res.json(),true);
});
test('Admin global: paginação, responsável, plano, status e datas; não retorna hash ou senha',async t=>{
 const db=fake(),r=await serve(t,db,options()),res=await r('/api/admin/tenants?page=2&page_size=10&search=10%25_%3D&status=active',{headers});assert.equal(res.status,200);const body=await res.json();assertEnvelope(body,true);assert.deepEqual(body.data.pagination,{page:2,page_size:10,total:21,total_pages:3});const tenant=body.data.tenants[0];assert.equal(tenant.owner.name,'Responsável');assert.equal(tenant.plan.code,'starter');assert.equal(tenant.status,'active');assert.match(tenant.created_at,/Z$/);assert.equal(tenant.owner.password_hash,undefined);const query=db.calls.find(c=>c.sql?.startsWith('SELECT c.id'));assert.match(query.sql,/LIMIT 10 OFFSET 10$/);assert.deepEqual(query.args,[1,'%10=%=_==%','%10=%=_==%','%10=%=_==%','%10=%=_==%']);assert.deepEqual(db.calls.slice(-2),['commit','release']);assert.equal(res.headers['cache-control'],'no-store');assert.match(res.headers['x-request-id'],/^[a-f0-9-]{36}$/);
});
test('Admin global: paginação e filtros malformados não abrem transação',async t=>{const db=fake(),r=await serve(t,db,options());for(const query of ['page=0','page=-1','page=1&page=2','page_size=101','page=999999','search='+('x'.repeat(81)),'status=blocked']){const res=await r('/api/admin/tenants?'+query,{headers});assert.equal(res.status,400);assertEnvelope(await res.json(),false);}assert.equal(db.calls.includes('begin'),false);});
test('Admin global: criação atômica com senha scrypt e papel proprietário fixo, sem autenticar como loja',async t=>{
 const db=fake(),r=await serve(t,db,options()),res=await r('/api/admin/tenants',requestBody('POST',{...payload,owner:{...payload.owner,role:'super_admin'},tenant_id:999}));assert.equal(res.status,201);const body=await res.json();assertEnvelope(body,true);assert.equal(body.data.id,8);assert.equal(body.data.owner.email,'owner@example.com');assert.equal(body.data.status,'active');assert.equal(body.data.plan.status,'trialing');assert.equal(body.data.cnpj,'12ABC34501DE00');assert.ok(!JSON.stringify(body).includes(payload.owner.password));assert.equal(res.headers['set-cookie'],undefined);const created=db.calls.find(c=>c.sql?.startsWith('INSERT INTO users'));assert.match(created.sql,/'owner',1/);assert.equal(created.args[0],8);assert.equal(await verifyPassword(payload.owner.password,created.args[3]),true);const subscription=db.calls.find(c=>c.sql?.startsWith('INSERT INTO subscriptions'));assert.deepEqual(subscription.args,[8,'starter']);const audit=db.calls.find(c=>c.sql?.startsWith('INSERT INTO platform_audit'));assert.equal(audit.args.includes(payload.owner.password),false);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('Admin global: criação valida CNPJ numérico/alfanumérico, slug e dados sem acessar banco',async()=>{
 assert.equal(createInput({...payload,cnpj:'12.345.678/0001-95'}).cnpj,'12345678000195');assert.match(createInput({...payload,slug:undefined,name:'Açaí da Loja'}).slug,/^acai-da-loja-[a-f0-9]{8}$/);
 for(const input of [null,{...payload,name:''},{...payload,cnpj:'12ABC'},{...payload,cnpj:'12ABC34501DEAA'},{...payload,plan_code:'invalid plan'},{...payload,slug:'../loja'},{...payload,owner:{...payload.owner,password:'curta'}}])assert.throws(()=>createInput(input));
});
test('Admin global: duplicidade, falha de auditoria ou sessão Master revogada revertem cadastro',async t=>{
 for(const [opts,status]of [[{duplicate:true},409],[{failAudit:true},500],[{revoked:true},401],[{inactive:true},401]]){const db=fake(opts),r=await serve(t,db,options()),res=await r('/api/admin/tenants',requestBody('POST',payload));assert.equal(res.status,status);assertEnvelope(await res.json(),false);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}
});
test('Admin global: suspensão revoga sessões somente da loja escolhida e registra motivo; ativação não recria sessões',async t=>{
 for(const status of ['suspended','active']){const db=fake(),r=await serve(t,db,options()),res=await r('/api/admin/tenants/8/status',requestBody('PUT',{status,reason:'Solicitação administrativa',company_id:999}));assert.equal(res.status,200);const body=await res.json();assert.equal(body.data.status,status);const update=db.calls.find(c=>c.sql?.startsWith('UPDATE companies'));assert.deepEqual(update.args,[status==='active',8]);const removed=db.calls.find(c=>c.sql?.startsWith('DELETE s FROM sessions'));if(status==='suspended')assert.deepEqual(removed.args,[8]);else assert.equal(removed,undefined);const audit=db.calls.find(c=>c.sql?.startsWith('INSERT INTO platform_audit'));assert.equal(JSON.parse(audit.args[3]).reason,'Solicitação administrativa');assert.deepEqual(db.calls.slice(-2),['commit','release']);}
});
test('Admin global: status inexistente/inválido e auditoria com falha não mudam empresa',async t=>{
 for(const [opts,status]of [[{missing:true},404],[{failAudit:true},500]]){const db=fake(opts),r=await serve(t,db,options()),res=await r('/api/admin/tenants/8/status',requestBody('PUT',{status:'suspended'}));assert.equal(res.status,status);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}
 const db=fake(),r=await serve(t,db,options());for(const [id,body]of [['0',{status:'active'}],['8',{status:'blocked'}],['8',{status:'active',reason:'abc'}],['1%20OR%201',{status:'active'}]])assert.equal((await r('/api/admin/tenants/'+id+'/status',requestBody('PUT',body))).status,400);assert.equal(db.calls.includes('begin'),false);
});
test('Admin global: KPIs consolidam pedidos e MRR decimal somente de preços configurados',async t=>{
 const r=await serve(t,fake(),options()),res=await r('/api/admin/metrics',{headers});assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.active_tenants,4);assert.equal(data.total_tenants,5);assert.equal(data.orders_total,50);assert.equal(data.orders_today,3);assert.equal(data.completed_order_volume,'900.50');assert.equal(data.mrr_estimate,'449.60');assert.equal(data.mrr_missing_price_subscriptions,0);assert.equal(data.currency,'BRL');assert.equal(data.timezone,'UTC');
 const unknown=await serve(t,fake(),{...options(),planPrices:{starter:'99.90'}});const body=await (await unknown('/api/admin/metrics',{headers})).json();assert.equal(body.data.mrr_estimate,null);assert.equal(body.data.mrr_known_amount,'299.70');assert.equal(body.data.mrr_missing_price_subscriptions,1);
});
test('Preços de planos: validação e centavos exatos, inclusive valores zero e ausência de assinaturas',()=>{
 assert.deepEqual(estimatedMrr([],planPrices({})),{mrr_estimate:'0.00',mrr_known_amount:'0.00',mrr_missing_price_subscriptions:0,active_subscriptions:0,plan_prices_configured:false});assert.equal(estimatedMrr([{plan_code:'free',total:'2'}],planPrices({free:'0.00'})).mrr_estimate,'0.00');for(const invalid of ['não-json',[],null,{starter:99.9},{starter:'10.001'},{starter:'-1.00'},{starter:'1,00'}])assert.throws(()=>planPrices(invalid));
});
test('Admin global: erro de conexão no auth ou pool retorna 503 e log JSON sem SQL, credenciais ou corpo',async t=>{
 for(const fail of ['auth','connection']){const logs=[],r=await serve(t,fake({fail}),options(logs)),res=await r('/api/admin/metrics',{headers});assert.equal(res.status,503);const data=await res.json();assertEnvelope(data,false);assert.equal(logs.length,1);assert.equal(logs[0].code,'ECONNREFUSED');assert.equal(logs[0].event,'platform_admin_request_failed');assert.equal(JSON.stringify(logs).includes('NAO_LOGAR'),false);assert.equal(JSON.stringify(data).includes('SELECT'),false);assert.equal(logs[0].request_id,res.headers['x-request-id']);}
});
test('Admin global: JSON inválido, origem externa e subrotas desconhecidas mantêm envelope REST',async t=>{
 const r=await serve(t,fake(),options());for(const [url,opts,status]of [['/api/admin/tenants',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{'},400],['/api/admin/tenants',{...requestBody('POST',payload),headers:{...headers,Origin:'https://evil.example','Content-Type':'application/json'}},403],['/api/admin/tenants/not-supported',{headers},404],['/api/admin/metrics/extra',{headers},404],['/api/admin/metrics',requestBody('POST',{}),405]]){const res=await r(url,opts);assert.equal(res.status,status);assertEnvelope(await res.json(),false);}
});
