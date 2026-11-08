'use strict';
const notice=document.getElementById('notice');
const show=(message,error=false)=>{notice.textContent=message;notice.classList.toggle('error',error);notice.hidden=false;};
async function initialize(){
 try{
  const meResponse=await fetch('/api/auth/me',{cache:'no-store'});
  if(meResponse.status===401){location.replace('/login.html');return;}
  const me=await meResponse.json();if(!meResponse.ok)throw new Error(me.error||'Não foi possível consultar a conta.');
  const response=await fetch('/api/tenant/subscription',{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Não foi possível consultar a assinatura.');
  const subscription=data.subscription,request=data.plan_request;
  const date=subscription.trial_ends_at?new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(subscription.trial_ends_at)):'';
  document.getElementById('subscription-message').textContent=subscription.access_state==='trial_expired'?'Seu período de teste terminou'+(date?' em '+date:'')+'. Escolha um plano para solicitar a ativação.':subscription.access_state==='inactive'?'A assinatura desta loja precisa ser ativada. Escolha um plano para solicitar a ativação.':'Escolha um plano para sua loja.';
  if(request?.status==='pending')show('Solicitação do plano '+request.plan_code.toUpperCase()+' já registrada. Nossa equipe precisa ativar a assinatura.');
  if(me.user?.role!=='owner')for(const button of document.querySelectorAll('.choose'))button.disabled=true;
 }catch(error){show(error.message||'Não foi possível carregar os planos.',true);}
}
for(const button of document.querySelectorAll('.choose'))button.addEventListener('click',async()=>{
 const plan=button.dataset.plan,original=button.textContent;button.disabled=true;button.textContent='Enviando solicitação…';
 try{const response=await fetch('/api/tenant/subscription/choose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_type:plan})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível enviar a solicitação.');show(data.message);}
 catch(error){show(error.message||'Não foi possível enviar a solicitação.',true);button.disabled=false;button.textContent=original;}
});
initialize();
