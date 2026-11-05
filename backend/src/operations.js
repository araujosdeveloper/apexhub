const { asyncRoute } = require('./auth');

const defaults = () => ({ timezone: 'America/Sao_Paulo', mode: 'open', delivery_enabled: true,
  pickup_enabled: false, pickup_address: '', delivery_minutes: 60, pickup_minutes: 30,
  zones_enabled: false, zones: [], hours: [] });
const money = value => typeof value === 'string' && /^\d{1,4}(\.\d{1,2})?$/.test(value);
const normalizeNeighborhood = value => value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
function minutes(value, end = false) {
  if (end && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function validateOperations(body) {
  if (!body || typeof body.timezone !== 'string' || body.timezone.length > 80) throw new Error('Informe um fuso horário válido.');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: body.timezone }).format(); }
  catch { throw new Error('Fuso horário inválido. Use, por exemplo, America/Sao_Paulo.'); }
  if (!['open', 'paused', 'schedule'].includes(body.mode)) throw new Error('Escolha o modo de funcionamento.');
  if (['delivery_enabled', 'pickup_enabled', 'zones_enabled'].some(key => typeof body[key] !== 'boolean') ||
      (!body.delivery_enabled && !body.pickup_enabled)) throw new Error('Ative pelo menos uma modalidade de atendimento.');
  if (typeof body.pickup_address !== 'string' || body.pickup_address.length > 320 ||
      (body.pickup_enabled && !body.pickup_address.trim())) throw new Error('Informe o endereço de retirada (até 320 caracteres).');
  if (['delivery_minutes', 'pickup_minutes'].some(key => !Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 240)) throw new Error('Os prazos devem ser de 1 a 240 minutos.');
  if (!Array.isArray(body.hours) || body.hours.length > 28) throw new Error('Cadastre até 28 intervalos semanais.');
  const occupied = new Set();
  const hours = body.hours.map(slot => {
    const start = minutes(slot?.start), end = minutes(slot?.end, true);
    if (!Number.isInteger(slot?.day) || slot.day < 0 || slot.day > 6 || start === null || end === null || start === end) throw new Error('Confira os dias e horários. Abertura e fechamento devem ser diferentes.');
    const duration = end > start ? end - start : 1440 - start + end;
    for (let minute = 0; minute < duration; minute++) {
      const key = (slot.day * 1440 + start + minute) % 10080;
      if (occupied.has(key)) throw new Error('Existem horários sobrepostos na semana.');
      occupied.add(key);
    }
    return { day: slot.day, start: slot.start, end: slot.end };
  });
  if (body.mode === 'schedule' && !hours.length) throw new Error('Cadastre horários para usar a abertura automática.');
  if (!Array.isArray(body.zones) || body.zones.length > 100) throw new Error('Cadastre até 100 bairros.');
  const names = new Set();
  const zones = body.zones.map(zone => {
    if (typeof zone?.name !== 'string' || !zone.name.trim() || zone.name.length > 160 || !money(zone.fee)) throw new Error('Informe bairro e taxa de 0 a 9999,99.');
    const name = zone.name.trim().replace(/\s+/g, ' '), key = normalizeNeighborhood(name);
    if (names.has(key)) throw new Error('Existem bairros repetidos.');
    names.add(key);
    return { name, fee: Number(zone.fee).toFixed(2) };
  });
  if (body.zones_enabled && body.delivery_enabled && !zones.length) throw new Error('Cadastre pelo menos um bairro atendido.');
  return { timezone: body.timezone, mode: body.mode, delivery_enabled: body.delivery_enabled,
    pickup_enabled: body.pickup_enabled, pickup_address: body.pickup_address.trim(),
    delivery_minutes: body.delivery_minutes, pickup_minutes: body.pickup_minutes,
    zones_enabled: body.zones_enabled, zones, hours };
}
async function loadOperations(db, companyId) {
  const [rows] = await db.execute('SELECT config FROM company_operations WHERE company_id = ?', [companyId]);
  if (!rows.length) return defaults();
  const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
  return validateOperations(config);
}
function availability(config, now = new Date()) {
  let is_open = config.mode === 'open';
  if (config.mode === 'schedule') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const current = day * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
    is_open = config.hours.some(slot => {
      const start = slot.day * 1440 + minutes(slot.start), end = minutes(slot.end, true);
      const duration = end > minutes(slot.start) ? end - minutes(slot.start) : 1440 - minutes(slot.start) + end;
      return (current - start + 10080) % 10080 < duration;
    });
  }
  return { ...config, is_open, status_message: is_open ? 'Aberto para pedidos' : config.mode === 'paused' ? 'Pedidos pausados pela loja' : 'Fechado neste horário' };
}
function quoteDelivery(config, method, neighborhood) {
  if (!(method === 'pickup' ? config.pickup_enabled : config.delivery_enabled)) throw new Error('Esta modalidade está indisponível nesta loja.');
  if (method === 'pickup' || !config.zones_enabled) return { fee: '0.00', neighborhood };
  const zone = config.zones.find(z => normalizeNeighborhood(z.name) === normalizeNeighborhood(neighborhood));
  if (!zone) throw new Error('Este bairro está fora da área de entrega. Escolha um bairro atendido ou retirada.');
  return { fee: zone.fee, neighborhood: zone.name };
}
function installOperations(app, db, auth, manage) {
  app.get('/api/admin/operations', auth, asyncRoute(async (req, res) => {
    res.json({ operations: availability(await loadOperations(db, req.tenantId)) });
  }));
  app.put('/api/admin/operations', auth, manage, asyncRoute(async (req, res) => {
    let config;
    try { config = validateOperations(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Mesmo bloqueio usado no checkout: uma alteração não muda o frete no meio do pedido.
      await conn.execute('SELECT id FROM companies WHERE id = ? FOR UPDATE', [req.tenantId]);
      await conn.execute('INSERT INTO company_operations (company_id, config) VALUES (?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)', [req.tenantId, JSON.stringify(config)]);
      await conn.commit();
      res.json({ operations: availability(config) });
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }));
}
module.exports = { defaults, validateOperations, loadOperations, availability, quoteDelivery, installOperations, normalizeNeighborhood };
