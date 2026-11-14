'use strict';
/* Apex Delivery: rendering separado do acesso à API para facilitar evolução e testes. */
const $ = id => document.getElementById(id);
const storeUrl = slug => ['apexdelivery.com.br','www.apexdelivery.com.br'].includes((typeof location.hostname==='string'?location.hostname.toLowerCase():'')) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? `https://${slug}.apexdelivery.com.br/` : '/?loja='+encodeURIComponent(slug);
const statusLabels = {pending:'Novo',preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega',completed:'Concluído',cancelled:'Cancelado'};
const roleLabels = {owner:'Proprietário',manager:'Gerente',operator:'Operador'};
const state = {user:null, data:null, metric:'revenue', loading:false, authenticated:false, searchRevision:0, searchTimer:null, stream:null, queued:false};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const cash = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const shortNumber = value => Number(value).toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1});
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const dateLabel = (day, options={day:'2-digit',month:'short'}) => new Date(day+'T12:00:00Z').toLocaleDateString('pt-BR',{...options,timeZone:'UTC'});

function feedback(message, error=false) {
  $('feedback').textContent=message; $('feedback').hidden=!message; $('feedback').classList.toggle('error',error);
}
function expire() {
  state.authenticated=false; state.stream?.close(); state.stream=null; $('main').hidden=true; $('search-results').hidden=true;
  location.replace('/login.html');
}
async function api(url, options={}) {
  const response=await fetch(url,{cache:'no-store',...options});
  if(response.status===401) { expire(); throw new Error('Entre na sua conta.'); }
  if(response.status===403) { state.authenticated=false; $('main').hidden=true; location.replace('/admin.html'); throw new Error('Seu perfil não permite acessar a visão geral.'); }
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || 'Não foi possível consultar a operação.');
  if(data.company_id!==undefined && Number(data.company_id)!==Number(state.user?.company_id)) {
    expire(); throw new Error('A loja da sessão mudou. Entre novamente.');
  }
  return data;
}

