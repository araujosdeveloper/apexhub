'use strict';
const $=id=>document.getElementById(id);
const token=location.hash.slice(1),validToken=/^[a-f0-9]{64}$/.test(token);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=value=>value===null||value===undefined?'Valor indisponível':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
let loading=false,timer=null,finished=false,hasData=false;
function options(value){try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)?parsed:[];}catch{return [];}}
function render(order,serverTime){
 const pickup=order.fulfillment_method==='pickup';
 const labels={pending:'Pedido recebido',preparing:'Em preparo',ready:pickup?'Pronto para retirada':'Pronto para sair',delivering:'Saiu para entrega',completed:'Pedido concluído',cancelled:'Pedido cancelado'};
 const descriptions={pending:'O restaurante recebeu seu pedido e vai confirmar o preparo.',preparing:'Seu pedido está sendo preparado.',ready:pickup?'Seu pedido está pronto para ser retirado na loja.':'Seu pedido está pronto e aguarda a saída para entrega.',delivering:'Seu pedido saiu para entrega.',completed:'O restaurante marcou o pedido como concluído.',cancelled:'O restaurante cancelou este pedido. Entre em contato com a loja para esclarecer dúvidas.'};
 $('company').textContent=order.company_name;$('number').textContent='Pedido #'+order.id;$('status').textContent=labels[order.status]||'Situação indisponível';$('status-description').textContent=descriptions[order.status]||'Consulte o restaurante.';
 const stages=['pending','preparing','ready',...(pickup?[]:['delivering']),'completed'];
 $('steps').innerHTML=order.status==='cancelled'?'':stages.map(stage=>`<li${stage===order.status?' class="current" aria-current="step"':''}>${esc(labels[stage])}</li>`).join('');
 finished=['completed','cancelled'].includes(order.status);
 if(order.status==='completed')window.orderReviewUI?.load();
 $('estimate').textContent=!finished&&order.estimated_at?'Previsão informada ao pedir: '+new Date(order.estimated_at).toLocaleString('pt-BR')+'. É uma estimativa do tempo total desde o recebimento.':'';
 $('pickup').textContent=pickup&&order.pickup_address?'Retirada em: '+order.pickup_address:'';
 $('last-sync').textContent='Última consulta confirmada: '+new Date(serverTime).toLocaleString('pt-BR');
 $('items').innerHTML=order.items.length?order.items.map(item=>`<div class="item"><strong>${Number(item.quantity)} × ${esc(item.product_name)}</strong> · ${esc(cash(item.total_price))}${options(item.addons_snapshot).map(option=>'<small>+ '+esc(option.group_name)+': '+((option.quantity || 1) > 1 ? Number(option.quantity)+'× ' : '')+esc(option.name)+'</small>').join('')}</div>`).join(''):'<p>Este pedido antigo não possui itens detalhados. Consulte o restaurante.</p>';
 $('totals').textContent='Frete: '+cash(order.delivery_fee)+' · Desconto: '+cash(order.discount_amount)+(order.coupon_code?' · Cupom: '+order.coupon_code:'')+' · Total do pedido: '+cash(order.total_amount);
 const menuUrl=typeof order.menu_url==='string'&&/^\/\?loja=[a-zA-Z0-9%-]+$/.test(order.menu_url)?order.menu_url:null;$('menu').hidden=!menuUrl;if(menuUrl)$('menu').href=menuUrl;
 $('content').hidden=false;hasData=true;if(finished&&timer){clearInterval(timer);timer=null;}else if(!finished&&!timer){timer=setInterval(()=>{if(!document.hidden&&!finished)load();},10000);}
}
async function load(){
 if(loading||!validToken)return;loading=true;$('refresh').disabled=true;
 try{const response=await fetch('/api/order-tracking',{cache:'no-store',headers:{'X-Order-Token':token}});const data=await response.json();if(!response.ok){if(response.status===404){$('content').hidden=true;hasData=false;finished=true;if(timer){clearInterval(timer);timer=null;}}throw new Error(data.error||'Não foi possível consultar o pedido.');}render(data.order,data.server_time);$('message').textContent=finished?'':'Acompanhamento atualizado.';}
 catch(e){$('message').textContent=hasData?'Não foi possível atualizar. As informações exibidas são da última consulta confirmada. Tente novamente.':e.message;}
 finally{loading=false;$('refresh').disabled=false;}
}
$('refresh').onclick=()=>load();document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!finished)load();});window.addEventListener('hashchange',()=>location.reload());
if(validToken){timer=setInterval(()=>{if(!document.hidden&&!finished)load();},10000);load();}else{$('message').textContent='Link de acompanhamento inválido. Use o link recebido ao finalizar seu pedido.';$('refresh').disabled=true;}
