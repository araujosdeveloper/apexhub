const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function editor(){const nodes=new Map(),calls=[],revoked=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:true,files:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},removeAttribute(key){delete this[key];}});return nodes.get(id);};
 const context=vm.createContext({window:{},document:{getElementById:node},URL:{createObjectURL:()=> 'blob:photo',revokeObjectURL:url=>revoked.push(url)},location:{replace(){}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({image_url:'/api/admin/products/3/image?v=abc'})};}});vm.runInContext(fs.readFileSync(require.resolve('../../frontend/product-image.js'),'utf8'),context);return {nodes,calls,revoked,api:context.window.productImageEditor,node};}
test('editor de fotos: escolhe arquivo, mostra prévia e envia bytes do arquivo selecionado',async()=>{
 const p=editor(),file={type:'image/png',size:100};p.node('product-image').files=[file];p.node('product-image').listeners.change();assert.equal(p.node('image-preview').src,'blob:photo');assert.equal(p.node('image-preview').hidden,false);await p.api.save(3);assert.equal(p.calls[0].options.body,file);assert.equal(p.calls[0].options.headers['Content-Type'],'image/png');assert.equal(p.calls[0].options.method,'PUT');assert.deepEqual(p.revoked,['blob:photo']);await p.api.save(3);assert.equal(p.calls.length,1);
});
test('editor de fotos: recusa SVG/excesso de tamanho e permite remover foto ao salvar',async()=>{
 const p=editor();p.api.reset({image_url:'/foto-atual'});p.node('product-image').files=[{type:'image/svg+xml',size:100}];p.node('product-image').listeners.change();assert.match(p.node('image-message').textContent,/JPG/);await p.api.save(3);assert.equal(p.calls.length,0);p.node('remove-image').checked=true;p.node('remove-image').listeners.change();assert.equal(p.node('image-preview').hidden,true);await p.api.save(3);assert.equal(p.calls[0].options.method,'DELETE');
});
test('editor de fotos: mudar de produto descarta arquivo pendente e bloqueio desabilita seleção',async()=>{
 const p=editor();p.node('product-image').files=[{type:'image/jpeg',size:100}];p.node('product-image').listeners.change();p.api.reset({image_url:'/foto-outro'});assert.deepEqual(p.revoked,['blob:photo']);assert.equal(p.node('image-preview').src,'/foto-outro');await p.api.save(4);assert.equal(p.calls.length,0);p.api.setDisabled(true);assert.equal(p.node('product-image').disabled,true);assert.equal(p.node('remove-image').disabled,true);
});
test('cadastro de produto: falha de foto conserva ID para tentar novamente sem duplicar produto',async()=>{
 const html=fs.readFileSync(require.resolve('../../frontend/catalog.html'),'utf8'),source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 const nodes=new Map(),writes=[];let saves=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',children:[],listeners:{},textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},get options(){return this.children;},addEventListener(type,fn){this.listeners[type]=fn;},reset(){},focus(){},querySelector(){return node('save-product');}});return nodes.get(id);};
 const context=vm.createContext({URLSearchParams,location:{search:''},console,window:{productImageEditor:{reset(){},setDisabled(){},save:async()=>{if(++saves===1)throw new Error('Falha na conexão');}}},document:{getElementById:node,createElement:tag=>node('created-'+Math.random()),createTextNode:text=>({textContent:text})},fetch:async(url,options)=>{
  if(url==='/api/admin/catalog')return {ok:true,json:async()=>({categories:[{id:1,name:'Combos',active:1}],products:[]})};
  if(url==='/api/admin/settings')return {ok:true,json:async()=>({company:{whatsapp_phone:''}})};
  writes.push({url,options});return {ok:true,json:async()=>({id:7})};
 }});
 vm.runInContext(source,context);for(let i=0;i<12;i++)await Promise.resolve();for(const [id,value]of Object.entries({'product-name':'Combo','description':'','category':'1','price':'20.00'}))node(id).value=value;
 const submit=()=>node('product-form').listeners.submit({preventDefault(){},target:node('product-form')});await submit();assert.equal(node('product-id').value,7);assert.match(node('message').textContent,/Produto salvo, mas a foto/);await submit();assert.deepEqual(writes.map(call=>[call.options.method,call.url]),[['POST','/api/admin/products'],['PUT','/api/admin/products/7']]);
});
