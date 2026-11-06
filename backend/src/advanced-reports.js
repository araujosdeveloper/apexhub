const express=require('express');
const {asyncRoute}=require('./auth');
const {requireRoles}=require('./middlewares/auth');
const {reportPeriod,localDay}=require('./reports');
const {loadOperations}=require('./operations');
const {transaction,success,AdminError,adminErrorHandler}=require('./platform-admin-http');
const {estimatedMrr}=require('./platform-plan-prices');
const DAY=86400000;
function shift(day,offset){return new Date(Date.parse(day+'T00:00:00Z')+offset*DAY).toISOString().slice(0,10);}
function windowFor(query,timezone,now=new Date(),fixed=false){
 if(fixed&&(query.start!==undefined||query.end!==undefined))throw new AdminError(400,'O gráfico semanal usa os últimos 7 dias, incluindo hoje.');
 const end=localDay(now,timezone);
 try{return reportPeriod(query.start===undefined&&query.end===undefined?{start:shift(end,-6),end}:query,timezone);}catch(e){throw new AdminError(400,e.message);}
}
// company_id é a chave tenant_id do esquema existente. O filtro de intervalo usa
// o índice orders_company_date; funções de data nunca envolvem a coluna no WHERE.
const metrics=`COUNT(o.id) AS orders,
 COALESCE(SUM(o.status='completed'),0) AS completed_orders,
 COALESCE(SUM(o.status='cancelled'),0) AS cancelled_orders,
 COALESCE(SUM(CASE WHEN o.status='completed' AND o.total_amount>=0 AND o.discount_amount>=0 THEN o.total_amount+o.discount_amount ELSE 0 END),0) AS gross_revenue,
 COALESCE(SUM(CASE WHEN o.status='completed' AND o.total_amount>=0 THEN o.total_amount ELSE 0 END),0) AS order_revenue,
 ROUND(AVG(CASE WHEN o.status='completed' AND o.total_amount>=0 THEN o.total_amount END),2) AS average_ticket,
 COALESCE(SUM(o.status='completed' AND (o.total_amount IS NULL OR o.total_amount<0 OR o.discount_amount IS NULL OR o.discount_amount<0)),0) AS incomplete_amount_orders`;
