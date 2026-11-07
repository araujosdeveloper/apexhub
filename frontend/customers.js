'use strict';
const $ = id => document.getElementById(id);
const cash = value => value === null || value === undefined ? 'Valor não disponível' : Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date = value => value ? new Date(value).toLocaleString('pt-BR') : 'Nenhuma';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statuses = {pending:'Pendente',preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega',completed:'Concluído',cancelled:'Cancelado'};
let companyId, offset = 0, total = 0, listVersion = 0, profileVersion = 0, selected = null, historyOffset = 0, historyTotal = 0;
let selection = {search:'',segment:'all',sort:'recent'};
function message(text) { $('message').textContent = text; }
async function api(url) {
 const response = await fetch(url, { cache:'no-store' });
 if (response.status === 401) { location.replace('/login.html'); throw new Error('Entre na sua conta.'); }
 if (response.status === 403) { $('content').hidden = true; throw new Error('Seu perfil não permite consultar clientes.'); }
 const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os clientes.');
 if (data.company_id !== undefined && Number(data.company_id) !== Number(companyId)) { $('content').hidden = true; throw new Error('A loja da sessão mudou. Recarregue a página.'); }
 return data;
}
async function load() {
 const version = ++listVersion;
 try {
  const data = await api('/api/admin/customers?' + new URLSearchParams({...selection,offset:String(offset)})); if (version !== listVersion) return;
  total = data.total;
  if (offset && offset >= total) { offset = 0; return load(); }
  const s = data.summary;
  $('summary').innerHTML = [['Clientes',s.contacts],['Recorrentes',s.repeat_contacts],['Sem comprar há 30+ dias',s.inactive30],['Total em pedidos concluídos',cash(s.total_spent)]].map(([label,value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('') + (s.unknown_value_orders ? '<p>Há pedidos antigos sem valor válido; eles não entram no total ou no ticket médio.</p>' : '');
  $('rows').replaceChildren();
  for (const customer of data.customers) {
   const row = document.createElement('tr');
   row.innerHTML = `<td>${escapeHtml(customer.name || 'Cliente sem nome')}<small>${escapeHtml(customer.phone)}</small></td><td>${customer.purchase_count}<small>${customer.active_orders} em andamento · ${customer.cancelled_orders} cancelados</small></td><td>${cash(customer.total_spent)}${customer.unknown_value_orders ? '<small>Histórico com valores incompletos</small>' : ''}</td><td>${escapeHtml(date(customer.last_purchase_at))}</td>`;
   const cell = document.createElement('td'), button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Ver histórico'; button.onclick = () => { selected = customer.id; historyOffset = 0; loadProfile(); }; cell.append(button); row.append(cell); $('rows').append(row);
  }
  $('empty').hidden = data.customers.length > 0; $('previous').disabled = offset === 0; $('next').disabled = offset + 50 >= total;
  $('page').textContent = `${total} clientes · página ${Math.floor(offset/50)+1} de ${Math.max(1,Math.ceil(total/50))}`; message('');
 } catch (error) { if (version === listVersion) message(error.message); }
}
function jsonSnapshot(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return null; } }
function orderHtml(order) {
 const items = order.items.map(item => {
  const snapshot = jsonSnapshot(item.addons_snapshot);
  const addons = Array.isArray(snapshot) ? snapshot : snapshot?.groups || [];
  return `<li>${Number(item.quantity)} × ${escapeHtml(item.product_name)} · ${cash(item.total_price)}${addons.length ? '<small>Adicionais: ' + addons.map(addon => ((addon.quantity || 1) > 1 ? Number(addon.quantity) + '× ' : '') + escapeHtml((addon.group_name ? addon.group_name + ': ' : '') + (addon.name || 'Adicional')) + ' (' + cash(addon.price) + ')').join(', ') + '</small>' : ''}${item.item_notes ? '<small>Observação: ' + escapeHtml(item.item_notes) + '</small>' : ''}</li>`;
 }).join('');
 return `<article class="history"><strong>Pedido #${Number(order.id)} · ${escapeHtml(statuses[order.status] || order.status)} · ${cash(order.total_amount)}</strong><p>${escapeHtml(date(order.created_at))} · ${escapeHtml(order.fulfillment_method === 'pickup' ? 'Retirada' : 'Delivery')} · ${escapeHtml(order.payment_method)}</p><p>Dados registrados no pedido: ${escapeHtml(order.customer_name)} · ${escapeHtml(order.customer_phone)}<br>${escapeHtml(order.fulfillment_address || [order.address_street,order.address_number,order.address_neighborhood].filter(Boolean).join(', '))}</p>${items ? '<ul>'+items+'</ul>' : '<p>Pedido antigo sem itens detalhados.</p>'}<p>Frete: ${cash(order.delivery_fee)} · Desconto: ${cash(order.discount_amount)}${order.coupon_code ? ' · Cupom: '+escapeHtml(order.coupon_code) : ''}</p>${order.notes ? '<p>Observações: '+escapeHtml(order.notes)+'</p>' : ''}${order.snapshot_source !== 'checkout' ? '<small>Registro legado: dados históricos podem estar incompletos.</small>' : ''}</article>`;
}
async function loadProfile() {
 const version = ++profileVersion, id = selected;
 $('profile').hidden = true;
 try {
  const data = await api(`/api/admin/customers/${id}?offset=${historyOffset}&limit=20`); if (version !== profileVersion || selected !== id) return;
  historyTotal = data.total; if (historyOffset && historyOffset >= historyTotal) { historyOffset = 0; return loadProfile(); }
  const c = data.customer; $('profile-title').textContent = c.name || 'Cliente sem nome';
  $('profile-info').innerHTML = `<p>Cadastro: ${escapeHtml(c.phone)} · ${escapeHtml([c.address_street,c.address_number,c.address_neighborhood].filter(Boolean).join(', '))}</p><p>${c.purchase_count} compras concluídas · Total: ${cash(c.total_spent)} · Ticket médio: ${cash(c.average_order)}</p><p>Primeira compra: ${escapeHtml(date(c.first_purchase_at))} · Última: ${escapeHtml(date(c.last_purchase_at))}</p>${c.unknown_value_orders ? '<p>Há compras antigas sem valor válido. O ticket médio usa apenas compras com valor conhecido.</p>' : ''}`;
  $('favorites').textContent = data.favorites.map(item => `${item.product_name} (${item.quantity})`).join(' · ') || 'Sem itens em pedidos concluídos.';
  $('history').innerHTML = data.orders.map(orderHtml).join('') || '<p>Sem pedidos.</p>';
  $('history-previous').disabled = historyOffset === 0; $('history-next').disabled = historyOffset + 20 >= historyTotal;
  $('history-page').textContent = `Página ${Math.floor(historyOffset/20)+1} de ${Math.max(1,Math.ceil(historyTotal/20))}`;
  $('profile').hidden = false; message(''); $('profile').scrollIntoView({behavior:'smooth',block:'start'});
 } catch (error) { if (version === profileVersion) message(error.message); }
}
$('filters').onsubmit = event => { event.preventDefault(); selection = {search:$('search').value.trim(),segment:$('segment').value,sort:$('sort').value}; offset = 0; load(); };
$('previous').onclick = () => { offset = Math.max(0,offset-50); load(); };
$('next').onclick = () => { if (offset+50 < total) { offset += 50; load(); } };
$('close-profile').onclick = () => { selected = null; ++profileVersion; $('profile').hidden = true; };
$('history-previous').onclick = () => { historyOffset = Math.max(0,historyOffset-20); loadProfile(); };
$('history-next').onclick = () => { if (historyOffset+20 < historyTotal) { historyOffset += 20; loadProfile(); } };
api('/api/auth/me').then(async ({user}) => { companyId = user.company_id; if (!['owner','manager'].includes(user.role)) throw new Error('Seu perfil não permite consultar clientes.'); $('content').hidden = false; await load(); const requested=Number(new URLSearchParams(location.search).get('customer'));if(Number.isSafeInteger(requested)&&requested>0){selected=requested;historyOffset=0;await loadProfile();} }).catch(error => message(error.message));
