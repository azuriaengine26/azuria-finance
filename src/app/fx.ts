// Fetching the daily USD→HNL rate from Wise on each platform.
//  - Android app: native HTTP request straight to Wise.
//  - Mac app: the desktop shell fetches from Wise (the page itself has no network access).
//  - Web / iPhone Home Screen: browsers block reading Wise directly, so the app reads the copy that
//    the daily GitHub job publishes (also used as a fallback on Android/Mac).
// Only the public rate is requested; no personal or financial data is ever sent.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Db } from '../core/db';
import { WISE_JSON_URL, WISE_PAGE_URL, WISE_PAGE_URL_ES, PUBLISHED_RATE_URL, parseWiseJson, parseWisePage, parsePublished, rateToString } from '../core/fxsource';
import { applyUsdHnl, autoRefreshDue, type FxResult } from '../core/fxupdate';
import { setSetting } from '../core/seed';

declare global { interface Window { azDesktop?: { fetchText(url: string): Promise<string> } } }

const directAccess = () => Capacitor.isNativePlatform() || !!window.azDesktop;

async function getText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, responseType: 'text', headers: { Accept: 'application/json, text/html' }, connectTimeout: 15000, readTimeout: 15000 });
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  if (window.azDesktop) {
    try { return await window.azDesktop.fetchText(url); }
    catch (e: any) { throw new Error(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^net::ERR_/, 'network error ')); }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export interface FetchedRate { rate: string; source: string; fetchedAt: string }

export async function fetchUsdHnl(): Promise<FetchedRate> {
  const problems: string[] = [];
  if (directAccess()) {
    for (const [url, parse, label] of [[WISE_JSON_URL, parseWiseJson, 'Wise'], [WISE_PAGE_URL, parseWisePage, 'Wise'], [WISE_PAGE_URL_ES, parseWisePage, 'Wise']] as const) {
      try {
        const v = parse(await getText(url));
        if (v != null) return { rate: rateToString(v), source: label, fetchedAt: new Date().toISOString() };
        problems.push('Wise answered in an unexpected format');
      } catch (e: any) { problems.push(`Wise: ${e?.message ?? e}`); }
    }
  }
  try {
    const p = parsePublished(await getText(PUBLISHED_RATE_URL));
    if (!p) throw new Error('unexpected format');
    const ageDays = (Date.now() - Date.parse(p.fetched_at)) / 86_400_000;
    if (ageDays > 4) throw new Error(`the daily copy is ${Math.floor(ageDays)} days old`);
    return { rate: p.rate, source: 'Wise (daily copy)', fetchedAt: p.fetched_at };
  } catch (e: any) { problems.push(`Daily copy: ${e?.message ?? e}`); }
  throw new Error(`Couldn’t get today’s rate (${[...new Set(problems)].join('; ')}). It will try again later; your last rate is still used.`);
}

/** Fetch and apply. `force` = you confirmed a rate that looked unusual. */
export async function refreshUsdHnl(db: Db, opts: { force?: boolean } = {}): Promise<FxResult & { source: string }> {
  setSetting(db, 'fx_last_attempt', String(Date.now()));
  try {
    const f = await fetchUsdHnl();
    const res = applyUsdHnl(db, f.rate, { force: opts.force });
    setSetting(db, 'fx_last_source', f.source);
    return { ...res, source: f.source };
  } catch (e: any) {
    setSetting(db, 'fx_last_error', e?.message ?? String(e));
    throw e;
  }
}

let running = false;
/** Called on unlock and when the date changes. Quiet: problems are shown in Settings → Currencies. */
export async function autoRefreshUsdHnl(db: Db): Promise<void> {
  if (running || !autoRefreshDue(db)) return;
  running = true;
  try { await refreshUsdHnl(db); } catch { /* recorded in settings */ } finally { running = false; }
}
