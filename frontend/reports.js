'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=value=>value===null||value===undefined?'Indisponível':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const day=value=>String(value).split('-').reverse().join('/');
let companyId,revision=0;
function message(text){$('message').textContent=text;}
async function api(url){
 const response=await fetch(url,{cache:'no-store'});
 if(response.status===401){$('app').hidden=true;location.replace('/login.html');throw new Error('Entre na sua conta.');}
 if(response.status===403){$('app').hidden=true;throw new Error('Seu perfil não permite consultar relatórios.');}
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível carregar o relatório.');
 if(data.company_id!==undefined&&Number(data.company_id)!==Number(companyId)){$('app').hidden=true;throw new Error('A loja da sessão mudou. Recarregue a página.');}return data;
}
function table(id,rows,columns){$(id).innerHTML=rows.length?rows.map(row=>'<tr>'+columns(row).map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="6">Sem pedidos para este período.</td></tr>';}
function render(data){
 const s=data.summary;
 $('period-title').textContent=`${day(data.start)} a ${day(data.end)}`;$('timezone').textContent='Fuso horário da loja: '+data.timezone;
 $('updated').textContent='Consultado em '+new Date(data.server_time).toLocaleString('pt-BR',{timeZone:data.timezone})+' ('+data.timezone+')';
 $('summary').innerHTML=[['Total em pedidos concluídos',cash(s.total)],['Pedidos concluídos',s.completed],['Ticket médio',cash(s.average_order)],['Pedidos recebidos',s.orders],['Em andamento',s.active],['Cancelados',s.cancelled],['Frete de concluídos',cash(s.delivery_fees)],['Descontos de concluídos',cash(s.discounts)]].map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
 $('warnings').textContent=[s.unknown_values?`${s.unknown_values} pedidos concluídos sem valor válido: excluídos da soma e do ticket médio.`:'',s.unknown_charges?`${s.unknown_charges} pedidos concluídos com frete ou desconto indisponível: as somas desses campos podem estar incompletas.`:'',s.incomplete_orders?`${s.incomplete_orders} pedidos concluídos sem itens detalhados: não entram no ranking de produtos.`:''].filter(Boolean).join(' ');
 table('daily',data.daily,row=>[day(row.day),row.orders,row.completed,row.active,row.cancelled,cash(row.total)]);
 table('payments',data.payments,row=>[row.label,row.completed,cash(row.total),cash(row.average_order)]);
 table('fulfillment',data.fulfillment,row=>[{delivery:'Delivery',pickup:'Retirada'}[row.label]||row.label||'Não informada',row.orders,row.completed,row.active,row.cancelled,cash(row.total)]);
 table('products',data.products,row=>[row.product_name||'Produto sem nome',row.quantity,row.order_count,cash(row.gross_total)]);
 const maximum=Math.max(0,...data.daily.map(row=>Number(row.total)));
 $('chart').innerHTML=data.daily.map(row=>{const height=maximum?Math.max(0,Math.min(160,Number(row.total)/maximum*160)):0;return `<div class="chart-column" title="${esc(day(row.day)+': '+cash(row.total))}"><div class="bar" style="height:${height}px"></div><small>${esc(day(row.day).slice(0,5))}</small></div>`;}).join('');
 $('results').hidden=false;
}
async function load(query){
 const version=++revision;$('results').hidden=true;message('Carregando relatório…');
 try{const data=await api('/api/admin/reports/sales'+(query?'?'+new URLSearchParams(query):''));if(version!==revision)return;
  if(!query){$('start').value=data.start;$('end').value=data.end;}render(data);message('');
 }catch(e){if(version===revision)message(e.message);}
}
$('filters').onsubmit=event=>{event.preventDefault();load({start:$('start').value,end:$('end').value});};
api('/api/auth/me').then(async({user})=>{companyId=user.company_id;if(!['owner','manager'].includes(user.role))throw new Error('Seu perfil não permite consultar relatórios.');$('app').hidden=false;await load();}).catch(e=>message(e.message));