function normalize(row){return {...row,orders:Number(row.orders||0),completed_orders:Number(row.completed_orders||0),cancelled_orders:Number(row.cancelled_orders||0),incomplete_amount_orders:Number(row.incomplete_amount_orders||0),gross_revenue:String(row.gross_revenue??'0.00'),order_revenue:String(row.order_revenue??'0.00'),average_ticket:row.average_ticket==null?null:String(row.average_ticket),cancellation_rate:Number(row.orders)?Number((Number(row.cancelled_orders||0)*100/Number(row.orders)).toFixed(2)):0};}
async function aggregate(conn,tenantId,period){
 const [[row]]=await conn.execute(`SELECT ${metrics} FROM orders o WHERE o.company_id=? AND o.created_at>=? AND o.created_at<?`,[tenantId,period.from,period.until]);return normalize(row);
}
async function daily(conn,tenantId,period){
 // Faixas civis calculadas em Node suportam horário de verão sem tabelas de fuso MySQL.
 const ranges=period.days.map(()=> 'SELECT DATE(?) AS day,CAST(? AS DATETIME) AS starts,CAST(? AS DATETIME) AS ends').join(' UNION ALL ');
 const [rows]=await conn.execute(`WITH day_ranges AS (${ranges}) SELECT d.day,${metrics}
 FROM day_ranges d LEFT JOIN orders o ON o.company_id=? AND o.created_at>=d.starts AND o.created_at<d.ends
 GROUP BY d.day ORDER BY d.day`,[...period.days.flatMap(d=>[d.day,d.from,d.until]),tenantId]);
 return rows.map(row=>({...normalize(row),day:row.day instanceof Date?row.day.toISOString().slice(0,10):String(row.day)}));
}
function metadata(period,timezone){return {currency:'BRL',timezone,start:period.start,end:period.end,basis:'created_at_current_status',money_format:'decimal_string',gross_revenue_basis:'completed_total_plus_discount_including_delivery',average_ticket_basis:'completed_known_total_after_discount',as_of:new Date().toISOString()};}
function tenantReportsRouter(db,auth,logger=console){
 const router=express.Router();router.use(auth,requireRoles('tenant_owner','tenant_manager'));
 for(const kind of ['summary','sales-chart','origin-chart'])router.get('/'+kind,asyncRoute(async(req,res)=>{
  const data=await transaction(db,req,logger,async conn=>{
   const config=await loadOperations(conn,req.tenantId),period=windowFor(req.query,config.timezone,new Date(),kind==='sales-chart');
   const result={tenant_id:req.tenantId,...metadata(period,config.timezone)};
   if(kind==='summary'){
    result.summary=await aggregate(conn,req.tenantId,period);result.daily=await daily(conn,req.tenantId,period);
    const today=localDay(new Date(),config.timezone);
    result.today=await aggregate(conn,req.tenantId,windowFor({start:today,end:today},config.timezone));
   }else if(kind==='sales-chart')result.series=await daily(conn,req.tenantId,period);
   else{
    const [rows]=await conn.execute(`SELECT CASE WHEN snapshot_source='checkout' THEN 'digital_menu' ELSE 'other_legacy' END AS origin,COUNT(*) AS orders
     FROM orders WHERE company_id=? AND created_at>=? AND created_at<? GROUP BY origin ORDER BY origin`,[req.tenantId,period.from,period.until]);
    const total=rows.reduce((n,r)=>n+Number(r.orders),0),byOrigin=new Map(rows.map(r=>[r.origin,Number(r.orders)]));
    result.total_orders=total;result.series=[['digital_menu','Cardápio Digital / Checkout próprio'],['other_legacy','Outros registros / Legados']].map(([origin,label])=>({origin,label,orders:byOrigin.get(origin)||0,percentage:total?Number(((byOrigin.get(origin)||0)*100/total).toFixed(2)):0}));
    result.origin_basis='snapshot_source_checkout_vs_other_all_statuses';
   }
   return result;
  });success(res,data,'Relatório consultado.');
 }));
 for(const path of ['/summary','/sales-chart','/origin-chart'])router.all(path,(req,res)=>res.set('Allow','GET, HEAD').status(405).json({success:false,data:null,message:'Método não permitido para este relatório.'}));
 router.use((req,res)=>res.status(404).json({success:false,data:null,message:'Relatório não encontrado.'}));router.use(adminErrorHandler(logger));return router;
}
function revenueGrowth(current,previous){
 const cents=value=>BigInt(String(value).replace('.', ''));
 const before=cents(previous),after=cents(current);if(before===0n)return null;
 return Number((after-before)*10000n/before)/100;
}
function monthWindow(now=new Date()){
 const y=now.getUTCFullYear(),m=now.getUTCMonth(),stamp=date=>date.toISOString().slice(0,19).replace('T',' ');
 return {previous:stamp(new Date(Date.UTC(y,m-1,1))),from:stamp(new Date(Date.UTC(y,m,1))),until:stamp(new Date(Date.UTC(y,m+1,1)))};
}
function globalFinancialHandler(db,{prices,logger=console}){return async(req,res)=>{
 const data=await transaction(db,req,logger,async conn=>{
  const period=monthWindow();
  // Dirigir a consulta pelas empresas ativas permite usar o índice tenant/data.
  const [[current]]=await conn.execute(`SELECT ${metrics} FROM companies c JOIN orders o ON o.company_id=c.id AND o.created_at>=? AND o.created_at<? WHERE c.active=1`,[period.from,period.until]);
  const [[previous]]=await conn.execute(`SELECT ${metrics} FROM companies c JOIN orders o ON o.company_id=c.id AND o.created_at>=? AND o.created_at<? WHERE c.active=1`,[period.previous,period.from]);
  const [plans]=await conn.execute("SELECT s.plan_code,COUNT(*) AS total FROM subscriptions s JOIN companies c ON c.id=s.company_id WHERE c.active=1 AND s.status='active' GROUP BY s.plan_code");
  const currentMetrics=normalize(current),previousMetrics=normalize(previous);
  return {currency:'BRL',timezone:'UTC',month:period.from.slice(0,7),scope:'currently_active_tenants',basis:'created_at_current_status',money_format:'decimal_string',current_month:currentMetrics,previous_month:previousMetrics,
   order_volume_growth_percent:previousMetrics.orders?Number(((currentMetrics.orders-previousMetrics.orders)*100/previousMetrics.orders).toFixed(2)):null,
   gross_revenue_growth_percent:revenueGrowth(currentMetrics.gross_revenue,previousMetrics.gross_revenue),comparison_basis:'current_month_to_date_vs_full_previous_month',...estimatedMrr(plans,prices),mrr_basis:'currently_active_tenants_and_subscriptions_configured_monthly_prices',mrr_growth_percent:null,mrr_growth_unavailable_reason:'subscription_price_history_not_recorded',as_of:new Date().toISOString()};
 });success(res,data,'Financeiro global consultado.');
};}
module.exports={windowFor,monthWindow,revenueGrowth,normalize,aggregate,daily,tenantReportsRouter,globalFinancialHandler};
