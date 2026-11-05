'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let companyId,canManage=false,editing=null,drivers=[],orders=[],offset=0,total=0,revision=0,busy=false;
const stages={preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega'};
function routeUrl(order){const address=order.fulfillment_address||[order.address_street,order.address_number,order.address_neighborhood].filter(Boolean).join(', ');return address?'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination:address}):null;}
function message(text){$('message').textContent=text;}
async function api(url,method='GET',body){
 const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===401){$('content').hidden=true;location.replace('/login.html');throw new Error('Entre na sua conta.');}
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível concluir.');
 if(data.company_id!==undefined&&Number(data.company_id)!==Number(companyId)){$('content').hidden=true;throw new Error('A loja da sessão mudou. Recarregue a página.');}return data;
}
function reset(){editing=null;$('driver-form').reset();$('save').textContent='Salvar entregador';}
function render(){
 $('drivers').replaceChildren();
 if(canManage)for(const driver of drivers){const row=document.createElement('div');row.className='driver';row.innerHTML=`<strong>${esc(driver.name)}</strong> · ${esc(driver.phone)} · ${driver.active?'Disponível':'Indisponível'} `;const button=document.createElement('button');button.textContent='Editar';button.className='secondary';button.disabled=busy;button.onclick=()=>{editing=driver;$('name').value=driver.name;$('phone').value=driver.phone;$('active').checked=Boolean(driver.active);$('save').textContent='Salvar alterações';$('name').focus();};row.append(button);$('drivers').append(row);}
 $('deliveries').replaceChildren();
 for(const order of orders){const row=document.createElement('article');row.className='delivery';const route=routeUrl(order);row.innerHTML=`<h3>Pedido #${Number(order.id)} · ${esc(stages[order.status])}</h3><p>${esc(order.customer_name)} · ${esc(order.customer_phone)}</p><p>${esc(order.fulfillment_address||[order.address_street,order.address_number,order.address_neighborhood].filter(Boolean).join(', '))}</p><p>Entregador vinculado: ${esc(order.driver_name||'Nenhum')}${order.driver_phone?' · '+esc(order.driver_phone):''}</p>${route?'<a class="route" target="_blank" rel="noopener noreferrer" href="'+esc(route)+'">Abrir rota no Google Maps ↗</a>':'<p>Endereço indisponível para rota.</p>'}`;
  if(order.status!=='delivering'){
   const label=document.createElement('label');label.textContent='Entregador ';const select=document.createElement('select');select.setAttribute('aria-label','Entregador do pedido '+order.id);const empty=document.createElement('option');empty.value='';empty.textContent='Sem entregador';select.append(empty);
   for(const driver of drivers.filter(d=>d.active||d.id===order.driver_id)){const option=document.createElement('option');option.value=String(driver.id);option.textContent=driver.name+(driver.active?'':' (indisponível)');option.disabled=!driver.active;select.append(option);}select.value=order.driver_id?String(order.driver_id):'';select.disabled=busy;label.append(select);row.append(label);
   const button=document.createElement('button');button.textContent='Salvar vinculação';button.disabled=busy;button.onclick=()=>assign(order,select.value===''?null:Number(select.value));row.append(button);
  }else{const note=document.createElement('p');note.textContent='Vinculação preservada durante a entrega.';row.append(note);}
  $('deliveries').append(row);
 }
 if(!orders.length)$('deliveries').textContent='Nenhuma entrega em preparo, pronta ou em entrega.';
 $('previous').disabled=busy||offset===0;$('next').disabled=busy||offset+50>=total;$('page').textContent=`${total} entregas · Página ${Math.floor(offset/50)+1} de ${Math.max(1,Math.ceil(total/50))}`;$('driver-fields').disabled=busy;$('refresh').disabled=busy;
}
async function load(){const version=++revision;try{const [d,o]=await Promise.all([api('/api/admin/drivers'),api('/api/admin/dispatch?offset='+offset)]);if(version!==revision)return;drivers=d.drivers;orders=o.orders;total=o.total;if(offset&&offset>=total){offset=0;return load();}render();}catch(e){if(version===revision){orders=[];render();message(e.message);}}}
async function assign(order,driverId){if(busy)return;busy=true;render();message('');try{await api('/api/admin/dispatch/'+order.id,'PUT',{driver_id:driverId,version:order.assignment_version,status:order.status});message('Entregador atualizado. A etapa do pedido continua no gestor.');}catch(e){message(e.message);}finally{busy=false;await load();}}
$('driver-form').onsubmit=async event=>{event.preventDefault();if(busy||!canManage)return;busy=true;render();try{await api('/api/admin/drivers'+(editing?'/'+editing.id:''),editing?'PUT':'POST',{name:$('name').value,phone:$('phone').value,active:$('active').checked,...(editing?{version:editing.version}:{})});reset();message('Entregador salvo.');}catch(e){message(e.message);}finally{busy=false;await load();}};
$('reset').onclick=()=>{if(!busy)reset();};$('refresh').onclick=()=>load();$('previous').onclick=()=>{offset=Math.max(0,offset-50);load();};$('next').onclick=()=>{if(offset+50<total){offset+=50;load();}};
api('/api/auth/me').then(async({user})=>{companyId=user.company_id;canManage=['owner','manager'].includes(user.role);$('management').hidden=!canManage;$('content').hidden=false;await load();}).catch(e=>message(e.message));
