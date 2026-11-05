const { asyncRoute } = require('./auth');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
function validateGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 12) throw new Error('Cadastre até 12 grupos de adicionais por produto.');
  const ids = new Set();
  const claim = id => { if (!validId(id) || ids.has(id)) throw new Error('Identificadores de adicionais inválidos ou repetidos.'); ids.add(id); };
  return groups.map(group => {
    claim(group?.id);
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 120 ||
      !Number.isInteger(group.min) || !Number.isInteger(group.max) || group.min < 0 || group.max < 1 || group.max > 20 || group.min > group.max ||
      !Array.isArray(group.options) || !group.options.length || group.options.length > 20 || group.max > group.options.length) throw new Error('Confira o nome, mínimo, máximo e opções de cada grupo.');
    const options = group.options.map(option => {
      claim(option?.id);
      if (typeof option.name !== 'string' || !option.name.trim() || option.name.length > 120 || typeof option.price !== 'string' || !/^\d{1,4}(\.\d{1,2})?$/.test(option.price) || typeof option.active !== 'boolean') throw new Error('Confira nome, preço e disponibilidade dos adicionais.');
      return { id: option.id, name: option.name.trim(), price: Number(option.price).toFixed(2), active: option.active };
    });
    if (options.filter(option => option.active).length < group.min) throw new Error('Grupos obrigatórios precisam ter opções ativas suficientes.');
    return { id: group.id, name: group.name.trim(), min: group.min, max: group.max, options };
  });
}
function decodeGroups(config) { return config ? validateGroups(typeof config === 'string' ? JSON.parse(config) : config) : []; }
function normalizeLines(items) {
  const lines = new Map(), quantities = new Map();
  for (const item of items) {
    const product_id = item.product_id || item.id;
    const option_ids = item.option_ids ?? [];
    if (!Array.isArray(option_ids) || option_ids.length > 240 || option_ids.some(id => !validId(id)) || new Set(option_ids).size !== option_ids.length ||
      (item.addon_version !== undefined && (!Number.isSafeInteger(item.addon_version) || item.addon_version < 0))) throw new Error('Seleção de adicionais inválida.');
    const sorted = [...option_ids].sort(), addon_version = item.addon_version || 0;
    const key = JSON.stringify([product_id, sorted, addon_version]);
    const line = lines.get(key) || { product_id, option_ids: sorted, addon_version, quantity: 0 };
    line.quantity += item.quantity; lines.set(key, line);
    quantities.set(product_id, (quantities.get(product_id) || 0) + item.quantity);
    if (quantities.get(product_id) > 99) throw new Error('Limite de 99 unidades por produto, incluindo variações.');
  }
  const key = line => JSON.stringify([line.product_id, line.option_ids, line.addon_version]);
  return { lines: [...lines.values()].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0), quantities };
}
function priceLine(product, line) {
  const groups = decodeGroups(product.addon_config), version = Number(product.addon_version || 0);
  if ((groups.length || line.addon_version) && line.addon_version !== version) throw new Error('Os adicionais deste produto mudaram. Atualize o cardápio e escolha novamente.');
  const remaining = new Set(line.option_ids), snapshot = [];
  for (const group of groups) {
    const selected = group.options.filter(option => remaining.has(option.id));
    if (selected.length < group.min || selected.length > group.max) throw new Error(`Escolha de ${group.min} a ${group.max} opções em ${group.name}.`);
    for (const option of selected) {
      if (!option.active) throw new Error('Um adicional selecionado está indisponível. Atualize o cardápio.');
      remaining.delete(option.id);
      snapshot.push({ group_id: group.id, group_name: group.name, option_id: option.id, name: option.name, price: option.price });
    }
  }
  if (remaining.size) throw new Error('Um adicional não pertence a este produto ou foi removido.');
  const unitCents = Math.round(Number(product.price) * 100) + snapshot.reduce((sum, option) => sum + Math.round(Number(option.price) * 100), 0);
  return { ...line, name: product.name, unitCents, snapshot };
}
function publicProduct(product) {
  const { addon_config, addon_version, ...base } = product;
  return { ...base, addon_version: Number(addon_version || 0), addon_groups: decodeGroups(addon_config).map(group => ({ ...group, options: group.options.filter(option => option.active) })) };
}
function installAddons(app, db, auth, manage) {
  app.get('/api/admin/products/:id/addons', auth, asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Produto inválido.' });
    const [rows] = await db.execute('SELECT p.id, p.name, a.config AS addon_config, a.version AS addon_version FROM products p LEFT JOIN product_addons a ON a.product_id = p.id WHERE p.id = ? AND p.company_id = ?', [id, req.user.company_id]);
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado nesta loja.' });
    res.json({ product: { id, name: rows[0].name }, groups: decodeGroups(rows[0].addon_config), version: Number(rows[0].addon_version || 0) });
  }));
  app.put('/api/admin/products/:id/addons', auth, manage, asyncRoute(async (req, res) => {
    const id = Number(req.params.id), version = req.body?.version;
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647) return res.status(400).json({ error: 'Produto ou versão inválida.' });
    let groups;
    try { groups = validateGroups(req.body?.groups); } catch (error) { return res.status(400).json({ error: error.message }); }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [products] = await conn.execute('SELECT id FROM products WHERE id = ? AND company_id = ? FOR UPDATE', [id, req.user.company_id]);
      if (!products.length) { await conn.rollback(); return res.status(404).json({ error: 'Produto não encontrado nesta loja.' }); }
      const [rows] = await conn.execute('SELECT version FROM product_addons WHERE product_id = ? FOR UPDATE', [id]);
      if (Number(rows[0]?.version || 0) !== version) { await conn.rollback(); return res.status(409).json({ error: 'Outra edição foi salva. Recarregue os adicionais antes de editar.' }); }
      await conn.execute('INSERT INTO product_addons (product_id, config, version) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config), version = VALUES(version)', [id, JSON.stringify(groups), version + 1]);
      await conn.commit(); res.json({ groups, version: version + 1 });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }));
}
module.exports = { validateGroups, decodeGroups, normalizeLines, priceLine, publicProduct, installAddons };
