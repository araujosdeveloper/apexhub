const {createMasterMenuImportController}=require('../controllers/master-menu-import');
const {MAX_UPLOAD,importGate}=require('../menu-import-ai');
const {globalFinancialHandler}=require('../advanced-reports');
const {impersonateHandler}=require('../impersonation');
const express=require('express');
const {asyncRoute}=require('../auth');
const {authenticate,requireRoles}=require('../middlewares/auth');
const {createPlatformAdminController}=require('../controllers/platform-admin');
const {planPrices}=require('../platform-plan-prices');
const {adminErrorHandler,lockMaster}=require('../platform-admin-http');
function platformAdminRouter(db,{jwt,prices,logger=console,menuImportExtractor,menuImportGate}){
 const importer=createMasterMenuImportController(db,{extractor:menuImportExtractor,logger}),gate=menuImportGate||importGate({key:req=>'master:'+req.master.id});
 const router=express.Router(),controller=createPlatformAdminController(db,{prices:planPrices(prices),logger});
 // Apenas estes recursos reservados são globais. Demais /api/admin continuam tenant.
 router.use(['/tenants','/metrics','/reports/global-financial','/menu','/subscription-requests'],authenticate(db,'master',jwt),requireRoles('super_admin'));
 router.post('/menu/import-ai',gate,express.raw({type:()=>true,limit:MAX_UPLOAD}),asyncRoute(importer.preview));
 router.post('/menu/confirm-import',asyncRoute(importer.confirm));
 router.get('/tenants',asyncRoute(controller.listTenants));
 router.post('/tenants',asyncRoute(controller.createTenant));
 router.put('/tenants/:id/status',asyncRoute(controller.setTenantStatus));
 router.post('/tenants/:id/impersonate',asyncRoute(impersonateHandler(db,{jwt,logger})));
 router.get('/reports/global-financial',asyncRoute(globalFinancialHandler(db,{prices:planPrices(prices),logger})));
 router.get('/metrics',asyncRoute(controller.metrics));
 router.get('/subscription-requests',asyncRoute(async(req,res)=>{
  const [rows]=await db.execute(`SELECT r.company_id,r.plan_code,r.status,r.created_at,r.updated_at,c.name,c.slug,u.name AS owner_name,u.email AS owner_email
   FROM subscription_plan_requests r JOIN companies c ON c.id=r.company_id
   LEFT JOIN users u ON u.id=(SELECT owner.id FROM users owner WHERE owner.company_id=c.id AND owner.role='owner' ORDER BY owner.active DESC,owner.id LIMIT 1)
   WHERE r.status='pending' ORDER BY r.created_at,r.company_id`);
  res.json({success:true,data:rows,message:'Solicitações de plano consultadas.'});
 }));
 router.put('/subscription-requests/:id',asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),status=req.body?.status;
  if(!/^[1-9]\d{0,9}$/.test(req.params.id)||!Number.isSafeInteger(id)||id>4294967295||!['accepted','declined'].includes(status))return res.status(400).json({success:false,data:null,message:'Informe empresa e decisão válidas.'});
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();
   await lockMaster(conn,req);
   const [[request]]=await conn.execute('SELECT company_id,plan_code,status FROM subscription_plan_requests WHERE company_id=? FOR UPDATE',[id]);
   if(!request){await conn.rollback();return res.status(404).json({success:false,data:null,message:'Solicitação de plano não encontrada.'});}
   if(request.status!=='pending'){await conn.rollback();return res.status(409).json({success:false,data:null,message:'Esta solicitação já foi processada.'});}
   if(status==='accepted'){
    const [[subscription]]=await conn.execute('SELECT company_id FROM subscriptions WHERE company_id=? FOR UPDATE',[id]);
    if(!subscription){await conn.rollback();return res.status(404).json({success:false,data:null,message:'Assinatura da empresa não encontrada.'});}
    await conn.execute("UPDATE subscriptions SET plan_code=?,status='active',trial_ends_at=NULL WHERE company_id=?",[request.plan_code,id]);
   }
   await conn.execute('UPDATE subscription_plan_requests SET status=? WHERE company_id=?',[status,id]);
   await conn.execute('INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,?,?,?)',[req.master.id,status==='accepted'?'subscription_activated':'subscription_request_declined',String(id),JSON.stringify({plan_code:request.plan_code})]);
   await conn.commit();return res.json({success:true,data:{company_id:id,plan_code:request.plan_code,status},message:status==='accepted'?'Plano ativado.':'Solicitação recusada.'});
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }));
 for(const [path,allow]of [['/menu/import-ai','POST'],['/menu/confirm-import','POST'],['/reports/global-financial','GET, HEAD'],['/tenants','GET, HEAD, POST'],['/tenants/:id/status','PUT'],['/metrics','GET, HEAD'],['/tenants/:id/impersonate','POST'],['/subscription-requests','GET, HEAD'],['/subscription-requests/:id','PUT']])router.all(path,(req,res)=>res.set('Allow',allow).status(405).json({success:false,data:null,message:'Método não permitido para este recurso.'}));
 router.use(['/tenants','/metrics','/reports/global-financial','/menu','/subscription-requests'],(req,res)=>res.status(404).json({success:false,data:null,message:'Rota administrativa global não encontrada.'}));
 router.use(adminErrorHandler(logger));
 return router;
}
module.exports={platformAdminRouter};
