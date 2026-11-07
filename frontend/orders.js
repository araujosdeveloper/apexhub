'use strict';
const $ = id => document.getElementById(id);
const kitchen = document.body.dataset.view === 'kitchen';
const labels = { pending: 'Novos', preparing: 'Em preparo', ready: 'Prontos', delivering: 'Em entrega', completed: 'Concluídos', cancelled: 'Cancelados' };
const actionLabels = { preparing: 'Aceitar e preparar', ready: 'Marcar pronto', delivering: 'Saiu para entrega', completed: 'Concluir pedido', cancelled: 'Cancelar' };
const state = { authenticated: false, initializing: false, started: false, orders: [], counts: {}, offset: 0, limit: 60, total: 0,
  revision: 0, loading: false, queued: false, stale: true, updating: new Set(), stream: null, streamLive: false,
  latestPending: null, soundEnabled: false, audio: null, clockOffset: 0, fingerprint: '', user: null };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function selections() {
  const status = $('status-filter').value;
  return { scope: kitchen ? 'kitchen' : ['history','completed','cancelled'].includes(status) ? 'history' : 'active', status: ['active','history'].includes(status) ? 'all' : status,
    fulfillment: $('fulfillment-filter').value, search: $('search').value.trim(), offset: String(state.offset), limit: String(state.limit) };
}
function shownStatuses() {
  const selection = selections();
  return selection.status !== 'all' ? [selection.status] : selection.scope === 'history' ? ['completed','cancelled'] : kitchen ? ['pending','preparing','ready'] : ['pending','preparing','ready','delivering'];
}
function allowedActions(order) {
  if (!(order.items || []).length) return !kitchen && ['pending','preparing','ready','delivering'].includes(order.status) ? ['cancelled'] : [];
  if (kitchen) return order.status === 'pending' ? ['preparing'] : order.status === 'preparing' ? ['ready'] : [];
  return ({ pending: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: [order.fulfillment_method === 'pickup' ? 'completed' : 'delivering','cancelled'], delivering: ['completed','cancelled'] })[order.status] || [];
}
function addons(snapshot) {
  try { const value = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot; return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function itemsHtml(order, prices = !kitchen) {
  const items = order.items || [];
  if (!items.length) return '<p class="notice error">Pedido antigo sem itens registrados. Confirme com o responsável antes de produzir.</p>';
  return '<ul class="items">' + items.map(item => `<li><span class="quantity">${Number(item.quantity)}×</span> ${escapeHtml(item.product_name)}${prices ? ' <span class="muted">· ' + money(item.total_price ?? item.unit_price * item.quantity) + '</span>' : ''}${addons(item.addons_snapshot).length ? '<ul class="addon-list">' + addons(item.addons_snapshot).map(option => `<li>+ ${escapeHtml(option.group_name)}: ${(option.quantity || 1) > 1 ? Number(option.quantity) + '× ' : ''}${escapeHtml(option.name)}${prices && Number(option.price) ? ' · ' + money(option.price) + ' por adicional' : ''}</li>`).join('') + '</ul>' : ''}${item.item_notes ? '<p class="notes">Observação: ' + escapeHtml(item.item_notes) + '</p>' : ''}</li>`).join('') + '</ul>';
}
function timing(order, now = Date.now() + state.clockOffset) {
  const received = Date.parse(order.created_at);
  if (!Number.isFinite(received)) return { text: 'Horário de recebimento indisponível', overdue: false };
  if (['completed','cancelled'].includes(order.status)) return { text: 'Recebido em ' + new Date(received).toLocaleString('pt-BR'), overdue: false };
  const minutes = Math.max(0, Math.floor((now - received) / 60000));
  const age = minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'min';
  const estimate = Number(order.estimated_minutes);
  const overdue = estimate > 0 && minutes >= estimate;
  return { overdue, text: 'Recebido há ' + age + (estimate > 0 ? ' · Previsão do pedido: ' + estimate + ' min' + (overdue ? ' · Prazo ultrapassado' : '') : ' · Sem previsão definida') };
}
function address(order) {
  return order.fulfillment_method === 'pickup' ? order.fulfillment_address : [order.address_street, order.address_number, order.address_neighborhood].filter(Boolean).join(', ');
}
function card(order) {
  const status = Object.hasOwn(labels, order.status) ? order.status : 'pending';
  const timer = timing(order), disabled = state.stale || state.updating.has(order.id);
  return `<article class="order-card ${status}${timer.overdue ? ' overdue' : ''}" data-order="${Number(order.id)}"><div class="card-header"><p class="order-number">#${Number(order.id)}</p><span class="order-type ${order.fulfillment_method === 'pickup' ? 'pickup' : ''}">${order.fulfillment_method === 'pickup' ? 'Retirada' : 'Delivery'}</span></div><div class="card-body"><p class="customer">${escapeHtml(order.customer_name)}</p><p class="timer" data-timer="${Number(order.id)}">${escapeHtml(timer.text)}</p>${itemsHtml(order)}${order.notes ? '<p class="notes">' + escapeHtml(order.notes) + '</p>' : ''}${!kitchen ? '<p class="muted">' + escapeHtml(order.customer_phone) + '<br>' + escapeHtml(address(order)) + (order.driver_name ? '<br>Entregador: ' + escapeHtml(order.driver_name) + ' · ' + escapeHtml(order.driver_phone) : '') + '</p><p class="payment">' + escapeHtml(order.payment_method) + ' · Frete: ' + money(order.delivery_fee) + (order.coupon_code ? '<br>Cupom ' + escapeHtml(order.coupon_code) + ': − ' + money(order.discount_amount) : '') + '<strong>Total: ' + money(order.total_amount) + '</strong></p>' : ''}${order.snapshot_source === 'legacy_customer_record' ? '<p class="muted">Histórico migrado; endereço recuperado do cadastro disponível na migração.</p>' : ''}</div><div class="card-actions">${allowedActions(order).map(next => `<button type="button" data-action="status" data-order-id="${Number(order.id)}" data-next="${next}"${disabled ? ' disabled' : ''}${next === 'cancelled' ? ' class="cancel"' : ''}>${state.updating.has(order.id) ? 'Aguarde…' : actionLabels[next]}</button>`).join('')}${!kitchen ? (typeof order.tracking_url === 'string' && /^\/track\.html#[a-f0-9]{64}$/.test(order.tracking_url) ? '<a href="'+escapeHtml(order.tracking_url)+'" target="_blank" rel="noopener noreferrer">Acompanhamento ↗</a>' : '<button type="button" data-action="tracking" data-order-id="'+Number(order.id)+'"'+(disabled?' disabled':'')+'>Gerar link de acompanhamento</button>') : ''}<button type="button" class="print" data-action="print" data-order-id="${Number(order.id)}">Imprimir</button></div></article>`;
}
const rowStatusLabels={pending:'Novo',preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega',completed:'Concluído',cancelled:'Cancelado'};
let orderLayout='list';
const expandedOrders=new Set();
function orderTable(orders) {
  if(!orders.length)return '<p class="empty">Nenhum pedido para os filtros selecionados.</p>';
  return '<table class="order-list-table"><thead><tr><th>Pedido / Cliente</th><th>Modalidade</th><th>Itens</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>'+orders.map(order=>{
    const disabled=state.stale||state.updating.has(order.id),expanded=expandedOrders.has(order.id),next=allowedActions(order).find(action=>action!=='cancelled');
    const status=Object.hasOwn(labels,order.status)?order.status:'pending';
    const count=(order.items||[]).reduce((sum,item)=>sum+Number(item.quantity),0);
    return `<tr><td><strong>#${Number(order.id)}</strong><small>${escapeHtml(order.customer_name)}</small></td><td>${order.fulfillment_method==='pickup'?'Retirada':'Delivery'}</td><td>${count||'Sem detalhe'}</td><td>${order.total_amount===null?'Indisponível':money(order.total_amount)}</td><td><span class="order-status ${status}">${rowStatusLabels[status]}</span></td><td><div class="order-list-actions">${next?'<button type="button" data-action="status" data-order-id="'+Number(order.id)+'" data-next="'+next+'"'+(disabled?' disabled':'')+'>'+actionLabels[next]+'</button>':''}<button class="secondary" type="button" data-action="details" data-order-id="${Number(order.id)}" aria-expanded="${expanded}">${expanded?'Fechar':'Detalhes'}</button></div></td></tr><tr class="order-detail-row"${expanded?'':' hidden'}><td colspan="6">${card(order)}</td></tr>`;
  }).join('')+'</tbody></table>';
}
function render() {
  const statuses = shownStatuses();
  const fingerprint = JSON.stringify([state.orders, statuses, state.stale, [...state.updating],orderLayout,[...expandedOrders]]);
  if (fingerprint !== state.fingerprint) {
    $('orders-board').className = !kitchen&&orderLayout==='list'?'board orders-list':'board columns-' + statuses.length;
    $('orders-board').innerHTML = !kitchen&&orderLayout==='list'?orderTable(state.orders):statuses.map(status => {
      const orders = state.orders.filter(order => order.status === status);
      return `<section class="stage"><h3 class="stage-heading">${labels[status]} <span>${orders.length} nesta página</span></h3>${orders.map(card).join('') || '<p class="empty">Nenhum pedido nesta etapa e página.</p>'}</section>`;
    }).join('');
    state.fingerprint = fingerprint;
  }
  $('result-summary').textContent = state.total ? `Pedidos ${state.offset + 1}–${Math.min(state.offset + state.orders.length, state.total)} de ${state.total}` : 'Nenhum pedido para os filtros selecionados.';
  $('order-note').textContent = selections().scope === 'history' ? 'Histórico mais recente primeiro' : 'Pedidos ativos mais antigos primeiro';
  $('previous').disabled = state.offset === 0;
  $('next').disabled = state.offset + state.limit >= state.total;
  $('page-label').textContent = `Página ${Math.floor(state.offset / state.limit) + 1} de ${Math.max(1, Math.ceil(state.total / state.limit))}`;
  for (const status of ['pending','preparing','ready','delivering']) $('count-' + status).textContent = state.counts[status] || 0;
  refreshTimers();
}
function refreshTimers() {
  for (const order of state.orders) {
    const node = document.querySelector('[data-timer="' + Number(order.id) + '"]');
    if (!node) continue;
    const timer = timing(order); node.textContent = timer.text;
    node.closest('.order-card')?.classList.toggle('overdue', timer.overdue);
  }
}
function connectionLabel() {
  $('connection').textContent = state.stale ? 'Sem atualização confirmada' : state.streamLive ? '● Ao vivo' : 'Atualização automática · 10s';
  $('connection').className = 'connection ' + (state.stale ? 'offline' : state.streamLive ? 'live' : '');
}
function feedback(message, error = false) {
  const node = $(error ? 'error' : 'feedback'); node.textContent = message; node.hidden = !message;
}
function beep() {
  if (!state.soundEnabled || !state.audio) return;
  try {
    const oscillator = state.audio.createOscillator(), gain = state.audio.createGain();
    oscillator.frequency.value = 740; gain.gain.value = 0.12;
    oscillator.connect(gain); gain.connect(state.audio.destination);
    oscillator.start(); oscillator.stop(state.audio.currentTime + 0.25);
  } catch { feedback('O navegador não conseguiu reproduzir o alerta.'); }
}
async function toggleSound() {
  if (state.soundEnabled) state.soundEnabled = false;
  else {
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error(); state.audio ||= new Audio(); await state.audio.resume(); state.soundEnabled = true; beep(); }
    catch { feedback('Som indisponível neste navegador. Os novos pedidos continuam aparecendo na tela.'); return; }
  }
  $('sound').textContent = state.soundEnabled ? 'Som ativado' : 'Ativar som'; $('sound').setAttribute('aria-pressed', String(state.soundEnabled));
}
function stop() {
  state.authenticated = false; state.started = false; state.streamLive = false;
  state.stream?.close(); state.stream = null;
  clearInterval(state.pollTimer); clearInterval(state.ageTimer); clearTimeout(state.reconnectTimer); clearTimeout(state.eventTimer); clearTimeout(state.searchTimer);
}
function expired() { stop(); location.replace('/login.html'); }
function connectStream() {
  if (!state.authenticated || state.stream || document.hidden || typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/admin/orders/events'); state.stream = source;
  source.onopen = () => { if (!state.authenticated || state.stream !== source) return; state.streamLive = true; connectionLabel(); loadOrders(); };
  source.addEventListener('orders-changed', () => { clearTimeout(state.eventTimer); state.eventTimer = setTimeout(loadOrders, 150); });
  source.addEventListener('session-ended', expired);
  source.onerror = () => {
    source.close(); if (state.stream !== source) return;
    state.stream = null; state.streamLive = false; connectionLabel();
    clearTimeout(state.reconnectTimer); state.reconnectTimer = setTimeout(connectStream, 5000);
  };
}
async function loadOrders() {
  if (!state.authenticated) return;
  if (state.loading) { state.queued = true; return; }
  state.loading = true; const revision = state.revision;
  $('orders-board').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/admin/orders/board?' + new URLSearchParams(selections()));
    if (response.status === 401) { expired(); return; }
    if (!response.ok) throw new Error('Não foi possível atualizar os pedidos. Tentaremos novamente automaticamente.');
    const data = await response.json();
    if (!state.authenticated) return;
    if (data.company_id !== undefined && data.company_id !== state.user?.company_id) { expired(); return; }
    if (revision !== state.revision) { state.queued = true; return; }
    if (!Array.isArray(data.orders) || !data.counts) throw new Error('Resposta de pedidos inválida.');
    if (data.total > 0 && state.offset >= data.total) { state.offset = Math.floor((data.total - 1) / state.limit) * state.limit; state.revision++; state.queued = true; return; }
    state.orders = data.orders; state.counts = data.counts; state.total = data.total;
    const serverTime = Date.parse(data.server_time); if (Number.isFinite(serverTime)) state.clockOffset = serverTime - Date.now();
    if (state.latestPending !== null && data.latest_pending_id > state.latestPending) { $('new-orders').hidden = false; beep(); }
    state.latestPending = Math.max(state.latestPending || 0, data.latest_pending_id || 0);
    state.stale = false; feedback('', true); $('last-sync').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
    render(); connectionLabel();
  } catch (error) {
    if (revision === state.revision && state.authenticated) { state.stale = true; feedback(error.message, true); render(); connectionLabel(); }
  } finally {
    state.loading = false; $('orders-board').setAttribute('aria-busy', 'false');
    if (state.queued && state.authenticated) { state.queued = false; loadOrders(); }
  }
}
function changeFilter(reset = true) {
  if (reset) state.offset = 0;
  state.revision++; state.orders = []; state.total = 0; state.fingerprint = ''; render(); loadOrders();
}
async function updateStatus(id, next) {
  const order = state.orders.find(item => item.id === id);
  if (!order || state.stale || state.updating.has(id) || !allowedActions(order).includes(next)) return;
  if (next === 'cancelled' && !confirm('Cancelar o pedido #' + id + '?')) return;
  state.updating.add(id); render();
  try {
    const response = await fetch('/api/admin/orders/' + id + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next, expected_status: order.status }) }).catch(() => { throw new Error('Não foi possível confirmar a alteração. Confira o pedido antes de tentar novamente.'); });
    if (response.status === 401) { expired(); return; }
    const result = await response.json().catch(() => ({ error: 'Não foi possível confirmar a alteração. Atualize os pedidos.' }));
    if (!response.ok || result.success !== true) throw new Error(result.error || 'Não foi possível confirmar a alteração. Atualize os pedidos.');
    order.status = next; feedback('Pedido #' + id + ' atualizado.');
  } catch (error) { feedback(error.message); }
  finally { state.revision++; state.updating.delete(id); state.fingerprint = ''; render(); loadOrders(); }
}
async function createTrackingLink(id) {
 if(state.stale||state.updating.has(id))return;state.updating.add(id);state.fingerprint='';render();
 try{const response=await fetch('/api/admin/orders/'+id+'/tracking',{method:'POST'});if(response.status===401){expired();return;}const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível gerar o link.');const order=state.orders.find(order=>order.id===id);if(order)order.tracking_url=data.tracking_url;feedback('Link disponível no botão Acompanhamento do pedido.');}
 catch(e){feedback(e.message,true);}finally{state.updating.delete(id);state.fingerprint='';render();}
}
function printOrder(id) {
  const order = state.orders.find(item => item.id === id); if (!order) return;
  const ticket = $('print-ticket');
  ticket.innerHTML = `<h1>${escapeHtml(state.user?.company_name)}</h1><h2>Pedido #${Number(order.id)} · ${kitchen ? 'Cozinha' : 'Entrega / retirada'}</h2><p>${order.fulfillment_method === 'pickup' ? 'RETIRADA NO BALCÃO' : 'DELIVERY'}</p><p>${escapeHtml(order.customer_name)}</p>${itemsHtml(order, !kitchen)}${order.notes ? '<p class="notes">' + escapeHtml(order.notes) + '</p>' : ''}${!kitchen ? '<p>' + escapeHtml(order.customer_phone) + '<br>' + escapeHtml(address(order)) + (order.driver_name ? '<br>Entregador: ' + escapeHtml(order.driver_name) + ' · ' + escapeHtml(order.driver_phone) : '') + '</p><p>' + escapeHtml(order.payment_method) + ' · Frete: ' + money(order.delivery_fee) + (order.coupon_code ? '<br>Cupom ' + escapeHtml(order.coupon_code) + ': − ' + money(order.discount_amount) : '') + '<br><strong>Total: ' + money(order.total_amount) + '</strong></p>' : ''}<p class="print-footer">Recebido: ${escapeHtml(new Date(order.created_at).toLocaleString('pt-BR'))}</p>`;
  window.print();
}
async function initialize() {
  if (state.initializing) return;
  state.initializing = true;
  try {
    const response = await fetch('/api/auth/me');
    if (response.status === 401) { expired(); return; }
    if (!response.ok) throw new Error('Não foi possível validar a sessão. Clique em Atualizar.');
    const { user } = await response.json(); state.user = user; state.authenticated = true;
    $('company-name').textContent = user.company_name; $('store-link').href = '/?loja=' + encodeURIComponent(user.slug);
    document.querySelectorAll('.manage-only').forEach(node => { node.hidden = !['owner','manager'].includes(user.role); });
    document.querySelectorAll('.owner-only').forEach(node => { node.hidden = user.role !== 'owner'; });
    const initialQuery=new URLSearchParams(location.search);
    if(!state.started){const search=initialQuery.get('search'),status=initialQuery.get('status');if(search&&search.length<=80)$('search').value=search;if(['active','pending','preparing','ready','delivering','history','completed','cancelled'].includes(status)&&!kitchen)$('status-filter').value=status;}
    await loadOrders();
    if (!state.authenticated || state.started) return;
    state.started = true;
    state.pollTimer = setInterval(() => { if (!document.hidden) { loadOrders(); connectStream(); } }, 10000);
    state.ageTimer = setInterval(refreshTimers, 15000); connectStream();
    try {
      const subscriptionResponse = await fetch('/api/admin/subscription');
      if (subscriptionResponse.status === 401) { expired(); return; }
      if (subscriptionResponse.ok) {
        const { subscription } = await subscriptionResponse.json();
        $('subscription').textContent = subscription?.status === 'trialing' ? 'Período de teste' : subscription?.status === 'legacy' ? 'Plano legado · cobrança não configurada' : '';
      }
    } catch {}
  } catch (error) { feedback(error.message, true); }
  finally { state.initializing = false; }
}
document.getElementById('order-layout')?.addEventListener('click',event=>{const button=event.target.closest('[data-layout]');if(!button)return;orderLayout=button.dataset.layout==='board'?'board':'list';document.querySelectorAll('[data-layout]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.layout===orderLayout)));state.fingerprint='';render();});
$('refresh').addEventListener('click', () => state.authenticated ? loadOrders() : initialize());
$('sound').addEventListener('click', toggleSound);
$('status-filter').addEventListener('change', () => changeFilter());
$('fulfillment-filter').addEventListener('change', () => changeFilter());
$('search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(changeFilter, 300); });
$('stats').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) { $('status-filter').value = button.dataset.filter; changeFilter(); } });
$('view-new').addEventListener('click', () => { $('status-filter').value = 'pending'; $('fulfillment-filter').value = 'all'; $('search').value = ''; $('new-orders').hidden = true; changeFilter(); });
$('previous').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); changeFilter(false); });
$('next').addEventListener('click', () => { if (state.offset + state.limit < state.total) { state.offset += state.limit; changeFilter(false); } });
$('orders-board').addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  if(button.dataset.action==='details'){const id=Number(button.dataset.orderId);if(expandedOrders.has(id))expandedOrders.delete(id);else expandedOrders.add(id);state.fingerprint='';render();document.querySelector('[data-action="details"][data-order-id="'+id+'"]')?.focus();return;}
  if(button.dataset.action==='tracking'){createTrackingLink(Number(button.dataset.orderId));return;}
  if (button.dataset.action === 'print') printOrder(Number(button.dataset.orderId));
  else updateStatus(Number(button.dataset.orderId), button.dataset.next);
});
$('logout').addEventListener('click', async () => { try { const response = await fetch('/api/auth/logout', { method: 'POST' }); if (response.ok || response.status === 401) expired(); else throw new Error(); } catch { feedback('Não foi possível sair. Tente novamente.', true); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { state.stream?.close(); state.stream = null; state.streamLive = false; connectionLabel(); }
  else if (state.authenticated) { loadOrders(); connectStream(); }
});
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', event => { if (event.persisted) initialize(); });
window.addEventListener('afterprint', () => { $('print-ticket').replaceChildren(); });
initialize();
