const {requireRoles}=require('./middlewares/auth');
const {asyncRoute}=require('./auth');
const {phoneKey}=require('./coupons');
function driverInput(body={}) {
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>120||!phoneKey(body.phone)||typeof body.active!=='boolean') throw new Error('Informe nome, telefone brasileiro com DDD e disponibilidade.');
 return {name:body.name.trim(),phone:phoneKey(body.phone),active:body.active};
}
function installDrivers(app,db,auth,events) {
 const manage=requireRoles('tenant_owner','tenant_manager');
 app.get('/api/admin/drivers',auth,asyncRoute(async(req,res)=>{
  const [drivers]=await db.execute('SELECT id,name,phone,active,version FROM delivery_drivers WHERE company_id=? ORDER BY active DESC,name,id',[req.tenantId]);res.json({company_id:req.tenantId,drivers});
 }));
 app.post('/api/admin/drivers',auth,manage,asyncRoute(async(req,res)=>{
  let input;try{input=driverInput(req.body);}catch(e){return res.status(400).json({error:e.message});}
  try{const [result]=await db.execute('INSERT INTO delivery_drivers(company_id,name,phone,active) VALUES (?,?,?,?)',[req.tenantId,input.name,input.phone,input.active]);res.status(201).json({id:result.insertId});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Telefone já cadastrado nesta loja.'});throw e;}
 }));
 app.put('/api/admin/drivers/:id',auth,manage,asyncRoute(async(req,res)=>{
  let input;const id=Number(req.params.id),version=req.body?.version;
  try{input=driverInput(req.body);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(version)||version<1)throw new Error('Identificador ou versão inválidos.');}catch(e){return res.status(400).json({error:e.message});}
  try{const [result]=await db.execute('UPDATE delivery_drivers SET name=?,phone=?,active=?,version=version+1 WHERE id=? AND company_id=? AND version=?',[input.name,input.phone,input.active,id,req.tenantId,version]);if(!result.affectedRows)return res.status(409).json({error:'Cadastro mudou ou não está disponível. Atualize a lista.'});res.json({ok:true});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Telefone já cadastrado nesta loja.'});throw e;}
 }));
 app.get('/api/admin/dispatch',auth,asyncRoute(async(req,res)=>{
  const offset=String(req.query.offset||'0');if(!/^\d{1,6}$/.test(offset)||Number(offset)>100000)return res.status(400).json({error:'Página inválida.'});
  const [[count]]=await db.execute("SELECT COUNT(*) AS total FROM orders WHERE company_id=? AND fulfillment_method='delivery' AND status IN ('preparing','ready','delivering')",[req.tenantId]);
  const [orders]=await db.execute(`SELECT o.id,o.status,o.customer_name,o.customer_phone,o.payment_method,o.total_amount,o.delivery_fee,o.notes,o.address_street,o.address_number,o.address_neighborhood,o.fulfillment_address,
   a.driver_id,a.driver_name,a.driver_phone,COALESCE(a.version,0) AS assignment_version
   FROM orders o LEFT JOIN delivery_assignments a ON a.order_id=o.id AND a.company_id=o.company_id
   WHERE o.company_id=? AND o.fulfillment_method='delivery' AND o.status IN ('preparing','ready','delivering') ORDER BY o.created_at,o.id LIMIT 50 OFFSET ${Number(offset)}`,[req.tenantId]);
  res.json({company_id:req.tenantId,orders,total:Number(count.total),offset:Number(offset),limit:50});
 }));
 app.put('/api/admin/dispatch/:id',auth,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),{driver_id:driverId,version,status}=req.body||{};
  if(!Number.isSafeInteger(id)||id<1||!(driverId===null||Number.isSafeInteger(driverId)&&driverId>0)||!Number.isSafeInteger(version)||version<0||!['preparing','ready'].includes(status))return res.status(400).json({error:'Vinculação inválida.'});
  const conn=await db.getConnection();let committed=false;
  try{
   await conn.beginTransaction();
   const [[order]]=await conn.execute('SELECT status,fulfillment_method FROM orders WHERE id=? AND company_id=? FOR UPDATE',[id,req.tenantId]);
   if(!order){await conn.rollback();return res.status(404).json({error:'Pedido não encontrado.'});}
   if(order.status!==status||order.fulfillment_method!=='delivery'){await conn.rollback();return res.status(409).json({error:'O pedido mudou. Atualize antes de vincular.'});}
   const [[assignment]]=await conn.execute('SELECT version FROM delivery_assignments WHERE order_id=? AND company_id=?',[id,req.tenantId]);
   if(Number(assignment?.version||0)!==version){await conn.rollback();return res.status(409).json({error:'Outro operador alterou o entregador. Atualize a lista.'});}
   let driver;
   if(driverId!==null){
    [[driver]]=await conn.execute('SELECT id,name,phone FROM delivery_drivers WHERE id=? AND company_id=? AND active=1 FOR UPDATE',[driverId,req.tenantId]);
    if(!driver){await conn.rollback();return res.status(400).json({error:'Entregador indisponível nesta loja.'});}
   }
   await conn.execute(`INSERT INTO delivery_assignments(order_id,company_id,driver_id,driver_name,driver_phone,version) VALUES (?,?,?,?,?,1)
    ON DUPLICATE KEY UPDATE driver_id=VALUES(driver_id),driver_name=VALUES(driver_name),driver_phone=VALUES(driver_phone),version=version+1`,[id,req.tenantId,driver?.id||null,driver?.name||'',driver?.phone||'']);
   await conn.commit();committed=true;events.publish(req.tenantId);res.json({ok:true});
  }catch(e){if(!committed)await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={driverInput,installDrivers};
