const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {testJwt}=require('../test-support/jwt');
const {issue,verify,verifyImpersonation}=require('../src/jwt');
const {tokenHash}=require('../src/security');
const {sessionUser}=require('../src/auth');
const config=testJwt(),masterSid=tokenHash('a'.repeat(64));
const master={Authorization:'Bearer '+issue(config,{scope:'master',id:2,role:'super_admin',sid:masterSid})};
const json=(method,body,headers=master)=>({method,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fake({company=true,active=true,owner=true,failAudit=false}={}){
 const calls=[],sessions=new Map();let parent=true,snapshot;
 async function execute(sql,args=[]){calls.push({sql,args});
  if(sql.includes('FROM platform_sessions s'))return [parent?[{id:2,name:'Master',email:'master@example.com'}]:[]];
  if(sql.startsWith('SELECT id FROM platform_admins'))return [parent?[{id:2}]:[]];
  if(sql.startsWith('SELECT token_hash FROM platform_sessions'))return [parent?[{token_hash:masterSid}]:[]];
  if(sql.startsWith('SELECT id,name,active FROM companies'))return [company?[{id:8,name:'Loja alvo',active:Number(active)}]:[]];
  if(sql.startsWith('SELECT id FROM users'))return [owner?[{id:3}]:[]];
  if(sql.startsWith('INSERT INTO platform_impersonations')){sessions.set(args[0],{id:args[0],admin_id:args[1],company_id:args[3],owner_id:args[4],exchanged:0,cookie_hash:null});return [{affectedRows:1}];}
  if(sql.startsWith('SELECT i.id AS assisted_id')){const row=sessions.get(args[0]);if(!row||!parent||!active||!owner||(args.length===2&&row.cookie_hash!==args[1]))return [[]];return [[{...row,assisted_id:row.id,id:row.owner_id,role:'owner',name:'Dono da loja',email:'owner@example.com',company_name:'Loja alvo',slug:'loja-alvo',actor_name:'Master',actor_email:'master@example.com',assisted_expires_at:new Date(Date.now()+3599000)}]];}
  if(sql.startsWith('UPDATE platform_impersonations')){const row=sessions.get(args[1]);row.cookie_hash=args[0];row.exchanged=1;return [{affectedRows:1}];}
  if(sql.startsWith('SELECT id,admin_id,company_id,cookie_hash')){const row=sessions.get(args[0]);return [row&&(args.length===1||row.cookie_hash===args[1])?[row]:[]];}
  if(sql.startsWith('SELECT id FROM platform_impersonations WHERE cookie_hash'))return [[...sessions.values()].filter(row=>row.cookie_hash===args[0]).slice(0,1)];
  if(sql.startsWith('DELETE FROM platform_impersonations WHERE id=')){sessions.delete(args[0]);return [{affectedRows:1}];}
  if(sql.startsWith('DELETE FROM platform_impersonations WHERE expires_at'))return [{affectedRows:0}];
  if(sql.startsWith('INSERT INTO platform_audit')){if(failAudit)throw new Error('Auditoria indisponível');return [{insertId:4}];}
  if(sql.includes('FROM sessions s'))return [[{id:7,company_id:7,role:'owner',name:'Conta normal',email:'normal@example.com',company_name:'Outra loja',slug:'outra-loja'}]];
  if(sql.startsWith('DELETE FROM platform_sessions')){parent=false;sessions.clear();return [{affectedRows:1}];}
  if(sql.startsWith('SELECT id, name, sort_order'))return [[{id:11,name:'Categoria alvo'}]];
  if(sql.startsWith('SELECT p.id,p.category_id'))return [[]];
  if(sql.startsWith('INSERT INTO categories'))return [{insertId:19}];
  if(sql.startsWith('DELETE FROM sessions'))return [{affectedRows:1}];
  throw new Error(sql);
 }
 return {calls,sessions,execute,revoke(){parent=false;sessions.clear();},getConnection:async()=>({execute,beginTransaction:async()=>{calls.push('begin');snapshot=new Map([...sessions].map(([id,row])=>[id,{...row}]));},commit:async()=>calls.push('commit'),rollback:async()=>{calls.push('rollback');sessions.clear();for(const [id,row]of snapshot)sessions.set(id,row);},release:()=>calls.push('release')})};
}
const settings={jwt:config,secureCookies:true,logger:{error(){}}};
async function start(request){const res=await request('/api/admin/tenants/8/impersonate',json('POST',{reason:'Atendimento assistido'}));assert.equal(res.status,200);return (await res.json()).data;}
async function enter(request,data){const res=await request('/api/auth/impersonation/exchange',json('POST',{token:data.access_token},{}));assert.equal(res.status,200);const body=await res.json(),cookie=String(res.headers['set-cookie']).split(';')[0];return {headers:{Cookie:cookie,'X-Apex-Impersonation':body.data.context},context:body.data.context,response:res,cookie};}
test('Impersonation: emissão exclusiva Master, JWT proprietário com ator e validade de uma hora',async t=>{
 const db=fake(),r=await serve(t,db,settings);for(const headers of [{},{Authorization:'Bearer '+issue(config,{scope:'tenant',id:7,role:'tenant_owner',tenantId:7,sid:masterSid})}])assert.equal((await r('/api/admin/tenants/8/impersonate',json('POST',{},headers))).status,401);
 const data=await start(r),claims=verifyImpersonation(config,data.access_token);assert.equal(claims.tenant_id,8);assert.equal(claims.role,'tenant_owner');assert.equal(claims.act.sub,'master:2');assert.equal(claims.exp-claims.iat,3600);assert.equal(data.expires_in,3600);assert.ok(data.redirect_url.startsWith('/tenant/dashboard#token='));assert.ok(!data.redirect_url.includes('?token='));assert.throws(()=>verify(config,data.access_token,'tenant'));assert.throws(()=>verify(config,data.access_token,'master'));assert.throws(()=>verifyImpersonation(config,data.access_token,claims.exp));assert.equal(db.calls.some(c=>c.sql?.startsWith('INSERT INTO users')),false);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('Impersonation: loja ausente/suspensa, proprietário inativo e auditoria com falha não emitem sessão',async t=>{
 for(const [opts,status]of [[{company:false},404],[{active:false},409],[{owner:false},409],[{failAudit:true},500]]){const db=fake(opts),r=await serve(t,db,settings),res=await r('/api/admin/tenants/8/impersonate',json('POST',{}));assert.equal(res.status,status);assert.equal(db.sessions.size,0);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}
 const db=fake(),r=await serve(t,db,settings);assert.equal((await r('/api/admin/tenants/0/impersonate',json('POST',{}))).status,400);assert.equal((await r('/api/admin/tenants/8/impersonate',json('POST',{reason:'abc'}))).status,400);assert.equal(db.calls.includes('begin'),false);
});
test('Impersonation: bearer permite operar somente o tenant alvo, identifica ator e impede renovação/elevacao',async t=>{
 const db=fake(),r=await serve(t,db,settings),data=await start(r),headers={Authorization:'Bearer '+data.access_token};
 const me=await r('/api/auth/me',{headers});assert.equal(me.status,200);const who=await me.json();assert.equal(who.user.company_id,8);assert.equal(who.impersonation.actor.id,2);assert.equal(who.user.id,3);assert.ok(!JSON.stringify(who).includes(data.access_token));
 assert.equal((await r('/api/admin/catalog?tenant_id=999',{headers})).status,200);const read=db.calls.find(c=>c.sql?.startsWith('SELECT id, name, sort_order'));assert.deepEqual(read.args,[8]);
 assert.equal((await r('/api/admin/categories',json('POST',{name:'Criada no suporte',company_id:999},headers))).status,201);assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('INSERT INTO categories')).args,[8,'Criada no suporte']);const attempt=db.calls.find(c=>c.sql?.includes("'impersonation_request'"));assert.equal(attempt.args[0],2);assert.equal(attempt.args[1],'8');
 assert.equal((await r('/api/auth/token',json('POST',{},headers))).status,403);assert.equal((await r('/api/admin/metrics',{headers})).status,401);
 const forged=issue(config,{scope:'tenant',id:3,role:'tenant_owner',tenantId:9,sid:[...db.sessions.keys()][0],actorId:2});assert.equal((await r('/api/auth/me',{headers:{Authorization:'Bearer '+forged}})).status,401);
});
test('Impersonation: troca única por cookie seguro, sem persistir JWT ou sobrescrever sessão de lojista',async t=>{
 const db=fake(),r=await serve(t,db,settings),data=await start(r),entry=await enter(r,data),cookie=String(entry.response.headers['set-cookie']);for(const part of ['HttpOnly','Secure','SameSite=Strict','Path=/api'])assert.ok(cookie.includes(part));assert.ok(!cookie.includes('delivery_session='));assert.ok(!cookie.includes(data.access_token));assert.ok(entry.cookie.startsWith('apex_assisted_session='));
 assert.equal((await r('/api/auth/impersonation/exchange',json('POST',{token:data.access_token},{}))).status,409);
 const me=await(await r('/api/auth/me',{headers:entry.headers})).json();assert.equal(me.user.company_id,8);assert.equal(me.impersonation.active,true);
 const combined={Cookie:entry.cookie+'; delivery_session='+'b'.repeat(64)};const normal=await(await r('/api/auth/me',{headers:combined})).json();assert.equal(normal.user.company_id,7);assert.equal(normal.impersonation,undefined);
 const stale=await r('/api/auth/me',{headers:{...combined,'X-Apex-Impersonation':'f'.repeat(64)}});assert.equal(stale.status,401);assert.equal((await r('/api/auth/token',json('POST',{},entry.headers))).status,403);
});
test('Impersonation: encerramento preserva conta normal e token anterior é revogado',async t=>{
 const db=fake(),r=await serve(t,db,settings),data=await start(r),entry=await enter(r,data);
 const ended=await r('/api/auth/impersonation/end',json('POST',{},entry.headers));assert.equal(ended.status,200);assert.ok(String(ended.headers['set-cookie']).includes('apex_assisted_session='));assert.ok(!String(ended.headers['set-cookie']).includes('delivery_session='));assert.equal(db.sessions.size,0);assert.equal((await r('/api/auth/me',{headers:{Authorization:'Bearer '+data.access_token}})).status,401);assert.equal(db.calls.some(c=>c.sql?.startsWith('DELETE FROM sessions')),false);
});
test('Impersonation: logout normal do painel assistido também encerra somente o acesso assistido',async t=>{
 const db=fake(),r=await serve(t,db,settings),data=await start(r),entry=await enter(r,data);assert.equal((await r('/api/auth/logout',json('POST',{},entry.headers))).status,200);assert.equal(db.sessions.size,0);assert.equal(db.calls.some(c=>c.sql?.startsWith('DELETE FROM sessions')),false);
});
test('Impersonation: trocar de contexto em outra aba não permite operar ou encerrar o contexto novo',async t=>{
 const db=fake(),r=await serve(t,db,settings),first=await enter(r,await start(r)),second=await enter(r,await start(r));const stale={Cookie:second.cookie,'X-Apex-Impersonation':first.context};assert.equal((await r('/api/auth/me',{headers:stale})).status,401);const end=await r('/api/auth/impersonation/end',json('POST',{},stale));assert.equal(end.status,409);assert.equal(end.headers['set-cookie'],undefined);assert.equal((await r('/api/auth/me',{headers:second.headers})).status,200);
});
test('Impersonation: fim da sessão Master revoga bearer/cookie e o fluxo SSE revalida o pai',async t=>{
 const db=fake(),r=await serve(t,db,settings),data=await start(r),entry=await enter(r,data);const req={headers:{cookie:entry.cookie},query:{assisted_context:entry.context},originalUrl:'/api/admin/orders/events?assisted_context='+entry.context,app:{locals:{jwt:config}}};assert.equal((await sessionUser(db,req)).company_id,8);assert.equal((await r('/api/master/auth/logout',json('POST',{},master))).status,200);assert.equal((await r('/api/auth/me',{headers:entry.headers})).status,401);assert.equal((await r('/api/auth/me',{headers:{Authorization:'Bearer '+data.access_token}})).status,401);assert.equal(await sessionUser(db,req),null);assert.equal((await r('/api/auth/impersonation/end',json('POST',{},entry.headers))).status,200);
});
test('Impersonation: JWT comum, corpo inválido e origem externa não fazem troca de sessão',async t=>{
 const db=fake(),r=await serve(t,db,settings);const normal=issue(config,{scope:'tenant',id:3,role:'tenant_owner',tenantId:8,sid:masterSid});assert.equal((await r('/api/auth/impersonation/exchange',json('POST',{token:normal},{}))).status,401);assert.equal((await r('/api/auth/impersonation/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);assert.equal((await r('/api/admin/tenants/8/impersonate',json('POST',{}, {...master,Origin:'https://evil.example'}))).status,403);assert.equal(db.sessions.size,0);assert.equal((await r('/tenant/dashboard')).status,200);
});
test('Impersonation: falha em auditar tentativa impede a escrita operacional',async t=>{const db=fake(),r=await serve(t,db,settings),data=await start(r);const execute=db.execute;db.execute=async(sql,args)=>{if(sql.includes("'impersonation_request'"))throw new Error('Auditoria indisponível');return execute(sql,args);};assert.equal((await r('/api/admin/categories',json('POST',{name:'Não criar'},{Authorization:'Bearer '+data.access_token}))).status,500);assert.equal(db.calls.some(c=>c.sql?.startsWith('INSERT INTO categories')),false);});
test('Impersonation: imagens privadas carregam com nonce e cookie, sem JWT na URL',async t=>{const db=fake(),r=await serve(t,db,settings),entry=await enter(r,await start(r));const req={headers:{cookie:entry.cookie},query:{assisted_context:entry.context},originalUrl:'/api/admin/products/11/image?assisted_context='+entry.context,app:{locals:{jwt:config}}};assert.equal((await sessionUser(db,req)).company_id,8);const {withImage}=require('../src/product-images');const image=withImage({id:11,image_digest:'digest'},true,entry.context);assert.ok(image.image_url.includes('assisted_context='+entry.context));assert.ok(!image.image_url.includes('token='));});
