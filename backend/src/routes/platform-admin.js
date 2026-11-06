const {globalFinancialHandler}=require('../advanced-reports');
const {impersonateHandler}=require('../impersonation');
const express=require('express');
const {asyncRoute}=require('../auth');
const {authenticate,requireRoles}=require('../middlewares/auth');
const {createPlatformAdminController}=require('../controllers/platform-admin');
const {planPrices}=require('../platform-plan-prices');
const {adminErrorHandler}=require('../platform-admin-http');
function platformAdminRouter(db,{jwt,prices,logger=console}){
 const router=express.Router(),controller=createPlatformAdminController(db,{prices:planPrices(prices),logger});
 // Apenas estes recursos reservados são globais. Demais /api/admin continuam tenant.
 router.use(['/tenants','/metrics','/reports/global-financial'],authenticate(db,'master',jwt),requireRoles('super_admin'));
 router.get('/tenants',asyncRoute(controller.listTenants));
 router.post('/tenants',asyncRoute(controller.createTenant));
 router.put('/tenants/:id/status',asyncRoute(controller.setTenantStatus));
 router.post('/tenants/:id/impersonate',asyncRoute(impersonateHandler(db,{jwt,logger})));
 router.get('/reports/global-financial',asyncRoute(globalFinancialHandler(db,{prices:planPrices(prices),logger})));
 router.get('/metrics',asyncRoute(controller.metrics));
 for(const [path,allow]of [['/reports/global-financial','GET, HEAD'],['/tenants','GET, HEAD, POST'],['/tenants/:id/status','PUT'],['/metrics','GET, HEAD'],['/tenants/:id/impersonate','POST']])router.all(path,(req,res)=>res.set('Allow',allow).status(405).json({success:false,data:null,message:'Método não permitido para este recurso.'}));
 router.use(['/tenants','/metrics','/reports/global-financial'],(req,res)=>res.status(404).json({success:false,data:null,message:'Rota administrativa global não encontrada.'}));
 router.use(adminErrorHandler(logger));
 return router;
}
module.exports={platformAdminRouter};
