const assert = require('node:assert/strict');
async function verifyCustomers(db,request,{a,b,productId}) {
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const ids=[];
 for(const [company,name,phone] of [[a.id,'CRM exclusivo A','(11) 95555-1234'],[a.id,'CRM exclusivo novo','+55 (11) 95555-1234'],[b.id,'CRM exclusivo B','11955551234'],[a.id,'CRM sem compras','11955550000']]) {
  const [result]=await db.execute('INSERT INTO customers (company_id,name,phone,address_street,address_number,address_neighborhood) VALUES (?,?,?,\'Rua teste\',\'1\',\'Centro\')',[company,name,phone]);ids.push(result.insertId);
 }
 const orderIds=[];
 for(const [customer,company,status,value,days] of [[ids[0],a.id,'completed','20.00',65],[ids[1],a.id,'completed','30.00',35],[ids[1],a.id,'cancelled','900.00',2],[ids[2],b.id,'completed','99.00',1]]) {
  const [order]=await db.execute(`INSERT INTO orders (company_id,customer_id,total_amount,status,payment_method,customer_name,customer_phone,address_street,address_number,address_neighborhood,created_at) VALUES (?,?,?,?,'Dinheiro','CRM histórico','11955551234','Rua teste','1','Centro',DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY))`,[company,customer,value,status,days]);orderIds.push(order.insertId);
 }
 await db.execute('INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price,total_price,addons_snapshot) VALUES (?,?,?,2,10,20,?)',[orderIds[0],productId,'CRM Lanche',JSON.stringify([{name:'Queijo',price:'1.00'}])]);
 await db.execute("UPDATE orders SET coupon_code='CRM5',discount_amount=5,coupon_snapshot=? WHERE id=? AND company_id=?",[JSON.stringify({kind:'fixed',value:'5.00'}),orderIds[0],a.id]);
 const get=async(url,cookie=a.cookie)=>{const response=await request(url,{headers:{Cookie:cookie}});assert.equal(response.status,200);return response.json();};
 const list=await get('/api/admin/customers?search=955551234');assert.equal(list.total,1);const c=list.customers[0];
 assert.equal(c.id,ids[0]);assert.equal(c.name,'CRM exclusivo novo');assert.equal(c.purchase_count,2);assert.equal(c.cancelled_orders,1);assert.equal(Number(c.total_spent),50);assert.equal(Number(c.average_order),25);assert.ok(c.days_since_purchase>=35);
 const profile=await get('/api/admin/customers/'+c.id+'?limit=1');assert.equal(profile.total,3);assert.equal(profile.orders.length,1);assert.equal(profile.orders[0].status,'cancelled');assert.equal(profile.orders[0].customer_name,'CRM histórico');
 const alias=await get('/api/admin/customers/'+ids[1]);assert.equal(alias.customer.id,c.id);assert.equal(alias.orders.length,3);assert.equal(alias.favorites[0].quantity,2);const snapshot=alias.orders.find(order=>order.id===orderIds[0]);assert.equal(snapshot.coupon_code,'CRM5');assert.equal(snapshot.items[0].addons_snapshot[0].name,'Queijo');
 assert.equal((await request('/api/admin/customers/'+ids[2],{headers:{Cookie:a.cookie}})).status,404);
 assert.equal((await get('/api/admin/customers?search=955551234',b.cookie)).customers[0].purchase_count,1);
 assert.equal((await get('/api/admin/customers?search=955551234&segment=inactive30')).total,1);
 assert.equal((await get('/api/admin/customers?search=955551234&segment=inactive60')).total,0);
 assert.equal((await get('/api/admin/customers?search=955550000&segment=no_purchases')).total,1);
 await db.execute("UPDATE orders SET status='pending' WHERE id=? AND company_id=?",[orderIds[2],a.id]);
 assert.equal((await get('/api/admin/customers?search=955551234&segment=inactive30')).total,0);
 // Os registros legados de propósito incompletos não participam da auditoria final de checkout.
 await db.execute(`DELETE FROM order_items WHERE order_id IN (${orderIds.map(()=>'?').join(',')})`,orderIds);
 await db.execute(`DELETE FROM orders WHERE id IN (${orderIds.map(()=>'?').join(',')}) AND company_id IN (?,?)`,[...orderIds,a.id,b.id]);
 await db.execute(`DELETE FROM customers WHERE id IN (${ids.map(()=>'?').join(',')}) AND company_id IN (?,?)`,[...ids,a.id,b.id]);
}
module.exports={verifyCustomers};
