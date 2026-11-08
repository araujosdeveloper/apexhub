const {randomBytes}=require('node:crypto');
const {hashPassword}=require('../security');
const {utcDate}=require('../order-board');
const {planCode,estimatedMrr}=require('../platform-plan-prices');
const {AdminError,success,transaction,lockMaster}=require('../platform-admin-http');
function pagination(query){
 const {page='1',page_size='20',search='',status='all'}=query;
 if(typeof page!=='string'||!/^\d{1,6}$/.test(page)||Number(page)<1||typeof page_size!=='string'||!/^\d{1,3}$/.test(page_size)||Number(page_size)<1||Number(page_size)>100||typeof search!=='string'||search.length>80||!['all','active','suspended'].includes(status))throw new AdminError(400,'Informe página positiva, page_size de 1 a 100 e filtros válidos.');
 const offset=(Number(page)-1)*Number(page_size);if(offset>100000)throw new AdminError(400,'Página fora do limite permitido.');
 return {page:Number(page),limit:Number(page_size),offset,search:search.trim(),status};
}
function createInput(body){
 if(!body||Array.isArray(body)||typeof body!=='object')throw new AdminError(400,'Informe os dados da empresa e do proprietário.');
 const {name,owner,cnpj}=body;
 if(typeof name!=='string'||!name.trim()||name.trim().length>160||!owner||Array.isArray(owner)||typeof owner.name!=='string'||!owner.name.trim()||owner.name.trim().length>120||typeof owner.email!=='string'||owner.email.trim().length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email.trim())||typeof owner.password!=='string'||owner.password.length<12||owner.password.length>128||typeof cnpj!=='string'||body.plan_code!==undefined&&!planCode(body.plan_code))throw new AdminError(400,'Informe nome, proprietário com e-mail válido e senha de 12 a 128 caracteres, CNPJ e plan_code válido quando informado.');
 const fiscal=cnpj.trim().toUpperCase().replace(/[.\/\s-]/g,'');
 if(!/^[A-Z0-9]{12}[0-9]{2}$/.test(fiscal))throw new AdminError(400,'CNPJ deve ter 14 posições, com os dois últimos dígitos numéricos.');
 let slug=body.slug;if(slug===undefined){const base=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60).replace(/-$/,'')||'loja';slug=base+'-'+randomBytes(4).toString('hex');}
 if(typeof slug!=='string'||slug.length<3||slug.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new AdminError(400,'Slug inválido. Use de 3 a 80 letras minúsculas, números e hífens.');
 return {name:name.trim(),slug,cnpj:fiscal,plan_code:'trial',owner:{name:owner.name.trim(),email:owner.email.trim().toLowerCase(),password:owner.password}};
}
function tenantView(row){return {id:row.id,name:row.name,slug:row.slug,cnpj:row.cnpj||null,owner:row.owner_id?{id:row.owner_id,name:row.owner_name,email:row.owner_email}:null,plan:{code:row.plan_code||null,status:row.subscription_status||null,trial_ends_at:row.trial_ends_at?utcDate(row.trial_ends_at):null},status:Number(row.active)===1?'active':'suspended',created_at:utcDate(row.created_at)};}
function createPlatformAdminController(db,{prices,logger=console}){
 return {
  listTenants:async(req,res)=>{
   const filter=pagination(req.query),where=[],args=[];
   if(filter.status!=='all'){where.push('c.active=?');args.push(filter.status==='active'?1:0);}
   if(filter.search){const pattern='%'+filter.search.replace(/[=%_]/g,'=$&')+'%';where.push("(c.name LIKE ? ESCAPE '=' OR c.slug LIKE ? ESCAPE '=' OR u.email LIKE ? ESCAPE '=' OR p.cnpj LIKE ? ESCAPE '=')");args.push(pattern,pattern,pattern,'%'+(filter.search.toUpperCase().replace(/[.\/\s-]/g,'')||'!').replace(/[=%_]/g,'=$&')+'%');}
   const joins="FROM companies c LEFT JOIN users u ON u.id=(SELECT owner.id FROM users owner WHERE owner.company_id=c.id AND owner.role='owner' ORDER BY owner.active DESC,owner.id LIMIT 1) LEFT JOIN subscriptions s ON s.company_id=c.id LEFT JOIN platform_tenant_profiles p ON p.company_id=c.id";
   const condition=where.length?' WHERE '+where.join(' AND '):'';
   const data=await transaction(db,req,logger,async conn=>{
    const [[count]]=await conn.execute('SELECT COUNT(*) AS total '+joins+condition,args);
    const [rows]=await conn.execute(`SELECT c.id,c.name,c.slug,c.active,c.created_at,p.cnpj,u.id AS owner_id,u.name AS owner_name,u.email AS owner_email,s.plan_code,s.status AS subscription_status,s.trial_ends_at ${joins}${condition} ORDER BY c.created_at DESC,c.id DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`,args);
    return {tenants:rows.map(tenantView),pagination:{page:filter.page,page_size:filter.limit,total:Number(count.total),total_pages:Math.ceil(Number(count.total)/filter.limit)}};
   });success(res,data,'Empresas consultadas.');
  },
  createTenant:async(req,res)=>{
   const input=createInput(req.body),encoded=await hashPassword(input.owner.password);
   const data=await transaction(db,req,logger,async conn=>{
    await lockMaster(conn,req);
    const [company]=await conn.execute('INSERT INTO companies(name,slug,active) VALUES (?,?,1)',[input.name,input.slug]);
    const [owner]=await conn.execute("INSERT INTO users(company_id,name,email,password_hash,role,active) VALUES (?,?,?,?,'owner',1)",[company.insertId,input.owner.name,input.owner.email,encoded]);
    await conn.execute("INSERT INTO subscriptions(company_id,plan_code,status,trial_ends_at) VALUES (?,?,'trialing',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))",[company.insertId,input.plan_code]);
    await conn.execute('INSERT INTO platform_tenant_profiles(company_id,cnpj) VALUES (?,?)',[company.insertId,input.cnpj]);
    await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'tenant_created',?,?)",[req.master.id,String(company.insertId),JSON.stringify({name:input.name,owner_id:owner.insertId,plan_code:input.plan_code,subscription_status:'trialing'})]);
    const [[dates]]=await conn.execute('SELECT c.created_at,s.trial_ends_at FROM companies c JOIN subscriptions s ON s.company_id=c.id WHERE c.id=?',[company.insertId]);
    return tenantView({id:company.insertId,name:input.name,slug:input.slug,active:1,cnpj:input.cnpj,owner_id:owner.insertId,owner_name:input.owner.name,owner_email:input.owner.email,plan_code:input.plan_code,subscription_status:'trialing',...dates});
   });res.location('/api/admin/tenants?search='+encodeURIComponent(input.slug));success(res,data,'Empresa e proprietário cadastrados.',201);
  },
  setTenantStatus:async(req,res)=>{
   const id=Number(req.params.id),body=req.body;
   if(!/^[1-9]\d{0,9}$/.test(req.params.id)||!Number.isSafeInteger(id)||id>4294967295||!body||Array.isArray(body)||!['active','suspended'].includes(body.status)||body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>500))throw new AdminError(400,'Informe empresa válida, status active/suspended e motivo opcional de 5 a 500 caracteres.');
   const active=body.status==='active',reason=body.reason?.trim()||'Alteração de status pela API Master.';
   const data=await transaction(db,req,logger,async conn=>{
    await lockMaster(conn,req);
    const [[company]]=await conn.execute('SELECT id,active FROM companies WHERE id=? FOR UPDATE',[id]);if(!company)throw new AdminError(404,'Empresa não encontrada.');
    await conn.execute('UPDATE companies SET active=? WHERE id=?',[active,id]);
    if(!active){await conn.execute('DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.company_id=?',[id]);await conn.execute('DELETE FROM platform_impersonations WHERE company_id=?',[id]);}
    await conn.execute('INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,?,?,?)',[req.master.id,active?'tenant_activated':'tenant_suspended',String(id),JSON.stringify({before:{active:Number(company.active)===1},after:{active},reason})]);
    return {id,status:body.status,active,sessions_revoked:!active};
   });success(res,data,active?'Empresa ativada.':'Empresa suspensa e sessões revogadas.');
  },
  metrics:async(req,res)=>{
   const data=await transaction(db,req,logger,async conn=>{
    const [[stores]]=await conn.execute('SELECT COUNT(*) AS total,COALESCE(SUM(active=1),0) AS active FROM companies');
    const [[orders]]=await conn.execute("SELECT COUNT(*) AS total,COALESCE(SUM(created_at>=UTC_DATE() AND created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)),0) AS today,COALESCE(SUM(status='completed'),0) AS completed,COALESCE(SUM(CASE WHEN status='completed' AND total_amount>=0 THEN total_amount ELSE 0 END),0) AS completed_gmv,COALESCE(SUM(status='completed' AND (total_amount IS NULL OR total_amount<0)),0) AS unknown_amounts FROM orders");
    const [plans]=await conn.execute("SELECT plan_code,COUNT(*) AS total FROM subscriptions WHERE status='active' GROUP BY plan_code ORDER BY plan_code");
    return {total_tenants:Number(stores.total),active_tenants:Number(stores.active),suspended_tenants:Number(stores.total)-Number(stores.active),orders_total:Number(orders.total),orders_today:Number(orders.today),orders_completed:Number(orders.completed),completed_order_volume:String(orders.completed_gmv),orders_with_unknown_amount:Number(orders.unknown_amounts),...estimatedMrr(plans,prices),currency:'BRL',mrr_basis:'active_subscriptions_configured_monthly_prices',as_of:new Date().toISOString(),timezone:'UTC'};
   });success(res,data,'Indicadores globais consultados.');
  }
 };
}
module.exports={pagination,createInput,tenantView,createPlatformAdminController};
