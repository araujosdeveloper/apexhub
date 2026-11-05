const {asyncRoute}=require('./auth');
const {loadOperations}=require('./operations');
const DAY=86400000;
function calendarDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')throw new Error('Informe datas válidas entre 2000 e 2100.');
 const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw new Error('Data inválida.');return time;
}
function localDay(date,timezone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');}
// Limite do dia civil sem depender de tabelas de fuso do MySQL. Inclui dias de 23/25 horas.
function dayBoundary(day,timezone){
 const target=Date.parse(day+'T00:00:00Z');let low=target-2*DAY,high=target+2*DAY;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 const at=time=>{const parts=formatter.formatToParts(new Date(time));return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');};
 while(low<high){const mid=Math.floor((low+high)/2);if(at(mid)<day)low=mid+1;else high=mid;}return new Date(low).toISOString().slice(0,19).replace('T',' ');
}
function reportPeriod(query,timezone,now=new Date()){
 let {start,end}=query;
 if(start===undefined&&end===undefined){end=localDay(now,timezone);start=new Date(Date.parse(end+'T00:00:00Z')-29*DAY).toISOString().slice(0,10);}
 const from=calendarDate(start),to=calendarDate(end),length=(to-from)/DAY+1;
 if(length<1||length>93)throw new Error('Escolha um período de 1 a 93 dias.');
 const days=Array.from({length:length+1},(_,i)=>new Date(from+i*DAY).toISOString().slice(0,10));
 const boundaries=days.map(day=>dayBoundary(day,timezone));
 return {start,end,from:boundaries[0],until:boundaries.at(-1),days:days.slice(0,-1).map((day,i)=>({day,from:boundaries[i],until:boundaries[i+1]}))};
}
const METRICS=`COUNT(*) AS orders,
 SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
 SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
 SUM(CASE WHEN status IN ('pending','preparing','ready','delivering') THEN 1 ELSE 0 END) AS active,
 COALESCE(SUM(CASE WHEN status='completed' AND total_amount>=0 THEN total_amount ELSE 0 END),0) AS total,
 SUM(CASE WHEN status='completed' AND total_amount>=0 THEN 1 ELSE 0 END) AS valued_orders,
 SUM(CASE WHEN status='completed' AND (total_amount IS NULL OR total_amount<0) THEN 1 ELSE 0 END) AS unknown_values,
 SUM(CASE WHEN status='completed' AND (delivery_fee IS NULL OR delivery_fee<0 OR discount_amount IS NULL OR discount_amount<0) THEN 1 ELSE 0 END) AS unknown_charges,
 COALESCE(SUM(CASE WHEN status='completed' AND delivery_fee>=0 THEN delivery_fee ELSE 0 END),0) AS delivery_fees,
 COALESCE(SUM(CASE WHEN status='completed' AND discount_amount>=0 THEN discount_amount ELSE 0 END),0) AS discounts,
 ROUND(AVG(CASE WHEN status='completed' AND total_amount>=0 THEN total_amount ELSE NULL END),2) AS average_order`;
function counts(row){const result={...row};for(const key of ['orders','completed','cancelled','active','valued_orders','unknown_values','unknown_charges','quantity','order_count','incomplete_orders'])if(key in result)result[key]=Number(result[key]||0);return result;}
function installReports(app,db,auth){
 app.get('/api/admin/reports/sales',auth,(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.status(403).json({error:'Seu perfil não permite consultar relatórios de vendas.'}),asyncRoute(async(req,res)=>{
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();const config=await loadOperations(conn,req.user.company_id);let period;
   try{period=reportPeriod(req.query,config.timezone);}catch(e){await conn.rollback();return res.status(400).json({error:e.message});}
   const args=[req.user.company_id,period.from,period.until];
   const base=`WITH sales AS (SELECT id,status,total_amount,delivery_fee,discount_amount,payment_method,fulfillment_method,created_at FROM orders WHERE company_id=? AND created_at>=? AND created_at<?)`;
   const [[summary]]=await conn.execute(`${base} SELECT ${METRICS} FROM sales`,args);
   const [payments]=await conn.execute(`${base} SELECT COALESCE(NULLIF(TRIM(payment_method),''),'Não informado') AS label,${METRICS} FROM sales WHERE status='completed' GROUP BY label ORDER BY total DESC,label`,args);
   const [fulfillment]=await conn.execute(`${base} SELECT fulfillment_method AS label,${METRICS} FROM sales GROUP BY fulfillment_method ORDER BY label`,args);
   const ranges=period.days.map(()=> 'SELECT ? AS day,CAST(? AS DATETIME) AS starts,CAST(? AS DATETIME) AS ends').join(' UNION ALL ');
   const [daily]=await conn.execute(`${base}, day_ranges AS (${ranges}) SELECT d.day,COUNT(s.id) AS orders,
    SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN s.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
    SUM(CASE WHEN s.status IN ('pending','preparing','ready','delivering') THEN 1 ELSE 0 END) AS active,
    COALESCE(SUM(CASE WHEN s.status='completed' AND s.total_amount>=0 THEN s.total_amount ELSE 0 END),0) AS total
    FROM day_ranges d LEFT JOIN sales s ON s.created_at>=d.starts AND s.created_at<d.ends GROUP BY d.day ORDER BY d.day`,[...args,...period.days.flatMap(day=>[day.day,day.from,day.until])]);
   const [products]=await conn.execute(`${base} SELECT oi.product_id,oi.product_name,SUM(oi.quantity) AS quantity,COUNT(DISTINCT s.id) AS order_count,
    COALESCE(SUM(CASE WHEN oi.total_price>=0 THEN oi.total_price ELSE 0 END),0) AS gross_total
    FROM order_items oi JOIN sales s ON s.id=oi.order_id WHERE s.status='completed' GROUP BY oi.product_id,oi.product_name ORDER BY quantity DESC,gross_total DESC,oi.product_name,oi.product_id LIMIT 20`,args);
   const [[legacy]]=await conn.execute(`${base} SELECT COUNT(*) AS incomplete_orders FROM sales s WHERE s.status='completed' AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=s.id)`,args);
   await conn.commit();
   res.json({company_id:req.user.company_id,timezone:config.timezone,start:period.start,end:period.end,server_time:new Date().toISOString(),basis:'created_at_current_status',summary:{...counts(summary),...counts(legacy)},payments:payments.map(counts),fulfillment:fulfillment.map(counts),daily:daily.map(counts),products:products.map(counts)});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={calendarDate,localDay,dayBoundary,reportPeriod,counts,installReports};
