const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page({role='owner',path='/admin.html',assisted=null}={}) {
 const nodes=new Map(),events=new Map(),documentEvents=new Map(),pending=[],historyCalls=[],viewCalls=[];
 function node(id){if(!nodes.has(id)){const classes=new Set(),listeners=new Map();nodes.set(id,{hidden:true,textContent:'',value:'',children:[],dataset:{},style:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,force){const set=force??!classes.has(name);if(set)classes.add(name);else classes.delete(name);return set;}},setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];},replaceChildren(...items){this.children=items;},append(...items){this.children.push(...items);},addEventListener(type,callback){listeners.set(type,callback);},listeners,focus(){this.focused=true;},querySelector(){return node('profile-settings');}});}return nodes.get(id);}
 const frameLocation={href:'about:blank',replace(url){viewCalls.push(url);this.href=new URL(url,'https://apex.test').href;}};
 const contentWindow={location:frameLocation,document:{body:{classList:{contains(){return false;}}}}};node('page-view').contentWindow=contentWindow;
 const location={origin:'https://apex.test',href:'https://apex.test'+path,replace(url){node('redirect').value=url;}};
 const context=vm.createContext({URL,URLSearchParams,console,setInterval(){},setTimeout(){return 1;},clearTimeout(){},location,window:{ApexAssisted:assisted?{context:'a'.repeat(64),clear(){node('cleared').value=true;},async end(){node('ended').value=true;}}:undefined,history:{pushState(state,title,url){historyCalls.push(['push',url]);location.href=new URL(url,location.origin).href;},replaceState(state,title,url){historyCalls.push(['replace',url]);location.href=new URL(url,location.origin).href;}},addEventListener(type,callback){events.set(type,callback);}},document:{body:node('body'),hidden:false,getElementById:node,createElement:tag=>node('created-'+Math.random()),querySelectorAll:selector=>selector==='#shell-navigation a'?node('shell-navigation').children.filter(child=>child.dataset):[],addEventListener(type,callback){documentEvents.set(type,callback);}},fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
 vm.runInContext(fs.readFileSync(require.resolve('../../frontend/app-shell.js'),'utf8'),context);
 const answer=async(index,data,status=200)=>{pending[index].resolve({ok:status<300,status,json:async()=>data});for(let i=0;i<12;i++)await Promise.resolve();};
 const boot=async()=>{await answer(0,{...(assisted?{impersonation:assisted}:{}),user:{id:1,company_id:7,name:'Ana Silva',email:'ana@example.com',role,company_name:'Bebella',slug:'bebella'}});if(!assisted)await answer(1,{subscription:{plan_type:'trial',access_state:'trial',trial_valid:true,features:['ai_menu_import','coupons','automations','kds']}});};
 return {nodes,node,pending,events,documentEvents,historyCalls,viewCalls,contentWindow,answer,boot,run:code=>vm.runInContext(code,context)};
}
test('shell UI: troca módulos conservando os mesmos nós de sidebar/header e usando histórico do contêiner',async()=>{
 const p=page();await p.boot();const navigation=p.node('shell-navigation'),profile=p.node('profile-toggle');assert.match(p.viewCalls[0],/admin.html\?view=1/);assert.equal(p.node('user-name').textContent,'Ana Silva');
 p.run("navigate('/drivers.html')");assert.equal(p.node('shell-navigation'),navigation);assert.equal(p.node('profile-toggle'),profile);assert.equal(p.historyCalls.at(-1)[0],'push');assert.match(p.viewCalls.at(-1),/drivers.html\?view=1/);assert.equal(p.node('shell-title').textContent,'Entregadores e despacho');
 p.node('page-view').listeners.get('load')();assert.equal(p.node('page-view').hidden,false);assert.equal(p.node('view-loading').hidden,true);
});
test('shell UI: voltar usa mesma estrutura e mensagens de origem ou janela erradas não navegam',async()=>{
 const p=page();await p.boot();p.run("navigate('/catalog.html')");const count=p.viewCalls.length;
 p.events.get('message')({origin:'https://evil.test',source:p.contentWindow,data:{type:'apex:navigate',url:'/finance.html'}});assert.equal(p.viewCalls.length,count);
 p.events.get('message')({origin:'https://apex.test',source:{},data:{type:'apex:navigate',url:'/finance.html'}});assert.equal(p.viewCalls.length,count);
 p.events.get('message')({origin:'https://apex.test',source:p.contentWindow,data:{type:'apex:navigate',url:'/reports.html'}});assert.match(p.viewCalls.at(-1),/reports.html/);
 const historySize=p.historyCalls.length;p.run("location.href='https://apex.test/catalog.html'");p.events.get('popstate')();assert.equal(p.historyCalls.length,historySize);assert.equal(p.node('shell-title').textContent,'Cardápio');
 assert.equal(p.run("navigate('https://evil.test/admin.html')"),false);
});
test('shell UI: operador só vê operação e rota financeira não abre conteúdo privado',async()=>{
 const p=page({role:'operator',path:'/finance.html'});await p.boot();assert.match(p.viewCalls[0],/admin.html/);const links=p.node('shell-navigation').children.map(child=>child.href);assert.ok(links.includes('/drivers.html'));assert.equal(links.includes('/finance.html'),false);assert.equal(links.includes('/team.html'),false);assert.equal(p.node('profile-settings').hidden,true);
});
test('shell UI: carregamento antigo não substitui rota atual e expiração do conteúdo encerra sessão',async()=>{
 const p=page();await p.boot();const first=p.viewCalls[0];p.run("navigate('/customers.html')");p.contentWindow.location.href=new URL(first,'https://apex.test').href;p.node('page-view').listeners.get('load')();assert.equal(p.node('view-loading').hidden,false);assert.equal(p.node('shell-title').textContent,'Clientes');
 p.events.get('message')({origin:'https://apex.test',source:p.contentWindow,data:{type:'apex:expired'}});assert.equal(p.node('redirect').value,'/login.html');assert.equal(p.node('page-view').hidden,true);
});

test('shell UI: acesso assistido identifica Master, preserva banner na navegação e encerra sem logout do lojista',async()=>{const p=page({assisted:{active:true,actor:{id:2,name:'Admin Master',email:'master@example.com'},expires_at:new Date(Date.now()+3600000).toISOString()}});await p.boot();assert.equal(p.node('assisted-banner').hidden,false);assert.equal(p.node('user-name').textContent,'Admin Master');assert.equal(p.node('user-role').textContent,'Master · acesso assistido');p.run("navigate('/catalog.html')");assert.equal(p.node('assisted-banner').hidden,false);const calls=p.pending.length;await p.node('logout').onclick();assert.equal(p.node('ended').value,true);assert.equal(p.pending.length,calls);p.run('expire()');assert.equal(p.node('redirect').value,'/master.html');assert.equal(p.node('cleared').value,true);});
