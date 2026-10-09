import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from '../src/core/db';
import { seedDefaults, getSetting, setSetting } from '../src/core/seed';
import { saveRate } from '../src/core/repo';
import { Finance } from '../src/core/finance';
import { parseWiseJson, parseWisePage, parsePublished, rateToString, plausibleUsdHnl } from '../src/core/fxsource';
import { applyUsdHnl, autoRefreshDue } from '../src/core/fxupdate';
import { today, addDays } from '../src/core/dates';

describe('reading the Wise rate', () => {
  it('reads the live-rate JSON (object or array) and rejects nonsense', () => {
    expect(parseWiseJson('{"source":"USD","target":"HNL","value":26.9123,"time":1760000000000}')).toBe(26.9123);
    expect(parseWiseJson('[{"source":"USD","target":"HNL","value":26.8,"time":1},{"source":"USD","target":"HNL","value":26.91,"time":2}]')).toBe(26.91);
    expect(parseWiseJson('{"source":"USD","target":"EUR","value":0.92}')).toBeNull();
    expect(parseWiseJson('{"source":"USD","target":"HNL","value":2691}')).toBeNull(); // implausible
    expect(parseWiseJson('<html>blocked</html>')).toBeNull();
  });
  it('reads the converter page in English and Spanish', () => {
    expect(parseWisePage('<h3><span>1 USD = </span><span class="text-success">26.9123</span> <span>HNL</span></h3>')).toBe(26.9123);
    expect(parseWisePage('<div>$1 USD = 26,91 HNL</div>')).toBe(26.91);
    expect(parseWisePage('<script>{"source":"USD","target":"HNL","value":26.905,"time":1}</script>')).toBe(26.905);
    expect(parseWisePage('<p>1 USD&nbsp;=&nbsp;26.95&nbsp;HNL</p>')).toBe(26.95);
    expect(parseWisePage('<p>Convert 100 USD to HNL</p>')).toBeNull();
  });
  it('reads the daily published copy', () => {
    const ok = JSON.stringify({ base: 'USD', quote: 'HNL', rate: '26.9123', source: 'wise', method: 'json', fetched_at: '2026-10-08T12:07:00Z' });
    expect(parsePublished(ok)).toEqual({ rate: '26.9123', fetched_at: '2026-10-08T12:07:00Z', source: 'wise' });
    expect(parsePublished(ok.replace('26.9123', '2691'))).toBeNull();
    expect(parsePublished('{"base":"USD","quote":"EUR","rate":"0.9","fetched_at":"2026-10-08T00:00:00Z"}')).toBeNull();
  });
  it('formats rates as exact decimal strings', () => {
    expect(rateToString(26.912345678)).toBe('26.912346');
    expect(rateToString(26.9)).toBe('26.9');
    expect(plausibleUsdHnl(26.9)).toBe(true);
    expect(plausibleUsdHnl(0.037)).toBe(false);
  });
});

describe('applying the daily rate', () => {
  let db: Db;
  beforeEach(async () => { db = await Db.create(); seedDefaults(db); });

  it('saves a new rate, which then drives conversions; the original amounts never change', () => {
    saveRate(db, 'USD', 'HNL', '26.20', addDays(today(), -3), 'manual');
    const r = applyUsdHnl(db, '26.9123');
    expect(r.status).toBe('updated');
    const f = new Finance(db);
    expect(f.rates['USD>HNL']).toBe('26.9123');
    expect(f.conv(100_00, 'USD', 'HNL')).toBe(2691_23);
    expect(getSetting(db, 'fx_last_rate')).toBe('26.9123');
    expect(applyUsdHnl(db, '26.9123').status).toBe('unchanged');
  });
  it('never overwrites a rate you entered yourself for today', () => {
    saveRate(db, 'USD', 'HNL', '27.00', today(), 'manual');
    expect(applyUsdHnl(db, '26.91').status).toBe('kept_manual');
    expect(new Finance(db).rates['USD>HNL']).toBe('27.00');
    expect(applyUsdHnl(db, '26.91', { force: true }).status).toBe('updated');
  });
  it('holds back a suspicious jump for you to confirm; demo rates are not used for that check', () => {
    saveRate(db, 'USD', 'HNL', '26.20', addDays(today(), -1), 'wise');
    const r = applyUsdHnl(db, '31.50');
    expect(r.status).toBe('suspicious');
    expect(getSetting(db, 'fx_pending')).toBe('31.50');
    expect(new Finance(db).rates['USD>HNL']).toBe('26.20');
    expect(applyUsdHnl(db, '31.50', { force: true }).status).toBe('updated');
    expect(getSetting(db, 'fx_pending')).toBe('');
    db.run('DELETE FROM exchange_rates');
    saveRate(db, 'USD', 'HNL', '10.00', addDays(today(), -100), 'demo');
    expect(applyUsdHnl(db, '26.91').status).toBe('updated');
  });
  it('runs automatically once a day, retrying hourly after a failure, and can be switched off', () => {
    const now = Date.now();
    expect(autoRefreshDue(db, now)).toBe(true);
    setSetting(db, 'fx_last_attempt', String(now - 10 * 60_000));
    expect(autoRefreshDue(db, now)).toBe(false);            // failed 10 min ago: wait
    setSetting(db, 'fx_last_attempt', String(now - 61 * 60_000));
    expect(autoRefreshDue(db, now)).toBe(true);             // retry after an hour
    applyUsdHnl(db, '26.91');
    expect(autoRefreshDue(db, now)).toBe(false);            // done for today
    setSetting(db, 'fx_auto', '0');
    expect(autoRefreshDue(db, now + 2 * 86_400_000)).toBe(false);
  });
});
