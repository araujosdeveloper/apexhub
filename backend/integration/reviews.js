const assert=require('node:assert/strict');
async function verifyReviews(db,request,{a,b,json}){const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const [[order]]=await db.execute("SELECT o.id,t.token FROM orders o JOIN order_tracking t ON t.order_id=o.id WHERE o.company_id=? AND o.status='completed' ORDER BY o.id DESC LIMIT 1",[a.id]);assert.ok(order);
 const headers={'X-Order-Token':order.token,'Content-Type':'application/json'},post=body=>request('/api/order-review',{method:'POST',headers,body:JSON.stringify(body)});
 const get=await request('/api/order-review',{headers});assert.equal(get.status,200);assert.equal((await get.json()).can_review,true);
 const concurrent=await Promise.all([post({rating:5,comment:'Muito bom'}),post({rating:5,comment:'Muito bom'})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);assert.equal((await post({rating:1,comment:'Outro'})).status,409);
 const saved=await(await request('/api/order-review',{headers})).json();assert.equal(saved.can_review,false);assert.equal(saved.review.rating,5);
 const owner=await request('/api/admin/reviews?rating=5',{headers:{Cookie:a.cookie}});assert.equal(owner.status,200);const data=await owner.json();assert.equal(data.summary.total,1);assert.equal(Number(data.summary.average),5);assert.equal(data.reviews[0].comment,'Muito bom');
 const other=await request('/api/admin/reviews',{headers:{Cookie:b.cookie}});assert.equal(other.status,200);assert.equal((await other.json()).summary.total,0);
 const [[pending]]=await db.execute("SELECT t.token FROM orders o JOIN order_tracking t ON t.order_id=o.id WHERE o.company_id=? AND o.status<>'completed' LIMIT 1",[a.id]);assert.ok(pending);assert.equal((await request('/api/order-review',{method:'POST',headers:{...headers,'X-Order-Token':pending.token},body:JSON.stringify({rating:5,comment:''})})).status,409);
}
module.exports={verifyReviews};
