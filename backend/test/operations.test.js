const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateOperations, availability, quoteDelivery } = require('../src/operations');

test('horários seguem fuso local, limites exatos e turnos que cruzam domingo', () => {
 const config = validateOperations({ ...defaults(), mode: 'schedule', timezone: 'America/Fortaleza', hours: [{ day: 6, start: '22:00', end: '02:00' }] });
 for (const [date, expected] of [
  ['2026-11-01T00:59:00Z', false], ['2026-11-01T01:00:00Z', true],
  ['2026-11-01T04:59:00Z', true], ['2026-11-01T05:00:00Z', false]
 ]) assert.equal(availability(config, new Date(date)).is_open, expected, date);
 assert.equal(availability({ ...config, mode: 'paused' }).is_open, false);
 assert.equal(availability({ ...config, mode: 'open' }).is_open, true);
});
test('dia inteiro, intervalo entre turnos e fuso com horário de verão', () => {
 const full = { ...defaults(), mode: 'schedule', hours: [{ day: 1, start: '00:00', end: '24:00' }] };
 assert.equal(availability(full, new Date('2026-11-03T02:59:00Z')).is_open, true);
 assert.equal(availability(full, new Date('2026-11-03T03:00:00Z')).is_open, false);
 const split = validateOperations({ ...defaults(), mode: 'schedule', hours: [{ day: 2, start: '11:00', end: '14:00' }, { day: 2, start: '18:00', end: '23:00' }] });
 assert.equal(availability(split, new Date('2026-11-03T18:00:00Z')).is_open, false);
 const dst = { ...split, timezone: 'America/New_York', hours: [{ day: 0, start: '01:00', end: '02:00' }] };
 assert.equal(availability(dst, new Date('2026-11-01T05:30:00Z')).is_open, true);
 assert.equal(availability(dst, new Date('2026-11-01T06:30:00Z')).is_open, true);
});
test('configurações inválidas e intervalos sobrepostos são rejeitados', () => {
 for (const change of [
  { timezone: 'invalido' }, { delivery_enabled: false }, { pickup_enabled: true },
  { delivery_minutes: 0 }, { pickup_minutes: 241 }, { mode: 'schedule' }, { zones_enabled: true },
  { hours: [{ day: 1, start: '25:00', end: '22:00' }] },
  { hours: [{ day: 1, start: '18:00', end: '18:00' }] },
  { hours: [{ day: 6, start: '22:00', end: '02:00' }, { day: 0, start: '01:00', end: '03:00' }] },
  { zones: [{ name: 'São José', fee: '2.50' }, { name: ' sao  jose ', fee: '3.00' }] },
  { zones: [{ name: 'Centro', fee: '-1.00' }] }, { zones: [{ name: 'Centro', fee: '1.001' }] }
 ]) assert.throws(() => validateOperations({ ...defaults(), ...change }), JSON.stringify(change));
});
test('bairro ignora caixa, espaços e acentos; retirada nunca cobra entrega', () => {
 const config = validateOperations({ ...defaults(), pickup_enabled: true, pickup_address: 'Rua da Loja, 10', zones_enabled: true, zones: [{ name: 'São José', fee: '5.5' }, { name: 'Centro', fee: '0' }] });
 assert.equal(quoteDelivery(config, 'delivery', '  SAO   JOSE ').fee, '5.50');
 assert.equal(quoteDelivery(config, 'delivery', 'Centro').fee, '0.00');
 assert.throws(() => quoteDelivery(config, 'delivery', 'Outro bairro'), /fora da área/);
 assert.equal(quoteDelivery(config, 'pickup', '').fee, '0.00');
 assert.throws(() => quoteDelivery(defaults(), 'pickup', ''), /indisponível/);
});
