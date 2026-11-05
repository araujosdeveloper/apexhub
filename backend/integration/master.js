const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {provisionMaster}=require('../src/provision-master');
async function verifyMaster(db,request,{a,b,json}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const email='master-'+randomUUID()+'@example.com',password=randomUUID();const admin=await provisionMaster(db,{name:'Master integração',email,password});
 try{
  assert.equal((await request('/api/master/overview',{headers:{Cookie:a.cookie}})).status,401);
  const login=await request('/api/master/auth/login',json('POST',{email,password}));assert.equal(login.status,200);const cookie=String(login.headers['set-cookie']).split(';')[0];assert.match(cookie,/^apex_master_session=/);
  assert.equal((await request('/api/auth/me',{headers:{Cookie:cookie}})).status,401);
  const overview=await request('/api/master/overview',{headers:{Cookie:cookie}});assert.equal(overview.status,200);const data=await overview.json();assert.equal(data.mrr,null);assert.equal(data.uptime_percent,null);assert.equal(data.services.docker,null);assert.ok(data.stores.total>=1);
  const [[company]]=await db.execute('SELECT name FROM companies WHERE id=?',[b.id]);
  const get=async search=>{const res=await request('/api/master/tenants?search='+encodeURIComponent(search),{headers:{Cookie:cookie}});assert.equal(res.status,200);return res.json();};
  let tenant=(await get(company.name)).tenants.find(row=>row.id===b.id);assert.ok(tenant);assert.equal(tenant.password_hash,undefined);
  const body={name:tenant.name,cnpj:'T'+String(b.id).padStart(12,'0'),active:false,revision:tenant.revision,reason:'Suspensão no ensaio isolado'};
  assert.equal((await request('/api/master/tenants/'+b.id,json('PUT',body,a.cookie))).status,401);
  assert.equal((await request('/api/master/tenants/'+b.id,json('PUT',body,cookie))).status,200);
  assert.equal((await request('/api/auth/me',{headers:{Cookie:b.cookie}})).status,401);
  assert.equal((await request('/api/master/tenants/'+b.id,json('PUT',{...body,active:true},cookie))).status,409);
  tenant=(await get(body.cnpj)).tenants.find(row=>row.id===b.id);assert.equal(tenant.active,false);
  assert.equal((await request('/api/master/tenants/'+b.id,json('PUT',{...body,active:true,revision:tenant.revision},cookie))).status,200);
  const [[audit]]=await db.execute("SELECT COUNT(*) AS total FROM platform_audit WHERE admin_id=? AND action='tenant_suspended'",[admin.id]);assert.equal(Number(audit.total),1);
  assert.equal((await request('/api/master/auth/logout',json('POST',{},cookie))).status,200);
  assert.equal((await request('/api/master/overview',{headers:{Cookie:cookie}})).status,401);
 }finally{await db.execute('DELETE FROM platform_audit WHERE admin_id=?',[admin.id]);await db.execute('DELETE FROM platform_sessions WHERE admin_id=?',[admin.id]);await db.execute('DELETE FROM platform_admins WHERE id=?',[admin.id]);}
}
module.exports={verifyMaster};
