const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {productInput,categoryInput,positiveId}=require('../src/controllers/tenant-menu');
const {syncOptions}=require('../src/menu-options');
const {testJwt}=require('../test-support/jwt');
const {issue}=require('../src/jwt');
const jwt=testJwt(),headers={Cookie:'delivery_session='+'a'.repeat(64),'Content-Type':'application/json'};
const input={name:'Combo',category_id:3,price:'19.90',description:'Completo',image_url:'https://images.example/combo.jpg',options:[{name:'Queijo',additional_price:'2.50',max_quantity:1}]};
function fake({role='owner',found=true,fail=false}={}){
 const calls=[],row={id:8,company_id:7,category_id:3,name:'Combo',description:'Completo',price:'19.90',image_url:input.image_url,active:1,created_at:'2026-11-06 00:00:00'};
 async function execute(sql,args){calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(fail&&sql.includes('product_options')){const e=Error('MYSQL_PASSWORD=secret');e.code='ECONNREFUSED';throw e;}
  if(sql.startsWith('SELECT id FROM categories'))return [found?[{id:3}]:[]];
  if(sql.startsWith('SELECT id,active FROM products'))return [found?[row]:[]];
  if(sql.includes('FROM product_options o'))return [[{id:'12',tenant_id:7,product_id:8,group_key:'g',option_key:'o',name:'Queijo',additional_price:'2.50',max_quantity:1,is_active:1}]];
  if(sql.startsWith('SELECT p.id'))return [[row]];
  if(sql.startsWith('SELECT id,company_id,name'))return [[{id:3,company_id:7,name:'Combos',sort_order:0,active:1}]];
  if(sql.startsWith('SELECT id,company_id,category_id'))return [[row]];
  if(sql.startsWith('INSERT INTO categories'))return [{insertId:3}];
  if(sql.startsWith('INSERT INTO products'))return [{insertId:8}];
  if(/^(INSERT|UPDATE|DELETE)/.test(sql))return [{affectedRows:1}];
  throw Error(sql);
 }
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
const body=(method,value)=>({method,headers,body:JSON.stringify(value)});
test('cardápio API: autenticação, RBAC, rotas e envelope',async t=>{
 const db=fake({role:'operator'}),r=await serve(t,db,{jwt});
 for(const [url,method] of [['','GET'],['/categories','POST'],['/products','POST'],['/products/8/availability','PUT'],['/products/8','DELETE']]){
  const path='/api/tenant/menu'+url;assert.equal((await r(path,{method})).status,401);const response=await r(path,{method,headers});assert.equal(response.status,403);assert.equal((await response.json()).success,false);
 }
 const master=issue(jwt,{scope:'master',id:1,role:'super_admin',sid:'a'.repeat(64)});assert.equal((await r('/api/tenant/menu',{headers:{Authorization:'Bearer '+master}})).status,401);assert.equal(db.calls.includes('begin'),false);
});
test('cardápio API: leitura agrupada inclui opções e filtra todas as tabelas por tenant',async t=>{
 const db=fake(),r=await serve(t,db,{jwt}),res=await r('/api/tenant/menu?tenant_id=999',{headers});assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.tenant_id,7);assert.equal(data.categories[0].is_active,true);assert.equal(data.categories[0].products[0].options[0].additional_price,'2.50');assert.equal(data.categories[0].products[0].is_available,true);
 const calls=db.calls.filter(c=>c.sql&&!c.sql.includes('FROM sessions s'));assert.equal(calls.length,3);for(const c of calls)assert.deepEqual(c.args,[7]);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('cardápio API: criação usa tenant autenticado, valida categoria e sincroniza opções atomicamente',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});const category=await r('/api/tenant/menu/categories',body('POST',{name:'Combos',tenant_id:999}));assert.equal(category.status,201);const cat=db.calls.find(c=>c.sql?.startsWith('INSERT INTO categories'));assert.equal(cat.args[0],7);
 const res=await r('/api/tenant/menu/products',body('POST',{...input,tenant_id:999}));assert.equal(res.status,201);assert.equal((await res.json()).data.addon_version,1);const write=db.calls.find(c=>c.sql?.startsWith('INSERT INTO products'));assert.equal(write.args[0],7);assert.equal(write.args[1],3);const option=db.calls.find(c=>c.sql?.startsWith('INSERT INTO product_options'));assert.deepEqual(option.args.slice(0,2),[7,8]);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('cardápio API: categoria estrangeira, disponibilidade e exclusão de outra loja não escrevem',async t=>{
 for(const [path,method,value] of [['/products','POST',input],['/products/8/availability','PUT',{is_available:false}],['/products/8','DELETE',{}]]){
  const db=fake({found:false}),r=await serve(t,db,{jwt}),res=await r('/api/tenant/menu'+path,body(method,value));assert.equal(res.status,404);assert.equal(db.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql||'')),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);
 }
});
test('cardápio API: disponibilidade explícita é idempotente e exclusão preserva histórico',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});for(const available of [false,true]){const res=await r('/api/tenant/menu/products/8/availability',body('PUT',{is_available:available,tenant_id:999}));assert.equal(res.status,200);const c=db.calls.filter(c=>c.sql?.startsWith('UPDATE products SET active=')).at(-1);assert.deepEqual(c.args,[available,8,7]);}
 const res=await r('/api/tenant/menu/products/8',body('DELETE',{}));assert.equal(res.status,200);assert.equal((await res.json()).data.deactivated,true);assert.equal(db.calls.some(c=>c.sql?.startsWith('DELETE FROM products')),false);
});
test('cardápio API: valida IDs, preços, nomes, URLs e limitações reais dos opcionais',()=>{
 for(const id of ['0','1 OR 1','-1','8.0','4294967296'])assert.throws(()=>positiveId(id));
 for(const data of [{...input,price:'-1'},{...input,price:19.9},{...input,category_id:'3'},{...input,image_url:'javascript:alert(1)'},{...input,image_url:'https://user:pass@example.com/x'},{...input,name:''},{...input,options:[{name:'Extra',additional_price:'2.50',max_quantity:21}]}])assert.throws(()=>productInput(data));
 assert.equal(productInput({...input,price:'0'}).price,'0.00');assert.throws(()=>categoryInput({name:'Bebidas',sort_order:-1}));
});
test('cardápio API: falha ao sincronizar adicionais reverte produto sem vazar credenciais',async t=>{
 const db=fake({fail:true}),logs=[],r=await serve(t,db,{jwt,logger:{error:line=>logs.push(line)}}),res=await r('/api/tenant/menu/products',body('POST',input));assert.equal(res.status,503);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);assert.equal(logs.join('').includes('secret'),false);
});
test('opcionais: upsert conserva IDs e remoção de opções tem escopo de tenant/produto',async()=>{
 const calls=[],conn={execute:async(sql,args)=>{calls.push({sql,args});return [{}];}};
 await syncOptions(conn,7,8,[{id:'g',options:[{id:'cheese',name:'Queijo',price:'2.50',active:true}]}]);assert.match(calls[0].sql,/ON DUPLICATE KEY UPDATE/);assert.deepEqual(calls[1].args,[7,8,'cheese']);assert.match(calls[1].sql,/WHERE tenant_id=\? AND product_id=\?/);await syncOptions(conn,7,8,[]);assert.deepEqual(calls[2].args,[7,8]);
});

test('opcionais repetidos têm limite validado e projeção relacional atualizada', async () => {
 const data=productInput({...input,options:[{name:'Queijo',additional_price:'2.50',max_quantity:3}]});
 assert.equal(data.groups[0].max,3);assert.equal(data.groups[0].options[0].max_quantity,3);
 const calls=[];await syncOptions({execute:async(sql,args)=>{calls.push({sql,args});return [{}];}},7,8,data.groups);
 assert.equal(calls[0].args[6],3);assert.match(calls[0].sql,/max_quantity=VALUES\(max_quantity\)/);
});
