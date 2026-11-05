const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {INTERNAL_PAGES}=require('../src/app-shell');
test('shell: todas as rotas internas retornam a mesma estrutura persistente, sem consultas ou conteúdo privado',async t=>{
 const request=await serve(t,{execute(){throw new Error('HTML não deve consultar dados');}});
 for(const path of INTERNAL_PAGES){const response=await request(path);assert.equal(response.status,200,path);const html=await response.text();assert.match(html,/id="page-view"/);assert.match(html,/src="\/app-shell.js"/);assert.equal(response.headers['x-frame-options'],'SAMEORIGIN');assert.equal(response.headers['content-security-policy'],"frame-ancestors 'self'");assert.equal(response.headers['cache-control'],'no-store');}
});
test('shell: views são isoladas, recebem tema compartilhado e nunca retornam um shell aninhado',async t=>{
 const request=await serve(t,{});
 for(const path of INTERNAL_PAGES){const response=await request(path+'?view=1');assert.equal(response.status,200,path);const html=await response.text();assert.match(html,/\/admin-theme.css/);assert.match(html,/\/frame-bridge.js/);assert.doesNotMatch(html,/id="page-view"/);}
 const iframe=await request('/admin.html',{headers:{'Sec-Fetch-Dest':'iframe'}});assert.doesNotMatch(await iframe.text(),/id="page-view"/);
});
test('shell: páginas públicas continuam independentes e protegidas contra enquadramento externo',async t=>{
 const request=await serve(t,{});for(const path of ['/login.html','/track.html','/']){const response=await request(path);assert.equal(response.status,200);assert.equal(response.headers['x-frame-options'],'DENY');assert.doesNotMatch(await response.text(),/id="page-view"/);}
 const orders=await request('/admin.html?view=1');assert.doesNotMatch(await orders.text(),/<nav aria-label="Navegação do restaurante"/);
});
