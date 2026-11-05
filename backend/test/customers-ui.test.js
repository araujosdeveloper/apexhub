const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function page() {
 const nodes=new Map(),pending=[];
 const node=()=>({hidden:true,value:'',textContent:'',innerHTML:'',children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);},scrollIntoView(){}});
 const context=vm.createContext({URLSearchParams,Intl,Date,console,location:{replace(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},fetch:url=>new Promise(resolve=>pending.push({url,resolve}))});
 vm.runInContext(fs.readFileSync(require.resolve('../../frontend/customers.js'),'utf8'),context);
 const run=code=>vm.runInContext(code,context);
 const answer=async(index,data,status=200)=>{pending[index].resolve({status,ok:status===200,json:async()=>data});for(let i=0;i<8;i++)await Promise.resolve();};
 return {nodes,pending,run,answer};
}
const summary={contacts:0,repeat_contacts:0,inactive30:0,total_spent:'0',unknown_value_orders:0};
const list=(name)=>({company_id:7,total:1,summary,customers:[{id:1,name,phone:'11999990000',purchase_count:1,active_orders:0,cancelled_orders:0,total_spent:'10.00',last_purchase_at:null}]});
test('clientes UI: respostas antigas de filtros não substituem a busca atual e nomes são escapados',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});p.run('load()');await p.answer(2,list('<img src=x onerror=alert(1)>'));await p.answer(1,list('Antigo'));
 assert.match(p.nodes.get('rows').children[0].innerHTML,/&lt;img/);assert.doesNotMatch(p.nodes.get('rows').children[0].innerHTML,/<img|Antigo/);
});
test('clientes UI: histórico fechado não reabre quando chega resposta atrasada',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,list('Ana'));p.run('selected=1; loadProfile()');p.nodes.get('close-profile').onclick();
 await p.answer(2,{company_id:7,customer:{name:'Ana'},orders:[],favorites:[],total:0});assert.equal(p.nodes.get('profile').hidden,true);
});
test('clientes UI: troca de loja ou perfil operador mantém dados ocultos',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,{...list('Outra loja'),company_id:8});assert.equal(p.nodes.get('content').hidden,true);assert.match(p.nodes.get('message').textContent,/sessão mudou/);
 const denied=page();await denied.answer(0,{user:{company_id:7,role:'operator'}});assert.equal(denied.pending.length,1);assert.equal(denied.nodes.get('content')?.hidden ?? true,true);
});
test('clientes UI: histórico usa nomes de adicionais e escapa observações',async()=>{
 const p=page();const html=p.run(`orderHtml({id:1,status:'completed',total_amount:'10',delivery_fee:'0',discount_amount:'0',notes:'<script>x</script>',items:[{quantity:1,product_name:'Lanche',total_price:'10',addons_snapshot:[{group_name:'Extras',name:'Queijo',price:'2.50'}]}]})`);
 assert.match(html,/Extras: Queijo/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|group_name/);
 await p.answer(0,{user:{company_id:7,role:'operator'}});
});
