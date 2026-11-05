const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {driverInput}=require('../src/drivers');
const headers={Cookie:'delivery_session='+'a'.repeat(64),'Content-Type':'application/json'};
function fake({role='operator',status='ready',fulfillment='delivery',version=0,driver=true,missing=false,fail=false}={}){
 const calls=[],events=[];
 async function execute(sql,args){calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(sql.startsWith('SELECT status,fulfillment_method'))return [missing?[]:[{status,fulfillment_method:fulfillment}]];
  if(sql.startsWith('SELECT version FROM delivery_assignments'))return [version?[{version}]:[]];
  if(sql.startsWith('SELECT id,name,phone FROM delivery_drivers'))return [driver?[{id:3,name:'Ana',phone:'5511999990000'}]:[]];
  if(sql.startsWith('INSERT INTO delivery_assignments')){if(fail)throw new Error('Falha');return [{affectedRows:1}];}
  if(sql.startsWith('SELECT id,name,phone,active'))return [[{id:3,name:'Ana',phone:'5511999990000',active:1,version:1}]];
  if(sql.startsWith('INSERT INTO delivery_drivers'))return [{insertId:3}];
  if(sql.startsWith('UPDATE delivery_drivers'))return [{affectedRows:version?0:1}];
  if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];
  if(sql.includes('FROM orders o LEFT JOIN delivery_assignments'))return [[{id:12,status:'ready'}]];
  throw new Error(sql);
 }
 const db={execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
 return {db,calls,events,options:{orderEvents:{publish:id=>events.push(id),stream:()=>()=>{}}}};
}
const put=(body)=>({method:'PUT',headers,body:JSON.stringify({driver_id:3,version:0,status:'ready',...body})});
test('entregadores: valida telefone e campos sem aceitar disponibilidade ambígua',()=>{
 assert.deepEqual(driverInput({name:' Ana ',phone:'(11) 99999-0000',active:true}),{name:'Ana',phone:'5511999990000',active:true});
 for(const body of [{},{name:'x',phone:'x',active:true},{name:'x',phone:'11999990000',active:'true'},{name:' '.repeat(5),phone:'11999990000',active:true}])assert.throws(()=>driverInput(body));
});
test('entregadores: cadastro exige gestor, consulta e despacho exigem sessão',async t=>{
 const f=fake(),r=await serve(t,f.db,f.options);
 for(const path of ['/api/admin/drivers','/api/admin/dispatch'])assert.equal((await r(path)).status,401);
 assert.equal((await r('/api/admin/drivers',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await r('/api/admin/drivers/3',put({}))).status,403);
 assert.equal((await r('/api/admin/drivers',{headers})).status,200);
 assert.equal(f.calls.some(c=>c.sql?.startsWith('INSERT')),false);
});
test('despacho: operador vincula com trava, snapshot e loja da sessão sem alterar status',async t=>{
 const f=fake(),r=await serve(t,f.db,f.options);assert.equal((await r('/api/admin/dispatch/12',put({company_id:999}))).status,200);
 const insert=f.calls.find(c=>c.sql?.startsWith('INSERT INTO delivery_assignments'));assert.deepEqual(insert.args,[12,7,3,'Ana','5511999990000']);
 assert.match(f.calls.find(c=>c.sql?.startsWith('SELECT status')).sql,/FOR UPDATE/);assert.deepEqual(f.events,[7]);assert.deepEqual(f.calls.slice(-2),['commit','release']);assert.equal(f.calls.some(c=>c.sql?.startsWith('UPDATE orders')),false);
});
test('despacho: retirada, etapa divergente, concorrência e entregador de outra loja recusados',async t=>{
 for(const [opts,expected] of [[{fulfillment:'pickup'},409],[{status:'delivering'},409],[{version:1},409],[{driver:false},400],[{missing:true},404]]){
  const f=fake(opts),r=await serve(t,f.db,f.options);assert.equal((await r('/api/admin/dispatch/12',put({}))).status,expected);assert.equal(f.events.length,0);assert.deepEqual(f.calls.slice(-2),['rollback','release']);assert.equal(f.calls.some(c=>c.sql?.startsWith('INSERT')),false);
 }
});
test('despacho: remoção mantém versão; falha transacional libera conexão e não notifica',async t=>{
 const f=fake({version:2}),r=await serve(t,f.db,f.options);assert.equal((await r('/api/admin/dispatch/12',put({version:2,driver_id:null}))).status,200);assert.deepEqual(f.calls.find(c=>c.sql?.startsWith('INSERT')).args,[12,7,null,'','']);
 const failure=fake({fail:true}),rr=await serve(t,failure.db,failure.options);assert.equal((await rr('/api/admin/dispatch/12',put({}))).status,500);assert.deepEqual(failure.calls.slice(-2),['rollback','release']);assert.deepEqual(failure.events,[]);
});
test('despacho: paginação limitada e filtros inválidos sem escrita',async t=>{
 const f=fake(),r=await serve(t,f.db,f.options);assert.equal((await r('/api/admin/dispatch?offset=50&company_id=999',{headers})).status,200);
 const query=f.calls.find(c=>c.sql?.includes('FROM orders o LEFT JOIN'));assert.deepEqual(query.args,[7]);assert.match(query.sql,/LIMIT 50 OFFSET 50/);
 for(const body of [{driver_id:-1},{version:-1},{status:'delivering'},{version:'0'},{driver_id:'3'}])assert.equal((await r('/api/admin/dispatch/12',put(body))).status,400);
 assert.equal((await r('/api/admin/dispatch?offset=-1',{headers})).status,400);
});
test('entregadores: edição compara versão e restringe restaurante',async t=>{
 const f=fake({role:'manager'}),r=await serve(t,f.db,f.options),body={name:'Ana',phone:'11999990000',active:false,version:1};
 assert.equal((await r('/api/admin/drivers/3',{method:'PUT',headers,body:JSON.stringify(body)})).status,200);assert.deepEqual(f.calls.find(c=>c.sql?.startsWith('UPDATE')).args,['Ana','5511999990000',false,3,7,1]);
 const conflict=fake({role:'owner',version:1}),rr=await serve(t,conflict.db,conflict.options);assert.equal((await rr('/api/admin/drivers/3',{method:'PUT',headers,body:JSON.stringify(body)})).status,409);
});
