'use strict';

const { parseCashAmount, cashChangeNote } = require('./cash-change');
const { catalogForInterpreter, readIntent } = require('./whatsapp-language');
const { randomUUID } = require('node:crypto');
const { normalizeLines, publicProduct } = require('./addons');
const { priceCart } = require('./cart-pricing');
const { loadOperations, availability, quoteDelivery } = require('./operations');

const HELP = 'Use PRODUTOS, OPÇÕES código, ADICIONAR código quantidade | extra:quantidade | observação, REMOVER linha, CARRINHO ou LIMPAR. Para finalizar: RETIRADA nome | Pix, Cartão ou Dinheiro; ou ENTREGA nome | rua | número | bairro | pagamento. Para pedir troco, escreva Dinheiro 50,00 no campo de pagamento.';
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const methods = { pix: 'Pix', 'cartão': 'Cartão de Crédito', cartao: 'Cartão de Crédito', dinheiro: 'Dinheiro' };
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const productQuery = `SELECT p.id, p.name, p.price, a.config AS addon_config, a.version AS addon_version
  FROM products p JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
  LEFT JOIN product_addons a ON a.product_id = p.id
  WHERE p.company_id = ? AND p.active = 1 AND c.active = 1`;

async function handleCart(db, row, placeOrder, link, interpret) {
  const text = row.body.trim();
  const [first, ...rest] = text.split(/\s+/);
  let command = first.toLowerCase();
  const args = text.slice(first.length).trim();
  if (['oi', 'olá', 'ola', 'cardápio', 'cardapio', 'menu'].includes(command) && !args) {
    return 'Olá! Veja o cardápio em ' + link + ' ou envie PRODUTOS para montar seu pedido aqui.';
  }
  if (command === 'produtos') {
    const [products] = await db.execute(productQuery + ' ORDER BY p.id LIMIT 30', [row.company_id]);
    const lines = products.map(p => p.id + ' · ' + p.name + ' · ' + money(Math.round(Number(p.price) * 100)));
    return (lines.join('\n') || 'Nenhum produto disponível.') + '\nEnvie OPÇÕES seguido do código para ver os adicionais. Cardápio completo: ' + link;
  }

  const scope = [row.company_id, row.phone_number_id, row.sender];
  const [[cart]] = await db.execute(`SELECT items, quote FROM whatsapp_carts
    WHERE company_id = ? AND phone_number_id = ? AND sender = ?
      AND updated_at >= CURRENT_TIMESTAMP - INTERVAL 1 DAY`, scope);
  const items = json(cart?.items) || [];
  const quote = json(cart?.quote);
  async function save(newQuote = null) {
    await db.execute(`INSERT INTO whatsapp_carts (company_id, phone_number_id, sender, items, quote)
      VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE items = VALUES(items), quote = VALUES(quote)`,
    [...scope, JSON.stringify(items), newQuote && JSON.stringify(newQuote)]);
  }
  async function price(fee = 0) {
    const { quantities, lines } = normalizeLines(items);
    return priceCart(db, row.company_id, quantities, lines, fee);
  }
  const summary = (priced, fee) => priced.pricedLines.map(line =>
    line.quantity + ' × ' + line.name + (line.snapshot.length ? ' + ' +
      line.snapshot.map(extra => (extra.quantity || 1) + ' × ' + extra.name).join(', ') : '') +
      (line.notes ? ' (' + line.notes + ')' : '') + ' · ' + money(line.unitCents * line.quantity)
  ).join('\n') + '\nTaxa: ' + money(fee) + '\nTotal: ' + money(priced.grossCents);

  const commands = ['opções', 'opcoes', 'adicionar', 'limpar', 'remover', 'confirmar', 'carrinho', 'entrega', 'retirada'];
  const clarify = 'Não consegui identificar todos os itens. Envie os nomes do cardápio, a quantidade e os adicionais de cada lanche. Para ajuda, envie ATENDENTE.';
  if (interpret && !commands.includes(command) && text.length <= 1000 && text) {
    const [products] = await db.execute(productQuery + ' ORDER BY p.id LIMIT 101', [row.company_id]);
    if (products.length > 100) return 'Consulte o cardápio completo ' + link + ' ou envie ATENDENTE.';
    const available = products.map(publicProduct);
    const catalog = catalogForInterpreter(available);
    if (JSON.stringify(catalog).length > 32000) return 'Consulte o cardápio completo ' + link + ' ou envie ATENDENTE.';
    let intent;
    try { intent = readIntent(await interpret(text, catalog), available); }
    catch { return 'O atendimento por texto livre está indisponível. ' + HELP; }
    if (!intent || intent.action === 'clarify') return clarify;
    if (intent.action === 'menu') return 'Veja o cardápio em ' + link + ' ou envie PRODUTOS.';
    if (intent.action === 'cart') command = 'carrinho';
    if (intent.action === 'add') {
      if (items.length + intent.lines.length > 20) return 'Seu carrinho chegou ao limite de linhas. Remova uma linha para continuar.';
      items.push(...intent.lines);
      let priced;
      try { priced = await price(); }
      catch (error) { if (error.code) throw error; return clarify; }
      const review = 'Carrinho atualizado:\n' + summary(priced, 0) + '\n' +
        'Para cotar: RETIRADA nome | pagamento ou ENTREGA nome | rua | número | bairro | pagamento.';
      if (review.length > 4096) return 'O resumo ficou muito longo. Envie menos itens por vez ou peça um atendente.';
      await save();
      return review;
    }
  }

  if (['opções', 'opcoes', 'adicionar'].includes(command)) {
    const [selection, extras = '', notes = '', ...overflow] = args.split('|').map(v => v.trim());
    const [id, count = '1', ...invalid] = selection.split(/\s+/);
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,2}$/.test(count) || Number(count) < 1 || invalid.length || overflow.length) return HELP;
    const [[product]] = await db.execute(productQuery + ' AND p.id = ?', [row.company_id, Number(id)]);
    if (!product) return 'Produto indisponível. Envie PRODUTOS.';
    if (command !== 'adicionar') {
      const groups = publicProduct(product).addon_groups;
      return product.name + '\n' + (groups.map(group => group.name + ': ' +
        group.options.filter(o => o.active !== false && o.available !== false).map(o => o.id + ' (' + o.name + ', ' + money(Math.round(Number(o.price) * 100)) + ')').join(', ')
      ).join('\n') || 'Sem adicionais.') + '\nADICIONAR ' + id + ' 1 | código-do-adicional:1 | observação';
    }
    if (items.length >= 20) return 'Seu carrinho chegou a 20 linhas. Remova uma linha para continuar.';
    const pairs = extras ? extras.split(',').map(v => v.trim().split(':')) : [];
    if (pairs.some(p => p.length !== 2 || !/^[\w-]{1,64}$/.test(p[0]) || !/^\d{1,2}$/.test(p[1])) ||
        new Set(pairs.map(p => p[0])).size !== pairs.length || notes.length > 500) return HELP;
    items.push({ product_id: Number(id), quantity: Number(count), addon_version: Number(product.addon_version || 0),
      option_quantities: Object.fromEntries(pairs.map(([option, quantity]) => [option, Number(quantity)])), notes });
    await price();
    await save();
    return 'Item adicionado na linha ' + items.length + '. Envie CARRINHO para conferir.';
  }
  if (command === 'limpar' || command === 'remover') {
    const index = Number(args) - 1;
    if (command === 'remover' && (!/^\d{1,2}$/.test(args) || !items[index])) return 'Informe uma linha válida do CARRINHO.';
    command === 'limpar' ? items.splice(0) : items.splice(index, 1);
    await save();
    return items.length ? 'Item removido. Envie CARRINHO para conferir.' : 'Carrinho vazio.';
  }
  if (command === 'confirmar') {
    if (quote?.order) return quote.order;
    if (!quote || args !== quote.code || Date.now() > quote.expires) return 'Solicite um novo resumo e use o código de confirmação que ele mostrar.';
    const result = await placeOrder(quote.body, quote.key, quote.total, quote.cashCents);
    if (!result.success) {
      await save();
      return result.error + ' Envie os dados da modalidade novamente para revisar.';
    }
    const order = 'Pedido #' + result.order_id + ' recebido. Total: ' + money(quote.total) +
      '\nAcompanhe: ' + new URL(result.tracking_url, link).href;
    items.splice(0);
    await save({ order });
    return order;
  }
  if (!['carrinho', 'entrega', 'retirada'].includes(command)) return HELP;
  if (!items.length) return 'Seu carrinho está vazio. Envie PRODUTOS.';
  if (command === 'carrinho') {
    const priced = await price();
    return 'Linhas: ' + items.map((item, index) => (index + 1) + ' (produto ' + item.product_id + ')').join(', ') +
      '\n' + summary(priced, 0) + '\nA taxa final é calculada ao informar a modalidade.';
  }
  const fields = rest.length ? args.split('|').map(v => v.trim()) : [];
  const delivery = command === 'entrega';
  if (fields.length !== (delivery ? 5 : 2) || fields.some(field => !field || field.length > 160)) return HELP;
  const paymentInput = fields.at(-1).toLowerCase();
  const cashInput = /^dinheiro\s+(.+)$/.exec(paymentInput);
  const cashCents = cashInput ? parseCashAmount(cashInput[1]) : undefined;
  if (cashInput && !cashCents) return 'Informe o valor em dinheiro. Exemplo: Dinheiro 50,00.';
  const paymentKey = cashInput ? 'dinheiro' : paymentInput;
  const payment = Object.hasOwn(methods, paymentKey) ? methods[paymentKey] : null;
  if (!payment || typeof payment !== 'string') return 'Escolha Pix, Cartão ou Dinheiro.';
  const [name, street = '', number = '', neighborhood = ''] = delivery ? fields : [fields[0]];
  const method = delivery ? 'delivery' : 'pickup';
  const operations = availability(await loadOperations(db, row.company_id));
  if (!operations.is_open) return operations.status_message;
  const fee = Math.round(Number(quoteDelivery(operations, method, neighborhood).fee) * 100);
  const priced = await price(fee);
  if (cashCents !== undefined && cashCents < priced.grossCents) return 'O valor em dinheiro precisa cobrir o total de ' + money(priced.grossCents) + '.';
  const key = randomUUID();
  const code = key.slice(0, 8);
  const review = summary(priced, fee) + '\n' + (delivery ? 'Entrega: ' + [street, number, neighborhood].join(', ') :
    'Retirada: ' + operations.pickup_address) + '\nPagamento: ' + payment + (cashCents === undefined ? '' : '\n' + cashChangeNote(cashCents, priced.grossCents)) + '\nPara pedir, envie CONFIRMAR ' + code + '.';
  if (review.length > 4096) return 'O resumo é longo demais. Remova uma linha para continuar.';
  await save({ key, code, expires: Date.now() + 600000, cashCents, total: priced.grossCents, body: {
    company_id: Number(row.company_id), items, fulfillment_method: method, delivery_fee: (fee / 100).toFixed(2),
    payment_method: payment, customer: { name, phone: row.sender, street, number, neighborhood }
  } });
  return review;
}

module.exports = { handleCart };
