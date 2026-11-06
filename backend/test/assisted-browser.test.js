const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../../frontend/assisted-context.js'),'utf8');
function client(value='a'.repeat(64)){
 const storage=new Map(value?[['apex_assisted_context',value]]:[]),requests=[],streams=[],redirects=[];
 const original=async(input,init)=>{requests.push({input,init});return {ok:true,status:200,json:async()=>({})};};
 class Stream{constructor(url){streams.push(url);}}
 const window={fetch:original,EventSource:Stream};
 vm.runInNewContext(code,{window,sessionStorage:{getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)},location:{origin:'https://apex.test',href:'https://apex.test/dashboard.html',replace:url=>redirects.push(url)},URL,Headers});
 return {window,storage,requests,streams,redirects,original};
}
test('browser assistido: aplica nonce somente aos recursos locais, preservando Bearer e sem gravar JWT',async()=>{
 const c=client();await c.window.fetch('/api/admin/orders',{method:'GET'});assert.equal(c.requests[0].init.headers.get('X-Apex-Impersonation'),'a'.repeat(64));await c.window.fetch('/api/auth/me');assert.equal(c.requests[1].init.headers.get('X-Apex-Impersonation'),'a'.repeat(64));await c.window.fetch('/api/admin/catalog',{headers:{Authorization:'Bearer exemplo'}});assert.equal(c.requests[2].init.headers.has('X-Apex-Impersonation'),false);await c.window.fetch('https://external.example/api/admin/orders');assert.equal(c.requests[3].init.headers,undefined);await c.window.fetch('/api/master/auth/me');assert.equal(c.requests[4].init.headers,undefined);new c.window.EventSource('/api/admin/orders/events');assert.ok(c.streams[0].includes('assisted_context='));assert.ok(!c.streams[0].includes('token='));assert.deepEqual([...c.storage.keys()],['apex_assisted_context']);await c.window.ApexAssisted.end();assert.equal(c.storage.size,0);assert.deepEqual(c.redirects,['/master.html#tenants']);
});
test('browser normal: sem nonce não altera fetch, EventSource ou sessão do lojista',()=>{const c=client(null);assert.equal(c.window.fetch,c.original);assert.equal(c.window.ApexAssisted.context,null);new c.window.EventSource('/api/admin/orders/events');assert.equal(c.streams[0],'/api/admin/orders/events');});
function entry({hash='#token=a.b.c',ok=true}={}){
 const calls=[],saved=[],redirects=[],history=[],node={textContent:''};
 const location={pathname:'/tenant/dashboard',hash,replace:url=>redirects.push(url)};
 const context={location,history:{replaceState(...args){history.push(args);}},URLSearchParams,sessionStorage:{setItem(...args){saved.push(args);}},document:{getElementById:()=>node},fetch:async(url,options)=>{assert.equal(history.length,1);calls.push({url,options});return {ok,status:ok?200:401,json:async()=>ok?{success:true,data:{context:'b'.repeat(64),redirect_url:'/dashboard.html'}}:{message:'Link expirado'}};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../frontend/impersonation-entry.js'),'utf8'),context);
 return {calls,saved,redirects,history,node,async done(){for(let i=0;i<20;i++)await Promise.resolve();}};
}
test('entrada assistida: apaga token da URL antes de trocar, armazena só nonce e abre dashboard',async()=>{const p=entry();await p.done();assert.deepEqual(p.history[0],[null,'','/tenant/dashboard']);assert.equal(p.calls[0].url,'/api/auth/impersonation/exchange');assert.equal(JSON.parse(p.calls[0].options.body).token,'a.b.c');assert.deepEqual(p.saved,[['apex_assisted_context','b'.repeat(64)]]);assert.deepEqual(p.redirects,['/dashboard.html']);});
test('entrada assistida: link recusado ou sem fragmento não salva credenciais nem redireciona',async()=>{for(const opts of [{ok:false},{hash:''}]){const p=entry(opts);await p.done();assert.equal(p.saved.length,0);assert.equal(p.redirects.length,0);assert.ok(p.node.textContent);}});
test('tema: Master e telas operacionais compartilham tokens e shell, sem cabeçalho/menu horizontal legado',()=>{for(const name of ['master','app-shell','admin','kitchen','catalog','drivers','coupons']){const html=fs.readFileSync(require.resolve('../../frontend/'+name+'.html'),'utf8');assert.ok(html.includes('/apex-tokens.css'));if(['admin','kitchen','catalog','drivers','coupons'].includes(name)){assert.ok(html.includes('/assisted-context.js'));assert.ok(!/<nav\b/.test(html));assert.ok(!/background\s*:\s*(white|#f4f6fa)\b/.test(html));}}const palette=fs.readFileSync(require.resolve('../../frontend/apex-tokens.css'),'utf8');for(const color of ['#121212','#1E1E1E','#FF7F00','#F5F5F5'])assert.ok(palette.includes(color));});
