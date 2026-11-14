const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = [...fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
async function storefront({ storage = new Map(), failFirst = false, operations, couponQuote = null, quoteGate = null, companyPhone = '', products = [{ id: 1, category_id: 1, name: 'Lanche', price: '12.35' }] } = {}) {
 const nodes = new Map(); const requests = []; const alerts = []; const quoteRequests = []; const openedWindows = [];
 const getNode = id => {
  if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', innerText: '', dataset: {}, disabled: false, classList: { add() {}, remove() {} } });
  return nodes.get(id);
 };
 for (const [id, value] of Object.entries({ 'customer-name': 'Ana', 'customer-phone': '11999999999', 'customer-street': 'Rua A', 'customer-number': '10', 'customer-neighborhood': 'Centro', 'payment-method': 'Pix' })) getNode(id).value = value;
 const context = vm.createContext({ URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto, console,
  document: { getElementById: getNode }, location: { search: '?loja=loja-a', replace() {} }, alert: value => alerts.push(value), window: { open(url) { openedWindows.push(url); } },
  sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  fetch: async (url, options) => {
   if (url.startsWith('/api/menu')) return { ok: true, json: async () => ({ company: { id: 7, name: 'Loja A', whatsapp_phone: companyPhone }, categories: [{ id: 1, name: 'Lanches' }], products, ...(operations ? { operations } : {}) }) };
   if (url === '/api/public/coupons/validate') { quoteRequests.push(options); if (quoteGate) await quoteGate; return { ok: Boolean(couponQuote), json: async () => couponQuote ? { success: true, data: couponQuote } : { success: false, error: 'Cupom inválido.' } }; }
   requests.push(options);
   if (failFirst && requests.length === 1) throw new Error('Conexão interrompida depois do envio');
   return { ok: true, json: async () => ({ order_id: 20, total_amount: 24.7 }) };
  }
 });
 await vm.runInContext(source, context);
 return { context, requests, quoteRequests, openedWindows, alerts, nodes, storage, run: value => vm.runInContext(value, context) };
}
test('carrinho permite diminuir e remover itens e respeita o limite', async () => {
 const page = await storefront();
 page.run('addToCart(1); addToCart(1); changeQuantity(1, -1)');
 assert.equal(page.run('cart[0].quantity'), 1);
 page.run('changeQuantity(1, -99)'); assert.equal(page.run('cart.length'), 0);
 page.run('for (let n = 0; n < 110; n++) addToCart(1)'); assert.equal(page.run('cart[0].quantity'), 99);
});
test('carrinho restaura quantidades com os preços atuais e descarta produtos ausentes', async () => {
 const storage = new Map([['delivery-cart:loja-a', JSON.stringify([{ id: 1, quantity: 2, price: 0.01 }, { id: 99, quantity: 2 }])]]);
 const page = await storefront({ storage });
 assert.equal(page.run('cart.length'), 1); assert.equal(page.run('cart[0].price'), '12.35'); assert.equal(page.run('cart[0].quantity'), 2);
});
test('falha de conexão preserva chave e carrinho; reenvio bem-sucedido limpa ambos', async () => {
 const page = await storefront({ failFirst: true });
 page.run('addToCart(1); addToCart(1)'); await page.run('sendOrder()');
 assert.equal(page.run('cart.length'), 1); assert.equal(page.nodes.get('send-order').disabled, false);
 await page.run('sendOrder()');
 assert.equal(page.requests.length, 2); assert.equal(page.requests[0].headers['Idempotency-Key'], page.requests[1].headers['Idempotency-Key']);
 assert.equal(page.requests[0].body, page.requests[1].body); assert.equal(page.run('cart.length'), 0); assert.equal(page.storage.has('delivery-attempt:loja-a'), false);
});
test('reabrir a página mantém a chave do envio ainda não confirmado', async () => {
 const first = await storefront({ failFirst: true }); first.run('addToCart(1)'); await first.run('sendOrder()');
 const second = await storefront({ storage: first.storage }); await second.run('sendOrder()');
 assert.equal(first.requests[0].headers['Idempotency-Key'], second.requests[0].headers['Idempotency-Key']);
});
test('checkout mostra frete e total e envia a cotação do bairro escolhido', async () => {
 const { defaults } = require('../src/operations');
 const page = await storefront({ operations: { ...defaults(), is_open: true, zones_enabled: true, zones: [{ name: 'Centro', fee: '4.50' }] } });
 page.run('addToCart(1); openCheckout()');
 assert.equal(page.nodes.get('send-order').disabled, true);
 await page.run('sendOrder()'); assert.equal(page.requests.length, 0);
 page.nodes.get('delivery-zone').value = '0'; page.run('updateCheckoutTotal()');
 assert.match(page.nodes.get('checkout-summary').textContent, /Total: R\$ 16.85/);
 await page.run('sendOrder()');
 const payload = JSON.parse(page.requests[0].body); assert.equal(payload.delivery_fee, '4.50'); assert.equal(payload.customer.neighborhood, 'Centro');
});
test('retirada funciona sem endereço do cliente e exibe o endereço da loja', async () => {
 const { defaults } = require('../src/operations');
 const page = await storefront({ operations: { ...defaults(), is_open: true, delivery_enabled: false, pickup_enabled: true, pickup_address: 'Rua da Loja, 10' } });
 for (const id of ['customer-street', 'customer-number', 'customer-neighborhood']) page.nodes.get(id).value = '';
 page.run('addToCart(1); openCheckout()');
 assert.match(page.nodes.get('fulfillment-info').textContent, /Rua da Loja, 10/);
 assert.match(page.nodes.get('checkout-summary').textContent, /Retirada sem frete/);
 await page.run('sendOrder()');
 assert.equal(JSON.parse(page.requests[0].body).fulfillment_method, 'pickup');
});
test('checkout envia tenant_id e mensagem opcional do WhatsApp inclui observações do item', async () => {
 const page = await storefront({ companyPhone: '5511999999999' });
 page.run("addToCart(1); updateItemNotes(0, 'Sem cebola'); openCheckout()");
 await page.run('sendOrder()');
 const payload = JSON.parse(page.requests[0].body);
 assert.equal(payload.tenant_id, 7); assert.equal(payload.company_id, undefined); assert.equal(payload.items[0].notes, 'Sem cebola');
 assert.equal(page.openedWindows.length, 1);
 const message = new URL(page.openedWindows[0]).searchParams.get('text');
 assert.match(message, /Observação: Sem cebola/);
});
test('loja fechada bloqueia novos pedidos, mas permite reconfirmar o envio anterior', async () => {
 const { defaults } = require('../src/operations');
 const operations = { ...defaults(), is_open: true, status_message: 'Aberto' };
 const page = await storefront({ operations, failFirst: true }); page.run('addToCart(1)'); await page.run('sendOrder()');
 operations.is_open = false; page.run('updateCheckoutTotal()'); assert.equal(page.nodes.get('send-order').disabled, false);
 await page.run('sendOrder()');
 assert.equal(page.requests.length, 2); assert.equal(page.requests[0].headers['Idempotency-Key'], page.requests[1].headers['Idempotency-Key']);
 const closed = await storefront({ operations }); closed.run('addToCart(1); openCheckout()');
 assert.equal(closed.nodes.get('send-order').disabled, true); await closed.run('sendOrder()'); assert.equal(closed.requests.length, 0);
});
test('pedido alterado não usa permissão de reconfirmação após fechamento', async () => {
 const { defaults } = require('../src/operations'); const operations = { ...defaults(), is_open: true };
 const page = await storefront({ operations, failFirst: true }); page.run('addToCart(1)'); await page.run('sendOrder()');
 operations.is_open = false; page.nodes.get('customer-number').value = '20';
 await page.run('sendOrder()'); assert.equal(page.requests.length, 1);
});

function customizableProducts() {
 const { publicProduct } = require('../src/addons');
 return [publicProduct({ id: 1, category_id: 1, name: 'Lanche', price: '12.35', addon_version: 2, addon_config: require('./fixtures/addons.json') })];
}
test('modal exige escolhas obrigatórias, bloqueia excesso e soma os preços escolhidos', async () => {
 const page = await storefront({ products: customizableProducts() });
 page.run('addToCart(1); confirmAddons()'); assert.equal(page.run('cart.length'), 0);
 assert.match(page.nodes.get('addons-error').textContent, /Escolha de 1 a 1/);
 page.run("toggleAddon('ketchup'); toggleAddon('mayo'); confirmAddons()"); assert.equal(page.run('cart.length'), 0);
 page.run("toggleAddon('mayo'); toggleAddon('cheese')"); assert.match(page.nodes.get('confirm-addons').textContent, /14.85/);
 page.run('confirmAddons(); openCheckout()'); assert.equal(page.run('cart[0].price'), '14.85');
 assert.match(page.nodes.get('cart-items-list').innerHTML, /Queijo/);
 await page.run('sendOrder()'); const body = JSON.parse(page.requests[0].body);
 assert.deepEqual(body.items[0].option_ids, ['cheese', 'ketchup']); assert.equal(body.items[0].addon_version, 2);
});
test('combinações diferentes ficam separadas no carrinho e podem ser alteradas individualmente', async () => {
 const page = await storefront({ products: customizableProducts() });
 page.run("addToCart(1); toggleAddon('ketchup'); confirmAddons(); addToCart(1); toggleAddon('mayo'); confirmAddons()");
 assert.equal(page.run('cart.length'), 2);
 page.run('changeQuantityByIndex(1, 1)'); assert.equal(page.run('cart[0].quantity'), 1); assert.equal(page.run('cart[1].quantity'), 2);
 page.run('changeQuantityByIndex(0, -99)'); assert.equal(page.run('cart.length'), 1); assert.equal(page.run('cart[0].option_ids[0]'), 'mayo');
});
test('recarregar preserva adicionais e chave pendente; versão alterada remove item com aviso', async () => {
 const products = customizableProducts(); const first = await storefront({ products, failFirst: true });
 first.run("addToCart(1); toggleAddon('ketchup'); toggleAddon('cheese'); confirmAddons()"); await first.run('sendOrder()');
 const second = await storefront({ products, storage: first.storage }); await second.run('sendOrder()');
 assert.equal(first.requests[0].body, second.requests[0].body); assert.equal(first.requests[0].headers['Idempotency-Key'], second.requests[0].headers['Idempotency-Key']);
 const storage = new Map([['delivery-cart:loja-a', JSON.stringify([{ id: 1, quantity: 1, addon_version: 1, option_ids: ['ketchup'] }])]]);
 const changed = await storefront({ products, storage }); assert.equal(changed.run('cart.length'), 0); assert.match(changed.nodes.get('cart-notice').textContent, /alterados/);
});
test('nomes de adicionais são escapados no modal e no carrinho', async () => {
 const products = customizableProducts(); products[0].addon_groups[0].options[0].name = '<img src=x onerror=alert(1)>';
 const page = await storefront({ products }); page.run('addToCart(1)');
 assert.doesNotMatch(page.nodes.get('addons-options').innerHTML, /<img/);
 page.run("toggleAddon('ketchup'); confirmAddons(); openCheckout()"); assert.doesNotMatch(page.nodes.get('cart-items-list').innerHTML, /<img/);
});

const couponQuote = { coupon_code: 'TESTE', discount_amount: '5.00', subtotal_amount: '12.35', delivery_fee: '0.00', total_amount: '7.35' };
test('cupom validado aparece no resumo e é enviado com valor e subtotal conferidos', async () => {
 const page = await storefront({ couponQuote }); page.run('addToCart(1); openCheckout()'); page.nodes.get('coupon-code').value = 'teste';
 await page.run('applyCoupon()'); assert.match(page.nodes.get('checkout-summary').textContent, /Cupom TESTE: − R\$ 5.00/); assert.match(page.nodes.get('checkout-summary').textContent, /Total: R\$ 7.35/);
 await page.run('sendOrder()'); const payload = JSON.parse(page.requests[0].body);
 assert.equal(payload.coupon_code, 'TESTE'); assert.equal(payload.coupon_discount, '5.00'); assert.equal(payload.coupon_subtotal, '12.35'); assert.equal(page.storage.has('delivery-coupon:loja-a'), false);
});
test('alterar quantidade ou telefone invalida cupom e impede confirmar sem reaplicar', async () => {
 const page = await storefront({ couponQuote }); page.run('addToCart(1)'); page.nodes.get('coupon-code').value = 'TESTE'; await page.run('applyCoupon()');
 page.run('changeQuantity(1, 1)'); assert.equal(page.run('appliedCoupon'), null); await page.run('sendOrder()'); assert.equal(page.requests.length, 0);
 page.run('removeCoupon()'); await page.run('sendOrder()'); assert.equal(page.requests.length, 1); assert.equal(JSON.parse(page.requests[0].body).coupon_code, undefined);
});
test('resposta antiga de cupom não se aplica após mudar o carrinho', async () => {
 let release; const quoteGate = new Promise(resolve => { release = resolve; });
 const page = await storefront({ couponQuote, quoteGate }); page.run('addToCart(1)'); page.nodes.get('coupon-code').value = 'TESTE'; const pending = page.run('applyCoupon()');
 page.run('addToCart(1)'); release(); await pending; assert.equal(page.run('appliedCoupon'), null); assert.match(page.nodes.get('coupon-message').textContent, /pedido mudou/);
});
test('falha de envio e recarga preservam cupom e chave para reconfirmar o mesmo pedido', async () => {
 const first = await storefront({ couponQuote, failFirst: true }); first.run('addToCart(1)'); first.nodes.get('coupon-code').value = 'TESTE'; await first.run('applyCoupon()'); await first.run('sendOrder()');
 const second = await storefront({ storage: first.storage }); await second.run('sendOrder()');
 assert.equal(second.requests.length, 1); assert.equal(first.requests[0].body, second.requests[0].body); assert.equal(first.requests[0].headers['Idempotency-Key'], second.requests[0].headers['Idempotency-Key']);
});

test('sugestões: dependem do carrinho, removem duplicados e não oferecem itens já adicionados',async()=>{
 const page=await storefront({products:[{id:1,category_id:1,name:'Lanche',price:'10',recommended_ids:[2,3,99]},{id:2,category_id:1,name:'Bebida',price:'5',recommended_ids:[3]},{id:3,category_id:1,name:'Batata',price:'7'}]});
 assert.equal(page.run('suggestionProducts().length'),0);page.run('addToCart(1)');assert.deepEqual(Array.from(page.run('suggestionProducts().map(p=>p.id)')),[2,3]);assert.match(page.nodes.get('cart-suggestions').innerHTML,/Que tal acompanhar/);
 page.run('addToCart(2)');assert.deepEqual(Array.from(page.run('suggestionProducts().map(p=>p.id)')),[3]);page.run('changeQuantity(1,-99);changeQuantity(2,-99)');assert.equal(page.run('suggestionProducts().length'),0);assert.equal(page.nodes.get('cart-suggestions').innerHTML,'');
});
test('sugestão com adicionais obrigatórios usa o mesmo fluxo e atualiza resumo do checkout',async()=>{
 const page=await storefront({products:[{id:1,category_id:1,name:'Lanche',price:'10',recommended_ids:[2]},{id:2,category_id:1,name:'Bebida',price:'5',addon_version:1,addon_groups:[{id:'size',name:'Tamanho',min:1,max:1,options:[{id:'large',name:'Grande',price:'2.00'}]}]}]});
 page.run('addToCart(1);openCheckout();addToCart(2);confirmAddons()');assert.equal(page.run('cart.length'),1);assert.match(page.nodes.get('addons-error').textContent,/Escolha/);page.run("toggleAddon('large');confirmAddons()");assert.equal(page.run('cart.length'),2);assert.equal(page.run('cart[1].price'),'7.00');assert.match(page.nodes.get('cart-items-list').innerHTML,/Bebida/);assert.equal(page.run('suggestionProducts().length'),0);
});
test('sugestões: nomes escapados, limite de quatro ofertas e nenhuma inclusão automática',async()=>{
 const products=[{id:1,category_id:1,name:'Lanche',price:'10',recommended_ids:[2,3,4,5,6,7]},...Array.from({length:6},(_,i)=>({id:i+2,category_id:1,name:'<img src=x>',price:'1'}))];const page=await storefront({products});page.run('addToCart(1)');assert.equal(page.run('cart.length'),1);assert.equal(page.run('suggestionProducts().length'),4);assert.match(page.nodes.get('cart-suggestions').innerHTML,/&lt;img/);assert.doesNotMatch(page.nodes.get('cart-suggestions').innerHTML,/<img/);
});
test('fotos do cardápio: aparecem em cards e sugestões, nomes escapados e URLs externas recusadas',async()=>{
 const photo='/api/product-images/2?v='+'a'.repeat(64);const page=await storefront({products:[{id:1,category_id:1,name:'Combo',price:'10',recommended_ids:[2]},{id:2,category_id:1,name:'Bebida <gelada>',price:'5',image_url:photo}]});page.run('addToCart(1)');assert.match(page.nodes.get('cart-suggestions').innerHTML,/<img/);assert.match(page.nodes.get('cart-suggestions').innerHTML,/Bebida &lt;gelada&gt;/);assert.match(page.nodes.get('cart-suggestions').innerHTML,/loading="lazy"/);
 assert.doesNotMatch(page.run("menuProductCard({id:3,name:'Item',price:'1',image_url:'javascript:alert(1)'})"),/<img/);
});
test('acompanhamento do checkout: só mostra links locais válidos e restaura último pedido da aba',async()=>{
 const link='/track.html#'+'a'.repeat(64),storage=new Map([['delivery-received:loja-a',JSON.stringify({order_id:12,tracking_url:link})]]);const page=await storefront({storage});assert.match(page.nodes.get('order-received').innerHTML,/Acompanhar meu pedido/);assert.match(page.nodes.get('order-received').innerHTML,/#12/);page.run("renderReceivedOrder({order_id:12,tracking_url:'javascript:alert(1)'})");assert.equal(page.nodes.get('order-received').innerHTML,'');
});
test('cardápio mobile: pesquisa local ignora acentos e mantém o carrinho ao filtrar/limpar',async()=>{
 const page=await storefront({products:[{id:1,category_id:1,name:'Café com leite',description:'Cremoso',price:'8.00'},{id:2,category_id:1,name:'Suco',description:'Natural',price:'6.00'}]});
 page.run("storeData.merchandising={popular_ids:[1]};addToCart(1);searchMenu('cafe')");assert.match(page.nodes.get('menu-container').innerHTML,/Café com leite/);assert.doesNotMatch(page.nodes.get('menu-container').innerHTML,/Suco/);assert.equal(page.nodes.get('menu-search-results').textContent,'1 produto encontrado');assert.doesNotMatch(page.nodes.get('menu-categories').innerHTML,/Destaques/);
 page.run("searchMenu('produto ausente')");assert.match(page.nodes.get('menu-container').innerHTML,/Nenhum produto encontrado/);assert.equal(page.nodes.get('menu-search-results').textContent,'0 produtos encontrados');page.run('clearMenuSearch()');assert.match(page.nodes.get('menu-container').innerHTML,/Suco/);assert.equal(page.run('cart[0].quantity'),1);assert.equal(page.requests.length,0);
});
test('cardápio mobile: prazo real de entrega/retirada e categorias com navegação local',async()=>{
 const page=await storefront({operations:{is_open:true,status_message:'Aberto para pedidos',delivery_enabled:true,pickup_enabled:true,delivery_minutes:35,pickup_minutes:15,zones_enabled:false,zones:[],mode:'manual'}});
 assert.match(page.nodes.get('store-estimate').textContent,/35 min/);assert.match(page.nodes.get('store-estimate').textContent,/15 min/);assert.match(page.nodes.get('menu-categories').innerHTML,/menu-category-1/);assert.match(page.nodes.get('menu-categories').innerHTML,/Lanches/);assert.equal(page.nodes.get('store-status').dataset.open,'true');
});
test('cardápio mobile: link de categoria respeita preferência por movimento reduzido',async()=>{
 const page=await storefront();let scroll;page.nodes.set('menu-category-1',{scrollIntoView:options=>{scroll=options;}});page.context.matchMedia=()=>({matches:true});page.run("jumpMenuCategory('menu-category-1')");assert.equal(scroll.behavior,'auto');assert.equal(scroll.block,'start');
});

test('observações permanecem separadas na sacola, na recarga e no envio', async () => {
 const page = await storefront();
 page.run("addToCart(1); updateItemNotes(0, 'Sem milho'); addToCart(1); updateItemNotes(1, 'Com milho'); openCheckout()");
 assert.equal(page.run('cart.length'), 2);
 assert.match(page.nodes.get('cart-items-list').innerHTML, /Sem milho/);
 const restored = await storefront({ storage: page.storage });
 assert.equal(restored.run('cart.length'), 2);
 assert.equal(restored.run('cart[0].notes'), 'Sem milho');
 await restored.run('sendOrder()');
 const items = JSON.parse(restored.requests[0].body).items;
 assert.deepEqual(items.map(item => item.notes), ['Sem milho', 'Com milho']);
});
test('observação é escapada na sacola e não aceita conteúdo inválido', async () => {
 const page = await storefront();
 page.run("addToCart(1); updateItemNotes(0, '</textarea><img src=x>'); openCheckout()");
 assert.doesNotMatch(page.nodes.get('cart-items-list').innerHTML, /<img src=x>/);
 assert.match(page.nodes.get('cart-items-list').innerHTML, /&lt;img/);
 page.run("updateItemNotes(0, 'x'.repeat(501))");
 assert.equal(page.run('cart[0].notes'), '</textarea><img src=x>');
});

test('adicionais repetidos calculam preço, persistem e são enviados com observações', async () => {
 const product={id:1,category_id:1,name:'Lanche',price:'12.35',addon_version:3,addon_groups:[{id:'extras',name:'Extras',min:1,max:3,options:[{id:'cheese',name:'Queijo',price:'2.50',max_quantity:3}]}]};
 const p=await storefront({products:[product]});
 p.run("addToCart(1); setAddonQuantity('cheese','2'); confirmAddons(); updateItemNotes(0,'Sem milho')");
 assert.equal(p.run('cart[0].price'),'17.35');
 assert.equal(p.run('cart[0].option_quantities.cheese'),2);
 p.run('openCheckout()');assert.match(p.nodes.get('cart-items-list').innerHTML,/2× Queijo/);
 const restored=await storefront({products:[product],storage:p.storage});
 assert.equal(restored.run('cart[0].price'),'17.35');assert.equal(restored.run('cart[0].notes'),'Sem milho');
 await restored.run('sendOrder()');
 assert.deepEqual(JSON.parse(restored.requests[0].body).items[0].option_quantities,{cheese:2});
});
test('adicionais repetidos recusam excesso e separam configurações na sacola', async () => {
 const product={id:1,category_id:1,name:'Lanche',price:'12.35',addon_version:3,addon_groups:[{id:'extras',name:'Extras',min:1,max:2,options:[{id:'cheese',name:'Queijo',price:'2.50',max_quantity:3}]}]};
 const p=await storefront({products:[product]});
 p.run("addToCart(1); setAddonQuantity('cheese','3'); confirmAddons()");assert.equal(p.run('cart.length'),0);
 p.run("setAddonQuantity('cheese','2'); confirmAddons(); addToCart(1); setAddonQuantity('cheese','1'); confirmAddons()");
 assert.equal(p.run('cart.length'),2);
 p.run("addToCart(1); setAddonQuantity('cheese','1.5'); confirmAddons()");assert.equal(p.run('cart.length'),2);
});
