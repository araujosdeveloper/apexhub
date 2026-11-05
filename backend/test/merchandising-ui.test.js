const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page(){const nodes=new Map(),pending=[];function node(){return {value:'',textContent:'',children:[],checked:false,disabled:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}};}
 const context=vm.createContext({console,location:{replace(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node,createTextNode:text=>({textContent:text})},fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/merchandising.js'),'utf8'),context);
 return {nodes,pending,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({status,ok:status<300,json:async()=>data});for(let i=0;i<10;i++)await Promise.resolve();}};
}
const data=()=>({company_id:7,version:0,config:{popular_enabled:true,suggestions_enabled:true,recommendations:[]},products:Array.from({length:8},(_,i)=>({id:i+1,name:'Produto '+(i+1),active:1,category_active:1}))});
test('vitrine UI: operador não consulta; seleções de acompanhantes ficam no rascunho e respeitam seis',async()=>{
 const denied=page();await denied.answer(0,{user:{company_id:7,role:'operator'}});assert.equal(denied.pending.length,1);
 const p=page();await p.answer(0,{user:{company_id:7,role:'manager'}});await p.answer(1,data());p.nodes.get('source').value='1';p.nodes.get('source').onchange();
 for(let i=0;i<7;i++){const checkbox=p.nodes.get('choices').children[i].children[0];checkbox.checked=true;checkbox.onchange();}assert.equal(p.run('config.recommendations[0].related_ids.length'),6);assert.match(p.nodes.get('message').textContent,/máximo seis/);
 p.nodes.get('source').value='2';p.nodes.get('source').onchange();assert.equal(p.run('config.recommendations[0].related_ids.length'),6);assert.equal(p.pending.length,2);
});
test('vitrine UI: salvar usa versão corrente e conflito mantém recarregar disponível',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,data());p.nodes.get('merch-form').onsubmit({preventDefault(){}});assert.equal(JSON.parse(p.pending[2].options.body).version,0);await p.answer(2,{error:'Outra edição foi salva'},409);assert.equal(p.nodes.get('save').disabled,true);assert.equal(p.nodes.get('fields').disabled,false);
 p.nodes.get('reload').onclick();await p.answer(3,{...data(),version:1});assert.equal(p.nodes.get('save').disabled,false);assert.equal(p.run('version'),1);
});
test('vitrine UI: nomes ficam em texto e troca de loja bloqueia alterações',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});const value=data();value.products[0].name='<img src=x>';value.config.recommendations=[{product_id:1,related_ids:[2]}];await p.answer(1,value);assert.match(p.nodes.get('configured').children[0].textContent,/<img src=x>/);assert.equal(p.nodes.get('configured').children[0].innerHTML,undefined);
 p.nodes.get('reload').onclick();await p.answer(2,{...value,company_id:8});assert.equal(p.nodes.get('fields').disabled,true);assert.match(p.nodes.get('message').textContent,/sessão mudou/);
});