// Os gráficos usam apenas SVG/CSS locais; não carregam bibliotecas de terceiros.
function sparkline(id, values) {
  if(!values.length) { $(id).innerHTML=''; return; }
  const max=Math.max(...values,1), points=values.map((value,index)=>[3+index*82/Math.max(1,values.length-1),25-value/max*21]);
  $(id).innerHTML=`<polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`;
}
function smoothPath(points) {
  return points.map(([x,y],index)=>{
    if(!index) return `M${x},${y}`;
    const [previousX,previousY]=points[index-1],middle=(previousX+x)/2;
    return `C${middle},${previousY} ${middle},${y} ${x},${y}`;
  }).join(' ');
}
function renderPerformance() {
  const series=state.data?.daily || [], revenue=state.metric==='revenue';
  const values=series.map(row=>Number(revenue ? row.gross_revenue : row.orders)), total=values.reduce((sum,value)=>sum+value,0);
  $('weekly-value').textContent=revenue ? cash(total) : total.toLocaleString('pt-BR')+' pedidos';
  $('chart-legend').textContent=revenue?'Receita bruta em pedidos concluídos':'Pedidos recebidos, incluindo cancelados';
  document.querySelectorAll('[data-chart]').forEach(button=>{
    const selected=button.dataset.chart===state.metric;
    button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected));
  });
  if(!series.length) { $('performance-chart').innerHTML=''; return; }
  const maximum=Math.max(...values,1), width=Math.max(220,$('performance-chart').clientWidth||670),top=10,bottom=153,left=45,right=width-10;
  const points=values.map((value,index)=>[left+index*(right-left)/Math.max(1,values.length-1),bottom-value/maximum*(bottom-top)]);
  const path=smoothPath(points);
  const grid=[0,.25,.5,.75,1].map(fraction=>{
    const y=bottom-fraction*(bottom-top),value=maximum*fraction;
    return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#343434" stroke-dasharray="3 5"/><text x="0" y="${y+3}" fill="#a0a0a0" font-size="10">${revenue?'R$ ':''}${shortNumber(value)}</text>`;
  }).join('');
  const dots=points.map(([x,y],index)=>`<circle cx="${x}" cy="${y}" r="4" fill="#ff7f00" stroke="#1e1e1e" stroke-width="2"><title>${escapeHtml(dateLabel(series[index].day)+': '+(revenue?cash(values[index]):values[index]+' pedidos'))}</title></circle>`).join('');
  $('performance-chart').innerHTML=`<svg viewBox="0 0 ${width} 172" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="apex-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff7f00" stop-opacity=".22"/><stop offset="1" stop-color="#ff7f00" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${path} L${right},${bottom} L${left},${bottom} Z" fill="url(#apex-chart-fill)"/><path d="${path}" fill="none" stroke="#ff7f00" stroke-width="2.5"/>${dots}</svg>`;
  $('performance-chart').setAttribute('aria-label',(revenue?'Receita bruta':'Pedidos recebidos')+' nos últimos sete dias: '+(revenue?cash(total):total+' pedidos')+'. Valores diários na tabela abaixo.');
  $('chart-labels').innerHTML=series.map(row=>`<span>${escapeHtml(dateLabel(row.day,{weekday:'short',day:'2-digit'}))}</span>`).join('');
  $('daily-table').innerHTML=series.map(row=>`<tr><td>${escapeHtml(dateLabel(row.day))}</td><td>${row.orders}</td><td>${cash(row.gross_revenue)}</td></tr>`).join('');
}
function renderOrigins(data) {
  const definitions=[{key:'digital_menu',label:'Cardápio digital',color:'#ff7f00'},{key:'other_records',label:'Outros registros',color:'#32d1d4'}];
  const total=data.origins.reduce((sum,row)=>sum+row.total,0); let angle=0;
  const segments=definitions.map(source=>{
    const count=data.origins.find(row=>row.source===source.key)?.total||0;
    const start=angle; angle+=total?count/total*360:0;
    return {...source,count,start,end:angle,percent:total?Math.round(count/total*100):0};
  });
  $('origin-total').textContent=total.toLocaleString('pt-BR');
  $('origin-donut').style.background=total?'conic-gradient('+segments.map(segment=>`${segment.color} ${segment.start}deg ${segment.end}deg`).join(',')+')':'conic-gradient(#343434 0deg 360deg)';
  $('origin-donut').setAttribute('aria-label',segments.map(segment=>segment.label+': '+segment.count+' pedidos').join('. '));
  $('origin-legend').innerHTML=segments.map(segment=>`<div class="origin-row"><span class="legend-dot" style="background:${segment.color}"></span><span class="origin-name">${segment.label}</span><strong>${segment.count}</strong><small>${segment.percent}%</small></div>`).join('');
}
function renderLatest(data) {
  $('latest-orders').innerHTML=data.latest.length?data.latest.map(order=>{
    const status=Object.hasOwn(statusLabels,order.status)?order.status:'pending';
    const orderScope=['completed','cancelled'].includes(status)?status:'active';
    return `<tr><td><a class="order-id" href="/admin.html?search=%23${Number(order.id)}&amp;status=${orderScope}">#${Number(order.id)}</a><span class="order-customer">${escapeHtml(order.customer_name||'Cliente')} · ${order.item_count} itens</span></td><td class="order-method">${order.fulfillment_method==='pickup'?'Retirada':'Delivery'}</td><td class="order-amount">${order.total_amount===null?'Indisponível':cash(order.total_amount)}</td><td><span class="badge ${status}">${statusLabels[status]}</span></td><td><a class="order-open" href="/admin.html?search=%23${Number(order.id)}&amp;status=${orderScope}" aria-label="Abrir pedido ${Number(order.id)}">${icon('arrow')}</a></td></tr>`;
  }).join(''):'<tr><td colspan="5" class="table-empty">Sua próxima venda começa aqui.<br>Os pedidos recebidos aparecerão nesta lista.</td></tr>';
  const stages=[['pending','Novos pedidos','#ff7f00'],['preparing','Em preparo','#32d1d4'],['ready','Prontos','#00e676'],['delivering','Em entrega','#ac91ff']];
  const queueTotal=stages.reduce((sum,[key])=>sum+data.queue[key],0);
  $('queue-total').textContent=queueTotal;
  $('kds-stages').innerHTML=stages.map(([key,label,color])=>`<a class="kds-stage" href="/admin.html?status=${key}"><span class="stage-dot" style="background:${color}"></span><span>${label}</span><strong>${data.queue[key]}</strong>${icon('arrow')}</a>`).join('');
  $('notification-dot').hidden=!data.queue.pending;
  $('notifications-toggle').setAttribute('aria-label',data.queue.pending+' pedidos aguardando aceite');
  $('notification-text').textContent=data.queue.pending ? data.queue.pending+' pedidos aguardam o aceite da sua equipe.' : 'Tudo em dia. Nenhum pedido aguardando aceite.';
}
function render(data) {
  state.data=data;
  $('kpi-orders').textContent=data.kpis.orders.toLocaleString('pt-BR');
  $('kpi-revenue').textContent=cash(data.kpis.gross_revenue);
  $('kpi-revenue').title='Receita bruta: '+cash(data.kpis.gross_revenue)+'. Pedidos concluídos recebidos hoje, incluindo frete e antes dos descontos.';
  $('kpi-rating').innerHTML=(data.kpis.review_average===null?'—':Number(data.kpis.review_average).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}))+'<span class="value-unit"> / 5</span>';
  const measuredTime=data.kpis.average_minutes;
  $('kpi-time').innerHTML=(measuredTime===null||measuredTime===undefined?'—':Number(measuredTime).toLocaleString('pt-BR',{maximumFractionDigits:1}))+'<span class="value-unit"> min</span>';
  $('time-note').textContent=measuredTime===null||measuredTime===undefined?'Tempo real ainda não medido':'Tempo real de atendimento';
  $('time-badge').hidden=measuredTime!==null&&measuredTime!==undefined;
  $('rating-note').textContent=data.kpis.review_count+' avaliações hoje';
  $('today-label').textContent='Hoje, '+dateLabel(data.today);
  $('timezone-label').textContent='Horários de '+data.timezone;
  $('last-sync').textContent='Atualizado às '+new Date(data.server_time).toLocaleTimeString('pt-BR',{timeZone:data.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('live-status').classList.remove('stale'); $('live-status').classList.add('connected');
  $('live-status').classList.toggle('paused',!data.operations.is_open);
  $('live-status').title=data.operations.status_message;
  $('sidebar-status').style.background=data.operations.is_open?'var(--success)':'var(--primary)';
  $('sync-label').textContent=(data.operations.is_open?'Loja aberta':'Loja fechada')+' · Operação atualizada';
  sparkline('orders-spark',data.daily.map(row=>row.orders));
  sparkline('revenue-spark',data.daily.map(row=>Number(row.gross_revenue)));
  renderPerformance(); renderOrigins(data); renderLatest(data);
  const unknown=data.daily.reduce((sum,row)=>sum+row.unknown_values,0);
  feedback(unknown ? 'Há '+unknown+' pedidos concluídos no período com valores antigos incompletos. Eles não entram na receita exibida.' : '');
}
async function load() {
  if(!state.authenticated)return;
  if(state.loading){state.queued=true;return;}
  state.loading=true; $('refresh').disabled=true;
  try { render(await api('/api/admin/dashboard')); }
  catch(error) {
    if(state.authenticated) {
      $('live-status').classList.remove('connected'); $('live-status').classList.add('stale');
      $('sync-label').textContent='Atualização pendente';
      feedback('Não foi possível atualizar. '+(state.data?'Os dados exibidos são da última consulta confirmada.':'Tente novamente em Atualizar.'),true);
    }
  } finally { state.loading=false; $('refresh').disabled=false; if(state.queued&&state.authenticated){state.queued=false;load();} }
}

// Invalidação SSE do gestor existente, com polling de 30 s como fallback.
function connectStream() {
  if(state.stream||!state.authenticated||document.hidden)return;
  if(typeof EventSource!=='function') { $('realtime-label').textContent='30 s'; return; }
  const stream=new EventSource('/api/admin/orders/events'); state.stream=stream;
  stream.addEventListener('connected',()=>{ $('realtime-label').textContent='AO VIVO'; load(); });
  stream.addEventListener('orders-changed',()=>load());
  stream.addEventListener('session-ended',()=>expire());
  stream.onerror=()=>{ $('realtime-label').textContent='30 s'; };
}

// Busca global com debounce e descarte de respostas antigas.
async function search() {
  const query=$('global-query').value.trim(),revision=++state.searchRevision;
  if(query.length<2) { $('search-results').hidden=!query.length; $('search-results').textContent='Digite pelo menos 2 caracteres para pesquisar.'; $('global-query').setAttribute('aria-expanded',String(Boolean(query.length))); return; }
  $('search-results').hidden=false; $('search-results').textContent='Buscando…';
  $('global-query').setAttribute('aria-expanded','true');
  try {
    const data=await api('/api/admin/dashboard/search?q='+encodeURIComponent(query));
    if(revision!==state.searchRevision)return;
    $('search-results').replaceChildren();
    for(const result of data.results) {
      if(typeof result.url!=='string'||!result.url.startsWith('/')||result.url.startsWith('//'))continue;
      const link=document.createElement('a'),type=document.createElement('small'),label=document.createElement('span');
      link.href=result.url; type.textContent=result.type; label.textContent=result.label;
      link.append(type,label); $('search-results').append(link);
    }
    if(!data.results.length) { const empty=document.createElement('p'); empty.textContent='Nenhum resultado nesta loja.'; $('search-results').append(empty); }
  } catch(error) { if(revision===state.searchRevision) $('search-results').textContent=error.message; }
}
function togglePopover(id,buttonId) {
  const wasOpen=!$(id).hidden;
  for(const [menu,button] of [['notifications','notifications-toggle'],['profile-menu','profile-toggle']]) {
    $(menu).hidden=true; $(button).setAttribute('aria-expanded','false');
  }
  $(id).hidden=wasOpen; $(buttonId).setAttribute('aria-expanded',String(!wasOpen));
}
function closeSidebar() {
  $('sidebar').classList.remove('open'); $('sidebar-backdrop').hidden=true;
  $('menu-toggle').setAttribute('aria-expanded','false'); document.body.style.overflow='';
}
$('menu-toggle').onclick=()=>{
  const open=$('sidebar').classList.toggle('open'); $('sidebar-backdrop').hidden=!open;
  $('menu-toggle').setAttribute('aria-expanded',String(open)); document.body.style.overflow=open?'hidden':'';
};
$('sidebar-backdrop').onclick=closeSidebar;
window.addEventListener('resize',()=>{if(window.innerWidth>760)closeSidebar();if(state.data)renderPerformance();});
$('notifications-toggle').onclick=()=>togglePopover('notifications','notifications-toggle');
$('profile-toggle').onclick=()=>togglePopover('profile-menu','profile-toggle');
$('refresh').onclick=()=>load();
$('search-form').onsubmit=event=>{event.preventDefault(); clearTimeout(state.searchTimer); search();};
$('global-query').oninput=()=>{++state.searchRevision; clearTimeout(state.searchTimer);state.searchTimer=setTimeout(search,250);};
document.querySelectorAll('[data-chart]').forEach(button=>{button.onclick=()=>{state.metric=button.dataset.chart;renderPerformance();};});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape') {
    closeSidebar(); $('notifications').hidden=true; $('profile-menu').hidden=true; $('search-results').hidden=true;
    $('global-query').setAttribute('aria-expanded','false');
    $('notifications-toggle').setAttribute('aria-expanded','false'); $('profile-toggle').setAttribute('aria-expanded','false');
    ++state.searchRevision; clearTimeout(state.searchTimer);
  }
  if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('global-query').focus(); }
});
document.addEventListener('click',event=>{
  if(!event.target.closest('.global-search')) { $('search-results').hidden=true; $('global-query').setAttribute('aria-expanded','false'); ++state.searchRevision;clearTimeout(state.searchTimer); }
  if(!event.target.closest('.popover-wrap')) {
    $('notifications').hidden=true; $('profile-menu').hidden=true;
    $('notifications-toggle').setAttribute('aria-expanded','false'); $('profile-toggle').setAttribute('aria-expanded','false');
  }
});
$('logout').onclick=async()=>{
  $('logout').disabled=true;
  try { const response=await fetch('/api/auth/logout',{method:'POST'}); if(response.ok||response.status===401)expire(); else throw new Error(); }
  catch { feedback('Não foi possível sair da conta. Tente novamente.',true); }
  finally { $('logout').disabled=false; }
};
async function initialize() {
  try {
    const {user}=await api('/api/auth/me');
    if(!['owner','manager'].includes(user.role)) { location.replace('/admin.html'); return; }
    state.user=user; state.authenticated=true;
    $('user-name').textContent=user.name; $('user-role').textContent=roleLabels[user.role]||user.role;
    $('user-email').textContent=user.email; $('avatar').textContent=user.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
    $('sidebar-store').textContent=user.company_name;
    const option=document.createElement('option'); option.value=String(user.company_id); option.textContent=user.company_name;
    $('store-select').replaceChildren(option); $('store-select').title='Estabelecimento vinculado à sua conta';
    $('open-store').href=storeUrl(user.slug); $('team-link').hidden=user.role!=='owner';
    $('greeting').textContent='Olá, '+user.name.trim().split(/\s+/)[0]+'. Aqui está o panorama da sua operação.';
    await load(); connectStream();
    if(state.authenticated) setInterval(()=>{if(!document.hidden)load();},30000);
  } catch(error) { feedback(error.message,true); }
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){state.stream?.close();state.stream=null;$('realtime-label').textContent='EM ESPERA';}else{load();connectStream();}});
window.addEventListener('pagehide',()=>{state.stream?.close();state.stream=null;});
window.addEventListener('pageshow',event=>{if(event.persisted&&state.authenticated){load();connectStream();}});
initialize();
