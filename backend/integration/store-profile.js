const assert=require('node:assert/strict');
async function verifyStoreProfile(db,request,{a,b}){
 const [[schema]]=await db.query('SELECT DATABASE() AS name');assert.match(schema.name,/_test$/);
 const [[original]]=await db.execute('SELECT config FROM company_operations WHERE company_id=?',[a.id]);
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
 }finally{if(original)await db.execute('UPDATE company_operations SET config=? WHERE company_id=?',[typeof original.config==='string'?original.config:JSON.stringify(original.config),a.id]);else await db.execute('DELETE FROM company_operations WHERE company_id=?',[a.id]);}
}
module.exports={verifyStoreProfile};
