const { asyncRoute } = require('./auth');
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validProduct = body => body && typeof body.name === 'string' && body.name.trim() && body.name.length <= 160 &&
  typeof body.description === 'string' && body.description.length <= 4000 && Number.isSafeInteger(body.category_id) && body.category_id > 0 &&
  typeof body.price === 'string' && /^\d{1,6}(\.\d{1,2})?$/.test(body.price);
function installCatalogEditing(app, db, auth, manage) {
  app.put('/api/admin/products/:id', auth, manage, asyncRoute(async (req, res) => {
    if (!validId(req.params.id) || !validProduct(req.body)) return res.status(400).json({ error: 'Confira nome, descrição, categoria e preço.' });
    const { name, description, category_id, price } = req.body;
    // INSERT não é usado para editar: IDs de outra empresa nunca criam produtos.
    const [result] = await db.execute(`UPDATE products p JOIN categories c ON c.id = ? AND c.company_id = p.company_id AND (c.active = 1 OR c.id = p.category_id)
      SET p.name = ?, p.description = ?, p.category_id = ?, p.price = ? WHERE p.id = ? AND p.company_id = ?`,
    [category_id, name.trim(), description.trim(), category_id, price, Number(req.params.id), req.user.company_id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Produto ou categoria indisponível nesta loja.' });
    res.json({ success: true });
  }));
  app.put('/api/admin/categories/:id', auth, manage, asyncRoute(async (req, res) => {
    const { name, sort_order, active } = req.body || {};
    if (!validId(req.params.id) || typeof name !== 'string' || !name.trim() || name.length > 120 ||
      !Number.isSafeInteger(sort_order) || sort_order < 0 || sort_order > 10000 || typeof active !== 'boolean') return res.status(400).json({ error: 'Informe nome, ordem de 0 a 10000 e disponibilidade.' });
    const [result] = await db.execute('UPDATE categories SET name = ?, sort_order = ?, active = ? WHERE id = ? AND company_id = ?',
      [name.trim(), sort_order, active, Number(req.params.id), req.user.company_id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json({ success: true });
  }));
  app.get('/api/admin/settings', auth, asyncRoute(async (req, res) => {
    const [rows] = await db.execute('SELECT name, slug, whatsapp_phone FROM companies WHERE id = ?', [req.user.company_id]);
    res.json({ company: rows[0] });
  }));
}
module.exports = { installCatalogEditing };
