/* Contexto por aba: só um nonce não autenticador em sessionStorage. JWT nunca é persistido. */
(()=>{'use strict';const KEY='apex_assisted_context';let context=null;try{const value=sessionStorage.getItem(KEY);if(/^[a-f0-9]{64}$/.test(value||''))context=value;}catch{}
 const clear=()=>{try{sessionStorage.removeItem(KEY);}catch{}};
 const original=window.fetch.bind(window);
 window.ApexAssisted={context,clear,async end(){const response=await original('/api/auth/impersonation/end',{method:'POST',credentials:'same-origin',headers:context?{'X-Apex-Impersonation':context}:{}});if(response.ok||[401,409].includes(response.status)){clear();location.replace('/master.html#tenants');return;}const data=await response.json();throw new Error(data.message||data.error||'Não foi possível encerrar o acesso assistido.');}};
 if(!context)return;
 window.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:(input.url||String(input)),location.href);if(url.origin===location.origin&&(/^\/api\/(?:admin\/|tenant\/reports(?:\/|$))/.test(url.pathname)||['/api/auth/me','/api/auth/logout','/api/auth/token'].includes(url.pathname))){const headers=new Headers(init.headers||input?.headers);if(!headers.has('Authorization'))headers.set('X-Apex-Impersonation',context);return original(input,{...init,headers});}return original(input,init);};
 if(typeof window.EventSource==='function'){const Base=window.EventSource;window.EventSource=class extends Base{constructor(input,options){const url=new URL(String(input),location.href);if(url.origin===location.origin&&url.pathname==='/api/admin/orders/events')url.searchParams.set('assisted_context',context);super(url.href,options);}};}
})();
