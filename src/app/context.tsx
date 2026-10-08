import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Db } from '../core/db';
import { Finance } from '../core/finance';
import type { Scope } from '../core/types';
import { Vault } from '../core/vault';
import { getSetting, setSetting } from '../core/seed';
import { generateRecurring } from '../core/repo';
import { today } from '../core/dates';

export interface Toast { msg: string; tone?: 'ok' | 'bad'; action?: { label: string; run: () => void } }

interface AppCtx {
  db: Db;
  fin: Finance;
  version: number;
  scope: Scope;
  setScope: (s: Scope) => void;
  vault: Vault;
  lock: () => void;
  saveState: 'saved' | 'saving' | 'error';
  toast: (t: Toast | string) => void;
  /** Encrypted restore point (taken automatically before risky actions). */
  snapshot: (note: string) => Promise<void>;
  setting: (key: string, fallback?: string) => string;
  updateSetting: (key: string, value: string) => void;
  /** Run a mutation and surface validation errors as a toast instead of crashing. */
  act: <T>(fn: () => T, ok?: string) => T | undefined;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

export function AppProvider({ db, vault, onLock, children }: { db: Db; vault: Vault; onLock: () => void; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [scope, setScopeState] = useState<Scope>(() => (getSetting(db, 'last_scope', 'all') as Scope));
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [toastState, setToast] = useState<Toast | null>(null);
  const [day, setDay] = useState(today());
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setSaveState('saving');
    const bytes = db.export();
    saving.current = saving.current.then(() => vault.save(bytes)).then(() => setSaveState('saved'), (e) => {
      console.error(e);
      setSaveState('error');
      setToast({ msg: 'Could not save to this device. Export a backup now (Settings → Backup).', tone: 'bad' });
    });
    return saving.current;
  }, [db, vault]);

  useEffect(() => db.onChange(() => {
    setVersion((v) => v + 1);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 350);
  }), [db, flush]);

  // Save immediately when the app is hidden (switching apps, closing the lid).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && timer.current) flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
  }, [flush]);

  const lock = useCallback(async () => {
    if (timer.current) await flush(); else await saving.current;
    onLock();
  }, [flush, onLock]);

  // Auto-lock after inactivity, including while the app is in the background.
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const minutes = () => Number(getSetting(db, 'auto_lock_minutes', '5'));
    const check = () => {
      const m = minutes();
      if (m > 0 && Date.now() - last > m * 60_000) lock();
      const d = today();
      if (d !== day) { setDay(d); generateRecurring(db); }
    };
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    const ev = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    ev.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    const iv = window.setInterval(check, 15_000);
    return () => { ev.forEach((e) => window.removeEventListener(e, bump)); document.removeEventListener('visibilitychange', onVis); window.clearInterval(iv); };
  }, [db, lock, day]);

  useEffect(() => {
    if (!toastState) return;
    const t = window.setTimeout(() => setToast(null), toastState.action ? 7000 : 3500);
    return () => window.clearTimeout(t);
  }, [toastState]);

  // Theme
  useEffect(() => {
    const t = getSetting(db, 'theme', 'system');
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [db, version]);

  const fin = useMemo(() => new Finance(db, day), [db, version, day]);

  const value: AppCtx = {
    db, fin, version, scope, vault, lock, saveState,
    setScope: (s) => { setScopeState(s); setSetting(db, 'last_scope', s); },
    toast: (t) => setToast(typeof t === 'string' ? { msg: t } : t),
    snapshot: async (note) => { await vault.snapshot(db.export(), note); },
    setting: (k, f = '') => getSetting(db, k, f),
    updateSetting: (k, v) => setSetting(db, k, v),
    act: (fn, ok) => {
      try {
        const r = fn();
        if (ok) setToast({ msg: ok });
        return r;
      } catch (e: any) {
        setToast({ msg: e?.message ?? String(e), tone: 'bad' });
        return undefined;
      }
    },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastState && (
        <div className={`toast ${toastState.tone === 'bad' ? 'bad' : ''}`} role="status">
          <span>{toastState.msg}</span>
          {toastState.action && <button onClick={() => { toastState.action!.run(); setToast(null); }}>{toastState.action.label}</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
