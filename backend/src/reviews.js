const {requireRoles}=require('./middlewares/auth');
const {asyncRoute}=require('./auth');
const {utcDate}=require('./order-board');
function reviewInput(body){if(!body||!Number.isInteger(body.rating)||body.rating<1||body.rating>5||typeof body.comment!=='string'||body.comment.length>1000)throw new Error('Escolha uma nota de 1 a 5 e comentário de até 1000 caracteres.');return {rating:body.rating,comment:body.comment.trim()};}
function filters(query){const {rating='all',offset='0'}=query;if(typeof rating!=='string'||!['all','1','2','3','4','5'].includes(rating)||typeof offset!=='string'||!/^\d{1,6}$/.test(offset)||Number(offset)>100000)throw new Error('Filtros inválidos.');return {rating,offset:Number(offset)};}
function installReviews(app,db,auth){
 const token=(req,res,next)=>{const value=req.get('X-Order-Token');if(!/^[a-f0-9]{64}$/.test(value||''))return res.status(404).json({error:'Link de avaliação inválido ou indisponível.'});req.reviewToken=value;next();};
 app.get('/api/order-review',token,asyncRoute(async(req,res)=>{
  const [[row]]=await db.execute(`SELECT o.status,r.rating,r.comment,r.created_at FROM order_tracking t JOIN orders o ON o.id=t.order_id JOIN companies c ON c.id=o.company_id LEFT JOIN order_reviews r ON r.order_id=o.id WHERE t.token=? AND c.active=1`,[req.reviewToken]);
  if(!row)return res.status(404).json({error:'Link de avaliação inválido ou indisponível.'});res.json({can_review:row.status==='completed'&&row.rating===null,review:row.rating===null?null:{rating:Number(row.rating),comment:row.comment,created_at:utcDate(row.created_at)}});
 }));
 app.post('/api/order-review',token,asyncRoute(async(req,res)=>{
  let input;try{input=reviewInput(req.body);}catch(e){return res.status(400).json({error:e.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();
   const [[linked]]=await conn.execute('SELECT o.id FROM order_tracking t JOIN orders o ON o.id=t.order_id JOIN companies c ON c.id=o.company_id WHERE t.token=? AND c.active=1',[req.reviewToken]);
   if(!linked){await conn.rollback();return res.status(404).json({error:'Link de avaliação inválido ou indisponível.'});}
   const [[order]]=await conn.execute('SELECT id,status FROM orders WHERE id=? FOR UPDATE',[linked.id]);
   if(!order){await conn.rollback();return res.status(404).json({error:'Link de avaliação inválido ou indisponível.'});}
   if(order.status!=='completed'){await conn.rollback();return res.status(409).json({error:'Só é possível avaliar pedidos concluídos.'});}
   const [[existing]]=await conn.execute('SELECT rating,comment FROM order_reviews WHERE order_id=? FOR UPDATE',[order.id]);
   if(existing){await conn.commit();if(Number(existing.rating)!==input.rating||existing.comment!==input.comment)return res.status(409).json({error:'Este pedido já foi avaliado. A avaliação enviada não pode ser alterada.'});return res.json({ok:true,replayed:true});}
   await conn.execute('INSERT INTO order_reviews(order_id,rating,comment) VALUES (?,?,?)',[order.id,input.rating,input.comment]);await conn.commit();res.status(201).json({ok:true});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
 app.get('/api/admin/reviews',auth,requireRoles('tenant_owner','tenant_manager'),asyncRoute(async(req,res)=>{
  let selection;try{selection=filters(req.query);}catch(e){return res.status(400).json({error:e.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();const company=req.tenantId;
   const from='FROM order_reviews r JOIN orders o ON o.id=r.order_id WHERE o.company_id=?';
   const [[summary]]=await conn.execute(`SELECT COUNT(*) AS total,ROUND(AVG(r.rating),2) AS average,SUM(CASE WHEN r.rating<=2 THEN 1 ELSE 0 END) AS low_ratings ${from}`,[company]);
   const [distribution]=await conn.execute(`SELECT r.rating,COUNT(*) AS total ${from} GROUP BY r.rating ORDER BY r.rating`,[company]);
   const condition=selection.rating==='all'?'':' AND r.rating=?',args=[company,...(selection.rating==='all'?[]:[Number(selection.rating)])];
   const [[count]]=await conn.execute(`SELECT COUNT(*) AS total ${from}${condition}`,args);
   const [reviews]=await conn.execute(`SELECT r.order_id,r.rating,r.comment,r.created_at,o.customer_name,o.fulfillment_method ${from}${condition} ORDER BY r.created_at DESC,r.order_id DESC LIMIT 50 OFFSET ${selection.offset}`,args);
   await conn.commit();res.json({company_id:company,summary:{total:Number(summary.total),average:summary.average,low_ratings:Number(summary.low_ratings||0)},distribution:distribution.map(row=>({rating:Number(row.rating),total:Number(row.total)})),reviews:reviews.map(row=>({...row,rating:Number(row.rating),created_at:utcDate(row.created_at)})),total:Number(count.total),offset:selection.offset,limit:50});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={reviewInput,filters,installReviews};
