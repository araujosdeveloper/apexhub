const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page() {
 const nodes=new Map(),pending=[],events=new Map(),sources=[];
 function node(id) {
  if(!nodes.has(id)) {
   const classes=new Set();
   nodes.set(id,{hidden:true,value:'',textContent:'',innerHTML:'',children:[],style:{},dataset:{},classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},toggle(name,force){const add=force??!classes.has(name);if(add)classes.add(name);else classes.delete(name);return add;},contains:name=>classes.has(name)},setAttribute(key,value){this[key]=value;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},focus(){}});
  }return nodes.get(id);
 }
 const chartButtons=['revenue','orders'].map(metric=>{const button=node('chart-'+metric);button.dataset.chart=metric;return button;});
 class Source {constructor(){this.listeners={};sources.push(this);}addEventListener(type,callback){this.listeners[type]=callback;}close(){this.closed=true;}}
 const context=vm.createContext({URLSearchParams,Date,Intl,console,EventSource:Source,setInterval(){return 1;},setTimeout(){return 2;},clearTimeout(){},document:{hidden:false,body:{style:{}},getElementById:node,createElement:tag=>node('created-'+Math.random()),querySelectorAll:selector=>selector==='[data-chart]'?chartButtons:[],addEventListener(type,callback){events.set(type,callback);}},window:{innerWidth:1400,addEventListener(){}},location:{replace(url){node('redirect').value=url;}},fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
 vm.runInContext(fs.readFileSync(require.resolve('../../frontend/dashboard.js'),'utf8'),context);
 return {nodes,node,pending,events,sources,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({status,ok:status<300,json:async()=>data});for(let i=0;i<12;i++)await Promise.resolve();}};
}
const user={id:1,company_id:7,role:'owner',name:'Ana Souza',email:'ana@example.com',company_name:'Loja Apex',slug:'loja-apex'};
const data=()=>({company_id:7,timezone:'America/Sao_Paulo',today:'2026-11-04',server_time:'2026-11-04T12:00:00Z',operations:{is_open:true,status_message:'Aberto'},kpis:{orders:2,gross_revenue:'50.00',unknown_values:0,average_minutes:null,review_average:'4.5',review_count:2},daily:Array.from({length:7},(_,i)=>({day:'2026-11-0'+(i+1),orders:i,gross_revenue:String(i*10),unknown_values:0})),origins:[{source:'digital_menu',total:2}],queue:{pending:1,preparing:1,ready:0,delivering:0},latest:[{id:12,customer_name:'<img src=x>',status:'completed',fulfillment_method:'delivery',total_amount:'50.00',item_count:2}]});
test('Apex Delivery UI: KPIs reais, tempo sem dado, SVG acessível e nomes escapados',async()=>{
 const p=page();await p.answer(0,{user});await p.answer(1,data());assert.equal(p.node('kpi-orders').textContent,'2');assert.match(p.node('kpi-revenue').textContent,/50,00/);assert.match(p.node('kpi-time').innerHTML,/—/);assert.equal(p.node('avatar').textContent,'AS');assert.match(p.node('latest-orders').innerHTML,/&lt;img/);assert.doesNotMatch(p.node('latest-orders').innerHTML,/<img/);assert.match(p.node('latest-orders').innerHTML,/status=completed/);assert.match(p.node('performance-chart').innerHTML,/<svg/);assert.match(p.node('performance-chart')['aria-label'],/sete dias/);assert.match(p.node('origin-donut').style.background,/conic-gradient/);assert.equal(p.sources.length,1);
});
test('Apex Delivery UI: troca de gráfico e atualização por evento preservam a consulta autenticada',async()=>{
 const p=page();await p.answer(0,{user});await p.answer(1,data());p.node('chart-orders').onclick();assert.match(p.node('weekly-value').textContent,/pedidos/);p.sources[0].listeners['orders-changed']();assert.equal(p.pending[2].url,'/api/admin/dashboard');await p.answer(2,data());p.sources[0].listeners['session-ended']();assert.equal(p.node('redirect').value,'/login.html');assert.equal(p.node('main').hidden,true);assert.equal(p.sources[0].closed,true);
});
test('Apex Delivery UI: operador segue para gestor e sessão de outra loja oculta dados',async()=>{
 const denied=page();await denied.answer(0,{user:{...user,role:'operator'}});assert.equal(denied.pending.length,1);assert.equal(denied.node('redirect').value,'/admin.html');const p=page();await p.answer(0,{user});await p.answer(1,{...data(),company_id:8});assert.equal(p.node('main').hidden,true);assert.equal(p.node('redirect').value,'/login.html');
});
test('Apex Delivery UI: busca descarta resposta antiga e renderiza nomes como texto',async()=>{
 const p=page();await p.answer(0,{user});await p.answer(1,data());p.node('global-query').value='Ana';p.run('search()');p.node('global-query').value='Combo';p.run('search()');await p.answer(3,{company_id:7,results:[{type:'Produto',label:'<script>Combo</script>',url:'/catalog.html?produto=1'}]});await p.answer(2,{company_id:7,results:[]});const result=p.node('search-results').children[0];assert.equal(result.children[1].textContent,'<script>Combo</script>');assert.equal(result.href,'/catalog.html?produto=1');
});
test('Apex Delivery UI: erro mantém última confirmação explícita; drawer e notificações operam',async()=>{
 const p=page();await p.answer(0,{user});await p.answer(1,data());p.node('refresh').onclick();await p.answer(2,{error:'Falha'},500);assert.match(p.node('feedback').textContent,/última consulta confirmada/);assert.equal(p.node('kpi-orders').textContent,'2');p.node('menu-toggle').onclick();assert.equal(p.node('sidebar-backdrop').hidden,false);p.node('sidebar-backdrop').onclick();assert.equal(p.node('sidebar-backdrop').hidden,true);p.node('notifications-toggle').onclick();assert.equal(p.node('notifications').hidden,false);assert.match(p.node('notification-text').textContent,/1 pedidos/);
});
