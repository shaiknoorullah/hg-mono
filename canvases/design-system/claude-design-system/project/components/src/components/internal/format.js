/* Formatting helpers shared by the components. No rounding happens here: money is int64 cents
   from the server and is divided by 100 and padded, nothing else (02-components.md §20). */

export const TRUE_MINUS = '−';

/** Wire date or date-time -> "14 March 2027". Absolute, always; null when unparseable. */
export function formatAbsoluteDate(value, locale) {
  const d = parseWireDate(value);
  if (!d) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale || 'en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const day = get('day'), month = get('month'), year = get('year');
    return day && month && year ? day + ' ' + month + ' ' + year : null;
  } catch (e) { return null; }
}

/** Wire date-time -> "2:41 PM" in the viewer's zone. */
export function formatClockTime(value, locale) {
  const d = parseWireDate(value);
  if (!d) return null;
  try { return new Intl.DateTimeFormat(locale || 'en-CA', { hour: 'numeric', minute: '2-digit' }).format(d); }
  catch (e) { return null; }
}

export function parseWireDate(value) {
  if (!value || typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? value + 'T00:00:00Z' : value);
  return isNaN(d.getTime()) ? null : d;
}

export function isIntegerCents(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** 1234 -> "$12.34", -300 -> "−$3.00" (U+2212). signed: '+' for positives. */
export function formatCents(cents, opts) {
  const o = opts || {};
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  let whole;
  try { whole = dollars.toLocaleString(o.locale || 'en-CA'); } catch (e) { whole = String(dollars); }
  let s = '$' + whole + '.' + rem;
  if (neg && o.sign !== 'never') s = TRUE_MINUS + s;
  else if (!neg && o.sign === 'always' && cents !== 0) s = '+' + s;
  if (o.showCode) s += ' CAD';
  return s;
}

/** 1234 -> "12 dollars and 34 cents". */
export function spokenCents(cents, opts) {
  const o = opts || {};
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100), c = abs % 100;
  const parts = [];
  if (d > 0 || c === 0) parts.push(d + (d === 1 ? ' dollar' : ' dollars'));
  if (c > 0) parts.push(c + (c === 1 ? ' cent' : ' cents'));
  let s = parts.join(' and ');
  if (neg && o.sign !== 'never') s = 'minus ' + s;
  else if (!neg && o.sign === 'always' && cents !== 0) s = 'plus ' + s;
  if (o.showCode) s += ' Canadian';
  return s;
}
