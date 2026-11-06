const mysql = require('mysql2/promise');
const { createApp } = require('../src/app');
async function check(base) {
  require('../src/jwt').configuration(process.env,{required:true});
  for(const path of ['/api/auth/token','/api/master/auth/token']){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.status!==401)throw new Error('Emissão JWT desprotegida: '+path);}
  for(const [path,method] of [['/api/admin/menu/import-ai','POST'],['/api/admin/menu/confirm-import','POST'],['/api/admin/tenants','GET'],['/api/admin/tenants','POST'],['/api/admin/tenants/1/status','PUT'],['/api/admin/tenants/1/impersonate','POST'],['/api/admin/metrics','GET'],['/api/admin/reports/global-financial','GET'],['/api/tenant/menu/import-ai','POST'],['/api/tenant/menu/confirm-import','POST'],['/api/tenant/menu','GET'],['/api/tenant/menu/categories','POST'],['/api/tenant/menu/products','POST'],['/api/tenant/menu/products/1/availability','PUT'],['/api/tenant/menu/products/1','DELETE'],['/api/tenant/reports/summary','GET'],['/api/tenant/reports/sales-chart','GET'],['/api/tenant/reports/origin-chart','GET']]){const response=await fetch(base+path,{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:'{}'})});const data=await response.json();if(response.status!==401||data.success!==false||data.data!==null||typeof data.message!=='string')throw new Error('API global sem proteção/envelope: '+path);}
  const entry=await fetch(base+'/tenant/dashboard');if(!entry.ok||entry.headers.get('referrer-policy')!=='no-referrer'||!(await entry.text()).includes('Acesso assistido'))throw new Error('Entrada assistida indisponível.');
  for(const asset of ['/menu-theme.css','/catalog-theme.css'])if(!(await fetch(base+asset)).ok)throw new Error('Tema do cardápio indisponível: '+asset);
  for(const asset of ['/master-menu-import.js','/master-menu-import.css'])if(!(await fetch(base+asset)).ok)throw new Error('Asset de importação Master indisponível: '+asset);
  const masterPage=await fetch(base+'/master.html');if(!(await masterPage.text()).includes('data-page="menu-import"'))throw new Error('Navegação de importação Master ausente.');
  const refused=await fetch(base+'/api/auth/impersonation/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'invalid'})});if(refused.status!==401)throw new Error('Troca assistida sem validação JWT.');
  for(const asset of ['/assisted-context.js','/impersonation-entry.js','/apex-tokens.css'])if(!(await fetch(base+asset)).ok)throw new Error('Asset assistido/tema indisponível: '+asset);
  for (const [url, status, marker] of [['/api/master/auth/me',401],['/api/master/overview',401],['/api/master/tenants',401],['/master.html',200,'APEXHUB / PLATAFORMA'],['/master-login.html',200,'Acesso Master'],['/master.css',200,'#FF7F00'],['/master.js',200,'/api/master'],['/master-login.js',200,'/api/master/auth/login'],['/api/health', 200, '"status":"ok"'], ['/api/admin/orders',401], ['/api/admin/orders/board',401], ['/api/admin/orders/events',401], ['/api/admin/operations',401], ['/api/admin/dashboard',401], ['/api/admin/dashboard/search?q=teste',401], ['/dashboard.html?view=1',200,'ApexHub'], ['/dashboard.css',200,'#ff7f00'], ['/dashboard.js',200,'renderPerformance'], ['/api/admin/reviews',401], ['/api/order-review',404], ['/reviews.html?view=1',200,'Avaliações dos clientes'], ['/reviews.js',200,'low_ratings'], ['/order-review.js',200,'orderReviewUI'], ['/api/order-tracking',404], ['/track.html',200,'Acompanhar pedido'], ['/track.js',200,'X-Order-Token'], ['/api/admin/products/1/image',401], ['/product-image.js',200,'productImageEditor'], ['/api/admin/merchandising',401], ['/merchandising.html?view=1',200,'Destaques e sugestões'], ['/merchandising.js',200,'recommendations'], ['/api/admin/team',401], ['/team.html?view=1',200,'Equipe e permissões'], ['/team.js',200,'Criar acesso'], ['/api/admin/reports/sales',401], ['/reports.html?view=1',200,'Relatórios de vendas'], ['/reports.js',200,'Total em pedidos concluídos'], ['/api/admin/drivers',401], ['/api/admin/dispatch',401], ['/drivers.html?view=1',200,'Entregadores e despacho'], ['/drivers.js',200,'Salvar vinculação'], ['/api/admin/customers',401], ['/api/admin/customers/1',401], ['/customers.html?view=1',200,'Clientes e histórico'], ['/customers.js',200,'loadProfile'], ['/api/admin/coupons',401], ['/coupons.html?view=1',200,'Cupons e promoções'], ['/admin.html?view=1',200,'Gestor de pedidos'], ['/kitchen.html?view=1',200,'Cozinha'], ['/orders.js',200,'expected_status'], ['/orders.css',200,'.order-card'], ['/operations.html?view=1',200,'Salvar operação'], ['/addons.html?produto=1&view=1',200,'Salvar adicionais']]) {
    const response = await fetch(base + url);
    if (response.status !== status || (marker && !(await response.text()).includes(marker))) throw new Error('Verificação HTTP falhou: ' + url);
  }
  for(const page of ['dashboard','admin','kitchen','catalog','customers','drivers','coupons','reports','finance','operations','addons','merchandising','reviews','team']) {
    const shell=await fetch(base+'/'+page+'.html');
    if(!shell.ok||shell.headers.get('x-frame-options')!=='SAMEORIGIN'||!(await shell.text()).includes('id="page-view"'))throw new Error('Shell indisponível: '+page);
    const view=await fetch(base+'/'+page+'.html?view=1');
    if(!view.ok||!(await view.text()).includes('/admin-theme.css'))throw new Error('Tema indisponível: '+page);
  }
  for(const asset of ['/app-shell.js','/app-shell.css','/frame-bridge.js','/admin-theme.css','/finance.js']) {
    if(!(await fetch(base+asset)).ok)throw new Error('Asset do shell indisponível: '+asset);
  }
  const menu = await fetch(base + '/api/menu/cachorro-quente-bebella');
  if (!menu.ok) throw new Error('Cardápio da loja publicada indisponível.');
  const body = await menu.json();
  if (!body.merchandising || !Array.isArray(body.merchandising.popular_ids) || !body.operations || !Array.isArray(body.products) || body.products.some(product => !Object.hasOwn(product,'image_url') || !Array.isArray(product.addon_groups))) throw new Error('Cardápio não corresponde à nova versão.');
}
async function main() {
  const mode = process.argv[2];
  if (!['--canary', '--running'].includes(mode)) throw new Error('Modo HTTP inválido.');
  if (mode === '--running') { await check('http://127.0.0.1:3000'); return; }
  const db = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: 'Z' });
  let server;
  try {
    server = await new Promise((resolve, reject) => { const listener = createApp(db, { secureCookies: true }).listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
    await check('http://127.0.0.1:' + server.address().port);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.end(); }
}
main().then(() => console.log('Health, acesso assistido, API Super Admin, tema e cardápio aprovados.')).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
