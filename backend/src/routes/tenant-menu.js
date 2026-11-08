const {createMenuImportController}=require('../controllers/menu-import');
const {MAX_UPLOAD,importGate}=require('../menu-import-ai');
const express=require('express');
const {asyncRoute}=require('../auth');
const {requireRoles}=require('../middlewares/auth');
const {adminErrorHandler}=require('../platform-admin-http');
const {createTenantMenuController}=require('../controllers/tenant-menu');
function tenantMenuRouter(db,auth,logger=console,importOptions={}){
 const importer=createMenuImportController(db,{...importOptions,logger}),gate=importOptions.gate||importGate();
 const jwtOnly=(req,res,next)=>req.auth?.credential==='bearer'?next():res.status(401).json({success:false,data:null,message:'Envie um JWT válido no cabeçalho Authorization: Bearer.'});
 const router=express.Router(),controller=createTenantMenuController(db,logger),manage=requireRoles('tenant_owner','tenant_manager'),aiAccess=importOptions.aiSubscriptionGate||((req,res,next)=>next());
 router.use(auth,manage);
 router.post('/import-ai',aiAccess,jwtOnly,gate,express.raw({type:()=>true,limit:MAX_UPLOAD}),asyncRoute(importer.preview));
 router.post('/confirm-import',aiAccess,jwtOnly,asyncRoute(importer.confirm));
 router.get('/',asyncRoute(controller.list));
 router.post('/categories',asyncRoute(controller.createCategory));
 router.post('/products',asyncRoute(controller.createProduct));
 router.put('/products/:id/availability',asyncRoute(controller.availability));
 router.delete('/products/:id',asyncRoute(controller.remove));
 for(const [path,allow] of [['/import-ai','POST'],['/confirm-import','POST'],['/','GET, HEAD'],['/categories','POST'],['/products','POST'],['/products/:id/availability','PUT'],['/products/:id','DELETE']])router.all(path,(req,res)=>res.set('Allow',allow).status(405).json({success:false,data:null,message:'Método não permitido para este recurso.'}));
 router.use((req,res)=>res.status(404).json({success:false,data:null,message:'Rota de cardápio não encontrada.'}));router.use(adminErrorHandler(logger));return router;
}
module.exports={tenantMenuRouter};
