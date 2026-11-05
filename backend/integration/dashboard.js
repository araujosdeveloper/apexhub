const assert=require('node:assert/strict');
const {dayBoundary}=require('../src/reports');
async function verifyDashboard(db,request,{a,b}) {
  const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
  const get=async(url,cookie)=>{const response=await request(url,{headers:{Cookie:cookie}});assert.equal(response.status,200);return response.json();};
  const data=await get('/api/admin/dashboard?company_id='+b.id,a.cookie);
  assert.equal(data.company_id,a.id);assert.equal(data.daily.length,7);assert.equal(data.daily.at(-1).day,data.today);
  const start=dayBoundary(data.today,data.timezone),next=new Date(Date.parse(data.today+'T00:00:00Z')+86400000).toISOString().slice(0,10),until=dayBoundary(next,data.timezone);
  const [[expected]]=await db.execute("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='completed' THEN total_amount+discount_amount ELSE 0 END),0) AS gross FROM orders WHERE company_id=? AND created_at>=? AND created_at<?",[a.id,start,until]);
  assert.equal(data.kpis.orders,Number(expected.total));assert.equal(Number(data.kpis.gross_revenue),Number(expected.gross));assert.equal(data.kpis.average_minutes,null);
  assert.equal(data.origins.reduce((sum,row)=>sum+row.total,0),data.kpis.orders);
  const [[rating]]=await db.execute('SELECT AVG(r.rating) AS average FROM order_reviews r JOIN orders o ON o.id=r.order_id WHERE o.company_id=? AND r.created_at>=? AND r.created_at<?',[a.id,start,until]);
  if(rating.average!==null)assert.equal(Number(data.kpis.review_average),Math.round(Number(rating.average)*100)/100);
  const other=await get('/api/admin/dashboard',b.cookie);assert.equal(other.company_id,b.id);
  const search=await get('/api/admin/dashboard/search?q=Vitrine&company_id='+b.id,a.cookie);assert.ok(search.results.length>0);assert.ok(search.results.every(result=>result.url.startsWith('/')));assert.ok(search.results.every(result=>!result.label.includes('outra loja')));
}
module.exports={verifyDashboard};
