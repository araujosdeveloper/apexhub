const {randomUUID}=require('node:crypto');
const isPlatformAdminPath=path=>/^\/api\/admin\/(?:tenants|metrics|menu|reports\/global-financial|subscription-requests)(?:\/|$)/i.test(path)||/^\/api\/tenant\/(?:reports|menu|orders|coupons)(?:\/|$)/i.test(path)||/^\/api\/public\/coupons\/validate(?:\/|$)/i.test(path)||/^\/api\/auth\/impersonation(?:\/|$)/i.test(path);
class AdminError extends Error{constructor(status,message){super(message);this.status=status;}}
function responseEnvelope(req,res,next){
 req.requestId=randomUUID();res.set({'X-Request-ID':req.requestId,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
 const send=res.json.bind(res);res.json=body=>send(body&&typeof body.success==='boolean'?body:{success:false,data:null,message:typeof body?.error==='string'?body.error:'Não foi possível concluir a operação.'});next();
}
function success(res,data,message,status=200){return res.status(status).json({success:true,data,message});}
const connectionCodes=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','PROTOCOL_CONNECTION_LOST','PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR','ER_CON_COUNT_ERROR','ER_TOO_MANY_USER_CONNECTIONS','ER_SERVER_SHUTDOWN','POOL_CLOSED','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT']);
function safeLog(logger,req,event,error){
 const code=/^[A-Z0-9_]{1,64}$/.test(error?.code||'')?error.code:'INTERNAL_ERROR';
 try{logger.error(JSON.stringify({level:'error',event,request_id:req.requestId,method:req.method,route:req.route?.path||'platform-admin',code}));}catch{}
}
function adminErrorHandler(logger=console){return (error,req,res,next)=>{
 if(res.headersSent)return next(error);
 if(error.type==='entity.parse.failed')return res.status(400).json({success:false,data:null,message:'JSON inválido.'});
 if(error.type==='entity.too.large')return res.status(413).json({success:false,data:null,message:'Requisição muito grande.'});
 if(error instanceof require('./jwt').InvalidToken)return res.status(401).json({success:false,data:null,message:error.message});
 if(error instanceof AdminError)return res.status(error.status).json({success:false,data:null,message:error.message});
 if(error.code==='ER_DUP_ENTRY')return res.status(409).json({success:false,data:null,message:'E-mail, CNPJ ou endereço da loja já cadastrado.'});
 safeLog(logger,req,'platform_admin_request_failed',error);
 const unavailable=connectionCodes.has(error.code);
 res.status(unavailable?503:500).json({success:false,data:null,message:unavailable?'Banco de dados temporariamente indisponível. Tente novamente.':'Não foi possível concluir a operação. Tente novamente.'});
};}
async function transaction(db,req,logger,handler){
 const conn=await db.getConnection();let broken=false;
 try{await conn.beginTransaction();const data=await handler(conn);await conn.commit();return data;}
 catch(error){try{await conn.rollback();}catch(rollbackError){broken=true;safeLog(logger,req,'platform_admin_rollback_failed',rollbackError);conn.destroy?.();}throw error;}
 finally{if(!broken)conn.release();}
}
async function lockMaster(conn,req){
 const [[admin]]=await conn.execute('SELECT id FROM platform_admins WHERE id=? AND active=1 FOR UPDATE',[req.master.id]);
 if(!admin)throw new AdminError(401,'Conta Master indisponível. Entre novamente.');
 const [[session]]=await conn.execute('SELECT token_hash FROM platform_sessions WHERE token_hash=? AND admin_id=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',[req.auth.sid,req.master.id]);
 if(!session)throw new AdminError(401,'Sessão Master expirada. Entre novamente.');
}
module.exports={isPlatformAdminPath,responseEnvelope,AdminError,success,adminErrorHandler,safeLog,transaction,lockMaster};
