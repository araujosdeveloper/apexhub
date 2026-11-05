const {positiveId,roles}=require('../jwt');
// O tenant vem exclusivamente da identidade autenticada, nunca de body/query/header.
function tenantMiddleware(req,res,next){
 if(!req.auth)return res.status(401).json({error:'Autenticação necessária.'});
 if(req.auth.scope!=='tenant'||!Object.values(roles).includes(req.auth.role)||!positiveId(req.auth.tenant_id)||req.auth.tenant_id!==req.user?.company_id)return res.status(403).json({error:'Acesso restrito à empresa da sua conta.'});
 if(Object.hasOwn(req,'tenantId')){if(req.tenantId!==req.auth.tenant_id)return res.status(403).json({error:'Escopo de empresa inválido.'});}
 else Object.defineProperty(req,'tenantId',{value:req.auth.tenant_id,enumerable:true,writable:false,configurable:false});
 next();
}
module.exports={tenantMiddleware};
