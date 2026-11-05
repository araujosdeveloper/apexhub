const assert=require('node:assert/strict');
async function verifyReports(db,request,{a,b,productId}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const [customer]=await db.execute("INSERT INTO customers(company_id,name,phone,address_street,address_number,address_neighborhood) VALUES (?,'Relatório teste','11922220000','Rua','1','Centro')",[a.id]);
 const [other]=await db.execute("INSERT INTO customers(company_id,name,phone,address_street,address_number,address_neighborhood) VALUES (?,'Relatório outra loja','11922220000','Rua','1','Centro')",[b.id]);
 const ids=[];
 for(const [company,client,status,total,fee,discount,method,fulfillment,time] of [
  [a.id,customer.insertId,'completed','20.00','3.00','2.00','Pix','delivery','2024-02-28 03:00:00'],
  [a.id,customer.insertId,'completed','30.00','0.00','0.00','Dinheiro','pickup','2024-03-01 02:59:59'],
  [a.id,customer.insertId,'preparing','90.00','0.00','0.00','Cartão','delivery','2024-02-28 02:59:59'],
  [a.id,customer.insertId,'pending','40.00','0.00','0.00','Pix','delivery','2024-02-28 10:00:00'],
  [a.id,customer.insertId,'cancelled','100.00','0.00','0.00','Pix','delivery','2024-02-29 12:00:00'],
  [a.id,customer.insertId,'completed','500.00','0.00','0.00','Pix','delivery','2024-03-01 03:00:00'],
  [b.id,other.insertId,'completed','999.00','0.00','0.00','Pix','delivery','2024-02-29 12:00:00']]){
  const [order]=await db.execute(`INSERT INTO orders(company_id,customer_id,status,total_amount,delivery_fee,discount_amount,payment_method,fulfillment_method,created_at,customer_name,customer_phone,address_street,address_number,address_neighborhood) VALUES (?,?,?,?,?,?,?,?,?,'Relatório','11922220000','Rua','1','Centro')`,[company,client,status,total,fee,discount,method,fulfillment,time]);ids.push(order.insertId);
 }
 await db.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES (?,?,?,2,9.50,19.00)',[ids[0],productId,'Nome histórico']);
 const get=async(query,cookie=a.cookie)=>{const response=await request('/api/admin/reports/sales?'+query,{headers:{Cookie:cookie}});assert.equal(response.status,200);return response.json();};
 const data=await get('start=2024-02-28&end=2024-02-29&company_id='+b.id);assert.equal(data.company_id,a.id);assert.equal(data.timezone,'America/Sao_Paulo');
 assert.equal(data.summary.orders,4);assert.equal(data.summary.completed,2);assert.equal(data.summary.active,1);assert.equal(data.summary.cancelled,1);assert.equal(Number(data.summary.total),50);assert.equal(Number(data.summary.average_order),25);assert.equal(Number(data.summary.delivery_fees),3);assert.equal(Number(data.summary.discounts),2);assert.equal(data.summary.incomplete_orders,1);
 assert.equal(data.daily.length,2);assert.equal(data.daily[0].day,'2024-02-28');assert.equal(Number(data.daily[0].total),20);assert.equal(Number(data.daily[1].total),30);
 assert.equal(data.products[0].product_name,'Nome histórico');assert.equal(data.products[0].quantity,2);assert.equal(Number(data.products[0].gross_total),19);assert.equal(data.payments.length,2);assert.equal(Number(data.payments.find(row=>row.label==='Pix').total),20);
 assert.equal(data.fulfillment.find(row=>row.label==='delivery').active,1);
 const foreign=await get('start=2024-02-28&end=2024-02-29',b.cookie);assert.equal(Number(foreign.summary.total),999);
 const empty=await get('start=2023-01-01&end=2023-01-03');assert.equal(empty.summary.orders,0);assert.equal(empty.summary.average_order,null);assert.equal(empty.daily.length,3);assert.ok(empty.daily.every(row=>Number(row.total)===0));assert.deepEqual(empty.products,[]);
 // Os pedidos legados sem itens são propositais; remover antes da auditoria de checkout.
 await db.execute(`DELETE FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')})`,ids);
 await db.execute(`DELETE FROM orders WHERE id IN (${ids.map(()=>'?').join(',')}) AND company_id IN (?,?)`,[...ids,a.id,b.id]);
 await db.execute('DELETE FROM customers WHERE id IN (?,?) AND company_id IN (?,?)',[customer.insertId,other.insertId,a.id,b.id]);
}
module.exports={verifyReports};
