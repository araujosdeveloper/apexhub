/* Apresentação pública: dados da própria loja, sem HTML vindo de campos editáveis. */
window.ApexStoreHeader=(()=>{
 const $=id=>document.getElementById(id);
 function safeImage(value){if(/^\/api\/store-images\/[1-9]\d{0,9}\/(banner|logo)\?v=[a-f0-9]{64}$/.test(value||''))return value;try{if(typeof value!=='string'||value.length>2048)return null;const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
 function image(id,url,alt){const node=$(id),src=safeImage(url);node.hidden=!src;if(alt)node.alt=alt;node.onerror=()=>{node.hidden=true;node.removeAttribute('src');};if(src)node.src=src;else node.removeAttribute('src');}
 function render(company,operations){
  const profile=operations.store_profile||{},name=String(company.name||'Loja');$('store-initials').textContent=name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toLocaleUpperCase('pt-BR')||'A';
  image('store-cover-image',profile.banner_url);image('store-logo',profile.logo_url,'Logo de '+name);
  const phone=String(profile.phone||company.whatsapp_phone||'').replace(/[\s()+-]/g,''),validPhone=/^\d{10,15}$/.test(phone);$('store-phone').hidden=!validPhone;$('store-phone-empty').hidden=validPhone;
  if(validPhone){$('store-phone').textContent='Telefone: +'+phone;$('store-phone').href='tel:+'+phone;}else $('store-phone').removeAttribute('href');
  const address=String(profile.address||operations.pickup_address||'');$('store-address').textContent=address||'Endereço não informado.';const map='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address);$('store-map-link').hidden=!address||map.length>2048;if(address&&map.length<=2048)$('store-map-link').href=map;else $('store-map-link').removeAttribute('href');
  $('store-footer-name').textContent=name;
  const email=String(profile.email||''),hasEmail=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);$('store-email-row').hidden=!hasEmail;$('store-email').textContent=hasEmail?email:'';if(hasEmail)$('store-email').href='mailto:'+encodeURIComponent(email);else $('store-email').removeAttribute('href');
  let socialCount=0;for(const [id,key,hosts]of [['store-instagram','instagram_url',['instagram.com','www.instagram.com']],['store-facebook','facebook_url',['facebook.com','www.facebook.com','m.facebook.com']]]){let href=null;try{const url=new URL(profile[key]);if(url.protocol==='https:'&&!url.username&&!url.password&&hosts.includes(url.hostname))href=url.href;}catch{}$(id).hidden=!href;if(href){$(id).href=href;socialCount++;}else $(id).removeAttribute('href');}$('store-social-links').hidden=!socialCount;
  if(Array.isArray(operations.hours)&&operations.hours.length){const days=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];$('store-hours').textContent=[...operations.hours].sort((a,b)=>a.day-b.day||String(a.start).localeCompare(String(b.start))).map(slot=>(days[slot.day]||'Dia')+': '+slot.start+' às '+slot.end+(slot.end<slot.start?' (dia seguinte)':'')).join('\n')+'\nFuso: '+(operations.timezone||'da loja');}
  $('store-public-notice').textContent=String(profile.notice||'');$('store-public-notice').hidden=!profile.notice;
 }
 return {render};
})();
