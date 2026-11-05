const { priceLine } = require('./addons');
function validItems(items) {
  return Array.isArray(items) && items.length > 0 && items.length <= 100 && items.every(item => item && Number.isSafeInteger(item.product_id || item.id) && (item.product_id || item.id) > 0 && Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99);
}
async function priceCart(conn, companyId, quantities, lines, feeCents) {
  const ids = [...quantities.keys()];
  const [products] = await conn.execute(`SELECT p.id, p.name, p.price, a.config AS addon_config, a.version AS addon_version FROM products p LEFT JOIN product_addons a ON a.product_id = p.id JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
    WHERE p.company_id = ? AND p.active = 1 AND c.active = 1 AND p.id IN (${ids.map(() => '?').join(',')}) FOR SHARE`, [companyId, ...ids]);
  if (products.length !== ids.length || ids.some(id => !products.some(product => product.id === id))) throw new Error('Um ou mais produtos estão indisponíveis nesta loja.');
  const pricedLines = lines.map(line => priceLine(products.find(product => product.id === line.product_id), line));
  const subtotalCents = pricedLines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
  const grossCents = subtotalCents + feeCents;
  if (!Number.isSafeInteger(grossCents) || grossCents > 999999999) throw new Error('Valor do pedido excede o limite.');
  return { pricedLines, subtotalCents, grossCents };
}
module.exports = { validItems, priceCart };
