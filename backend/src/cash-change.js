'use strict';

function parseCashAmount(value) {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(value);
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}

const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function cashChangeNote(cashCents, totalCents) {
  return 'Troco para ' + money(cashCents) + ' · Levar ' + money(cashCents - totalCents);
}

module.exports = { parseCashAmount, cashChangeNote };
