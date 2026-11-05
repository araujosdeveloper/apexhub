const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function verifyJwtRbac(db,request,{a,b,json}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const mint=async(cookie)=>{const response=await request('/api/auth/token',json('POST',{},cookie));assert.equal(response.status,200);return response.json();};
 const owner=await mint(a.cookie),other=await mint(b.cookie);assert.equal(owner.role,'tenant_owner');assert.equal(owner.tenant_id,a.id);
 const headers={Authorization:'Bearer '+owner.access_token},foreign={Authorization:'Bearer '+other.access_token};
 const get=async(url,h=headers)=>{const res=await request(url,{headers:h});assert.equal(res.status,200,url);return res.json();};
 for(const path of ['catalog','operations','orders','orders/board','customers','drivers','coupons','reports/sales','reviews','dashboard','subscription','merchandising','team']){
  const data=await get('/api/admin/'+path+'?tenant_id='+b.id+'&company_id='+b.id);
  if(data.company_id!==undefined)assert.equal(data.company_id,a.id,path);
 }
 const body=(method,content)=>({method,headers:{...headers,'Content-Type':'application/json','X-Tenant-ID':String(b.id)},body:JSON.stringify({...content,company_id:b.id,tenant_id:b.id})});
 const bCategory=await request('/api/admin/categories',{...body('POST',{name:'Privada B'}),headers:{...foreign,'Content-Type':'application/json'}});assert.equal(bCategory.status,201);const categoryId=(await bCategory.json()).id;
 const product=await request('/api/admin/products',{method:'POST',headers:{...foreign,'Content-Type':'application/json'},body:JSON.stringify({category_id:categoryId,name:'Produto privado B',description:'',price:'10.00'})});assert.equal(product.status,201);const productId=(await product.json()).id;
 assert.equal((await request('/api/admin/products/'+productId+'/image',{headers})).status,404);
 assert.equal((await request('/api/admin/products/'+productId+'/image',{method:'DELETE',headers})).status,404);
 assert.equal((await request('/api/admin/products/'+productId+'/addons',{headers})).status,404);
 assert.equal((await request('/api/admin/products/'+productId+'/availability',body('PATCH',{active:false}))).status,404);
 assert.equal((await request('/api/admin/categories/'+categoryId,body('PUT',{name:'Alteração indevida',sort_order:0,active:false}))).status,404);
 const [[unchanged]]=await db.execute('SELECT p.active,c.active AS category_active FROM products p JOIN categories c ON c.id=p.category_id AND c.company_id=p.company_id WHERE p.id=? AND p.company_id=?',[productId,b.id]);assert.equal(Number(unchanged.active),1);assert.equal(Number(unchanged.category_active),1);
 const own=await request('/api/admin/categories',body('POST',{name:'Escopo autenticado A'}));assert.equal(own.status,201);const ownId=(await own.json()).id;const [[created]]=await db.execute('SELECT company_id FROM categories WHERE id=?',[ownId]);assert.equal(created.company_id,a.id);
 const email='jwt-operator-'+randomUUID()+'@example.com',password=randomUUID();const staff=await request('/api/admin/team',body('POST',{name:'Operador JWT',email,password,role:'operator',active:true}));assert.equal(staff.status,201);const staffId=(await staff.json()).id;
 const login=await request('/api/auth/login',json('POST',{email,password}));assert.equal(login.status,200);const loginData=await login.json();assert.equal(loginData.role,'tenant_operator');assert.equal(loginData.tenant_id,a.id);assert.ok(loginData.access_token);const operator={Authorization:'Bearer '+loginData.access_token};
 assert.equal((await request('/api/admin/catalog',{headers:operator})).status,200);
 for(const path of ['team','reports/sales','customers','dashboard','reviews'])assert.equal((await request('/api/admin/'+path,{headers:operator})).status,403,path);
 assert.equal((await request('/api/master/tenants',{headers:operator})).status,401);
 // Troca de senha/perfil revoga o JWT da equipe na mesma transação já usada no painel.
 const roster=await get('/api/admin/team'),user=roster.users.find(row=>row.id===staffId);assert.ok(user);
 assert.equal((await request('/api/admin/team/'+staffId,body('PUT',{name:user.name,email:user.email,role:'manager',active:true,revision:user.revision,password:randomUUID()}))).status,200);
 assert.equal((await request('/api/admin/catalog',{headers:operator})).status,401);
 const relogin=await request('/api/auth/login',json('POST',{email,password}));assert.equal(relogin.status,401);
 // Bearer nunca herda o cookie quando inválido.
 assert.equal((await request('/api/admin/catalog',{headers:{...headers,Authorization:'Bearer invalid',Cookie:a.cookie}})).status,401);
}
module.exports={verifyJwtRbac};
