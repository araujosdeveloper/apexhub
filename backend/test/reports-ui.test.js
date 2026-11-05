const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page(){const nodes=new Map(),pending=[];const context=vm.createContext({URLSearchParams,Intl,Date,console,location:{replace(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:true,value:'',textContent:'',innerHTML:''});return nodes.get(id);}},fetch:url=>new Promise(resolve=>pending.push({url,resolve}))});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/reports.js'),'utf8'),context);
 return {nodes,pending,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({status,ok:status===200,json:async()=>data});for(let i=0;i<10;i++)await Promise.resolve();}};
}
const result=(total='10.00')=>({company_id:7,start:'2026-11-01',end:'2026-11-02',timezone:'America/Sao_Paulo',server_time:'2026-11-04T12:00:00Z',summary:{orders:1,completed:1,active:0,cancelled:0,total,average_order:total,delivery_fees:'0',discounts:'0'},daily:[{day:'2026-11-01',orders:1,completed:1,active:0,cancelled:0,total}],products:[],payments:[],fulfillment:[]});
test('relatórios UI: somente gestores consultam e datas padrão vêm do servidor',async()=>{
 const denied=page();await denied.answer(0,{user:{company_id:7,role:'operator'}});assert.equal(denied.pending.length,1);assert.equal(denied.nodes.get('app')?.hidden??true,true);
 const p=page();await p.answer(0,{user:{company_id:7,role:'manager'}});await p.answer(1,result());assert.equal(p.nodes.get('start').value,'2026-11-01');assert.equal(p.nodes.get('end').value,'2026-11-02');assert.match(p.nodes.get('timezone').textContent,/America\/Sao_Paulo/);assert.equal(p.nodes.get('results').hidden,false);
});
test('relatórios UI: nomes históricos escapados e avisos de valores incompletos',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});const data=result();data.products=[{product_name:'<img src=x onerror=x>',quantity:2,order_count:1,gross_total:'10'}];data.summary.unknown_values=1;data.summary.incomplete_orders=2;data.summary.unknown_charges=1;
 await p.answer(1,data);assert.match(p.nodes.get('products').innerHTML,/&lt;img/);assert.doesNotMatch(p.nodes.get('products').innerHTML,/<img/);assert.match(p.nodes.get('warnings').textContent,/excluídos da soma/);assert.match(p.nodes.get('warnings').textContent,/sem itens detalhados/);
});
test('relatórios UI: resposta de filtro antigo não substitui consulta recente; falha esconde resultado',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});p.run("load({start:'2026-11-01',end:'2026-11-02'})");await p.answer(2,result('99.00'));await p.answer(1,result('10.00'));assert.match(p.nodes.get('summary').innerHTML,/99,00/);assert.doesNotMatch(p.nodes.get('summary').innerHTML,/10,00/);
 p.run("load({start:'2026-11-01',end:'2026-11-02'})");await p.answer(3,{error:'Falha de consulta'},500);assert.equal(p.nodes.get('results').hidden,true);assert.equal(p.nodes.get('message').textContent,'Falha de consulta');
});
test('relatórios UI: loja divergente oculta relatório e gráfico vazio mantém números claros',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,{...result(),company_id:8});assert.equal(p.nodes.get('app').hidden,true);assert.match(p.nodes.get('message').textContent,/sessão mudou/);
 const empty=page();await empty.answer(0,{user:{company_id:7,role:'owner'}});const data=result('0.00');data.summary.average_order=null;await empty.answer(1,data);assert.match(empty.nodes.get('summary').innerHTML,/Indisponível/);assert.doesNotMatch(empty.nodes.get('chart').innerHTML,/NaN|Infinity/);
});
