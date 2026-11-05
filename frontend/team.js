'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={owner:'Dono',manager:'Gerente',operator:'Operador'};
let companyId,people=[],editing=null,offset=0,total=0,revision=0,busy=false,authorized=false;
function message(text){$('message').textContent=text;}
async function api(url,method='GET',body){
 const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===401){authorized=false;$('content').hidden=true;location.replace('/login.html');throw new Error('Entre na sua conta.');}
 if(response.status===403){authorized=false;$('content').hidden=true;throw new Error('Somente o dono pode gerenciar a equipe.');}
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'Não foi possível concluir.');error.status=response.status;throw error;}
 if(data.company_id!==undefined&&Number(data.company_id)!==Number(companyId)){authorized=false;$('content').hidden=true;throw new Error('A loja da sessão mudou. Recarregue a página.');}return data;
}
function reset(){editing=null;$('team-form').reset();$('password').value='';$('password').required=true;$('password-help').textContent='De 12 a 128 caracteres. Informe a senha à pessoa por um canal de sua escolha.';$('form-title').textContent='Novo acesso';$('save').textContent='Criar acesso';}
function edit(person){editing=person;$('name').value=person.name;$('email').value=person.email;$('role').value=person.role;$('active').checked=person.active;$('password').value='';$('password').required=false;$('password-help').textContent='Deixe em branco para manter a senha. Preencha para redefinir (12 a 128 caracteres).';$('form-title').textContent='Editar acesso';$('save').textContent='Salvar alterações';$('name').focus();}
function render(){
 $('people').replaceChildren();
 for(const person of people){const row=document.createElement('tr');row.innerHTML=`<td>${esc(person.name)}</td><td>${esc(person.email)}</td><td>${esc(labels[person.role]||person.role)}</td><td>${person.active?'Ativo':'Bloqueado'}</td>`;const cell=document.createElement('td');if(person.role==='owner'){cell.textContent='Conta protegida';}else{const button=document.createElement('button');button.className='secondary';button.textContent='Editar';button.disabled=busy||!authorized;button.onclick=()=>edit(person);cell.append(button);}row.append(cell);$('people').append(row);}
 $('fields').disabled=busy||!authorized;$('refresh').disabled=busy;$('previous').disabled=busy||offset===0;$('next').disabled=busy||offset+50>=total;$('page').textContent=`${total} pessoas · Página ${Math.floor(offset/50)+1} de ${Math.max(1,Math.ceil(total/50))}`;
}
async function load(){const version=++revision;try{const data=await api('/api/admin/team?offset='+offset);if(version!==revision)return;people=data.users;total=data.total;if(offset&&offset>=total){offset=0;return load();}render();}catch(e){if(version===revision){people=[];render();message(e.message);}}}
$('team-form').onsubmit=async event=>{
 event.preventDefault();if(busy||!authorized)return;const body={name:$('name').value,email:$('email').value,role:$('role').value,active:$('active').checked,...(editing?{revision:editing.revision}:{})};if(!editing||$('password').value!=='')body.password=$('password').value;
 busy=true;++revision;render();message('');try{await api('/api/admin/team'+(editing?'/'+editing.id:''),editing?'PUT':'POST',body);reset();offset=0;message('Acesso salvo.'+(body.revision?' A pessoa precisa entrar novamente.':''));}catch(e){message(e.message);if(editing&&e.status===409)reset();}finally{$('password').value='';busy=false;await load();}
};
$('reset').onclick=()=>{if(!busy)reset();};$('refresh').onclick=()=>load();$('previous').onclick=()=>{offset=Math.max(0,offset-50);load();};$('next').onclick=()=>{if(offset+50<total){offset+=50;load();}};
api('/api/auth/me').then(async({user})=>{companyId=user.company_id;if(user.role!=='owner')throw new Error('Somente o dono pode gerenciar a equipe.');authorized=true;$('content').hidden=false;await load();}).catch(e=>message(e.message));
