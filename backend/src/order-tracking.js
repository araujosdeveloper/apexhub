const {randomBytes}=require('node:crypto');
const {asyncRoute}=require('./auth');
const {utcDate}=require('./order-board');
const trackingUrl=token=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?'/track.html#'+token:null;
// O chamador mantém trava da linha do pedido (novo ou SELECT FOR UPDATE).
async function ensureTracking(conn,orderId){
 const [[existing]]=await conn.execute('SELECT token FROM order_tracking WHERE order_id=?',[orderId]);if(existing)return trackingUrl(existing.token);
 const token=randomBytes(32).toString('hex');await conn.execute('INSERT INTO order_tracking(order_id,token) VALUES (?,?)',[orderId,token]);return trackingUrl(token);
}
function installOrderTracking(app,db,auth){
 app.get('/api/order-tracking',asyncRoute(async(req,res)=>{
  const token=req.get('X-Order-Token');if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return res.status(404).json({error:'Link de acompanhamento inválido ou indisponível.'});
  const conn=await db.getConnection();try{
   await conn.beginTransaction();
   const [[order]]=await conn.execute(`SELECT o.id,o.status,o.created_at,o.fulfillment_method,o.estimated_minutes,o.fulfillment_address,o.total_amount,o.delivery_fee,o.discount_amount,o.coupon_code,c.name AS company_name,c.slug
    FROM order_tracking t JOIN orders o ON o.id=t.order_id JOIN companies c ON c.id=o.company_id WHERE t.token=? AND c.active=1`,[token]);
   if(!order){await conn.commit();return res.status(404).json({error:'Link de acompanhamento inválido ou indisponível.'});}
   const [items]=await conn.execute('SELECT product_name,quantity,total_price,addons_snapshot FROM order_items WHERE order_id=? ORDER BY id',[order.id]);await conn.commit();
   const createdAt=utcDate(order.created_at),created=Date.parse(createdAt),minutes=Number(order.estimated_minutes);
   const estimatedAt=Number.isFinite(created)&&minutes>0&&minutes<=240?new Date(created+minutes*60000).toISOString():null;
   // Lista explícita: não retorna cadastro, endereço/telefone do cliente ou observações.
   res.json({order:{id:order.id,status:order.status,created_at:createdAt,fulfillment_method:order.fulfillment_method,pickup_address:order.fulfillment_method==='pickup'?order.fulfillment_address:'',estimated_at:estimatedAt,total_amount:order.total_amount,delivery_fee:order.delivery_fee,discount_amount:order.discount_amount,coupon_code:order.coupon_code,company_name:order.company_name,menu_url:'/?loja='+encodeURIComponent(order.slug),items},server_time:new Date().toISOString()});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
 app.post('/api/admin/orders/:id/tracking',auth,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Pedido inválido.'});
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[order]]=await conn.execute('SELECT id FROM orders WHERE id=? AND company_id=? FOR UPDATE',[id,req.tenantId]);if(!order){await conn.rollback();return res.status(404).json({error:'Pedido não encontrado nesta loja.'});}
   const url=await ensureTracking(conn,id);await conn.commit();res.json({tracking_url:url});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={trackingUrl,ensureTracking,installOrderTracking};
