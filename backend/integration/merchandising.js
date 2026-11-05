const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function verifyMerchandising(db,request,{a,b,json}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 async function product(company,name,price){const category=await request('/api/admin/categories',json('POST',{name:'Vitrine '+randomUUID().slice(0,8)},company.cookie));assert.equal(category.status,201);const categoryId=(await category.json()).id;const result=await request('/api/admin/products',json('POST',{name,category_id:categoryId,description:'',price},company.cookie));assert.equal(result.status,201);return {id:(await result.json()).id,categoryId};}
 const main=await product(a,'Vitrine lanche','10.00'),drink=await product(a,'Vitrine bebida','5.00'),cancelled=await product(a,'Vitrine cancelado','7.00'),foreign=await product(b,'Vitrine outra loja','9.00');
 const config={popular_enabled:true,suggestions_enabled:true,recommendations:[{product_id:main.id,related_ids:[drink.id]}]};
 assert.equal((await request('/api/admin/merchandising',json('PUT',{version:0,config:{...config,recommendations:[{product_id:main.id,related_ids:[foreign.id]}]}},a.cookie))).status,400);
 const concurrent=await Promise.all([1,2].map(()=>request('/api/admin/merchandising',json('PUT',{version:0,config},a.cookie))));assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);
 const list=await request('/api/admin/merchandising',{headers:{Cookie:a.cookie}});assert.equal(list.status,200);const settings=await list.json();assert.equal(settings.version,1);assert.ok(settings.products.every(p=>p.id!==foreign.id));
 const [customer]=await db.execute("INSERT INTO customers(company_id,name,phone,address_street,address_number,address_neighborhood) VALUES (?,'Vitrine teste','11911110000','Rua','1','Centro')",[a.id]);
 for(const [status,total,lines]of [['completed','35.00',[[main.id,'Vitrine lanche',3,'10.00','30.00'],[drink.id,'Vitrine bebida',1,'5.00','5.00']]],['cancelled','693.00',[[cancelled.id,'Vitrine cancelado',99,'7.00','693.00']]]]){
  const [order]=await db.execute("INSERT INTO orders(company_id,customer_id,status,total_amount,payment_method,customer_name,customer_phone,address_street,address_number,address_neighborhood) VALUES (?,?,?,?,'Dinheiro','Vitrine teste','11911110000','Rua','1','Centro')",[a.id,customer.insertId,status,total]);
  for(const line of lines)await db.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?)',[order.insertId,...line]);
 }
 const menu=async()=>{const result=await request('/api/menu/'+a.slug);assert.equal(result.status,200);return result.json();};
 let publicMenu=await menu();assert.ok(publicMenu.products.findIndex(p=>p.id===main.id)<publicMenu.products.findIndex(p=>p.id===drink.id));assert.ok(publicMenu.merchandising.popular_ids.includes(main.id));assert.equal(publicMenu.merchandising.popular_ids.includes(cancelled.id),false);assert.deepEqual(publicMenu.products.find(p=>p.id===main.id).recommended_ids,[drink.id]);
 await db.execute('UPDATE categories SET active=0 WHERE id=? AND company_id=?',[drink.categoryId,a.id]);publicMenu=await menu();assert.equal(publicMenu.products.some(p=>p.id===drink.id),false);assert.deepEqual(publicMenu.products.find(p=>p.id===main.id).recommended_ids,[]);
 assert.equal((await request('/api/admin/merchandising',json('PUT',{version:1,config:{...config,popular_enabled:false,suggestions_enabled:false}},a.cookie))).status,200);
 publicMenu=await menu();assert.deepEqual(publicMenu.merchandising.popular_ids,[]);assert.ok(publicMenu.products.every(p=>p.recommended_ids.length===0));assert.deepEqual(publicMenu.products.map(p=>p.id),publicMenu.products.map(p=>p.id).sort((a,b)=>a-b));
 const other=await request('/api/menu/'+b.slug);assert.equal(other.status,200);assert.ok((await other.json()).products.every(p=>p.id!==main.id));
}
module.exports={verifyMerchandising};
