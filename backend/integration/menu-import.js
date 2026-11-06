const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function verifyMenuImport(db,request,{a,b}){
 const [[schema]]=await db.query('SELECT DATABASE() AS name');assert.match(schema.name,/_test$/);
 const mint=await request('/api/auth/token',{method:'POST',headers:{Cookie:a.cookie}});assert.equal(mint.status,200);const token=(await mint.json()).access_token;
 const name='Importação '+randomUUID(),payload={tenant_id:b.id,categories:[{name,products:[{name:'Produto importado',description:'Revisado',price:'12.50'},{name:'Bebida importada',description:'',price:'5.00'}]}]};
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};let categoryId;
 try{
  const form=new FormData();form.append('file',new Blob([require('./product-images').png],{type:'image/png'}),'menu.png');const upload=new Response(form);
  const preview=await request('/api/tenant/menu/import-ai',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':upload.headers.get('content-type')},body:Buffer.from(await upload.arrayBuffer())});assert.equal(preview.status,200);assert.equal((await preview.json()).data.saved,false);
  const [[before]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[a.id,name]);assert.equal(Number(before.total),0);
  const result=await request('/api/tenant/menu/confirm-import',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(result.status,201);const data=(await result.json()).data;categoryId=data.categories[0].id;assert.equal(data.tenant_id,a.id);assert.equal(data.product_count,2);
  const [products]=await db.execute('SELECT company_id,category_id,price FROM products WHERE category_id=? AND company_id=? ORDER BY id',[categoryId,a.id]);assert.equal(products.length,2);assert.ok(products.every(p=>p.company_id===a.id));assert.equal(products[0].price,'12.50');
  const [[foreign]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[b.id,name]);assert.equal(Number(foreign.total),0);
  const {serve}=require('../test-support/http');const {testJwt}=require('../test-support/jwt');
  const failingDb={execute:(...args)=>db.execute(...args),getConnection:async()=>{const conn=await db.getConnection();return {beginTransaction:()=>conn.beginTransaction(),commit:()=>conn.commit(),rollback:()=>conn.rollback(),release:()=>conn.release(),execute:(sql,args)=>conn.execute(sql,sql.startsWith('INSERT INTO products')&&args[2]==='Falha preço'?args.map((value,i)=>i===4?'-1.00':value):args)};}};
  const failedRequest=await serve(null,failingDb,{jwt:testJwt(),logger:{error(){}}}),rollbackName=name+' rollback';
  const failed=await failedRequest('/api/tenant/menu/confirm-import',{method:'POST',headers,body:JSON.stringify({categories:[{name:rollbackName,products:[{name:'Primeiro válido',price:'1.00'},{name:'Falha preço',price:'1.00'}]}]})});assert.equal(failed.status,500);
  const [[rolledBack]]=await db.execute('SELECT COUNT(*) AS total FROM categories WHERE company_id=? AND name=?',[a.id,rollbackName]);assert.equal(Number(rolledBack.total),0);
 }finally{if(categoryId){await db.execute('DELETE FROM products WHERE category_id=? AND company_id=?',[categoryId,a.id]);await db.execute('DELETE FROM categories WHERE id=? AND company_id=?',[categoryId,a.id]);}}
}
module.exports={verifyMenuImport};
