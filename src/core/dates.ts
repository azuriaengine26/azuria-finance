// Calendar-date helpers on ISO "YYYY-MM-DD" strings (no time zones involved).

export function pad(n: number) { return String(n).padStart(2, '0'); }

export function toISO(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function today(): string { return toISO(new Date()); }

export function parseISO(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }

export function makeISO(y: number, m: number, d: number): string {
  // normalise month overflow
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${pad(m)}-${pad(Math.min(d, daysInMonth(y, m)))}`;
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseISO(s);
  return toISO(new Date(y, m - 1, d + n));
}

/** Add months anchored to a day-of-month (clamps to month end: Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s: string, n: number, anchorDay?: number): string {
  const { y, m, d } = parseISO(s);
  return makeISO(y, m + n, anchorDay ?? d);
}

export function diffDays(a: string, b: string): number {
  const A = parseISO(a), B = parseISO(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

export function monthKey(s: string): string { return s.slice(0, 7); }
export function monthStart(s: string): string { return s.slice(0, 7) + '-01'; }
export function monthEnd(s: string): string { const { y, m } = parseISO(s); return makeISO(y, m, 31); }
export function yearStart(s: string): string { return s.slice(0, 4) + '-01-01'; }
export function yearEnd(s: string): string { return s.slice(0, 4) + '-12-31'; }

export function monthsBetween(a: string, b: string): number {
  const A = parseISO(a), B = parseISO(b);
  return (B.y - A.y) * 12 + (B.m - A.m);
}

/** Last N month keys ending with the month of `end`, oldest first. */
export function lastMonths(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(monthStart(end), -i)));
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_NAMES = MONTHS;

export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  return short ? `${name.slice(0, 3)} ${String(y).slice(2)}` : `${name} ${y}`;
}

export function formatDate(s: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!s) return '—';
  const { y, m, d } = parseISO(s);
  if (style === 'long') return `${MONTHS[m - 1]} ${d}, ${y}`;
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

export type RangePreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' | 'last_12' | 'all' | 'custom';

export interface DateRange { from: string; to: string }

export function presetRange(p: RangePreset, ref: string = today()): DateRange {
  const { y, m } = parseISO(ref);
  const q = Math.floor((m - 1) / 3);
  switch (p) {
    case 'this_month': return { from: monthStart(ref), to: monthEnd(ref) };
    case 'last_month': { const s = addMonths(monthStart(ref), -1); return { from: s, to: monthEnd(s) }; }
    case 'this_quarter': return { from: makeISO(y, q * 3 + 1, 1), to: makeISO(y, q * 3 + 3, 31) };
    case 'last_quarter': { const s = addMonths(makeISO(y, q * 3 + 1, 1), -3); return { from: s, to: monthEnd(addMonths(s, 2)) }; }
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'last_12': return { from: addMonths(monthStart(ref), -11), to: monthEnd(ref) };
    case 'all': return { from: '1900-01-01', to: '2999-12-31' };
    default: return { from: monthStart(ref), to: monthEnd(ref) };
  }
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', last_quarter: 'Last quarter',
  this_year: 'This year', last_year: 'Last year', last_12: 'Last 12 months', all: 'All time', custom: 'Custom',
};

/** Parse many common date formats into ISO. Returns null if unparseable. `order` disambiguates 01/02/2026. */
export function parseLooseDate(input: string, order: 'MDY' | 'DMY' = 'MDY'): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    if (a > 12) return valid(y, b, a);
    if (b > 12) return valid(y, a, b);
    return order === 'MDY' ? valid(y, a, b) : valid(y, b, a);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return toISO(new Date(t));
  return null;
  function valid(y: number, mo: number, d: number) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
}
