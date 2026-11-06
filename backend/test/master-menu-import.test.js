const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {serve}=require('../test-support/http');
const {issue}=require('../src/jwt');
const {testJwt}=require('../test-support/jwt');
const jwt=testJwt(),sid='a'.repeat(64),master={Authorization:'Bearer '+issue(jwt,{scope:'master',id:2,role:'super_admin',sid})};
const categories=[{name:'Lanches',products:[{name:'Combo',description:'Completo',price:'19.90'}]}];
function fake({found=true,active=true,revoked=false,failAudit=false}={}){
 const calls=[],receipts=new Map();let nextId=10;
 const execute=async(sql,args)=>{calls.push({sql,args});
  if(sql.includes('FROM platform_sessions s'))return [[{id:2,name:'Master'}]];
  if(sql.startsWith('SELECT id FROM platform_admins'))return [[{id:2}]];
  if(sql.startsWith('SELECT token_hash'))return [revoked?[]:[{token_hash:sid}]];
  if(sql.startsWith('SELECT id,name,active FROM companies'))return [found?[{id:args[0],name:'Bebella',active:active?1:0}]:[]];
  if(sql.startsWith('SELECT details FROM platform_audit'))return [receipts.has(args[2])?[{details:receipts.get(args[2])}]:[]];
  if(sql.startsWith('INSERT INTO platform_audit')){if(failAudit)throw Error('private SQL');if(sql.includes('menu_import_confirmed')){const receipt=JSON.parse(args[2]);receipts.set(receipt.import_id,receipt);}return [{insertId:nextId++}];}
  if(sql.startsWith('INSERT'))return [{insertId:nextId++}];throw Error(sql);
 };
 return {calls,receipts,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
const json=value=>({method:'POST',headers:{...master,'Content-Type':'application/json'},body:JSON.stringify(value)});
async function upload(id='9'){const form=new FormData();form.append('tenant_id',id);form.append('file',new Blob([Buffer.from('%PDF-1.7\ntest\n%%EOF')],{type:'application/pdf'}),'menu.pdf');const encoded=new Response(form);return {method:'POST',headers:{...master,'Content-Type':encoded.headers.get('content-type')},body:Buffer.from(await encoded.arrayBuffer())};}
test('Master import: anonimato e JWT tenant não chegam ao upload ou à gravação',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});for(const path of ['import-ai','confirm-import']){
  const url='/api/admin/menu/'+path;assert.equal((await r(url,{method:'POST'})).status,401);
  const tenant=issue(jwt,{scope:'tenant',id:1,role:'tenant_owner',tenantId:7,sid});const denied=await r(url,{method:'POST',headers:{Authorization:'Bearer '+tenant}});assert.equal(denied.status,401);assert.equal((await denied.json()).success,false);
 }assert.equal(db.calls.includes('begin'),false);
});
test('Master import: upload associa prévia à loja escolhida e audita sem cadastrar',async t=>{
 const db=fake();let file;const r=await serve(t,db,{jwt,menuImportExtractor:async value=>{file=value;return {categories};}});const res=await r('/api/admin/menu/import-ai',await upload('99'));assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.tenant_id,99);assert.equal(data.tenant_name,'Bebella');assert.equal(data.saved,false);assert.equal(file.tenantId,99);assert.ok(file.bytes.every(b=>b===0));assert.equal(db.calls.some(c=>c.sql?.startsWith('INSERT INTO products')),false);const audit=db.calls.find(c=>c.sql?.includes("VALUES (?,'menu_import_preview'"));assert.deepEqual(audit.args.slice(0,2),[2,'99']);assert.equal(JSON.parse(audit.args[2]).product_count,1);
});
test('Master import: loja ausente/suspensa e identificador inválido não chamam IA',async t=>{
 for(const [settings,status]of [[{found:false},404],[{active:false},409]]){let called=false;const db=fake(settings),r=await serve(t,db,{jwt,menuImportExtractor:async()=>{called=true;return {categories};}});assert.equal((await r('/api/admin/menu/import-ai',await upload())).status,status);assert.equal(called,false);}
 const r=await serve(t,fake(),{jwt});assert.equal((await r('/api/admin/menu/import-ai',await upload('9 OR 1'))).status,400);
});
test('Master import: confirmação usa alvo validado em todos os INSERTs e audita na transação',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});const res=await r('/api/admin/menu/confirm-import',json({tenant_id:99,categories,import_id:randomUUID()}));assert.equal(res.status,201);const {data}=await res.json();assert.equal(data.tenant_id,99);assert.equal(data.product_count,1);assert.equal(data.category_count,1);for(const call of db.calls.filter(c=>/^INSERT INTO (categories|products)/.test(c.sql||'')))assert.equal(call.args[0],99);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('Master import: repetição do mesmo lote retorna recibo sem duplicar e conteúdo divergente gera 409',async t=>{
 const db=fake(),r=await serve(t,db,{jwt}),body={tenant_id:99,categories,import_id:randomUUID()};assert.equal((await r('/api/admin/menu/confirm-import',json(body))).status,201);const second=await r('/api/admin/menu/confirm-import',json(body));assert.equal(second.status,200);assert.equal((await second.json()).data.replayed,true);assert.equal(db.calls.filter(c=>c.sql?.startsWith('INSERT INTO products')).length,1);const changed={...body,categories:[{name:'Novo',products:categories[0].products}]};assert.equal((await r('/api/admin/menu/confirm-import',json(changed))).status,409);assert.equal(db.calls.filter(c=>c.sql?.startsWith('INSERT INTO products')).length,1);
});
test('Master import: auditoria com falha e sessão revogada revertem lote',async t=>{
 for(const [opts,status]of [[{failAudit:true},500],[{revoked:true},401]]){const db=fake(opts),r=await serve(t,db,{jwt,logger:{error(){}}});const res=await r('/api/admin/menu/confirm-import',json({tenant_id:99,categories}));assert.equal(res.status,status);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}
});
test('Master import: métodos, JSON e limites mantêm envelope seguro',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});assert.equal((await r('/api/admin/menu/import-ai',{headers:master})).status,405);const invalid=await r('/api/admin/menu/confirm-import',{method:'POST',headers:{...master,'Content-Type':'application/json'},body:'{'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).success,false);assert.equal((await r('/api/admin/menu/confirm-import',json({tenant_id:99,categories:[{name:'Lanches',products:[{name:'Combo',price:null}]}]}))).status,422);
});
