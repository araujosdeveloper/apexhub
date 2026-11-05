'use strict';
window.productImageEditor=(()=>{
 const $=id=>document.getElementById(id);let file=null,remove=false,objectUrl=null,existing=null;
 function revoke(){if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
 function preview(url){$('image-preview').hidden=!url;if(url)$('image-preview').src=url;else $('image-preview').removeAttribute('src');}
 function reset(product={}){revoke();file=null;remove=false;existing=product.image_url||null;$('product-image').value='';$('remove-image').checked=false;$('image-message').textContent='';preview(existing);}
 $('product-image').addEventListener('change',()=>{
  revoke();file=null;const chosen=$('product-image').files?.[0];if(!chosen){preview(remove?null:existing);return;}
  if(!['image/jpeg','image/png','image/webp'].includes(chosen.type)||chosen.size>2*1024*1024||chosen.size===0){$('product-image').value='';$('image-message').textContent='Escolha JPG, PNG ou WebP de até 2 MB.';preview(remove?null:existing);return;}
  file=chosen;remove=false;$('remove-image').checked=false;$('image-message').textContent='A foto será enviada ao salvar o produto.';objectUrl=URL.createObjectURL(chosen);preview(objectUrl);
 });
 $('remove-image').addEventListener('change',()=>{remove=$('remove-image').checked;if(remove){file=null;revoke();$('product-image').value='';}preview(remove?null:existing);$('image-message').textContent=remove?'A foto será removida ao salvar o produto.':'';});
 $('image-preview').addEventListener('error',()=>{$('image-preview').hidden=true;$('image-message').textContent='Não foi possível visualizar esta foto. Escolha outra imagem se necessário.';});
 async function save(id){
  if(!file&&!remove)return;
  const response=await fetch('/api/admin/products/'+id+'/image',{method:file?'PUT':'DELETE',...(file?{headers:{'Content-Type':file.type},body:file}:{})});
  if(response.status===401){location.replace('/login.html');throw new Error('Entre novamente para enviar a foto.');}
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar a foto.');reset({image_url:data.image_url});
 }
 function setDisabled(disabled){$('product-image').disabled=disabled;$('remove-image').disabled=disabled;}
 return {reset,save,setDisabled};
})();
