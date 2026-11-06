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
 // Novas APIs BI usam o mesmo conjunto com limites de fuso e loja adversária.
 const advanced=async(path,query='',cookie=a.cookie)=>{const response=await request('/api/tenant/reports/'+path+query,{headers:{Cookie:cookie}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.success,true);return body.data;};
 const bi=await advanced('summary','?start=2024-02-28&end=2024-02-29&tenant_id='+b.id);
 assert.equal(bi.tenant_id,a.id);assert.equal(bi.summary.orders,4);assert.equal(bi.summary.completed_orders,2);assert.equal(bi.summary.cancellation_rate,25);assert.equal(Number(bi.summary.gross_revenue),52);assert.equal(Number(bi.summary.order_revenue),50);assert.equal(Number(bi.summary.average_ticket),25);assert.equal(bi.daily.length,2);assert.equal(Number(bi.daily[0].gross_revenue),22);assert.equal(Number(bi.daily[1].gross_revenue),30);
 const biOther=await advanced('summary','?start=2024-02-28&end=2024-02-29',b.cookie);assert.equal(Number(biOther.summary.gross_revenue),999);
 const biEmpty=await advanced('summary','?start=2023-01-01&end=2023-01-03');assert.equal(biEmpty.summary.average_ticket,null);assert.equal(biEmpty.summary.cancellation_rate,0);assert.equal(biEmpty.daily.length,3);assert.ok(biEmpty.daily.every(day=>day.orders===0&&Number(day.gross_revenue)===0));
 await db.execute("UPDATE orders SET snapshot_source='legacy' WHERE id=? AND company_id=?",[ids[4],a.id]);
 const origins=await advanced('origin-chart','?start=2024-02-28&end=2024-02-29');assert.equal(origins.total_orders,4);assert.equal(origins.series.find(s=>s.origin==='digital_menu').percentage,75);assert.equal(origins.series.find(s=>s.origin==='other_legacy').percentage,25);
 const weekly=await advanced('sales-chart');assert.equal(weekly.series.length,7);
 const [indexes]=await db.query("SHOW INDEX FROM orders WHERE Key_name='orders_company_date'");assert.deepEqual(indexes.sort((a,b)=>a.Seq_in_index-b.Seq_in_index).map(row=>row.Column_name),['company_id','created_at','id']);
 const [plan]=await db.execute('EXPLAIN SELECT COUNT(*) FROM orders WHERE company_id=? AND created_at>=? AND created_at<?',[a.id,'2024-02-28 03:00:00','2024-03-01 03:00:00']);assert.ok(plan.some(row=>String(row.possible_keys).includes('orders_company_date')));
 // Os pedidos legados sem itens são propositais; remover antes da auditoria de checkout.
 await db.execute(`DELETE FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')})`,ids);
 await db.execute(`DELETE FROM orders WHERE id IN (${ids.map(()=>'?').join(',')}) AND company_id IN (?,?)`,[...ids,a.id,b.id]);
 await db.execute('DELETE FROM customers WHERE id IN (?,?) AND company_id IN (?,?)',[customer.insertId,other.insertId,a.id,b.id]);
}
module.exports={verifyReports};
