const assert=require('node:assert/strict');
async function verifyStoreProfile(db,request,{a,b}){
 const [[schema]]=await db.query('SELECT DATABASE() AS name');assert.match(schema.name,/_test$/);
 const [[original]]=await db.execute('SELECT config FROM company_operations WHERE company_id=?',[a.id]);
 const [[originalB]]=await db.execute('SELECT config FROM company_operations WHERE company_id=?',[b.id]);
 const json=(method,body,cookie=a.cookie)=>({method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const profile={banner_url:'https://images.example/banner.jpg',logo_url:'https://images.example/logo.png',phone:'5586999999999',address:'Rua do Teste, 10, Cidade',notice:'Retirada pela entrada lateral.'};
 try{
  const before=await request('/api/admin/operations',json('GET'));assert.equal(before.status,200);const operations=(await before.json()).operations;
  const saved=await request('/api/admin/store-profile',json('PUT',{...profile,tenant_id:b.id}));assert.equal(saved.status,200);
  const publicResponse=await request('/api/menu/'+a.slug);assert.equal(publicResponse.status,200);assert.deepEqual((await publicResponse.json()).operations.store_profile,profile);
  const other=await request('/api/admin/store-profile',json('GET',undefined,b.cookie));assert.equal(other.status,200);assert.notEqual((await other.json()).profile.address,profile.address);
  const updated=await request('/api/admin/operations',json('PUT',{...operations,delivery_minutes:37}));assert.equal(updated.status,200);
  const after=await request('/api/admin/store-profile',json('GET'));assert.equal(after.status,200);assert.deepEqual((await after.json()).profile,profile);
  const edit=await request('/api/admin/store-profile',json('PUT',{...profile,notice:'Novo aviso'}));assert.equal(edit.status,200);
  const rules=await request('/api/admin/operations',json('GET'));const current=(await rules.json()).operations;assert.equal(current.delivery_minutes,37);assert.deepEqual(current.zones,operations.zones);assert.equal(current.pickup_enabled,operations.pickup_enabled);
  const {png}=require('./product-images');
  async function upload(kind,cookie=a.cookie){const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'../../store.png');const encoded=new Response(form);const response=await request('/api/admin/store-profile/images/'+kind+'?tenant_id='+a.id,{method:'POST',headers:{Cookie:cookie,'Content-Type':encoded.headers.get('content-type')},body:Buffer.from(await encoded.arrayBuffer())});assert.equal(response.status,200);return (await response.json()).image_url;}
  const banner=await upload('banner'),logo=await upload('logo');assert.ok(banner.startsWith('/api/store-images/'+a.id+'/banner?'));
  const binary=await request(banner);assert.equal(binary.status,200);assert.deepEqual(Buffer.from(await binary.arrayBuffer()),png);assert.equal((await request(banner,{headers:{'If-None-Match':binary.headers.etag}})).status,304);
  const foreignImage=await upload('logo',b.cookie);assert.ok(foreignImage.startsWith('/api/store-images/'+b.id+'/logo?'));
  assert.equal((await request('/api/admin/store-profile',json('PUT',{email:'contato@example.com',instagram_url:'https://www.instagram.com/loja'}))).status,200);
  const retained=await request('/api/admin/store-profile',json('GET'));assert.equal((await retained.json()).profile.banner_url,banner);
  assert.equal((await request('/api/admin/operations',json('PUT',{...operations,delivery_minutes:37}))).status,200);
  const publicUpdated=await request('/api/menu/'+a.slug);const visible=(await publicUpdated.json()).operations.store_profile;assert.equal(visible.logo_url,logo);assert.equal(visible.email,'contato@example.com');
  const deleted=await request('/api/admin/store-profile/images/banner',{method:'DELETE',headers:{Cookie:a.cookie}});assert.equal(deleted.status,200);assert.equal((await request(banner)).status,404);assert.equal((await request(logo)).status,200);
 }finally{await db.execute('DELETE FROM store_images WHERE company_id IN (?,?)',[a.id,b.id]);if(originalB)await db.execute('UPDATE company_operations SET config=? WHERE company_id=?',[typeof originalB.config==='string'?originalB.config:JSON.stringify(originalB.config),b.id]);else await db.execute('DELETE FROM company_operations WHERE company_id=?',[b.id]);if(original)await db.execute('UPDATE company_operations SET config=? WHERE company_id=?',[typeof original.config==='string'?original.config:JSON.stringify(original.config),a.id]);else await db.execute('DELETE FROM company_operations WHERE company_id=?',[a.id]);}
}
module.exports={verifyStoreProfile};
