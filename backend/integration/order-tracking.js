const assert=require('node:assert/strict');
async function verifyOrderTracking(db,request,{a,b,json,orderId,originalUrl}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const original=await request('/api/admin/orders/'+orderId+'/tracking',json('POST',{},a.cookie));assert.equal(original.status,200);assert.equal((await original.json()).tracking_url,originalUrl);
 // Pedido anterior/externo ao checkout, com itens válidos e sem acompanhamento.
 const [copy]=await db.execute(`INSERT INTO orders(company_id,customer_id,total_amount,status,payment_method,customer_name,customer_phone,address_street,address_number,address_neighborhood,fulfillment_method,delivery_fee,fulfillment_address,estimated_minutes)
 SELECT company_id,customer_id,total_amount,'pending',payment_method,customer_name,customer_phone,address_street,address_number,address_neighborhood,fulfillment_method,delivery_fee,fulfillment_address,estimated_minutes FROM orders WHERE id=? AND company_id=?`,[orderId,a.id]);const legacyId=copy.insertId;
 await db.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,total_price,addons_snapshot) SELECT ?,product_id,product_name,quantity,unit_price,total_price,addons_snapshot FROM order_items WHERE order_id=?',[legacyId,orderId]);
 assert.equal((await request('/api/admin/orders/'+legacyId+'/tracking',json('POST',{},b.cookie))).status,404);
 const urls=await Promise.all([1,2].map(async()=>{const response=await request('/api/admin/orders/'+legacyId+'/tracking',json('POST',{},a.cookie));assert.equal(response.status,200);return (await response.json()).tracking_url;}));assert.equal(urls[0],urls[1]);assert.notEqual(urls[0],originalUrl);
 const token=urls[0].split('#')[1],get=()=>request('/api/order-tracking',{headers:{'X-Order-Token':token}});
 let publicResponse=await get();assert.equal(publicResponse.status,200);let data=await publicResponse.json();assert.equal(data.order.status,'pending');assert.equal(data.order.id,legacyId);assert.equal(data.order.customer_name,undefined);assert.equal(data.order.customer_phone,undefined);assert.equal(data.order.address_street,undefined);assert.equal(data.order.items.length>0,true);assert.equal(data.order.pickup_address,'');
 for(const [expected_status,status]of [['pending','preparing'],['preparing','ready'],['ready','delivering'],['delivering','completed']]){assert.equal((await request('/api/admin/orders/'+legacyId+'/status',json('PATCH',{expected_status,status},a.cookie))).status,200);data=await(await get()).json();assert.equal(data.order.status,status);}
 const unknown=await request('/api/order-tracking',{headers:{'X-Order-Token':'0'.repeat(64)}});assert.equal(unknown.status,404);
 const [[count]]=await db.execute('SELECT COUNT(*) AS total FROM order_tracking WHERE order_id=?',[legacyId]);assert.equal(Number(count.total),1);
 const history=await request('/api/admin/orders/board?scope=history',{headers:{Cookie:a.cookie}});assert.equal(history.status,200);const tracked=(await history.json()).orders.find(order=>order.id===legacyId);assert.equal(tracked.tracking_url,urls[0]);assert.equal(tracked.tracking_token,undefined);
}
module.exports={verifyOrderTracking};
