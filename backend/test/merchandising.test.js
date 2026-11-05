const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {defaults,validateConfig,decorateMenu}=require('../src/merchandising');
const headers={Cookie:'delivery_session='+'a'.repeat(64),'Content-Type':'application/json'};
const config=()=>({...defaults(),recommendations:[{product_id:1,related_ids:[2,3]}]});
function fake({role='owner',version=0,foreign=false,fail=false,settings=config()}={}){
 const calls=[];
 async function execute(sql,args){calls.push({sql,args});
  if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
  if(sql.startsWith('SELECT config,version'))return [version?[{config:settings,version}]:[]];
  if(sql.startsWith('SELECT id FROM companies'))return [[{id:7}]];
  if(sql.startsWith('SELECT id FROM products'))return [foreign?[{id:1}]:args.slice(1).map(id=>({id}))];
  if(sql.startsWith('SELECT p.id,p.name'))return [[{id:1,name:'Lanche',price:'10',active:1,category_active:1}]];
  if(sql.startsWith('SELECT oi.product_id'))return [[{product_id:2,units:'10'},{product_id:1,units:'2'},{product_id:99,units:'1'}]];
  if(sql.startsWith('INSERT INTO company_merchandising')){if(fail)throw new Error('Falha');return [{affectedRows:1}];}throw new Error(sql);
 }
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
const put=(body={})=>({method:'PUT',headers,body:JSON.stringify({version:0,config:config(),...body})});
test('vitrine: valida limites, perfis de produto e impede sugestões repetidas ou do próprio item',()=>{
 assert.deepEqual(validateConfig(config()),config());
 for(const value of [null,{...defaults(),popular_enabled:'true'},{...defaults(),recommendations:Array(101).fill({product_id:1,related_ids:[2]})},...[[1],[2,2],Array.from({length:7},(_,i)=>i+2),[],['2']].map(related_ids=>({...defaults(),recommendations:[{product_id:1,related_ids}]})),{...defaults(),recommendations:[{product_id:1,related_ids:[2]},{product_id:1,related_ids:[3]}]}])assert.throws(()=>validateConfig(value));
});
test('vitrine: popularidade ordena, não publica números de vendas e remove sugestões indisponíveis',async()=>{
 const db=fake({version:1}),products=[{id:1,name:'Lanche'},{id:2,name:'Bebida'},{id:4,name:'Novo'}];const result=await decorateMenu(db,7,products);
 assert.deepEqual(result.products.map(p=>p.id),[2,1,4]);assert.deepEqual(result.merchandising.popular_ids,[2,1]);assert.deepEqual(result.products.find(p=>p.id===1).recommended_ids,[2]);assert.equal(result.products[0].units,undefined);
 const query=db.calls.find(c=>c.sql.startsWith('SELECT oi'));assert.deepEqual(query.args,[7]);assert.match(query.sql,/o.status='completed'/);assert.match(query.sql,/INTERVAL 30 DAY/);assert.match(query.sql,/p.company_id=o.company_id/);
});
test('vitrine: desligar recursos conserva ordem por ID e não consulta vendas',async()=>{
 const db=fake({version:1,settings:{...config(),popular_enabled:false,suggestions_enabled:false}});const result=await decorateMenu(db,7,[{id:2},{id:1}]);assert.deepEqual(result.products.map(p=>p.id),[1,2]);assert.deepEqual(result.merchandising.popular_ids,[]);assert.ok(result.products.every(p=>p.recommended_ids.length===0));assert.equal(db.calls.some(c=>c.sql?.startsWith('SELECT oi')),false);
});
test('vitrine: rotas administrativas exigem sessão e dono/gerente',async t=>{
 const db=fake({role:'operator'}),r=await serve(t,db);assert.equal((await r('/api/admin/merchandising')).status,401);assert.equal((await r('/api/admin/merchandising',{headers})).status,403);assert.equal((await r('/api/admin/merchandising',put())).status,403);assert.equal(db.calls.some(c=>c==='begin'),false);
});
test('vitrine: grava configuração na empresa da sessão com trava e versão',async t=>{
 const db=fake({role:'manager'}),r=await serve(t,db);assert.equal((await r('/api/admin/merchandising',put({company_id:999}))).status,200);const insert=db.calls.find(c=>c.sql?.startsWith('INSERT'));assert.equal(insert.args[0],7);assert.equal(insert.args[2],1);assert.deepEqual(JSON.parse(insert.args[1]),config());assert.deepEqual(db.calls.slice(-2),['commit','release']);assert.match(db.calls.find(c=>c.sql?.startsWith('SELECT id FROM companies')).sql,/FOR UPDATE/);
});
test('vitrine: versão antiga e produtos de outra loja recusam gravação e liberam conexão',async t=>{
 for(const [opts,status]of [[{version:1},409],[{foreign:true},400],[{fail:true},500]]){const db=fake(opts),r=await serve(t,db);assert.equal((await r('/api/admin/merchandising',put())).status,status);assert.deepEqual(db.calls.slice(-2),['rollback','release']);if(!opts.fail)assert.equal(db.calls.some(c=>c.sql?.startsWith('INSERT')),false);}
 const invalid=fake(),rr=await serve(t,invalid);assert.equal((await rr('/api/admin/merchandising',put({version:-1}))).status,400);assert.equal(invalid.calls.some(c=>c==='begin'),false);
});
test('vitrine: configuração inicial mantém recursos habilitados sem inventar combinações',async t=>{
 const db=fake(),r=await serve(t,db),data=await(await r('/api/admin/merchandising?company_id=999',{headers})).json();assert.equal(data.company_id,7);assert.equal(data.version,0);assert.deepEqual(data.config,defaults());for(const call of db.calls.filter(c=>!c.sql.includes('FROM sessions')))assert.deepEqual(call.args,[7]);
});
test('cardápio público integra vitrine preservando categorias, preços e adicionais sem dados de vendas',async t=>{
 const calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});
  if(sql.startsWith('SELECT id, name, slug'))return [[{id:7,name:'Loja',slug:'loja',whatsapp_phone:''}]];
  if(sql.startsWith('SELECT id, name, sort_order'))return [[{id:10,name:'Lanches',sort_order:0},{id:11,name:'Bebidas',sort_order:1}]];
  if(sql.startsWith('SELECT p.id, p.category_id'))return [[{id:1,category_id:10,name:'Lanche',price:'10.00',addon_config:null},{id:2,category_id:11,name:'Bebida',price:'5.00',addon_config:null}]];
  if(sql.startsWith('SELECT config,version'))return [[{config:config(),version:1}]];
  if(sql.startsWith('SELECT oi.product_id'))return [[{product_id:2,units:'5'},{product_id:1,units:'2'}]];
  if(sql.startsWith('SELECT config FROM company_operations'))return [[]];throw new Error(sql);
 }};
 const request=await serve(t,db),response=await request('/api/menu/loja');assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.categories.map(c=>c.id),[10,11]);assert.deepEqual(data.products.map(p=>p.id),[2,1]);assert.equal(data.products[0].price,'5.00');assert.deepEqual(data.products[0].addon_groups,[]);assert.deepEqual(data.products.find(p=>p.id===1).recommended_ids,[2]);assert.equal(data.merchandising.recommendations,undefined);assert.equal(data.products[0].units,undefined);
 for(const call of calls.slice(1))assert.equal(call.args[0],7);
});
