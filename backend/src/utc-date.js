function utcDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return value.replace(' ', 'T') + 'Z';
  return value;
}
module.exports={utcDate};
