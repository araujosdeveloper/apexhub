const {context,resolveAssisted,auditAttempt}=require('../impersonation');
const {tokenHash}=require('../security');
const {roles,verify,verifyImpersonation,issue,InvalidToken,TTL}=require('../jwt');
const {tenantMiddleware}=require('./tenant');
const authenticated=Symbol('apexhub-authenticated');
function cookieToken(req,name){const part=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));const value=part?.slice(name.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:null;}
async function resolveIdentity(db,req,scope,config){
 const authorization=req.headers.authorization;let claims=null,sid,credential;
 if(authorization!==undefined){if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/i.test(authorization))throw new InvalidToken();try{claims=verify(config,authorization.slice(7),scope);}catch(e){if(scope!=='tenant')throw e;const assisted=verifyImpersonation(config,authorization.slice(7));return resolveAssisted(db,req,{claims:assisted});}sid=claims.sid;credential='bearer';}
 else {if(scope==='tenant'){const marker=context(req);if(marker)return resolveAssisted(db,req,{marker});}const raw=cookieToken(req,scope==='master'?'apex_master_session':'delivery_session');if(!raw)return null;sid=tokenHash(raw);credential='cookie';}
 let user;
 if(scope==='tenant'){
  const [rows]=await db.execute(`SELECT u.id, u.company_id, u.name, u.email, u.role, c.name AS company_name, c.slug
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = 1 AND c.active = 1`,[sid]);user=rows[0];
 }else{
  const [[row]]=await db.execute('SELECT a.id,a.name,a.email FROM platform_sessions s JOIN platform_admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.active=1',[sid]);user=row;
 }
 if(!user)return null;
 const role=scope==='master'?'super_admin':roles[user.role],tenantId=scope==='master'?null:user.company_id;
 if(!role)return null;
 if(claims&&(claims.sub!==scope+':'+user.id||claims.role!==role||claims.tenant_id!==tenantId))throw new InvalidToken();
 return {user:Object.freeze(user),auth:Object.freeze({scope,role,tenant_id:tenantId,sub:scope+':'+user.id,sid,credential,exp:claims?.exp||null})};
}
function requireRoles(...allowed){return (req,res,next)=>{if(!req.auth)return res.status(401).json({error:'Autenticação necessária.'});if(!allowed.includes(req.auth.role))return res.status(403).json({error:'Seu perfil não permite realizar esta operação.'});next();};}
function authenticate(db,scope,config){return async(req,res,next)=>{try{if(req[authenticated]===scope)return scope==='tenant'?tenantMiddleware(req,res,next):requireRoles('super_admin')(req,res,next);const identity=await resolveIdentity(db,req,scope,config);if(!identity)return res.status(401).json({error:'Sessão expirada. Entre novamente.'});req.auth=identity.auth;req[authenticated]=scope;if(scope==='master'){req.master=identity.user;return requireRoles('super_admin')(req,res,next);}req.user=identity.user;return tenantMiddleware(req,res,()=>Promise.resolve(auditAttempt(db,req)).then(()=>next()).catch(next));}catch(e){if(e instanceof InvalidToken)return res.status(401).json({error:e.message});next(e);}};}
function accessTokenFields(config,{scope,id,role,tenantId=null,sid}){
 if(!config)return {};
 return {access_token:issue(config,{scope,id,role,tenantId,sid}),token_type:'Bearer',expires_in:TTL,role,tenant_id:tenantId};
}
function tokenResponse(req,res,config){
 if(!config)return res.status(503).json({error:'Emissão JWT não configurada neste ambiente.'});
 // Renovação exige a sessão HttpOnly. Um bearer não prolonga sua própria validade.
 if(req.auth.impersonation||req.auth.credential!=='cookie')return res.status(403).json({error:'Use a sessão da conta para emitir um novo token.'});
 const scope=req.auth.scope,id=Number(req.auth.sub.split(':')[1]);
 res.json(accessTokenFields(config,{scope,id,role:req.auth.role,tenantId:req.auth.tenant_id,sid:req.auth.sid}));
}
module.exports={cookieToken,resolveIdentity,authenticate,requireRoles,tokenResponse,accessTokenFields};
