const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page(){const nodes=new Map(),pending=[];function node(){return {hidden:true,value:'',checked:true,textContent:'',innerHTML:'',children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);},focus(){},reset(){}};}
 const context=vm.createContext({console,location:{replace(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/team.js'),'utf8'),context);
 return {nodes,pending,run:code=>vm.runInContext(code,context),answer:async(index,data,status=200)=>{pending[index].resolve({status,ok:status<300,json:async()=>data});for(let i=0;i<10;i++)await Promise.resolve();}};
}
const owner={id:1,name:'Dono',email:'dono@example.com',role:'owner',active:true,revision:'a'.repeat(64)};
const staff={id:3,name:'<img src=x>',email:'ana@example.com',role:'operator',active:true,revision:'b'.repeat(64)};
const list={company_id:7,total:2,users:[owner,staff]};
test('equipe UI: gerente e operador não consultam lista; dono protegido e texto escapado',async()=>{
 const denied=page();await denied.answer(0,{user:{company_id:7,role:'manager'}});assert.equal(denied.pending.length,1);assert.equal(denied.nodes.get('content')?.hidden??true,true);
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,list);const rows=p.nodes.get('people').children;assert.equal(rows[0].children[0].textContent,'Conta protegida');assert.match(rows[1].innerHTML,/&lt;img/);assert.doesNotMatch(rows[1].innerHTML,/<img/);
});
test('equipe UI: editar mantém senha em branco sem enviar e usa revisão lida',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,list);p.nodes.get('people').children[1].children[0].children[0].onclick();assert.equal(p.nodes.get('password').required,false);p.nodes.get('password').value='';
 p.nodes.get('team-form').onsubmit({preventDefault(){}});const request=p.pending[2];assert.equal(request.url,'/api/admin/team/3');const body=JSON.parse(request.options.body);assert.equal(body.password,undefined);assert.equal(body.revision,staff.revision);await p.answer(2,{ok:true});assert.equal(p.nodes.get('password').value,'');assert.equal(p.nodes.get('password').required,true);
});
test('equipe UI: falha limpa senha digitada e troca de loja oculta formulário',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});await p.answer(1,list);for(const [id,value]of Object.entries({name:'Ana',email:'ana@example.com',role:'operator',password:'senha-nova-123456'}))p.run(`$('${id}').value=${JSON.stringify(value)}`);
 p.nodes.get('team-form').onsubmit({preventDefault(){}});await p.answer(2,{error:'E-mail indisponível'},409);assert.equal(p.nodes.get('password').value,'');await p.answer(3,{...list,company_id:8});assert.equal(p.nodes.get('content').hidden,true);assert.match(p.nodes.get('message').textContent,/sessão mudou/);
});
test('equipe UI: lista antiga não sobrescreve atualização recente',async()=>{
 const p=page();await p.answer(0,{user:{company_id:7,role:'owner'}});p.run('load()');await p.answer(2,{company_id:7,total:1,users:[{...staff,name:'Atual'}]});await p.answer(1,list);assert.equal(p.nodes.get('people').children.length,1);assert.match(p.nodes.get('people').children[0].innerHTML,/Atual/);
});
