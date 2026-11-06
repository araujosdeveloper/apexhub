const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {issue}=require('../src/jwt');
const {testJwt}=require('../test-support/jwt');
const {validateMenu,createExtractor,MAX_UPLOAD}=require('../src/menu-import-ai');
const jwt=testJwt(),token=role=>issue(jwt,{scope:'tenant',id:1,tenantId:7,role,sid:'a'.repeat(64)}),headers={Authorization:'Bearer '+token('tenant_owner'),'Content-Type':'application/json'};
const menu={categories:[{name:'Lanches',products:[{name:'Combo',description:'Completo',price:'19.90'},{name:'Suco',description:'',price:'5.00'}]}]};
function fake({role='owner',fail=false}={}){
 const calls=[];let id=10,writes=0;
 const execute=async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];if(sql.startsWith('SELECT id FROM companies'))return [[{id:7}]];if(sql.startsWith('INSERT')){if(fail&&++writes===3)throw Object.assign(Error('secret SQL'),{code:'ECONNRESET'});return [{insertId:id++}];}throw Error(sql);};
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
async function multipart(bytes,type='application/pdf',extra=false){const form=new FormData();form.append('file',new Blob([bytes],{type}),'../../cardapio.pdf');if(extra)form.append('tenant_id','999');const response=new Response(form);return {body:Buffer.from(await response.arrayBuffer()),headers:{Authorization:headers.Authorization,'Content-Type':response.headers.get('content-type')}};}
const pdf=Buffer.from('%PDF-1.7\nexample test bytes\n%%EOF');
test('importação: JWT obrigatório, perfil e escopo antes de acessar upload/DB',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});for(const path of ['import-ai','confirm-import']){
  assert.equal((await r('/api/tenant/menu/'+path,{method:'POST'})).status,401);
  assert.equal((await r('/api/tenant/menu/'+path,{method:'POST',headers:{Cookie:'delivery_session='+'b'.repeat(64)}})).status,401);
 }
 const operator=await serve(t,fake({role:'operator'}),{jwt});assert.equal((await operator('/api/tenant/menu/import-ai',{method:'POST',headers:{Authorization:'Bearer '+token('tenant_operator')}})).status,403);assert.equal(db.calls.includes('begin'),false);
});
test('importação: prévia lê PDF temporário, retorna nulos para revisão e não grava',async t=>{
 const db=fake();let received;const r=await serve(t,db,{jwt,menuImportExtractor:async file=>{received=file;assert.equal(file.type,'application/pdf');return {categories:[{name:'Bebidas',products:[{name:'Suco',description:'',price:null}]}]};}});
 const upload=await multipart(pdf),res=await r('/api/tenant/menu/import-ai',{method:'POST',...upload});assert.equal(res.status,200);const {data}=await res.json();assert.equal(data.tenant_id,7);assert.equal(data.saved,false);assert.equal(data.requires_review,true);assert.equal(data.categories[0].products[0].price,null);assert.ok(received.bytes.every(byte=>byte===0));assert.equal(db.calls.includes('begin'),false);
});
test('importação: MIME, conteúdo, multipart inválido, múltiplos campos e tamanho',async t=>{
 const db=fake(),r=await serve(t,db,{jwt,menuImportExtractor:async()=>menu});
 for(const [upload,status]of [[await multipart(Buffer.from('invalido')),422],[await multipart(pdf,'text/plain'),415],[await multipart(pdf,'application/pdf',true),400],[await multipart(Buffer.from('not png'),'image/png'),422]])assert.equal((await r('/api/tenant/menu/import-ai',{method:'POST',...upload})).status,status);
 const big=await serve(t,fake(),{jwt});assert.equal((await big('/api/tenant/menu/import-ai',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'multipart/form-data; boundary=abc'},body:Buffer.alloc(MAX_UPLOAD+1)})).status,413);
});
test('importação: confirmação grava somente tenant JWT, valores parametrizados e lote atômico',async t=>{
 const db=fake(),r=await serve(t,db,{jwt});const res=await r('/api/tenant/menu/confirm-import',{method:'POST',headers,body:JSON.stringify({...menu,tenant_id:999})});assert.equal(res.status,201);const {data}=await res.json();assert.equal(data.tenant_id,7);assert.equal(data.product_count,2);const inserts=db.calls.filter(c=>c.sql?.startsWith('INSERT'));assert.equal(inserts.length,3);for(const c of inserts)assert.equal(c.args[0],7);assert.equal(inserts[1].args[1],10);assert.deepEqual(db.calls.slice(-2),['commit','release']);
 const failed=fake({fail:true}),logs=[],rr=await serve(t,failed,{jwt,logger:{error:s=>logs.push(s)}});assert.equal((await rr('/api/tenant/menu/confirm-import',{method:'POST',headers,body:JSON.stringify(menu)})).status,503);assert.equal(failed.calls.includes('commit'),false);assert.deepEqual(failed.calls.slice(-2),['rollback','release']);assert.equal(logs.join('').includes('secret'),false);
});
test('importação: não confirma preço ilegível, lote excessivo ou IDs externos',async()=>{
 const invalid=[{categories:[]},{categories:[{name:'Lanches',products:[{name:'Combo',price:null}]}]},{categories:[{name:'Lanches',products:Array.from({length:201},()=>menu.categories[0].products[0])}]}];for(const payload of invalid)assert.throws(()=>validateMenu(payload));const valid=validateMenu({categories:[{id:999,tenant_id:999,name:'Lanches',products:[{id:999,tenant_id:999,name:'Combo',price:'0'}]}]});assert.deepEqual(valid.categories[0].products[0],{name:'Combo',description:'',price:'0.00'});assert.equal(valid.categories[0].id,undefined);
});
test('provedor IA: configura contrato multimodal/JSON e não persiste resposta',async()=>{
 let request;const extractor=createExtractor({env:{OPENAI_API_KEY:'test-not-real'},fetchImpl:async(url,init)=>{request={url,init};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(menu)}]}]});}});const result=await extractor({type:'application/pdf',bytes:pdf});assert.equal(result.product_count,2);const sent=JSON.parse(request.init.body);assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.input[0].content[1].type,'input_file');assert.ok(sent.input[0].content[1].file_data.startsWith('data:application/pdf;base64,'));
 await extractor({type:'image/png',bytes:Buffer.from('png')});assert.equal(JSON.parse(request.init.body).input[0].content[1].type,'input_image');
});
test('provedor IA: configuração ausente, erros, recusa, truncamento e JSON inválido são seguros',async()=>{
 await assert.rejects(createExtractor({env:{}})({type:'application/pdf',bytes:pdf}),e=>e.status===503);
 for(const value of [{status:'incomplete'},{status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'invalid'}]}]}])await assert.rejects(createExtractor({env:{OPENAI_API_KEY:'fake'},fetchImpl:async()=>Response.json(value)})({type:'application/pdf',bytes:pdf}),e=>[422,502].includes(e.status));
 await assert.rejects(createExtractor({env:{OPENAI_API_KEY:'fake'},fetchImpl:async()=>new Response('private',{status:429})})({type:'application/pdf',bytes:pdf}),e=>e.status===503&&!e.message.includes('private'));
});
test('importação: concorrência por tenant e falha de provedor não deixam slot ocupado',async t=>{
 let resolve;const pending=new Promise(r=>{resolve=r;}),db=fake();const r=await serve(t,db,{jwt,menuImportExtractor:async()=>{await pending;return menu;}});const upload=await multipart(pdf);const first=r('/api/tenant/menu/import-ai',{method:'POST',...upload});await new Promise(r=>setImmediate(r));const second=await r('/api/tenant/menu/import-ai',{method:'POST',...upload});assert.equal(second.status,429);resolve();assert.equal((await first).status,200);assert.equal((await r('/api/tenant/menu/import-ai',{method:'POST',...upload})).status,200);
});
test('importação: instância com chaves próprias precisa emitir o JWT antes do teste de rollback',async t=>{
 const db=fake({fail:true}),otherJwt=testJwt(),r=await serve(t,db,{jwt:otherJwt,logger:{error(){}}});
 const payload=JSON.stringify(menu);assert.equal((await r('/api/tenant/menu/confirm-import',{method:'POST',headers,body:payload})).status,401);assert.equal(db.calls.includes('begin'),false);
 const minted=await r('/api/auth/token',{method:'POST',headers:{Cookie:'delivery_session='+'b'.repeat(64)}});assert.equal(minted.status,200);
 const ownHeaders={'Content-Type':'application/json',Authorization:'Bearer '+(await minted.json()).access_token};
 assert.equal((await r('/api/tenant/menu/confirm-import',{method:'POST',headers:ownHeaders,body:payload})).status,503);assert.equal(db.calls.includes('commit'),false);assert.deepEqual(db.calls.slice(-2),['rollback','release']);
});
