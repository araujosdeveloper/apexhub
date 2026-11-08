const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function verifyTenantMenu(db,request,{a,b}){
 const [[schema]]=await db.query('SELECT DATABASE() AS name');assert.match(schema.name,/_test$/);
 const call=(path,method='GET',body,cookie=a.cookie)=>request('/api/tenant/menu'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let categoryId,productId,customerId,orderId;
 try{
  const category=await call('/categories','POST',{name:'Menu integração '+randomUUID(),tenant_id:b.id,sort_order:4});assert.equal(category.status,201);categoryId=(await category.json()).data.id;
  const input={name:'Combo integrado',category_id:categoryId,price:'19.90',description:'Item de teste',image_url:'https://images.example/menu.jpg',options:[{name:'Queijo',additional_price:'2.50',max_quantity:3}]};
  assert.equal((await call('/products','POST',input,b.cookie)).status,404);
  const created=await call('/products','POST',{...input,tenant_id:b.id});assert.equal(created.status,201);productId=(await created.json()).data.id;
  const get=async()=>{const response=await call('');assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.tenant_id,a.id);return data.categories.find(c=>c.id===categoryId).products.find(p=>p.id===productId);};
  const product=await get();assert.equal(product.tenant_id,a.id);assert.equal(product.options.length,1);assert.equal(product.options[0].additional_price,'2.50');assert.equal(product.options[0].max_quantity,3);assert.equal(product.image_url,input.image_url);
  const [[projected]]=await db.execute('SELECT tenant_id,product_id,name FROM product_options WHERE tenant_id=? AND product_id=?',[a.id,productId]);assert.equal(projected.tenant_id,a.id);assert.equal(projected.name,'Queijo');
  await assert.rejects(db.execute("INSERT INTO product_options(tenant_id,product_id,option_key,group_key,name,additional_price) VALUES (?,?,'foreign','g','Invasor',1.00)",[b.id,productId]),error=>error.code==='ER_NO_REFERENCED_ROW_2');
  for(const [path,method,body] of [['/products/'+productId+'/availability','PUT',{is_available:false}],['/products/'+productId,'DELETE',{}]])assert.equal((await call(path,method,body,b.cookie)).status,404);
  const groups=[{id:'extras',name:'Extras',min:0,max:3,options:[{id:'cheese',name:'Queijo atualizado',price:'3.00',active:true,max_quantity:3}]}];
  const edit=await request('/api/admin/products/'+productId+'/addons',{method:'PUT',headers:{Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify({version:1,groups})});assert.equal(edit.status,200);
  const updated=await get();assert.equal(updated.options.length,1);assert.equal(updated.options[0].name,'Queijo atualizado');assert.equal(updated.options[0].additional_price,'3.00');assert.equal(updated.addon_version,2);
  // A precificação usa o mesmo config/version persistido pela nova API.
  const {priceLine}=require('../src/addons');const priced=priceLine({name:updated.name,price:updated.price,addon_config:updated.addon_groups,addon_version:updated.addon_version},{option_ids:['cheese'],addon_version:2,quantity:1});assert.equal(priced.unitCents,2290);
  assert.equal(updated.options[0].max_quantity,3);
  const repeated=priceLine({name:updated.name,price:updated.price,addon_config:updated.addon_groups,addon_version:2},{option_ids:['cheese'],option_quantities:{cheese:2},addon_version:2,quantity:2});assert.equal(repeated.unitCents,2590);
  await assert.rejects(db.execute('UPDATE product_options SET max_quantity=21 WHERE tenant_id=? AND product_id=?',[a.id,productId]),error=>error.code==='ER_CHECK_CONSTRAINT_VIOLATED');
  for(const value of [false,false,true]){const response=await call('/products/'+productId+'/availability','PUT',{is_available:value});assert.equal(response.status,200);assert.equal((await get()).is_available,value);}
  const publicMenu=await request('/api/menu/'+a.slug);assert.equal(publicMenu.status,200);assert.equal((await publicMenu.json()).products.find(p=>p.id===productId).image_url,input.image_url);
  const [customer]=await db.execute("INSERT INTO customers(company_id,name,phone,address_street,address_number,address_neighborhood) VALUES (?,'Menu teste',?,'Rua','1','Centro')",[a.id,'menu-'+randomUUID()]);customerId=customer.insertId;
  const [order]=await db.execute("INSERT INTO orders(company_id,customer_id,total_amount,status,payment_method,customer_name,customer_phone,address_street,address_number,address_neighborhood) VALUES (?,?,'19.90','completed','Pix','Menu teste','11922220000','Rua','1','Centro')",[a.id,customerId]);orderId=order.insertId;
  await db.execute("INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES (?,?,'Combo histórico',1,'19.90','19.90')",[orderId,productId]);
  for(let i=0;i<2;i++)assert.equal((await call('/products/'+productId,'DELETE',{})).status,200);
  const [[historical]]=await db.execute('SELECT product_name FROM order_items WHERE order_id=?',[orderId]);assert.equal(historical.product_name,'Combo histórico');
  const hidden=await request('/api/menu/'+a.slug);assert.equal((await hidden.json()).products.some(p=>p.id===productId),false);
 }finally{
  if(orderId){await db.execute('DELETE FROM order_items WHERE order_id=?',[orderId]);await db.execute('DELETE FROM orders WHERE id=? AND company_id=?',[orderId,a.id]);}
  if(customerId)await db.execute('DELETE FROM customers WHERE id=? AND company_id=?',[customerId,a.id]);
  if(productId){await db.execute('DELETE FROM product_addons WHERE product_id=?',[productId]);await db.execute('DELETE FROM products WHERE id=? AND company_id=?',[productId,a.id]);}
  if(categoryId)await db.execute('DELETE FROM categories WHERE id=? AND company_id=?',[categoryId,a.id]);
 }
}
module.exports={verifyTenantMenu};
