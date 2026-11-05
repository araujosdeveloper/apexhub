const {requireRoles}=require('./middlewares/auth');
const { asyncRoute } = require('./auth');
const { loadOperations, availability } = require('./operations');
const { localDay, reportPeriod } = require('./reports');
const { utcDate } = require('./order-board');

// Indicadores por dia civil da loja. Não infere tempo real sem timestamps das etapas.
function installDashboard(app, db, auth) {
  const permitted = requireRoles('tenant_owner','tenant_manager');
  app.get('/api/admin/dashboard', auth, permitted, asyncRoute(async (req,res) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const company = req.tenantId, config = await loadOperations(conn,company);
      const end = localDay(new Date(),config.timezone);
      const start = new Date(Date.parse(end+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
      const period = reportPeriod({start,end},config.timezone), today = period.days.at(-1);
      const ranges = period.days.map(()=>'SELECT ? AS day,CAST(? AS DATETIME) AS starts,CAST(? AS DATETIME) AS ends').join(' UNION ALL ');
      const [daily] = await conn.execute(`WITH scoped AS (
        SELECT status,total_amount,discount_amount,created_at FROM orders WHERE company_id=? AND created_at>=? AND created_at<?
      ), days AS (${ranges}) SELECT d.day,COUNT(o.created_at) AS orders,
        COALESCE(SUM(CASE WHEN o.status='completed' AND o.total_amount>=0 AND o.discount_amount>=0 THEN o.total_amount+o.discount_amount ELSE 0 END),0) AS gross_revenue,
        SUM(CASE WHEN o.status='completed' AND (o.total_amount IS NULL OR o.total_amount<0 OR o.discount_amount IS NULL OR o.discount_amount<0) THEN 1 ELSE 0 END) AS unknown_values
        FROM days d LEFT JOIN scoped o ON o.created_at>=d.starts AND o.created_at<d.ends GROUP BY d.day ORDER BY d.day`,
      [company,period.from,period.until,...period.days.flatMap(day=>[day.day,day.from,day.until])]);
      const [origins] = await conn.execute(`SELECT CASE WHEN cr.order_id IS NOT NULL
        THEN 'digital_menu' ELSE 'other_records' END AS source,COUNT(*) AS total
        FROM orders o LEFT JOIN (SELECT DISTINCT order_id FROM checkout_requests WHERE company_id=? AND order_id IS NOT NULL) cr ON cr.order_id=o.id
        WHERE o.company_id=? AND o.created_at>=? AND o.created_at<? GROUP BY source`,[company,company,today.from,today.until]);
      const [[reviews]] = await conn.execute(`SELECT COUNT(*) AS total,ROUND(AVG(r.rating),2) AS average
        FROM order_reviews r JOIN orders o ON o.id=r.order_id WHERE o.company_id=? AND r.created_at>=? AND r.created_at<?`,[company,today.from,today.until]);
      const [statuses] = await conn.execute('SELECT status,COUNT(*) AS total FROM orders WHERE company_id=? GROUP BY status',[company]);
      const [latest] = await conn.execute(`SELECT o.id,o.customer_name,o.status,o.fulfillment_method,o.total_amount,o.created_at,
        (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
        FROM orders o WHERE o.company_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 8`,[company]);
      await conn.commit();
      const series = daily.map(row=>({...row,orders:Number(row.orders),unknown_values:Number(row.unknown_values||0)}));
      const queue = Object.fromEntries(['pending','preparing','ready','delivering'].map(status=>[status,Number(statuses.find(row=>row.status===status)?.total||0)]));
      res.json({company_id:company,timezone:config.timezone,today:end,server_time:new Date().toISOString(),
        operations:availability(config),daily:series,kpis:{orders:series.at(-1).orders,gross_revenue:series.at(-1).gross_revenue,
          unknown_values:series.at(-1).unknown_values,average_minutes:null,review_average:reviews.average,review_count:Number(reviews.total)},
        origins:origins.map(row=>({source:row.source,total:Number(row.total)})),queue,
        latest:latest.map(row=>({...row,item_count:Number(row.item_count),created_at:utcDate(row.created_at)}))});
    } catch(error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }));

  // Pesquisa rápida restrita à loja e aos perfis que acessam este dashboard.
  app.get('/api/admin/dashboard/search',auth,permitted,asyncRoute(async(req,res)=>{
    const query=req.query.q;
    if(typeof query!=='string'||query.trim().length<2||query.length>80)return res.status(400).json({error:'Digite de 2 a 80 caracteres.'});
    const text=query.trim(),pattern='%'+text.replace(/[=%_]/g,'=$&')+'%',company=req.tenantId;
    const id=Number(text.replace(/^#/,'')),byId=Number.isSafeInteger(id)&&id>0;
    const [orders]=await db.execute(`SELECT id,customer_name,status FROM orders WHERE company_id=? AND (customer_name LIKE ? ESCAPE '='${byId?' OR id=?':''}) ORDER BY id DESC LIMIT 4`,[company,pattern,...(byId?[id]:[])]);
    const [products]=await db.execute("SELECT id,name FROM products WHERE company_id=? AND name LIKE ? ESCAPE '=' ORDER BY name,id LIMIT 4",[company,pattern]);
    const [customers]=await db.execute("SELECT id,name FROM customers WHERE company_id=? AND (name LIKE ? ESCAPE '=' OR phone LIKE ? ESCAPE '=') ORDER BY name,id LIMIT 4",[company,pattern,pattern]);
    res.json({company_id:company,results:[
      ...orders.map(row=>({type:'Pedido',label:'#'+row.id+' · '+(row.customer_name||'Cliente'),url:'/admin.html?search='+encodeURIComponent('#'+row.id)+'&status='+(['completed','cancelled'].includes(row.status)?row.status:'active')})),
      ...products.map(row=>({type:'Produto',label:row.name,url:'/catalog.html?produto='+row.id})),
      ...customers.map(row=>({type:'Cliente',label:row.name||'Cliente sem nome',url:'/customers.html?customer='+row.id}))]});
  }));
}
module.exports={installDashboard};
