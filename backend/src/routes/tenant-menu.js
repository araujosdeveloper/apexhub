const express=require('express');
const {asyncRoute}=require('../auth');
const {requireRoles}=require('../middlewares/auth');
const {adminErrorHandler}=require('../platform-admin-http');
const {createTenantMenuController}=require('../controllers/tenant-menu');
function tenantMenuRouter(db,auth,logger=console){
 const router=express.Router(),controller=createTenantMenuController(db,logger),manage=requireRoles('tenant_owner','tenant_manager');
 router.use(auth,manage);
 router.get('/',asyncRoute(controller.list));
 router.post('/categories',asyncRoute(controller.createCategory));
 router.post('/products',asyncRoute(controller.createProduct));
 router.put('/products/:id/availability',asyncRoute(controller.availability));
 router.delete('/products/:id',asyncRoute(controller.remove));
 for(const [path,allow] of [['/','GET, HEAD'],['/categories','POST'],['/products','POST'],['/products/:id/availability','PUT'],['/products/:id','DELETE']])router.all(path,(req,res)=>res.set('Allow',allow).status(405).json({success:false,data:null,message:'Método não permitido para este recurso.'}));
 router.use((req,res)=>res.status(404).json({success:false,data:null,message:'Rota de cardápio não encontrada.'}));router.use(adminErrorHandler(logger));return router;
}
module.exports={tenantMenuRouter};
