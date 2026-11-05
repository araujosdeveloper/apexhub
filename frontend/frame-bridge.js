'use strict';
/* Ponte de navegação entre conteúdo e App Shell, sempre no mesmo domínio. */
(()=>{
  const internal=new Set(['dashboard','admin','kitchen','catalog','customers','drivers','coupons','reports','finance','operations','addons','merchandising','reviews','team'].map(name=>'/'+name+'.html'));
  const page=location.pathname.split('/').pop().replace('.html','');
  document.documentElement.classList.add('apex-view-root');
  document.addEventListener('DOMContentLoaded',()=>document.body.classList.add('apex-view','apex-view-'+page));
  if(window.parent===window)return;
  const send=data=>window.parent.postMessage(data,location.origin);
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target==='_blank'||link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin||!internal.has(url.pathname))return;
    event.preventDefault();url.searchParams.delete('view');send({type:'apex:navigate',url:url.pathname+url.search+url.hash});
  });
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();event.stopImmediatePropagation();send({type:'apex:search'});}if(event.key==='Escape')send({type:'apex:closemenus'});},true);
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);
    if(response.status===401)send({type:'apex:expired'});
    return response;
  };
  window.addEventListener('pageshow',()=>send({type:'apex:ready'}));
})();
