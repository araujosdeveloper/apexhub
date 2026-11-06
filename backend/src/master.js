const {authenticate,tokenResponse,accessTokenFields}=require('./middlewares/auth');
const {createHash}=require('node:crypto');
const {asyncRoute}=require('./auth');
const {verifyPassword,sessionToken,tokenHash}=require('./security');
const {utcDate}=require('./order-board');
const cookieName='apex_master_session';
const capabilities={assisted_access:true,billing:false,docker:false,cnpj:true};
function tenantRevision(row){return createHash('sha256').update(JSON.stringify([row.id,row.name,row.slug,Number(row.active),row.cnpj||null])).digest('hex');}
function tenantInput(body){if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>160||typeof body.active!=='boolean'||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision)||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>500)throw new Error('Informe nome, status, versão e motivo de 5 a 500 caracteres.');if(body.cnpj!==undefined&&body.cnpj!==null&&typeof body.cnpj!=='string')throw new Error('Identificador fiscal inválido.');const cnpj=typeof body.cnpj==='string'?body.cnpj.trim().toUpperCase().replace(/[.\/\s-]/g,''):null;if(cnpj&&!/^[A-Z0-9]{1,32}$/.test(cnpj))throw new Error('Informe um identificador fiscal com até 32 letras ou números.');return {cnpj:cnpj||null,name:body.name.trim(),active:body.active,reason:body.reason.trim(),revision:body.revision};}
function installMaster(app,db,{secureCookies=false}={}){
 const cookieOptions={httpOnly:true,secure:secureCookies,sameSite:'strict',path:'/api/master',maxAge:8*3600000};
 const auth=authenticate(db,'master',app.locals.jwt);
 app.post('/api/master/auth/token',auth,(req,res)=>tokenResponse(req,res,app.locals.jwt));
 const attempts=new Map();
 app.post('/api/master/auth/login',asyncRoute(async(req,res)=>{
  const now=Date.now();for(const [ip,value]of attempts)if(value.until<now)attempts.delete(ip);const entry=attempts.get(req.ip)||{count:0,until:now+900000};entry.count++;attempts.set(req.ip,entry);if(entry.count>15)return res.status(429).json({error:'Muitas tentativas. Aguarde 15 minutos.'});
  const {email,password}=req.body||{};if(typeof email!=='string'||email.length>254||typeof password!=='string'||password.length>128)return res.status(400).json({error:'Informe e-mail e senha Master.'});
  const [[admin]]=await db.execute('SELECT id,password_hash FROM platform_admins WHERE email=? AND active=1',[email.trim().toLowerCase()]);
  const valid=await verifyPassword(password,admin?.password_hash||`scrypt:00000000000000000000000000000000:${'0'.repeat(128)}`);
  if(!admin||!valid)return res.status(401).json({error:'Credenciais Master inválidas.'});
  const conn=await db.getConnection();let raw,access;
  try{await conn.beginTransaction();const [[current]]=await conn.execute('SELECT id,password_hash FROM platform_admins WHERE id=? AND active=1 FOR UPDATE',[admin.id]);if(!current||current.password_hash!==admin.password_hash){await conn.rollback();return res.status(401).json({error:'Credenciais Master inválidas.'});}raw=sessionToken();await conn.execute('INSERT INTO platform_sessions(token_hash,admin_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))',[tokenHash(raw),admin.id]);await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'master_login',?,'{}')",[admin.id,String(admin.id)]);access=accessTokenFields(app.locals.jwt,{scope:'master',id:admin.id,role:'super_admin',sid:tokenHash(raw)});await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();}
  attempts.delete(req.ip);res.cookie(cookieName,raw,cookieOptions);res.json({ok:true,...access});
 }));
 app.use('/api/master',auth);
 app.get('/api/master/auth/me',auth,(req,res)=>res.json({admin:req.master,capabilities}));
 app.post('/api/master/auth/logout',auth,asyncRoute(async(req,res)=>{await db.execute('DELETE FROM platform_sessions WHERE token_hash=?',[req.auth.sid]);res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined});res.json({ok:true});}));
 app.get('/api/master/overview',auth,asyncRoute(async(req,res)=>{
  const conn=await db.getConnection();try{await conn.beginTransaction();
   const [[stores]]=await conn.execute('SELECT COUNT(*) AS total,SUM(active=1) AS active FROM companies');
   const [[orders]]=await conn.execute('SELECT COUNT(*) AS total FROM orders WHERE created_at>=UTC_DATE() AND created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)');
   const [growth]=await conn.execute("SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,COUNT(*) AS total FROM companies WHERE created_at>=DATE_SUB(DATE_FORMAT(UTC_DATE(),'%Y-%m-01'),INTERVAL 11 MONTH) AND created_at<=UTC_TIMESTAMP() GROUP BY month ORDER BY month");
   const [plans]=await conn.execute('SELECT plan_code,status,COUNT(*) AS total FROM subscriptions GROUP BY plan_code,status ORDER BY plan_code,status');
   const [audit]=await conn.execute('SELECT p.id,p.action,p.entity_id,p.created_at,a.name AS admin_name FROM platform_audit p JOIN platform_admins a ON a.id=p.admin_id ORDER BY p.id DESC LIMIT 8');
   await conn.commit();res.json({stores:{total:Number(stores.total),active:Number(stores.active||0)},orders_today:Number(orders.total),mrr:null,conversion:null,uptime_percent:null,growth:growth.map(row=>({...row,total:Number(row.total)})),subscriptions:plans.map(row=>({...row,total:Number(row.total)})),activity:audit.map(row=>({...row,created_at:utcDate(row.created_at)})),services:{api:true,mysql:true,node_uptime_seconds:Math.floor(process.uptime()),node_memory_bytes:process.memoryUsage().rss,docker:null,connections:null},capabilities,server_time:new Date().toISOString(),timezone:'UTC'});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
 app.get('/api/master/tenants',auth,asyncRoute(async(req,res)=>{
  const {search='',offset='0'}=req.query;if(typeof search!=='string'||search.length>80||typeof offset!=='string'||!/^\d{1,6}$/.test(offset)||Number(offset)>100000)return res.status(400).json({error:'Busca ou página inválida.'});
  const pattern='%'+search.trim().replace(/[=%_]/g,'=$&')+'%',args=[pattern,pattern,pattern,'%'+(search.trim().toUpperCase().replace(/[.\/\s-]/g,'')||'!').replace(/[=%_]/g,'=$&')+'%'];
  const where="WHERE (c.name LIKE ? ESCAPE '=' OR c.slug LIKE ? ESCAPE '=' OR EXISTS(SELECT 1 FROM users owner WHERE owner.company_id=c.id AND owner.role='owner' AND owner.email LIKE ? ESCAPE '=') OR p.cnpj LIKE ? ESCAPE '=')";
  const conn=await db.getConnection();try{await conn.beginTransaction();
   const [[count]]=await conn.execute('SELECT COUNT(*) AS total FROM companies c LEFT JOIN platform_tenant_profiles p ON p.company_id=c.id '+where,args);
   const [rows]=await conn.execute(`SELECT c.id,c.name,c.slug,c.active,c.created_at,p.cnpj,s.plan_code,s.status AS subscription_status,
    (SELECT u.name FROM users u WHERE u.company_id=c.id AND u.role='owner' ORDER BY u.active DESC,u.id LIMIT 1) AS owner_name,
    (SELECT u.email FROM users u WHERE u.company_id=c.id AND u.role='owner' ORDER BY u.active DESC,u.id LIMIT 1) AS owner_email
    FROM companies c LEFT JOIN platform_tenant_profiles p ON p.company_id=c.id LEFT JOIN subscriptions s ON s.company_id=c.id ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ${Number(offset)}`,args);
   await conn.commit();res.json({total:Number(count.total),offset:Number(offset),limit:20,tenants:rows.map(row=>({...row,active:Number(row.active)===1,created_at:utcDate(row.created_at),revision:tenantRevision(row)}))});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
 app.put('/api/master/tenants/:id',auth,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);let input;try{input=tenantInput(req.body);if(!Number.isSafeInteger(id)||id<1)throw new Error('Empresa inválida.');}catch(e){return res.status(400).json({error:e.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();
   const [[admin]]=await conn.execute('SELECT id FROM platform_admins WHERE id=? AND active=1 FOR UPDATE',[req.master.id]);if(!admin){await conn.rollback();return res.status(401).json({error:'Conta Master indisponível.'});}
   const [[company]]=await conn.execute('SELECT id,name,slug,active FROM companies WHERE id=? FOR UPDATE',[id]);if(!company){await conn.rollback();return res.status(404).json({error:'Empresa não encontrada.'});}
   const [[profile]]=await conn.execute('SELECT cnpj FROM platform_tenant_profiles WHERE company_id=?',[id]);company.cnpj=profile?.cnpj||null;
   if(tenantRevision(company)!==input.revision){await conn.rollback();return res.status(409).json({error:'A empresa mudou. Atualize antes de editar.'});}
   await conn.execute('UPDATE companies SET name=?,active=? WHERE id=?',[input.name,input.active,id]);
   if(profile)await conn.execute('UPDATE platform_tenant_profiles SET cnpj=? WHERE company_id=?',[input.cnpj,id]);else await conn.execute('INSERT INTO platform_tenant_profiles(company_id,cnpj) VALUES (?,?)',[id,input.cnpj]);
   if(!input.active){await conn.execute('DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.company_id=?',[id]);await conn.execute('DELETE FROM platform_impersonations WHERE company_id=?',[id]);}
   await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,?,?,?)",[req.master.id,input.active?'tenant_updated':'tenant_suspended',String(id),JSON.stringify({before:{name:company.name,cnpj:company.cnpj,active:Number(company.active)===1},after:{name:input.name,cnpj:input.cnpj,active:input.active},reason:input.reason})]);
   await conn.commit();res.json({ok:true});
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Identificador fiscal já cadastrado em outra empresa.'});throw e;}finally{conn.release();}
 }));
}
module.exports={tenantRevision,tenantInput,installMaster};
