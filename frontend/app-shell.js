'use strict';
/* App Shell persistente. Cada view conserva seu contexto, formulários e ciclo de vida. */
const $=id=>document.getElementById(id);
const routes={
 '/dashboard.html':{title:'Visão Geral',label:'Dashboard',icon:'grid',manage:true},
 '/admin.html':{title:'Gestão de Pedidos',label:'Gestão de Pedidos',icon:'orders'},
 '/kitchen.html':{title:'Cozinha (KDS)',label:'Cozinha (KDS)',icon:'chef'},
 '/catalog.html':{title:'Cardápio',label:'Cardápio',icon:'menu',manage:true},
 '/customers.html':{title:'Clientes',label:'Clientes',icon:'users',manage:true},
 '/drivers.html':{title:'Entregadores e despacho',label:'Entregadores',icon:'bike'},
 '/coupons.html':{title:'Cupons e promoções',label:'Cupons',icon:'star',manage:true},
 '/reports.html':{title:'Relatórios',label:'Relatórios',icon:'chart',manage:true},
 '/finance.html':{title:'Financeiro',label:'Financeiro',icon:'wallet',manage:true},
 '/operations.html':{title:'Configurações da loja',label:'Configurações',icon:'settings',manage:true},
 '/reviews.html':{title:'Avaliações dos clientes',label:'Avaliações',icon:'star',manage:true},
 '/team.html':{title:'Configurações / Equipe',label:'Equipe e permissões',icon:'users',owner:true},
 '/addons.html':{title:'Cardápio / Adicionais',parent:'/catalog.html',manage:true},
 '/merchandising.html':{title:'Cardápio / Destaques e sugestões',parent:'/catalog.html',manage:true}
};
const state={assisted:null,user:null,current:null,loading:false,stream:null,searchRevision:0,searchTimer:null,routeRevision:0};
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const roleNames={owner:'Proprietário',manager:'Gerente',operator:'Operador'};
function allowed(route){return route&&(!route.manage||['owner','manager'].includes(state.user?.role))&&(!route.owner||state.user?.role==='owner');}
function normalize(value){try{const url=new URL(value,location.origin);if(url.origin!==location.origin||!Object.hasOwn(routes,url.pathname))return null;url.searchParams.delete('view');url.searchParams.delete('_shell');return url;}catch{return null;}}
function fail(message){$('shell-feedback').textContent=message;$('shell-feedback').hidden=!message;}
function expire(){const assisted=Boolean(state.assisted)||Boolean(window.ApexAssisted?.context);state.stream?.close();state.user=null;$('page-view').hidden=true;if(assisted)window.ApexAssisted?.clear();location.replace(assisted?'/master.html':'/login.html');}
async function api(url,options={}){
 const response=await fetch(url,{cache:'no-store',...options});if(response.status===401){expire();throw new Error('Entre novamente.');}
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível consultar.');
 if(data.company_id!==undefined&&Number(data.company_id)!==Number(state.user?.company_id)){expire();throw new Error('A loja da sessão mudou.');}return data;
}
function renderNavigation(){
 const container=$('shell-navigation');container.replaceChildren();
 const heading=document.createElement('p');heading.className='nav-label';heading.textContent='PLATAFORMA';container.append(heading);
 for(const [path,route]of Object.entries(routes)){
  if(route.parent||!allowed(route))continue;
  const link=document.createElement('a');link.href=path;link.dataset.route=path;link.className='nav-link';link.innerHTML=icon(route.icon)+'<span>'+route.label+'</span>';container.append(link);
  if(path==='/admin.html')for(const [status,label]of [['active','Ativos'],['history','Histórico']]){
   const child=document.createElement('a');child.href='/admin.html?status='+status;child.className='nav-link sub-link';child.dataset.orderScope=status;child.textContent=label;container.append(child);
  }
 }
 markActive();
}
function markActive(){
 if(!state.current)return;const route=routes[state.current.pathname],parent=route.parent||state.current.pathname;
 const history=['history','completed','cancelled'].includes(state.current.searchParams.get('status'));
 document.querySelectorAll('#shell-navigation a').forEach(link=>{
  const selected=link.dataset.orderScope ? state.current.pathname==='/admin.html'&&link.dataset.orderScope===(history?'history':'active') : link.dataset.route===parent;
  link.classList.toggle('active',selected);if(selected&&!(link.dataset.route==='/admin.html'&&state.current.pathname==='/admin.html'))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 });
}
function embeddedUrl(url){const embedded=new URL(url.href);embedded.searchParams.set('view','1');embedded.searchParams.set('_shell',String(state.routeRevision));return embedded.pathname+embedded.search+embedded.hash;}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebar-backdrop').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');}
function closeMenus(){
 closeSidebar();$('search-results').hidden=true;$('global-query').setAttribute('aria-expanded','false');clearTimeout(state.searchTimer);++state.searchRevision;
 for(const [menu,button]of [['notifications','notifications-toggle'],['profile-menu','profile-toggle']]){$(menu).hidden=true;$(button).setAttribute('aria-expanded','false');}
}
function navigate(value,{replace=false,history=true}={}){
 if(!state.user)return false;let url=normalize(value);if(!url)return false;
 if(!allowed(routes[url.pathname]))url=new URL('/admin.html',location.origin);
 const relative=url.pathname+url.search+url.hash;
 if(state.current&&state.current.pathname+state.current.search+state.current.hash===relative&&!replace){closeSidebar();return true;}
 state.current=url;++state.routeRevision;fail('');closeMenus();
 $('shell-title').textContent=routes[url.pathname].title;document.title=routes[url.pathname].title+' · ApexHub';
 $('page-view').title=routes[url.pathname].title;$('page-view').hidden=true;$('view-loading').hidden=false;$('view-loading').textContent='Carregando '+routes[url.pathname].title+'…';
 if(history)window.history[replace?'replaceState':'pushState']({},'',relative);
 markActive();
 // replace evita entradas extras no histórico do iframe. Voltar/Avançar pertencem ao shell.
 const frame=$('page-view');const target=embeddedUrl(url);frame.dataset.route=relative;
 if(frame.contentWindow)frame.contentWindow.location.replace(target);else frame.src=target;
 return true;
}
$('page-view').addEventListener('load',()=>{
 if(!state.user||!state.current)return;
 try{
  const child=$('page-view').contentWindow,url=new URL(child.location.href);
  const navigation=url.searchParams.get('_shell');
  if(navigation&&navigation!==String(state.routeRevision))return;
  if(url.pathname==='/login.html'){expire();return;}
  if(url.pathname==='blank'||url.href==='about:blank')return;
  if(!routes[url.pathname]){fail('Não foi possível abrir esta página. Use a navegação lateral.');$('view-loading').hidden=true;return;}
  if(!allowed(routes[url.pathname])){navigate('/admin.html',{replace:true});return;}
  if(child.document.body?.classList.contains('apex-shell')){child.location.replace(embeddedUrl(url));return;}
  const clean=normalize(url.href);
  if(clean&&clean.pathname+clean.search!==state.current.pathname+state.current.search){state.current=clean;window.history.replaceState({},'',clean.pathname+clean.search+clean.hash);$('shell-title').textContent=routes[clean.pathname].title;document.title=routes[clean.pathname].title+' · ApexHub';markActive();}
  $('view-loading').hidden=true;$('page-view').hidden=false;
 }catch{fail('Não foi possível abrir o conteúdo. Atualize a página.');$('view-loading').hidden=true;}
});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==$('page-view').contentWindow||!event.data)return;
 if(event.data.type==='apex:navigate')navigate(event.data.url);
 if(event.data.type==='apex:expired')expire();
 if(event.data.type==='apex:search')$('global-query').focus();
 if(event.data.type==='apex:closemenus')closeMenus();
});
window.addEventListener('popstate',()=>navigate(location.href,{history:false,replace:true}));
document.addEventListener('click',event=>{
 const link=event.target.closest('a[href]');
 if(link?.classList.contains('skip-link')){event.preventDefault();$('main').focus();return;}
 if(link&&!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&link.target!=='_blank'&&normalize(link.href)){event.preventDefault();navigate(link.href);}
 if(!event.target.closest('.global-search')){$('search-results').hidden=true;clearTimeout(state.searchTimer);++state.searchRevision;$('global-query').setAttribute('aria-expanded','false');}
 if(!event.target.closest('.popover-wrap'))for(const [id,button]of [['notifications','notifications-toggle'],['profile-menu','profile-toggle']]){$(id).hidden=true;$(button).setAttribute('aria-expanded','false');}
});
function popover(id,button){const opening=$(id).hidden;for(const [menu,toggle]of [['notifications','notifications-toggle'],['profile-menu','profile-toggle']]){$(menu).hidden=true;$(toggle).setAttribute('aria-expanded','false');}$(id).hidden=!opening;$(button).setAttribute('aria-expanded',String(opening));}
$('notifications-toggle').onclick=()=>popover('notifications','notifications-toggle');$('profile-toggle').onclick=()=>popover('profile-menu','profile-toggle');
$('menu-toggle').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('sidebar-backdrop').hidden=!open;$('menu-toggle').setAttribute('aria-expanded',String(open));};$('sidebar-backdrop').onclick=closeSidebar;
window.addEventListener('resize',()=>{if(window.innerWidth>760)closeSidebar();});
function searchLink(type,label,url){const link=document.createElement('a'),kind=document.createElement('small'),text=document.createElement('span');link.href=url;kind.textContent=type;text.textContent=label;link.append(kind,text);$('search-results').append(link);}
async function search(){
 if(!state.user)return;
 const query=$('global-query').value.trim(),revision=++state.searchRevision;
 if(query.length<2){$('search-results').hidden=!query.length;$('search-results').textContent='Digite pelo menos 2 caracteres.';return;}
 $('search-results').hidden=false;$('global-query').setAttribute('aria-expanded','true');$('search-results').textContent='Buscando…';
 if(state.user.role==='operator'){$('search-results').replaceChildren();searchLink('Pedidos','Buscar nos pedidos ativos','/admin.html?search='+encodeURIComponent(query));searchLink('Histórico','Buscar pedidos encerrados','/admin.html?status=history&search='+encodeURIComponent(query));return;}
 try{const data=await api('/api/admin/dashboard/search?q='+encodeURIComponent(query));if(revision!==state.searchRevision)return;$('search-results').replaceChildren();for(const result of data.results){const url=normalize(result.url);if(url&&allowed(routes[url.pathname]))searchLink(result.type,result.label,url.pathname+url.search);}if(!data.results.length)$('search-results').textContent='Nenhum resultado nesta loja.';}catch(e){if(revision===state.searchRevision)$('search-results').textContent=e.message;}
}
$('global-query').oninput=()=>{clearTimeout(state.searchTimer);++state.searchRevision;state.searchTimer=setTimeout(search,250);};$('search-form').onsubmit=event=>{event.preventDefault();clearTimeout(state.searchTimer);search();};
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')closeMenus();
 if(event.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();$('global-query').focus();}
});
async function refreshNotifications(){if(!state.user||state.loading)return;state.loading=true;try{const data=await api('/api/admin/orders/board?limit=1');const count=data.counts.pending||0;$('notification-dot').hidden=!count;$('notifications-toggle').setAttribute('aria-label',count+' pedidos aguardando aceite');$('notification-text').textContent=count?count+' pedidos aguardam o aceite da equipe.':'Nenhum pedido aguardando aceite.';}catch{}finally{state.loading=false;}}
function connect(){if(!state.user||state.stream||document.hidden||typeof EventSource!=='function')return;const stream=new EventSource('/api/admin/orders/events');state.stream=stream;stream.addEventListener('orders-changed',refreshNotifications);stream.addEventListener('session-ended',expire);}
$('assisted-exit').onclick=async()=>{const button=$('assisted-exit');button.disabled=true;try{await window.ApexAssisted.end();}catch(error){fail(error.message);button.disabled=false;}};
$('logout').onclick=async()=>{if(state.assisted){$('assisted-exit').onclick();return;}try{const response=await fetch('/api/auth/logout',{method:'POST'});if(response.ok||response.status===401)expire();else fail('Não foi possível sair. Tente novamente.');}catch{fail('Não foi possível sair. Tente novamente.');}};
async function initialize(){try{const {user,impersonation}=await api('/api/auth/me');state.user=user;state.assisted=impersonation||null;if(impersonation){document.body.classList.add('assisted-mode');$('assisted-banner').hidden=false;$('assisted-description').textContent=user.company_name+' · '+impersonation.actor.name+' · até '+new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(impersonation.expires_at));const remaining=Date.parse(impersonation.expires_at)-Date.now();if(remaining<=0){expire();return;}setTimeout(expire,remaining);}$('user-name').textContent=state.assisted?state.assisted.actor.name:user.name;$('user-role').textContent=state.assisted?'Master · acesso assistido':roleNames[user.role]||user.role;$('user-email').textContent=state.assisted?state.assisted.actor.email:user.email;$('avatar').textContent=(state.assisted?state.assisted.actor.name:user.name).trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();$('sidebar-store').textContent=user.company_name;$('shell-store-link').href='/?loja='+encodeURIComponent(user.slug);const option=document.createElement('option');option.value=user.company_id;option.textContent=user.company_name;$('store-select').replaceChildren(option);$('team-link').hidden=user.role!=='owner';if(user.role==='operator')$('profile-menu').querySelector('a[href="/operations.html"]').hidden=true;renderNavigation();navigate(normalize(location.href)?location.href:(user.role==='operator'?'/admin.html':'/dashboard.html'),{replace:true});refreshNotifications();connect();setInterval(()=>{if(!document.hidden)refreshNotifications();},30000);}catch(e){fail(e.message);$('view-loading').textContent='Não foi possível abrir o painel. Atualize para tentar novamente.';}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){state.stream?.close();state.stream=null;}else{refreshNotifications();connect();}});window.addEventListener('pagehide',()=>{state.stream?.close();state.stream=null;});window.addEventListener('pageshow',event=>{if(event.persisted){refreshNotifications();connect();}});
initialize();
