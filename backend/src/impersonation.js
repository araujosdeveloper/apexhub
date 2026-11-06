const {sessionToken,tokenHash}=require('./security');
const {issue,verifyImpersonation,InvalidToken}=require('./jwt');
const {AdminError,success,transaction,lockMaster,adminErrorHandler}=require('./platform-admin-http');
const {utcDate}=require('./utc-date');
const COOKIE='apex_assisted_session';
const HEX=/^[a-f0-9]{64}$/;
function context(req){
 let value=req.headers['x-apex-impersonation'];
 const path=(req.originalUrl||req.url||req.path||'').split('?')[0];
 if(value===undefined&&(path==='/api/admin/orders/events'||/^\/api\/admin\/products\/[1-9][0-9]*\/image$/.test(path)))value=req.query?.assisted_context;
 if(value!==undefined&&(typeof value!=='string'||!HEX.test(value)))throw new InvalidToken();
 return value||null;
}
function rawCookie(req){const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));const raw=part?.slice(COOKIE.length+1);return HEX.test(raw||'')?raw:null;}
async function load(db,{id,cookieHash,claims,lock=false}){
 const args=[id],condition=cookieHash?' AND i.cookie_hash=? AND i.exchanged=1':'';if(cookieHash)args.push(cookieHash);
 const [[row]]=await db.execute(`SELECT i.id AS assisted_id,i.admin_id,i.company_id,i.owner_id,i.exchanged,LEAST(i.expires_at,s.expires_at) AS assisted_expires_at,
  u.id,u.name,u.email,u.role,c.name AS company_name,c.slug,a.name AS actor_name,a.email AS actor_email
  FROM platform_impersonations i JOIN platform_sessions s ON s.token_hash=i.master_session_hash AND s.admin_id=i.admin_id
  JOIN platform_admins a ON a.id=i.admin_id JOIN companies c ON c.id=i.company_id
  JOIN users u ON u.id=i.owner_id AND u.company_id=i.company_id
  WHERE i.id=?${condition} AND i.expires_at>UTC_TIMESTAMP() AND s.expires_at>UTC_TIMESTAMP() AND a.active=1 AND c.active=1 AND u.active=1 AND u.role='owner'${lock?' FOR UPDATE':''}`,args);
 if(!row)return null;
 if(claims&&(claims.sub!=='tenant:'+row.owner_id||claims.tenant_id!==row.company_id||claims.act.sub!=='master:'+row.admin_id))throw new InvalidToken();
 return row;
}
async function resolveAssisted(db,req,{claims,marker}={}){
 const raw=claims?null:rawCookie(req);if(!claims&&!raw)return null;
 const row=await load(db,{id:claims?.sid||marker,cookieHash:raw?tokenHash(raw):null,claims});if(!row)return null;
 return {user:Object.freeze({id:row.owner_id,company_id:row.company_id,name:row.name,email:row.email,role:'owner',company_name:row.company_name,slug:row.slug}),auth:Object.freeze({scope:'tenant',role:'tenant_owner',tenant_id:row.company_id,sub:'tenant:'+row.owner_id,sid:row.assisted_id,credential:claims?'bearer':'assisted_cookie',exp:claims?.exp||null,impersonation:true,actor_id:row.admin_id,actor_name:row.actor_name,actor_email:row.actor_email,expires_at:utcDate(row.assisted_expires_at)})};
}
function publicContext(auth){return auth?.impersonation?{active:true,actor:{id:auth.actor_id,name:auth.actor_name,email:auth.actor_email},expires_at:auth.expires_at}:null;}
async function auditAttempt(db,req){
 if(!req.auth?.impersonation||['GET','HEAD','OPTIONS'].includes(req.method))return;
 const path=(req.originalUrl||req.url||'').split('?')[0];
 await db.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'impersonation_request',?,?)",[req.auth.actor_id,String(req.tenantId),JSON.stringify({method:req.method,path:/^\/[a-zA-Z0-9/_-]{1,180}$/.test(path)?path:'tenant-api',owner_id:req.user.id})]);
}
function impersonateHandler(db,{jwt,logger=console}){return async(req,res)=>{
 if(!jwt)throw new AdminError(503,'JWT não configurado neste ambiente.');
 const id=Number(req.params.id),reason=req.body?.reason??'Acesso assistido solicitado pelo administrador.';
 if(!/^[1-9]\d{0,9}$/.test(req.params.id)||!Number.isSafeInteger(id)||id>4294967295||typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw new AdminError(400,'Informe empresa válida e motivo de 5 a 500 caracteres.');
 const data=await transaction(db,req,logger,async conn=>{
  await lockMaster(conn,req);
  const [[company]]=await conn.execute('SELECT id,name,active FROM companies WHERE id=? FOR UPDATE',[id]);
  if(!company)throw new AdminError(404,'Empresa não encontrada.');if(Number(company.active)!==1)throw new AdminError(409,'A empresa está suspensa.');
  const [[owner]]=await conn.execute("SELECT id FROM users WHERE company_id=? AND role='owner' AND active=1 ORDER BY id LIMIT 1 FOR UPDATE",[id]);
  if(!owner)throw new AdminError(409,'A loja precisa de um proprietário ativo para o acesso assistido.');
  const sessionId=sessionToken();
  await conn.execute('DELETE FROM platform_impersonations WHERE expires_at<=UTC_TIMESTAMP()');
  await conn.execute('INSERT INTO platform_impersonations(id,admin_id,master_session_hash,company_id,owner_id,expires_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionId,req.master.id,req.auth.sid,id,owner.id]);
  await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'impersonation_started',?,?)",[req.master.id,String(id),JSON.stringify({owner_id:owner.id,reason:reason.trim(),duration_seconds:3600})]);
  const token=issue(jwt,{scope:'tenant',id:owner.id,role:'tenant_owner',tenantId:id,sid:sessionId,actorId:req.master.id});
  return {access_token:token,token_type:'Bearer',expires_in:3600,tenant_id:id,role:'tenant_owner',impersonation:true,tenant_name:company.name,redirect_url:'/tenant/dashboard#token='+encodeURIComponent(token)};
 });success(res,data,'Acesso assistido iniciado.');
};}
function installImpersonation(app,db,{secureCookies=false}={}){
 const options={httpOnly:true,secure:secureCookies,sameSite:'strict',path:'/api'};
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 app.get('/tenant/dashboard',(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.sendFile(require('node:path').join(__dirname,'../../frontend/impersonation-entry.html'));});
 app.post('/api/auth/impersonation/exchange',wrap(async(req,res)=>{
  let claims;try{claims=verifyImpersonation(app.locals.jwt,req.body?.token);}catch{throw new AdminError(401,'Link de acesso assistido inválido ou expirado.');}
  const result=await transaction(db,req,app.locals.logger,async conn=>{
   const row=await load(conn,{id:claims.sid,claims,lock:true});if(!row)throw new AdminError(401,'Acesso assistido revogado ou indisponível.');if(Number(row.exchanged)===1)throw new AdminError(409,'Este link já foi utilizado. Inicie outro acesso pelo Master.');
   const raw=sessionToken();await conn.execute('UPDATE platform_impersonations SET exchanged=1,cookie_hash=? WHERE id=?',[tokenHash(raw),claims.sid]);
   await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'impersonation_entered',?,?)",[row.admin_id,String(row.company_id),JSON.stringify({owner_id:row.owner_id})]);
   return {raw,id:row.assisted_id,expires_at:utcDate(row.assisted_expires_at),tenant_id:row.company_id};
  });
  res.cookie(COOKIE,result.raw,{...options,maxAge:Math.max(0,Math.min(3600000,Date.parse(result.expires_at)-Date.now()))});
  success(res,{context:result.id,expires_at:result.expires_at,tenant_id:result.tenant_id,redirect_url:'/dashboard.html'},'Sessão assistida pronta.');
 }));
 const end=wrap(async(req,res)=>{
  const marker=context(req),raw=rawCookie(req);let bearer=null;let clearCookie=true;
  if(req.headers.authorization!==undefined){try{const match=/^Bearer ([A-Za-z0-9_.-]+)$/i.exec(req.headers.authorization);if(!match)throw new InvalidToken();bearer=verifyImpersonation(app.locals.jwt,match[1]);}catch{throw new AdminError(401,'Token assistido inválido.');}}
  if(raw&&!marker&&!bearer)throw new AdminError(400,'Informe o contexto da sessão assistida.');
  await transaction(db,req,app.locals.logger,async conn=>{
   const id=bearer?.sid||marker;if(!id)return;
   const args=[id],where=bearer?'':' AND cookie_hash=?';if(!bearer){if(!raw)return;args.push(tokenHash(raw));}
   const [[row]]=await conn.execute('SELECT id,admin_id,company_id,cookie_hash FROM platform_impersonations WHERE id=?'+where+' FOR UPDATE',args);
   if(!row){if(raw){const [[other]]=await conn.execute('SELECT id FROM platform_impersonations WHERE cookie_hash=?',[tokenHash(raw)]);if(other)throw new AdminError(409,'O contexto de acesso mudou. Volte ao Master nesta aba.');}return;}
   if(bearer&&raw&&row.cookie_hash!==tokenHash(raw))clearCookie=false;
   if(bearer&&bearer.act.sub!=='master:'+row.admin_id)throw new AdminError(401,'Token assistido inválido.');
   await conn.execute('DELETE FROM platform_impersonations WHERE id=?',[row.id]);
   await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'impersonation_ended',?,'{}')",[row.admin_id,String(row.company_id)]);
  });
  if(clearCookie)res.clearCookie(COOKIE,options);success(res,{redirect_url:'/master.html'},'Acesso assistido encerrado.');
 });
 app.post('/api/auth/impersonation/end',end);
 app.use('/api/auth/impersonation',adminErrorHandler(app.locals.logger));
 app.locals.endImpersonation=(req,res,next)=>end(req,res,error=>adminErrorHandler(app.locals.logger)(error,req,res,next));
}
module.exports={context,rawCookie,resolveAssisted,publicContext,auditAttempt,impersonateHandler,installImpersonation,COOKIE};
