'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleCart } = require('../src/whatsapp-cart');

test('carrinho WhatsApp preserva personalizações e usa confirmação única no checkout', async () => {
  const product = { id: 12, name: 'Hot dog', price: '11.00', addon_version: 1, addon_config: [{
    id: 'extras', name: 'Extras', min: 0, max: 2, options: [
      { id: 'ovo', name: 'Ovo', price: '3.00', active: true },
      { id: 'salsicha', name: 'Salsicha', price: '2.00', active: true }
    ]
  }] };
  let cart;
  const db = { async execute(sql, args) {
    if (sql.includes('FROM products')) return [[product]];
    if (sql.includes('FROM company_operations')) return [[]];
    if (sql.startsWith('SELECT items')) {
      assert.deepEqual(args, [42, '400', '558600000000']);
      return [cart ? [cart] : []];
    }
    assert.deepEqual(args.slice(0, 3), [42, '400', '558600000000']);
    cart = { items: args[3], quote: args[4] };
  } };
  let checkouts = 0;
  const send = body => handleCart(db, { company_id: 42, phone_number_id: '400', sender: '558600000000', body },
    async (order, key, total, cashCents) => {
      checkouts++;
      assert.match(key, /^[0-9a-f-]{36}$/);
      assert.equal(total, 2700);
      assert.equal(cashCents, 5000);
      assert.deepEqual(order.items.map(item => [item.option_quantities, item.notes]), [
        [{ ovo: 1 }, 'sem batata'], [{ salsicha: 1 }, '']
      ]);
      return { success: true, order_id: 55, tracking_url: '/track.html#test' };
    }, 'https://bebella.apexdelivery.com.br/');
  await send('ADICIONAR 12 1 | ovo:1 | sem batata');
  await send('ADICIONAR 12 1 | salsicha:1');
  assert.match(await send('ENTREGA Ana | Rua A | 10 | Joia | Dinheiro 26,99'), /precisa cobrir/);
  const review = await send('ENTREGA Ana | Rua A | 10 | Joia | Dinheiro 50,00');
  assert.match(review, /Troco para R\$\s*50,00 · Levar R\$\s*23,00/);
  const code = review.match(/CONFIRMAR ([a-f0-9]+)/)[1];
  assert.match(review, /Ovo \(sem batata\)/);
  assert.match(await send('CONFIRMAR errado'), /novo resumo/);
  assert.match(await send('CONFIRMAR ' + code), /Pedido #55/);
  assert.match(await send('CONFIRMAR ' + code), /Pedido #55/);
  assert.equal(checkouts, 1);
});
