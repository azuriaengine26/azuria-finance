import type { Db } from './db';
import { saveRate } from './repo';
import { getSetting, setSetting } from './seed';
import { today } from './dates';

export type FxStatus = 'updated' | 'unchanged' | 'kept_manual' | 'suspicious';
export interface FxResult { status: FxStatus; rate: string; previous: string | null }

/** Rates further than this from the last real rate are not applied automatically. */
export const MAX_AUTO_CHANGE = 0.15;

function latestUsdHnl(db: Db, excludeDemo: boolean) {
  return db.get<{ rate: string; date: string; source: string }>(
    `SELECT rate, date, source FROM exchange_rates WHERE base = 'USD' AND quote = 'HNL' ${excludeDemo ? "AND source <> 'demo'" : ''} ORDER BY date DESC, id DESC LIMIT 1`);
}

/**
 * Store a USD→HNL rate fetched from Wise for `day`.
 * - A rate you typed yourself for that day is never overwritten automatically.
 * - A rate that moved more than 15% from the last real rate is held for you to confirm.
 * `force` (you pressed "Use this rate") skips both checks.
 */
export function applyUsdHnl(db: Db, rate: string, opts: { force?: boolean; day?: string; source?: string } = {}): FxResult {
  if (!/^\d+(\.\d+)?$/.test(rate)) throw new Error(`Unexpected rate format: ${rate}`);
  const day = opts.day ?? today();
  const prevReal = latestUsdHnl(db, true);
  const todayRow = db.get<{ rate: string; source: string }>("SELECT rate, source FROM exchange_rates WHERE base = 'USD' AND quote = 'HNL' AND date = ?", [day]);
  const previous = prevReal?.rate ?? null;

  if (!opts.force && todayRow?.source === 'manual') return { status: 'kept_manual', rate: todayRow.rate, previous };
  if (!opts.force && previous) {
    const change = Math.abs(Number(rate) - Number(previous)) / Number(previous);
    if (change > MAX_AUTO_CHANGE) {
      setSetting(db, 'fx_pending', rate);
      setSetting(db, 'fx_last_error', `Wise returned L${rate} per dollar, ${Math.round(change * 100)}% different from the last rate (L${previous}). It wasn’t applied automatically.`);
      return { status: 'suspicious', rate, previous };
    }
  }
  const unchanged = todayRow?.rate === rate && todayRow?.source === (opts.source ?? 'wise');
  saveRate(db, 'USD', 'HNL', rate, day, opts.source ?? 'wise');
  setSetting(db, 'fx_last_ok', new Date().toISOString());
  setSetting(db, 'fx_last_rate', rate);
  setSetting(db, 'fx_last_error', '');
  setSetting(db, 'fx_pending', '');
  return { status: unchanged ? 'unchanged' : 'updated', rate, previous };
}

/** Automatic update runs once per day, retrying at most hourly after a failure. */
export function autoRefreshDue(db: Db, now = Date.now()): boolean {
  if (getSetting(db, 'fx_auto', '1') !== '1') return false;
  const lastOk = getSetting(db, 'fx_last_ok', '');
  if (lastOk && lastOk.slice(0, 10) === new Date(now).toISOString().slice(0, 10) && db.value("SELECT 1 FROM exchange_rates WHERE base='USD' AND quote='HNL' AND date = ?", [today()])) return false;
  const lastTry = Number(getSetting(db, 'fx_last_attempt', '0'));
  return now - lastTry > 60 * 60 * 1000;
}
