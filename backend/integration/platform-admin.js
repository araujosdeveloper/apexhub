const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {verifyPassword}=require('../src/security');
async function verifyPlatformAdmin(db,request,{bearer,a}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const slug='platform-api-'+randomUUID(),email=slug+'@example.com',password=randomUUID();
 const payload={name:'Loja criada pela API Master',slug,cnpj:'AB'+randomBytes(5).toString('hex').toUpperCase()+'00',plan_code:'starter',owner:{name:'Proprietário API',email,password}};
 const json=(method,body,headers=bearer)=>({method,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 let companyId;
 try{
  const denied=await request('/api/admin/tenants',json('POST',payload,{Cookie:a.cookie}));assert.equal(denied.status,401);assert.equal((await denied.json()).success,false);
  const created=await request('/api/admin/tenants',json('POST',payload));assert.equal(created.status,201);const data=(await created.json()).data;companyId=data.id;assert.equal(data.owner.email,email);assert.equal(data.plan.status,'trialing');assert.equal(data.status,'active');assert.equal(data.cnpj,payload.cnpj);assert.equal(created.headers['set-cookie'],undefined);assert.equal(data.owner.password_hash,undefined);
  const [[owner]]=await db.execute('SELECT company_id,role,password_hash FROM users WHERE email=?',[email]);assert.equal(owner.company_id,companyId);assert.equal(owner.role,'owner');assert.equal(await verifyPassword(password,owner.password_hash),true);
  const duplicate=await request('/api/admin/tenants',json('POST',payload));assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).success,false);
  const [[count]]=await db.execute('SELECT COUNT(*) AS total FROM companies WHERE slug=?',[slug]);assert.equal(Number(count.total),1);
  const list=await request('/api/admin/tenants?search='+slug+'&page=1&page_size=1',{headers:bearer});assert.equal(list.status,200);const listing=await list.json();assert.equal(listing.success,true);assert.equal(listing.data.pagination.total,1);assert.equal(listing.data.tenants[0].id,companyId);
  const metrics=await request('/api/admin/metrics',{headers:bearer});assert.equal(metrics.status,200);const summary=(await metrics.json()).data;const [[expected]]=await db.execute('SELECT COUNT(*) AS total,COALESCE(SUM(active=1),0) AS active FROM companies');assert.equal(summary.total_tenants,Number(expected.total));assert.equal(summary.active_tenants,Number(expected.active));assert.equal(summary.currency,'BRL');assert.ok(Object.hasOwn(summary,'mrr_estimate'));const [[orders]]=await db.execute('SELECT COUNT(*) AS total FROM orders');assert.equal(summary.orders_total,Number(orders.total));
  const financial=await request('/api/admin/reports/global-financial',{headers:bearer});assert.equal(financial.status,200);const global=(await financial.json()).data;
  const {monthWindow}=require('../src/advanced-reports');const month=monthWindow();
  const [[monthOrders]]=await db.execute("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN o.status='completed' AND o.total_amount>=0 AND o.discount_amount>=0 THEN o.total_amount+o.discount_amount ELSE 0 END),0) AS gross FROM orders o JOIN companies c ON c.id=o.company_id WHERE c.active=1 AND o.created_at>=? AND o.created_at<?",[month.from,month.until]);assert.equal(global.current_month.orders,Number(monthOrders.total));assert.equal(Number(global.current_month.gross_revenue),Number(monthOrders.gross));assert.equal(global.mrr_growth_percent,null);assert.equal(global.currency,'BRL');
  assert.equal((await request('/api/admin/reports/global-financial',{headers:{Cookie:a.cookie}})).status,401);
  const login=await request('/api/auth/login',json('POST',{email,password},{}));assert.equal(login.status,200);const ownCookie=String(login.headers['set-cookie']).split(';')[0],token=(await login.json()).access_token;assert.ok(token);
  assert.equal((await request('/api/admin/metrics',{headers:{Authorization:'Bearer '+token}})).status,401);
  const assisted=await request('/api/admin/tenants/'+companyId+'/impersonate',json('POST',{reason:'Validação de acesso assistido'}));assert.equal(assisted.status,200);const access=(await assisted.json()).data;assert.equal(access.role,'tenant_owner');assert.equal(access.tenant_id,companyId);assert.equal(access.expires_in,3600);assert.ok(access.redirect_url.includes('#token='));
  const asBearer={Authorization:'Bearer '+access.access_token};assert.equal((await request('/api/admin/metrics',{headers:asBearer})).status,401);
  const exchange=await request('/api/auth/impersonation/exchange',json('POST',{token:access.access_token},{}));assert.equal(exchange.status,200);const session=(await exchange.json()).data,assistedCookie=String(exchange.headers['set-cookie']).split(';')[0],asCookie={Cookie:assistedCookie,'X-Apex-Impersonation':session.context};
  const who=await request('/api/auth/me',{headers:asCookie});assert.equal(who.status,200);assert.equal((await who.json()).user.company_id,companyId);assert.equal((await who.json()).impersonation.active,true);
  assert.equal((await request('/api/auth/impersonation/exchange',json('POST',{token:access.access_token},{}))).status,409);
  const normal=await request('/api/auth/me',{headers:{Cookie:assistedCookie+'; '+a.cookie}});assert.equal(normal.status,200);assert.equal((await normal.json()).user.company_id,a.id);
  const cat=await request('/api/admin/categories',json('POST',{name:'Categoria assistida'},asCookie));assert.equal(cat.status,201);const catId=(await cat.json()).id;
  const prod=await request('/api/admin/products',json('POST',{category_id:catId,name:'Produto assistido',description:'',price:'10.00'},asCookie));assert.equal(prod.status,201);const productId=(await prod.json()).id;
  const photo=await request('/api/admin/products/'+productId+'/image',{method:'PUT',headers:{...asCookie,'Content-Type':'image/png'},body:require('./product-images').png});assert.equal(photo.status,200);const image=(await photo.json()).image_url;assert.ok(image.includes('assisted_context='+session.context));assert.equal((await request(image,{headers:{Cookie:assistedCookie}})).status,200);
  assert.equal((await request('/api/auth/token',json('POST',{},asCookie))).status,403);

  const suspension=await request('/api/admin/tenants/'+companyId+'/status',json('PUT',{status:'suspended',reason:'Teste de suspensão pela API Master'}));assert.equal(suspension.status,200);assert.equal((await suspension.json()).data.sessions_revoked,true);
  assert.equal((await request('/api/auth/me',{headers:asCookie})).status,401);assert.equal((await request('/api/auth/me',{headers:asBearer})).status,401);
  assert.equal((await request('/api/auth/me',{headers:{Cookie:ownCookie}})).status,401);assert.equal((await request('/api/auth/me',{headers:{Authorization:'Bearer '+token}})).status,401);
  const blockedLogin=await request('/api/auth/login',json('POST',{email,password},{}));assert.equal(blockedLogin.status,401);
  assert.equal((await request('/api/admin/tenants/'+companyId+'/status',json('PUT',{status:'active'}))).status,200);
  assert.equal((await request('/api/auth/me',{headers:{Cookie:ownCookie}})).status,401);
  assert.equal((await request('/api/auth/login',json('POST',{email,password},{}))).status,200);
  assert.equal((await request('/api/admin/tenants?page=0',{headers:bearer})).status,400);
  const missing=await request('/api/admin/tenants/4294967295/status',json('PUT',{status:'active'}));assert.equal(missing.status,404);
 }finally{
  if(companyId){await db.execute('DELETE FROM platform_impersonations WHERE company_id=?',[companyId]);await db.execute('DELETE i FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.company_id=?',[companyId]);await db.execute('DELETE FROM products WHERE company_id=?',[companyId]);await db.execute('DELETE FROM categories WHERE company_id=?',[companyId]);await db.execute('DELETE FROM platform_tenant_profiles WHERE company_id=?',[companyId]);await db.execute('DELETE FROM subscriptions WHERE company_id=?',[companyId]);await db.execute('DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.company_id=?',[companyId]);await db.execute('DELETE FROM users WHERE company_id=?',[companyId]);await db.execute('DELETE FROM companies WHERE id=?',[companyId]);}
 }
}
module.exports={verifyPlatformAdmin};
