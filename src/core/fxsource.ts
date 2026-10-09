// Reading the USD→HNL rate published by Wise. Self-contained (no imports) so the daily GitHub job
// (scripts/fetch-rate.mts) uses exactly the same parsing as the app.

export const WISE_JSON_URL = 'https://wise.com/rates/live?source=USD&target=HNL';
export const WISE_PAGE_URL = 'https://wise.com/gb/currency-converter/usd-to-hnl-rate';
export const WISE_PAGE_URL_ES = 'https://wise.com/es/currency-converter/usd-to-hnl-rate';
/** Copy of the Wise rate published once a day by .github/workflows/rates.yml */
export const PUBLISHED_RATE_URL = 'https://raw.githubusercontent.com/azuriaengine26/azuria-finance/rates/usd-hnl.json';

/** A USD→HNL rate outside this range is certainly a parsing mistake, not a real rate. */
export function plausibleUsdHnl(rate: number): boolean {
  return Number.isFinite(rate) && rate > 10 && rate < 60;
}

/** Number → plain decimal string with at most 6 decimals ("26.9123"), as the app stores rates. */
export function rateToString(rate: number): string {
  return rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function toNumber(s: string): number {
  // "26,9123" (Spanish page) or "26.9123"
  const t = s.trim();
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  return Number(t.replace(/,/g, ''));
}

/** Wise "live rate" JSON: {"source":"USD","target":"HNL","value":26.91,"time":...} (or a one-item array). */
export function parseWiseJson(text: string): number | null {
  let data: any;
  try { data = JSON.parse(text); } catch { return null; }
  const item = Array.isArray(data) ? data[data.length - 1] : data;
  if (!item || typeof item !== 'object') return null;
  if (item.source && item.source !== 'USD') return null;
  if (item.target && item.target !== 'HNL') return null;
  const v = typeof item.value === 'number' ? item.value : typeof item.rate === 'number' ? item.rate : Number(item.value ?? item.rate);
  return plausibleUsdHnl(v) ? v : null;
}

/** Wise currency-converter page (HTML). Tries the structured data first, then the visible "1 USD = 26.91 HNL" text. */
export function parseWisePage(html: string): number | null {
  const candidates: string[] = [];
  const patterns = [
    /"source"\s*:\s*"USD"\s*,\s*"target"\s*:\s*"HNL"\s*,\s*"value"\s*:\s*([\d.]+)/,
    /"sourceCurrency"\s*:\s*"USD"[^{}]{0,200}?"targetCurrency"\s*:\s*"HNL"[^{}]{0,200}?"rate"\s*:\s*([\d.]+)/,
    /"rate"\s*:\s*([\d.]+)[^{}]{0,200}?"source"\s*:\s*"USD"[^{}]{0,80}?"target"\s*:\s*"HNL"/,
    /1(?:[.,]00)?\s*(?:&nbsp;| |\s)*USD\s*(?:&nbsp;| |\s)*=\s*(?:&nbsp;| |\s)*([\d.,]+)\s*(?:&nbsp;| |\s)*HNL/i,
    /USD\s*(?:to|a)\s*HNL[^<]{0,80}?([\d]{2}[.,]\d{2,6})/i,
  ];
  const text = html.replace(/<[^>]+>/g, ' ');
  for (const re of patterns) {
    const m = html.match(re) ?? text.match(re);
    if (m) candidates.push(m[1]);
  }
  for (const c of candidates) {
    const v = toNumber(c);
    if (plausibleUsdHnl(v)) return v;
  }
  return null;
}

export interface PublishedRate { rate: string; fetched_at: string; source: string }

/** The daily file written by the GitHub job. */
export function parsePublished(text: string): PublishedRate | null {
  let d: any;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || d.base !== 'USD' || d.quote !== 'HNL' || typeof d.rate !== 'string' || typeof d.fetched_at !== 'string') return null;
  if (!/^\d+(\.\d+)?$/.test(d.rate) || !plausibleUsdHnl(Number(d.rate))) return null;
  if (Number.isNaN(Date.parse(d.fetched_at))) return null;
  return { rate: d.rate, fetched_at: d.fetched_at, source: String(d.source ?? 'wise') };
}
