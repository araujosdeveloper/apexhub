const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page(){const nodes=new Map(),pending=[];function node(){return {hidden:true,value:'',checked:true,textContent:'',innerHTML:'',children:[],append(n){this.children.push(n);},replaceChildren(){this.children=[];},setAttribute(){},reset(){},focus(){}};}
 const context=vm.createContext({URLSearchParams,console,location:{replace(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/drivers.js'),'utf8'),context);
 return {nodes,pending,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({status,ok:status<300,json:async()=>data});for(let i=0;i<12;i++)await Promise.resolve();}};
}
const order={id:12,status:'ready',customer_name:'<img src=x>',customer_phone:'11999990000',address_street:'Rua A & B',address_number:'1',address_neighborhood:'Centro',assignment_version:0};
test('despacho UI: rota codifica destino e não cria link quando endereço está vazio',async()=>{
 const p=page();const url=p.run(`routeUrl(${JSON.stringify(order)})`);assert.equal(new URL(url).origin,'https://www.google.com');assert.equal(new URL(url).searchParams.get('destination'),'Rua A & B, 1, Centro');assert.equal(new URL(url).searchParams.get('api'),'1');assert.equal(p.run('routeUrl({})'),null);await p.answer(0,{user:{role:'operator',company_id:7}});
});
test('despacho UI: operador só vincula e cadastro fica oculto; conteúdo escapado',async()=>{
 const p=page();await p.answer(0,{user:{role:'operator',company_id:7}});await p.answer(1,{company_id:7,drivers:[]});await p.answer(2,{company_id:7,orders:[order],total:1});
 assert.equal(p.nodes.get('management').hidden,true);const html=p.nodes.get('deliveries').children[0].innerHTML;assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/noopener noreferrer/);
 p.run(`assign(${JSON.stringify(order)},3)`);const request=p.pending[3];assert.equal(request.url,'/api/admin/dispatch/12');assert.deepEqual(JSON.parse(request.options.body),{driver_id:3,version:0,status:'ready'});await p.answer(3,{ok:true});
});
test('despacho UI: resposta antiga não substitui página atual; em entrega sem botão de vincular',async()=>{
 const p=page();await p.answer(0,{user:{role:'owner',company_id:7}});p.run('load()');await p.answer(3,{company_id:7,drivers:[]});await p.answer(4,{company_id:7,orders:[{...order,status:'delivering'}],total:1});await p.answer(1,{company_id:7,drivers:[]});await p.answer(2,{company_id:7,orders:[],total:0});
 const row=p.nodes.get('deliveries').children[0];assert.match(row.innerHTML,/Em entrega/);assert.equal(row.children.some(n=>n.textContent==='Salvar vinculação'),false);
});
test('despacho UI: respostas de outra loja ocultam informações e erro remove ações antigas',async()=>{
 const p=page();await p.answer(0,{user:{role:'owner',company_id:7}});await p.answer(1,{company_id:7,drivers:[]});await p.answer(2,{company_id:8,orders:[order],total:1});assert.equal(p.nodes.get('content').hidden,true);assert.match(p.nodes.get('message').textContent,/sessão mudou/);
});
