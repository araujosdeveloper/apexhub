const assert=require('node:assert/strict');
async function verifyDrivers(db,request,{a,b,orderId,pickupId,json}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 async function create(company,name,phone){const response=await request('/api/admin/drivers',json('POST',{name,phone,active:true},company.cookie));assert.equal(response.status,201);return (await response.json()).id;}
 const driver=await create(a,'Entregador A','11944440001'),other=await create(b,'Entregador B','11944440001');
 assert.equal((await request('/api/admin/drivers',json('POST',{name:'Duplicado',phone:'+55 (11) 94444-0001',active:true},a.cookie))).status,409);
 const [[original]]=await db.execute('SELECT status FROM orders WHERE id=? AND company_id=?',[orderId,a.id]);
 await db.execute("UPDATE orders SET status='ready' WHERE id=? AND company_id=?",[orderId,a.id]);
 const assign=(driverId,version=0,id=orderId,status='ready',cookie=a.cookie)=>request('/api/admin/dispatch/'+id,json('PUT',{driver_id:driverId,version,status},cookie));
 assert.equal((await assign(other)).status,400);
 assert.equal((await assign(driver,0,orderId,'ready',b.cookie)).status,404);
 assert.equal((await assign(driver,0,pickupId)).status,409);
 const competing=await Promise.all([assign(driver),assign(driver)]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
 const [[snapshot]]=await db.execute('SELECT * FROM delivery_assignments WHERE order_id=?',[orderId]);assert.equal(snapshot.driver_name,'Entregador A');assert.equal(snapshot.driver_phone,'5511944440001');assert.equal(snapshot.version,1);
 assert.equal((await request('/api/admin/drivers/'+driver,json('PUT',{name:'Nome novo',phone:'11944440002',active:false,version:1},a.cookie))).status,200);
 assert.equal((await assign(driver,1)).status,400);
 const [[unchanged]]=await db.execute('SELECT driver_name FROM delivery_assignments WHERE order_id=?',[orderId]);assert.equal(unchanged.driver_name,'Entregador A');
 assert.equal((await assign(null,1)).status,200);
 assert.equal((await request('/api/admin/drivers/'+driver,json('PUT',{name:'Disponível',phone:'11944440002',active:true,version:2},a.cookie))).status,200);
 assert.equal((await assign(driver,2)).status,200);
 const dispatch=await request('/api/admin/dispatch',{headers:{Cookie:a.cookie}});assert.equal(dispatch.status,200);const data=await dispatch.json();assert.equal(data.orders.find(o=>o.id===orderId).driver_name,'Disponível');
 await db.execute("UPDATE orders SET status='delivering' WHERE id=? AND company_id=?",[orderId,a.id]);assert.equal((await assign(null,3)).status,409);
 const board=await (await request('/api/admin/orders/board?status=delivering',{headers:{Cookie:a.cookie}})).json();assert.equal(board.orders.find(o=>o.id===orderId).driver_name,'Disponível');
 await db.execute('UPDATE orders SET status=? WHERE id=? AND company_id=?',[original.status,orderId,a.id]);
}
module.exports={verifyDrivers};
