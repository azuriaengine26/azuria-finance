import { useEffect, useRef, useState, Children, isValidElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app/context';
import { formatMoney, parseMoney, toDecimalString, currencyInfo, CURRENCIES } from '../core/money';
import type { Scope } from '../core/types';
import { Icon } from './icons';
import { isNative, saveFileNative } from '../app/native';

// ---------- Money ----------
export function useSecondary(): string | null {
  const { setting, fin } = useApp();
  if (setting('show_secondary', '1') !== '1') return null;
  const s = setting('secondary_currency', fin.base === 'USD' ? 'HNL' : 'USD');
  return s === fin.base ? null : s;
}

/** Amount display. `base` means v is already in the base currency (so a secondary-currency equivalent can be shown). */
export function Money({ v, cur, sign, tone, alt, compact, className }: { v: number; cur?: string; sign?: boolean; tone?: 'auto' | 'in' | 'out' | 'none'; alt?: boolean; compact?: boolean; className?: string }) {
  const { fin } = useApp();
  const sec = useSecondary();
  const c = cur ?? fin.base;
  const cls = tone === 'in' ? 'pos' : tone === 'out' ? 'neg' : tone === 'auto' ? (v < 0 ? 'neg' : v > 0 ? 'pos' : '') : '';
  const altCur = alt ? (c === fin.base ? sec : fin.base) : null;
  return (
    <span className={`num ${cls} ${className ?? ''}`}>
      {formatMoney(v, c, { sign, compact })}
      {altCur && <span className="alt">≈ {formatMoney(fin.conv(v, c, altCur), altCur, { compact })}</span>}
    </span>
  );
}

export function AltLine({ v, cur }: { v: number; cur?: string }) {
  const { fin } = useApp();
  const sec = useSecondary();
  const c = cur ?? fin.base;
  const altCur = c === fin.base ? sec : fin.base;
  if (!altCur) return null;
  return <div className="alt">≈ {formatMoney(fin.conv(v, c, altCur), altCur)}</div>;
}

export function Stat({ label, v, cur, sub, tone, children }: { label: string; v?: number; cur?: string; sub?: ReactNode; tone?: 'auto' | 'in' | 'out'; children?: ReactNode }) {
  const { fin } = useApp();
  return (
    <div className="panel stat">
      <div className="lbl">{label}</div>
      {v !== undefined && <div className={`val ${tone === 'in' ? 'pos' : tone === 'out' ? 'neg' : tone === 'auto' && v < 0 ? 'neg' : ''}`}>{formatMoney(v, cur ?? fin.base)}</div>}
      {v !== undefined && <AltLine v={v} cur={cur} />}
      {children}
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------- Layout pieces ----------
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · Azuria Finance`; }, [title]);
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

export function Panel({ title, action, children, flush, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`panel ${flush ? 'flush' : ''} ${className ?? ''}`}>
      {(title || action) && <div className="panel-head" style={flush ? { padding: '16px 18px 0', marginBottom: 10 } : undefined}><h2>{title}</h2>{action}</div>}
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Progress({ value, status }: { value: number | null; status?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return <div className={`bar ${status ?? ''}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${v}%` }} /></div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function ScopeSwitch() {
  const { scope, setScope, setting } = useApp();
  return <Segmented label="Show finances for" value={scope} onChange={setScope} options={[{ value: 'all' as Scope, label: 'All' }, { value: 'personal' as Scope, label: 'Personal' }, { value: 'business' as Scope, label: setting('business_name', 'Business').split(' ')[0] }]} />;
}

export function Chip({ children, kind }: { children: ReactNode; kind?: string }) {
  return <span className={`chip ${kind ?? ''}`}>{children}</span>;
}

export function OwnerChip({ owner }: { owner: string }) {
  return owner === 'business' ? <Chip kind="biz">Business</Chip> : <Chip>Personal</Chip>;
}

export function CatDot({ name, color }: { name?: string | null; color?: string | null }) {
  return <span className="dot" style={{ background: color ?? '#9a8a78' }} aria-hidden="true">{(name ?? '?').slice(0, 1).toUpperCase()}</span>;
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button.primary');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="sheet-head"><h2>{title}</h2><button className="btn ghost icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ title, children, confirmLabel, danger, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'danger solid' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
      <div className="stack">{children}</div>
    </Modal>
  );
}

// ---------- Form fields ----------
let fieldSeq = 0;
/**
 * Form field. A single input is wrapped in a <label>. Fields holding button groups (Segmented) render as a
 * labelled group instead: on iPhone Safari a tap on a button inside a <label> can be re-routed to the
 * label's first button, which made Personal/Business switches snap back.
 */
export function Field({ label, hint, children, full, group }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean; group?: boolean }) {
  const [id] = useState(() => `fld-${++fieldSeq}`);
  const isGroup = group || containsSegmented(children);
  if (isGroup) return <div className={`field ${full ? 'full' : ''}`} role="group" aria-labelledby={id}><span id={id}>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
  return <label className={`field ${full ? 'full' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function containsSegmented(node: ReactNode): boolean {
  let found = false;
  Children.forEach(node, (c) => {
    if (found || !isValidElement(c)) return;
    if (c.type === Segmented) found = true;
    else if ((c.props as any)?.children) found = containsSegmented((c.props as any).children);
  });
  return found;
}

export function Text({ value, onChange, ...rest }: { value: string | null | undefined; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Area({ value, onChange, ...rest }: { value: string | null | undefined; onChange: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  return <textarea className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function DateInput({ value, onChange, required }: { value: string | null | undefined; onChange: (v: string) => void; required?: boolean }) {
  return <input type="date" className="input" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string | number>({ value, onChange, options, placeholder }: { value: T | null | undefined; onChange: (v: T | null) => void; options: { value: T; label: string; group?: string }[]; placeholder?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const isNum = typeof options[0]?.value === 'number';
  const render = (os: typeof options) => os.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>);
  return (
    <select className="input" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : ((isNum ? Number(e.target.value) : e.target.value) as T))}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.length > 1 ? groups.map((g) => <optgroup key={g} label={g}>{render(options.filter((o) => (o.group ?? '') === g))}</optgroup>) : render(options)}
    </select>
  );
}

/** Money input: holds the raw text, reports minor units (or null if empty/invalid). */
export function MoneyInput({ value, onChange, currency, big, allowNegative, id }: { value: number | null | undefined; onChange: (v: number | null) => void; currency: string; big?: boolean; allowNegative?: boolean; id?: string }) {
  const [text, setText] = useState(value == null ? '' : toDecimalString(value, currencyInfo(currency).decimals));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    // keep in sync when the value is changed from outside
    let cur: number | null = null;
    try { cur = text.trim() ? parseMoney(text) : null; } catch { /* ignore */ }
    if (cur !== (value ?? null)) setText(value == null ? '' : toDecimalString(value, currencyInfo(currency).decimals));
  }, [value]);
  return (
    <div className={`money-input ${big ? 'big' : ''}`}>
      <span className="cur">{currency}</span>
      <input id={id} className="input" inputMode="decimal" autoComplete="off" value={text} aria-invalid={bad}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (!t.trim()) { setBad(false); onChange(null); return; }
          try { let v = parseMoney(t); if (!allowNegative) v = Math.abs(v); setBad(false); onChange(v); } catch { setBad(true); onChange(null); }
        }}
        style={bad ? { outline: '2px solid var(--spend)' } : undefined}
        placeholder="0.00" />
    </div>
  );
}

export function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onChange={(v) => onChange(v ?? 'USD')} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />;
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

/** Hook for a simple editable object with patch(). */
export function useDraft<T extends object>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  return [draft, patch, setDraft] as const;
}

/** Raised so the app shell can show download problems as a toast. */
export const DOWNLOAD_EVENT = 'az-download-status';

let downloadsCap: Promise<any> | null = null;
function viewerDownloads(): Promise<any> {
  // Inside the Claude artifact viewer, files must be offered through its "downloads" capability.
  const c = (window as any).claude;
  if (!c?.use) return Promise.resolve(null);
  return (downloadsCap ??= c.use('downloads').catch(() => null));
}

/**
 * Save a generated file. In a browser or the Mac app this triggers a normal download / save dialog;
 * inside the Claude preview it asks the viewer to confirm the save.
 */
export async function download(filename: string, data: BlobPart, type = 'text/plain'): Promise<boolean> {
  const blob = new Blob([data], { type });
  if (isNative()) {
    try {
      const ok = await saveFileNative(filename, blob);
      return ok;
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent(DOWNLOAD_EVENT, { detail: { ok: false, filename, message: `Couldn’t share ${filename}: ${e?.message ?? e}` } }));
      return false;
    }
  }
  const cap = await viewerDownloads();
  if (cap) {
    try {
      await cap.save({ filename, data: blob });
      window.dispatchEvent(new CustomEvent(DOWNLOAD_EVENT, { detail: { ok: true, filename } }));
      return true;
    } catch (e: any) {
      if (e?.code !== 'declined') window.dispatchEvent(new CustomEvent(DOWNLOAD_EVENT, { detail: { ok: false, filename, message: e?.message || 'This file could not be saved here.' } }));
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export function readFile(file: File, as: 'text' | 'buffer'): Promise<any> {
  return as === 'text' ? file.text() : file.arrayBuffer();
}
