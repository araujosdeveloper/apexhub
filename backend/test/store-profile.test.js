const {test}=require('node:test'),assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {defaults,loadOperations}=require('../src/operations');
const {profileInput}=require('../src/store-profile');
const headers={Cookie:'delivery_session='+'a'.repeat(64),'Content-Type':'application/json'};
const profile={banner_url:'https://images.example/cover.jpg',logo_url:'https://images.example/logo.png',address:'Rua da Loja, 10, Centro, Cidade',phone:'5586999999999',notice:'Retire pela entrada lateral.'};
function fake({role='owner',fail=false,active=true}={}){const calls=[],config={...defaults(),delivery_minutes:45,zones_enabled:true,zones:[{name:'Centro',fee:'3.50'}]};const execute=async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];if(sql.startsWith('SELECT id FROM companies'))return [active?[{id:7}]:[]];if(sql.startsWith('SELECT config'))return [[{config}]];if(sql.startsWith('INSERT INTO company_operations')){if(fail)throw Error('private SQL');return [{}];}throw Error(sql);};return {config,calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};}
test('apresentação: URLs seguras, campos públicos limitados e telefone válido',()=>{
 assert.deepEqual(profileInput({...profile,tenant_id:999}),profile);assert.equal(profileInput({}).banner_url,'');for(const change of [{banner_url:'javascript:alert(1)'},{logo_url:'http://image.example/x'},{banner_url:'https://user:secret@example.com/x'},{phone:'abc'},{notice:'x'.repeat(501)}])assert.throws(()=>profileInput({...profile,...change}));
});
test('apresentação: autenticação/perfil antes de consultar ou escrever',async t=>{const db=fake({role:'operator'}),r=await serve(t,db);assert.equal((await r('/api/admin/store-profile')).status,401);assert.equal((await r('/api/admin/store-profile',{headers})).status,403);assert.equal(db.calls.includes('begin'),false);});
test('apresentação: grava perfil somente na própria loja e preserva taxas/modalidades',async t=>{
 const db=fake(),r=await serve(t,db),res=await r('/api/admin/store-profile',{method:'PUT',headers,body:JSON.stringify({...profile,tenant_id:999})});assert.equal(res.status,200);const write=db.calls.find(c=>c.sql?.startsWith('INSERT'));assert.equal(write.args[0],7);const saved=JSON.parse(write.args[1]);assert.deepEqual(saved.store_profile,profile);assert.equal(saved.delivery_minutes,45);assert.equal(saved.zones[0].fee,'3.50');assert.equal(saved.delivery_enabled,true);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('apresentação: falha de escrita ou loja suspensa reverte e libera conexão',async t=>{
 const old=console.error;console.error=()=>{};try{for(const [settings,status]of [[{fail:true},500],[{active:false},403]]){const db=fake(settings),r=await serve(t,db);assert.equal((await r('/api/admin/store-profile',{method:'PUT',headers,body:JSON.stringify(profile)})).status,status);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}}finally{console.error=old;}
});
test('apresentação: perfil público acompanha operação e atualização de operação preserva perfil no SQL',async t=>{
 const db=fake();db.config.store_profile=profile;const config=await loadOperations(db,7);assert.deepEqual(config.store_profile,profile);const r=await serve(t,db),res=await r('/api/admin/operations',{method:'PUT',headers,body:JSON.stringify({...defaults(),delivery_minutes:30})});assert.equal(res.status,200);const sql=db.calls.find(c=>c.sql?.startsWith('INSERT')).sql;assert.match(sql,/JSON_CONTAINS_PATH/);assert.match(sql,/JSON_EXTRACT\(company_operations.config, '\$\.store_profile'\)/);
});
