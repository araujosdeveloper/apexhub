const {test}=require('node:test'),assert=require('node:assert/strict');
const {serve}=require('../test-support/http');const {defaults}=require('../src/operations');const {png}=require('../integration/product-images');const {profileInput}=require('../src/store-profile');
const headers={Cookie:'delivery_session='+'a'.repeat(64)};
function fake({role='owner',fail=false}={}){const calls=[],assets=new Map();let config={...defaults(),store_profile:{banner_url:'',logo_url:'',address:'Rua A',phone:'',notice:''}};
 const execute=async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];if(sql.startsWith('SELECT id FROM companies'))return [[{id:7}]];if(sql.startsWith('SELECT config'))return [[{config}]];
 if(sql.startsWith('SELECT i.content_type')){assert.match(sql,/c.active=1/);return [args[0]===7&&assets.has(args[1])?[assets.get(args[1])]:[]];}
 if(sql.startsWith('INSERT INTO store_images')){assets.set(args[1],{content_type:args[2],content:Buffer.from(args[3]),digest:args[4]});return [{}];}
 if(sql.startsWith('DELETE FROM store_images')){assets.delete(args[1]);return [{}];}
 if(sql.startsWith('INSERT INTO company_operations')){if(fail)throw Error('private failure');config=JSON.parse(args[1]);return [{}];}throw Error(sql);};
 return {calls,assets,execute,get config(){return config;},getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};}
async function upload(bytes=png,type='image/png',extra=false){const form=new FormData();form.append('file',new Blob([bytes],{type}),'../../logo.png');if(extra)form.append('tenant_id','999');const response=new Response(form);return {method:'POST',headers:{...headers,'Content-Type':response.headers.get('content-type')},body:Buffer.from(await response.arrayBuffer())};}
test('imagens da loja: sessão e perfil antes do multipart',async t=>{const db=fake({role:'operator'}),r=await serve(t,db);assert.equal((await r('/api/admin/store-profile/images/logo',{method:'POST'})).status,401);assert.equal((await r('/api/admin/store-profile/images/logo',await upload())).status,403);assert.equal(db.calls.includes('begin'),false);});
test('imagens da loja: upload deriva caminho do tenant, preserva regras e serve binário com ETag',async t=>{
 const db=fake(),r=await serve(t,db),res=await r('/api/admin/store-profile/images/banner?tenant_id=999',await upload());assert.equal(res.status,200);const body=await res.json();assert.match(body.image_url,/^\/api\/store-images\/7\/banner\?v=[a-f0-9]{64}$/);assert.equal(db.config.delivery_minutes,60);const row=db.calls.find(c=>c.sql?.startsWith('INSERT INTO store_images'));assert.deepEqual(row.args.slice(0,3),[7,'banner','image/png']);assert.deepEqual(db.calls.slice(-2),['commit','release']);
 const image=await r(body.image_url);assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);const cached=await r(body.image_url,{headers:{'If-None-Match':image.headers.etag}});assert.equal(cached.status,304);assert.equal((await r('/api/store-images/8/banner')).status,404);
});
test('imagens da loja: formatos falsos, campos extras e kind inválido não escrevem',async t=>{
 const db=fake(),r=await serve(t,db);for(const body of [await upload(png,'image/jpeg'),await upload(Buffer.from('<svg/>'),'image/svg+xml'),await upload(png,'image/png',true)])assert.equal((await r('/api/admin/store-profile/images/logo',body)).status,400);assert.equal((await r('/api/admin/store-profile/images/foreign',await upload())).status,400);assert.equal(db.calls.some(c=>c.sql?.startsWith('INSERT INTO store_images')),false);
});
test('imagens da loja: remoção limpa somente a imagem solicitada e metadados próprios',async t=>{
 const db=fake(),r=await serve(t,db);await r('/api/admin/store-profile/images/banner',await upload());await r('/api/admin/store-profile/images/logo',await upload());const res=await r('/api/admin/store-profile/images/banner',{method:'DELETE',headers});assert.equal(res.status,200);assert.equal((await res.json()).image_url,null);assert.equal(db.config.store_profile.banner_url,'');assert.match(db.config.store_profile.logo_url,/\/7\/logo\?/);assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('DELETE FROM store_images')).args,[7,'banner']);
});
test('imagens da loja: contatos não apagam arquivos e caminhos de outra loja são rejeitados',async t=>{
 const db=fake(),r=await serve(t,db);await r('/api/admin/store-profile/images/logo',await upload());const path=db.config.store_profile.logo_url;const json={...headers,'Content-Type':'application/json'};assert.equal((await r('/api/admin/store-profile',{method:'PUT',headers:json,body:JSON.stringify({address:'Nova rua',email:'contato@example.com',instagram_url:'https://www.instagram.com/loja'})})).status,200);assert.equal(db.config.store_profile.logo_url,path);
 assert.equal((await r('/api/admin/store-profile',{method:'PUT',headers:json,body:JSON.stringify({logo_url:'/api/store-images/999/logo?v='+'a'.repeat(64)})})).status,400);
});
test('imagens da loja: falha da referência reverte transação e tamanho excessivo é recusado',async t=>{
 const db=fake({fail:true}),r=await serve(t,db);assert.equal((await r('/api/admin/store-profile/images/logo',await upload())).status,500);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);const tooBig=await upload(Buffer.alloc(2*1024*1024+65536));assert.equal((await r('/api/admin/store-profile/images/logo',tooBig)).status,413);
});
test('perfil público: e-mail/redes validados e URL local de imagem aceita somente formato canônico',()=>{
 assert.equal(profileInput({email:'contato@example.com',facebook_url:'https://www.facebook.com/loja',logo_url:'/api/store-images/7/logo?v='+'a'.repeat(64)}).email,'contato@example.com');for(const body of [{email:'invalid'},{instagram_url:'javascript:alert(1)'},{facebook_url:'https://evil.example.com'}])assert.throws(()=>profileInput(body));
});
