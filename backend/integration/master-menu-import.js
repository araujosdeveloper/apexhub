const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {serve}=require('../test-support/http');
const {testJwt}=require('../test-support/jwt');
async function verifyMasterMenuImport(db,request,{bearer,masterCookie,tenantId,otherTenantId}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 let failAudit=false;
 // Usa o mesmo banco real, mas uma instância com extração simulada e chaves próprias.
 const wrapped={execute:(...args)=>db.execute(...args),getConnection:async()=>{const conn=await db.getConnection();return {beginTransaction:()=>conn.beginTransaction(),commit:()=>conn.commit(),rollback:()=>conn.rollback(),release:()=>conn.release(),execute:(sql,args)=>{if(failAudit&&sql.includes("VALUES (?,'menu_import_confirmed'"))throw Error('Falha de auditoria simulada');return conn.execute(sql,args);}};}};
 const previewRequest=await serve(null,wrapped,{jwt:testJwt(),logger:{error(){}},menuImportExtractor:async()=>({categories:[{name:'Categoria extraída',products:[{name:'Produto extraído',description:'',price:null}]}]})});
 const minted=await previewRequest('/api/master/auth/token',{method:'POST',headers:{Cookie:masterCookie}});assert.equal(minted.status,200);const ownToken=(await minted.json()).access_token;
 const form=new FormData();form.append('tenant_id',String(tenantId));form.append('file',new Blob([require('./product-images').png],{type:'image/png'}),'menu.png');const multipart=new Response(form);
 const [[before]]=await db.execute('SELECT COUNT(*) AS total FROM products WHERE company_id=?',[tenantId]);
 const preview=await previewRequest('/api/admin/menu/import-ai',{method:'POST',headers:{Authorization:'Bearer '+ownToken,'Content-Type':multipart.headers.get('content-type')},body:Buffer.from(await multipart.arrayBuffer())});assert.equal(preview.status,200);const parsed=(await preview.json()).data;assert.equal(parsed.tenant_id,tenantId);assert.equal(parsed.saved,false);assert.equal(parsed.categories[0].products[0].price,null);
 const [[after]]=await db.execute('SELECT COUNT(*) AS total FROM products WHERE company_id=?',[tenantId]);assert.equal(Number(before.total),Number(after.total));
 const name='Importação Master '+randomUUID(),import_id=randomUUID(),payload={tenant_id:tenantId,import_id,categories:[{name,products:[{name:'Produto '+name,description:'Revisado',price:'12.50'}]}]};
 const post=(body,headers=bearer)=>({method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const imported=await request('/api/admin/menu/confirm-import',post(payload));assert.equal(imported.status,201);assert.equal((await imported.json()).data.product_count,1);
 const repeated=await request('/api/admin/menu/confirm-import',post(payload));assert.equal(repeated.status,200);assert.equal((await repeated.json()).data.replayed,true);
 const [[count]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[tenantId,name]);assert.equal(Number(count.total),1);
 const [[foreign]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[otherTenantId,name]);assert.equal(Number(foreign.total),0);
 const [[audited]]=await db.execute("SELECT COUNT(*) AS total FROM platform_audit WHERE action='menu_import_confirmed' AND entity_id=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.import_id'))=?",[String(tenantId),import_id]);assert.equal(Number(audited.total),1);
 const mismatch={...payload,categories:[{name:'Outro nome',products:payload.categories[0].products}]};assert.equal((await request('/api/admin/menu/confirm-import',post(mismatch))).status,409);
 failAudit=true;const rollbackName=name+' rollback';const failed=await previewRequest('/api/admin/menu/confirm-import',post({tenant_id:tenantId,import_id:randomUUID(),categories:[{name:rollbackName,products:[{name:'Não gravar',description:'',price:'1.00'}]}]},{Authorization:'Bearer '+ownToken}));assert.equal(failed.status,500);
 const [[rolledBack]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[tenantId,rollbackName]);assert.equal(Number(rolledBack.total),0);
}
module.exports={verifyMasterMenuImport};
