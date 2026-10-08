// Decimal-safe money handling.
// All amounts are stored as INTEGER minor units (cents / centavos).
// Currency conversion uses exact rational arithmetic with BigInt and
// rounds once, half-away-from-zero, at the end. No floating point touches money.

export type Currency = 'USD' | 'HNL' | (string & {});

export const CURRENCIES: { code: Currency; name: string; symbol: string; decimals: number }[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', decimals: 2 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', decimals: 2 },
];

export function currencyInfo(code: string) {
  return CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: code + ' ', decimals: 2 };
}

/** Parse a user-entered decimal string ("1,234.56", "$500", "-20", "(45.10)") into minor units. Throws on garbage. */
export function parseMoney(input: string | number, decimals = 2): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid amount');
    input = input.toFixed(decimals);
  }
  let s = String(input).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s$€£L]|USD|HNL|EUR|MXN|GTQ/gi, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith('+')) s = s.slice(1);
  // European format "1.234,56" -> "1234.56"
  if (/^\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  s = s.replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error(`Invalid amount: "${input}"`);
  const [whole, frac = ''] = s.split('.');
  // Round half away from zero on extra decimal places
  let fracPadded = (frac + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  let units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded.slice(0, decimals) || '0');
  if (Number(fracPadded[decimals]) >= 5) units += 1n;
  const n = Number(units);
  if (!Number.isSafeInteger(n)) throw new Error('Amount too large');
  return negative ? -n : n;
}

/** Minor units -> plain decimal string "1234.56" (for inputs and CSV). */
export function toDecimalString(minor: number, decimals = 2): string {
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  return (neg ? '-' : '') + whole.toString() + (decimals > 0 ? '.' + frac : '');
}

/** Minor units -> display string "$1,234.56". */
export function formatMoney(minor: number, currency: string = 'USD', opts: { sign?: boolean; compact?: boolean } = {}): string {
  const info = currencyInfo(currency);
  const neg = minor < 0;
  const dec = toDecimalString(Math.abs(minor), info.decimals);
  let [whole, frac] = dec.split('.');
  if (opts.compact && Math.abs(minor) >= 1_000_000 * 10 ** info.decimals) {
    const m = Number(whole) / 1_000_000;
    return `${neg ? '−' : opts.sign ? '+' : ''}${info.symbol}${m.toFixed(m >= 10 ? 1 : 2)}M`;
  }
  if (opts.compact && Math.abs(minor) >= 10_000 * 10 ** info.decimals) {
    const k = Number(whole) / 1000;
    return `${neg ? '−' : opts.sign ? '+' : ''}${info.symbol}${k.toFixed(k >= 100 ? 0 : 1)}k`;
  }
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : opts.sign && minor > 0 ? '+' : ''}${info.symbol}${whole}${frac !== undefined ? '.' + frac : ''}`;
}

// ---------- Exact rational exchange rates ----------

export interface Rational { num: bigint; den: bigint }

/** "26.2451" -> 262451/10000 */
export function parseRate(rate: string): Rational {
  const s = String(rate).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid exchange rate: ${rate}`);
  const [w, f = ''] = s.split('.');
  const den = 10n ** BigInt(f.length);
  const num = BigInt(w) * den + BigInt(f || '0');
  if (num === 0n) throw new Error('Exchange rate cannot be zero');
  return { num, den };
}

/** Divide with rounding half away from zero. */
function divRound(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n);
  const A = a < 0n ? -a : a;
  const B = b < 0n ? -b : b;
  let q = A / B;
  if ((A % B) * 2n >= B) q += 1n;
  return neg ? -q : q;
}

/** Map of "FROM>TO" -> rate string, meaning 1 FROM = rate TO. */
export type RateTable = Record<string, string>;

export function findRate(rates: RateTable, from: string, to: string): Rational | null {
  if (from === to) return { num: 1n, den: 1n };
  const direct = rates[`${from}>${to}`];
  if (direct) return parseRate(direct);
  const inverse = rates[`${to}>${from}`];
  if (inverse) { const r = parseRate(inverse); return { num: r.den, den: r.num }; }
  // Triangulate through USD
  if (from !== 'USD' && to !== 'USD') {
    const a = findRate(rates, from, 'USD');
    const b = findRate(rates, 'USD', to);
    if (a && b) return { num: a.num * b.num, den: a.den * b.den };
  }
  return null;
}

/** Convert minor units between currencies exactly; original amount is never mutated. */
export function convert(minor: number, from: string, to: string, rates: RateTable): number {
  if (from === to) return minor;
  const r = findRate(rates, from, to);
  if (!r) throw new MissingRateError(from, to);
  const fromDec = BigInt(currencyInfo(from).decimals);
  const toDec = BigInt(currencyInfo(to).decimals);
  const scaled = BigInt(minor) * r.num * 10n ** toDec;
  return Number(divRound(scaled, r.den * 10n ** fromDec));
}

export class MissingRateError extends Error {
  constructor(public from: string, public to: string) { super(`No exchange rate for ${from} → ${to}. Add one in Settings → Currencies.`); }
}

/** Sum a list of {amount, currency} into a target currency: group per currency first, convert once per group. */
export function sumConverted(items: { amount: number; currency: string }[], to: string, rates: RateTable): number {
  const byCur = new Map<string, number>();
  for (const it of items) byCur.set(it.currency, (byCur.get(it.currency) ?? 0) + it.amount);
  let total = 0;
  for (const [cur, amt] of byCur) total += convert(amt, cur, to, rates);
  return total;
}

/** Ratio as a percentage with one decimal, safe for display only (not money). */
export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}
