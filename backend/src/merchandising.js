const {asyncRoute}=require('./auth');
const defaults=()=>({popular_enabled:true,suggestions_enabled:true,recommendations:[]});
function validateConfig(config){
 if(!config||typeof config.popular_enabled!=='boolean'||typeof config.suggestions_enabled!=='boolean'||!Array.isArray(config.recommendations)||config.recommendations.length>100)throw new Error('Confira as opções de destaque e cadastre até 100 combinações.');
 const anchors=new Set();
 const recommendations=config.recommendations.map(row=>{
  if(!row||!Number.isSafeInteger(row.product_id)||row.product_id<1||anchors.has(row.product_id)||!Array.isArray(row.related_ids)||row.related_ids.length<1||row.related_ids.length>6||row.related_ids.some(id=>!Number.isSafeInteger(id)||id<1||id===row.product_id)||new Set(row.related_ids).size!==row.related_ids.length)throw new Error('Escolha produtos diferentes e até seis sugestões por produto, sem repetições.');
  anchors.add(row.product_id);return {product_id:row.product_id,related_ids:[...row.related_ids]};
 });return {popular_enabled:config.popular_enabled,suggestions_enabled:config.suggestions_enabled,recommendations};
}
async function loadConfig(db,companyId){const [[row]]=await db.execute('SELECT config,version FROM company_merchandising WHERE company_id=?',[companyId]);return row?{config:validateConfig(typeof row.config==='string'?JSON.parse(row.config):row.config),version:Number(row.version)}:{config:defaults(),version:0};}
async function decorateMenu(db,companyId,products){
 const {config}=await loadConfig(db,companyId);let popularity=[];
 if(config.popular_enabled){[popularity]=await db.execute(`SELECT oi.product_id,SUM(oi.quantity) AS units FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id AND p.company_id=o.company_id
  WHERE o.company_id=? AND o.status='completed' AND o.created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) AND o.created_at<=UTC_TIMESTAMP() GROUP BY oi.product_id ORDER BY units DESC,oi.product_id`,[companyId]);}
 const ranks=new Map(popularity.filter(row=>Number(row.units)>0).map((row,index)=>[row.product_id,index]));
 const available=new Set(products.map(product=>product.id)),related=new Map(config.recommendations.map(row=>[row.product_id,row.related_ids]));
 const sorted=[...products].sort((a,b)=>config.popular_enabled?(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity)||a.id-b.id:a.id-b.id);
 return {products:sorted.map(product=>({...product,recommended_ids:config.suggestions_enabled?(related.get(product.id)||[]).filter(id=>available.has(id)):[]})),merchandising:{popular_enabled:config.popular_enabled,suggestions_enabled:config.suggestions_enabled,popular_ids:sorted.filter(product=>ranks.has(product.id)).slice(0,6).map(product=>product.id)}};
}
function installMerchandising(app,db,auth,manage){
 app.get('/api/admin/merchandising',auth,manage,asyncRoute(async(req,res)=>{
  const data=await loadConfig(db,req.tenantId);
  const [products]=await db.execute('SELECT p.id,p.name,p.price,p.active,c.active AS category_active FROM products p JOIN categories c ON c.id=p.category_id AND c.company_id=p.company_id WHERE p.company_id=? ORDER BY p.name,p.id',[req.tenantId]);
  res.json({...data,products,company_id:req.tenantId});
 }));
 app.put('/api/admin/merchandising',auth,manage,asyncRoute(async(req,res)=>{
  let config;const version=req.body?.version;
  try{config=validateConfig(req.body?.config);if(!Number.isSafeInteger(version)||version<0||version>=2147483647)throw new Error('Versão inválida. Recarregue a configuração.');}catch(e){return res.status(400).json({error:e.message});}
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();
   const [[company]]=await conn.execute('SELECT id FROM companies WHERE id=? AND active=1 FOR UPDATE',[req.tenantId]);if(!company){await conn.rollback();return res.status(404).json({error:'Loja indisponível.'});}
   const current=await loadConfig(conn,req.tenantId);if(current.version!==version){await conn.rollback();return res.status(409).json({error:'Outra edição foi salva. Recarregue antes de editar novamente.'});}
   const ids=[...new Set(config.recommendations.flatMap(row=>[row.product_id,...row.related_ids]))];
   if(ids.length){const [products]=await conn.execute(`SELECT id FROM products WHERE company_id=? AND id IN (${ids.map(()=>'?').join(',')})`,[req.tenantId,...ids]);if(products.length!==ids.length){await conn.rollback();return res.status(400).json({error:'Todos os produtos das combinações devem pertencer a esta loja.'});}}
   await conn.execute('INSERT INTO company_merchandising(company_id,config,version) VALUES (?,?,?) ON DUPLICATE KEY UPDATE config=VALUES(config),version=VALUES(version)',[req.tenantId,JSON.stringify(config),version+1]);
   await conn.commit();res.json({config,version:version+1,company_id:req.tenantId});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={defaults,validateConfig,loadConfig,decorateMenu,installMerchandising};
