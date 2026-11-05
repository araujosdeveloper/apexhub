const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function page({hash='#'+'a'.repeat(64)}={}){
 const nodes=new Map(),pending=[],timers=new Map();let sequence=0;
 const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',innerHTML:''});return nodes.get(id);},addEventListener(){}};
 const context=vm.createContext({Date,console,document,location:{hash,reload(){}},window:{addEventListener(){}},setInterval:fn=>{timers.set(++sequence,fn);return sequence;},clearInterval:id=>timers.delete(id),fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/track.js'),'utf8'),context);
 return {nodes,pending,timers,document,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({ok:status===200,status,json:async()=>data});for(let i=0;i<10;i++)await Promise.resolve();}};
}
const response=(status='preparing',method='delivery')=>({order:{id:12,status,company_name:'Loja <teste>',fulfillment_method:method,pickup_address:'Rua da Loja, 1',estimated_at:'2026-11-04T13:00:00Z',total_amount:'20.00',delivery_fee:'3.00',discount_amount:'0.00',coupon_code:'',menu_url:'/?loja=loja-a',items:[{product_name:'Lanche <img src=x>',quantity:1,total_price:'17.00',addons_snapshot:[{group_name:'Extras',name:'Queijo'}]}]},server_time:'2026-11-04T12:10:00Z'});
test('acompanhamento UI: fragmento inválido não consulta API; token via header sem aparecer na URL',async()=>{
 const invalid=page({hash:'#12'});assert.equal(invalid.pending.length,0);assert.match(invalid.nodes.get('message').textContent,/inválido/);
 const p=page();assert.equal(p.pending[0].url,'/api/order-tracking');assert.equal(p.pending[0].options.headers['X-Order-Token'],'a'.repeat(64));await p.answer(0,response());assert.equal(p.nodes.get('status').textContent,'Em preparo');assert.match(p.nodes.get('items').innerHTML,/&lt;img/);assert.doesNotMatch(p.nodes.get('items').innerHTML,/<img/);assert.equal(p.nodes.get('company').textContent,'Loja <teste>');
});
test('acompanhamento UI: retirada não mostra etapa de entrega e terminal encerra consultas periódicas',async()=>{
 const p=page();await p.answer(0,response('ready','pickup'));assert.equal(p.nodes.get('status').textContent,'Pronto para retirada');assert.match(p.nodes.get('pickup').textContent,/Rua da Loja/);assert.doesNotMatch(p.nodes.get('steps').innerHTML,/Saiu para entrega/);assert.equal(p.timers.size,1);
 p.nodes.get('refresh').onclick();await p.answer(1,response('completed','pickup'));assert.equal(p.timers.size,0);assert.equal(p.nodes.get('estimate').textContent,'');assert.equal(p.nodes.get('status').textContent,'Pedido concluído');
});
test('acompanhamento UI: falha de atualização sinaliza dados antigos sem confirmar status novo',async()=>{
 const p=page();await p.answer(0,response());const last=p.nodes.get('last-sync').textContent;p.nodes.get('refresh').onclick();await p.answer(1,{error:'Falha'},500);assert.match(p.nodes.get('message').textContent,/última consulta confirmada/);assert.equal(p.nodes.get('last-sync').textContent,last);assert.equal(p.nodes.get('status').textContent,'Em preparo');
});
test('acompanhamento UI: página oculta não consulta, cancelamento não apresenta previsão ou etapas concluídas',async()=>{
 const p=page();await p.answer(0,response());p.document.hidden=true;for(const fn of p.timers.values())fn();assert.equal(p.pending.length,1);p.document.hidden=false;p.nodes.get('refresh').onclick();await p.answer(1,response('cancelled'));assert.equal(p.nodes.get('steps').innerHTML,'');assert.equal(p.nodes.get('estimate').textContent,'');assert.equal(p.timers.size,0);
});
