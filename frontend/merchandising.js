'use strict';
const $=id=>document.getElementById(id);
let companyId,config,version=0,products=[],selected=null,busy=false,authorized=false,loading=0,stale=false;
function message(text){$('message').textContent=text;}
async function api(url,method='GET',body){
 const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===401){authorized=false;$('fields').disabled=true;location.replace('/login.html');throw new Error('Entre na sua conta.');}
 if(response.status===403){authorized=false;$('fields').disabled=true;throw new Error('Seu perfil não permite configurar destaques.');}
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'Não foi possível concluir.');error.status=response.status;throw error;}
 if(data.company_id!==undefined&&Number(data.company_id)!==Number(companyId)){authorized=false;$('fields').disabled=true;$('configured').replaceChildren();throw new Error('A loja da sessão mudou. Recarregue a página.');}return data;
}
function label(product){return product.name+(!product.active||!product.category_active?' (pausado)':'');}
function render(){
 $('choices').replaceChildren();const related=config.recommendations.find(row=>row.product_id===selected)?.related_ids||[];
 $('selection-summary').textContent=selected?related.length+' de 6 sugestões selecionadas':'Escolha um produto para configurar.';
 for(const product of products.filter(product=>selected&&product.id!==selected)){
  const row=document.createElement('label');row.className='option';const check=document.createElement('input');check.type='checkbox';check.checked=related.includes(product.id);check.disabled=busy;
  check.onchange=()=>{const ids=[...related];if(check.checked){if(ids.length>=6){check.checked=false;message('Escolha no máximo seis sugestões.');return;}ids.push(product.id);}else ids.splice(ids.indexOf(product.id),1);
   config.recommendations=config.recommendations.filter(row=>row.product_id!==selected);if(ids.length)config.recommendations.push({product_id:selected,related_ids:ids});render();
  };row.append(check,document.createTextNode(' '+label(product)));$('choices').append(row);
 }
 $('configured').replaceChildren();for(const row of config.recommendations){const line=document.createElement('p');line.textContent=(products.find(p=>p.id===row.product_id)?.name||'Produto indisponível')+' → '+row.related_ids.map(id=>products.find(p=>p.id===id)?.name||'Produto indisponível').join(', ');$('configured').append(line);}
 if(!config.recommendations.length)$('configured').textContent='Nenhuma combinação configurada.';$('fields').disabled=busy||!authorized;$('save').disabled=stale;
}
async function load(){const request=++loading;busy=true;$('fields').disabled=true;try{const data=await api('/api/admin/merchandising');if(request!==loading)return;config=data.config;version=data.version;products=data.products;stale=false;selected=null;$('popular').checked=config.popular_enabled;$('suggestions').checked=config.suggestions_enabled;$('source').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Escolha um produto';$('source').append(empty);for(const product of products){const option=document.createElement('option');option.value=String(product.id);option.textContent=label(product);$('source').append(option);}busy=false;render();}catch(e){message(e.message);busy=false;}}
$('source').onchange=()=>{selected=$('source').value?Number($('source').value):null;render();};$('reload').onclick=()=>{message('');load();};
$('merch-form').onsubmit=async event=>{event.preventDefault();if(busy||!authorized||stale)return;busy=true;render();message('');try{const data=await api('/api/admin/merchandising','PUT',{version,config:{...config,popular_enabled:$('popular').checked,suggestions_enabled:$('suggestions').checked}});config=data.config;version=data.version;message('Destaques e sugestões publicados no cardápio.');}catch(e){message(e.message);if(e.status===409)stale=true;}finally{busy=false;render();}};
api('/api/auth/me').then(async({user})=>{companyId=user.company_id;if(!['owner','manager'].includes(user.role))throw new Error('Seu perfil não permite configurar destaques.');authorized=true;await load();}).catch(e=>message(e.message));
