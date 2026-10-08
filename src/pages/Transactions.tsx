import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Money, Empty, Field, Select, Text, MoneyInput, DateInput, Chip, CatDot, download, Segmented } from '../ui/components';
import { TxForm, accountOptions, categoryOptions } from '../ui/TxForm';
import { presetRange, RANGE_LABELS, type RangePreset, formatDate } from '../core/dates';
import { formatMoney, toDecimalString } from '../core/money';
import { toCSV } from '../core/backup';
import type { TxRow } from '../core/finance';
import { Icon } from '../ui/icons';

export interface TxFilter {
  preset: RangePreset; from?: string; to?: string; account?: number | null; kind?: string | null; category?: number | null;
  text?: string; min?: number | null; max?: number | null; tag?: string | null; client?: number | null; tax?: string | null; status?: string | null;
}

export function TxRowItem({ t, onOpen }: { t: TxRow & { tagNames?: string[] }; onOpen: () => void }) {
  const isTransfer = t.kind === 'transfer';
  const title = t.payee || t.description || (isTransfer ? 'Transfer' : t.cat_name) || '—';
  const meta = isTransfer
    ? `${t.a_name ?? 'External'} → ${t.ta_name ?? (t.transfer_type === 'debt_payment' ? 'debt' : 'external')}`
    : `${t.cat_name ?? 'Uncategorized'} · ${t.a_name ?? 'no account'}`;
  return (
    <button className="item" onClick={onOpen}>
      {isTransfer ? <span className="dot" style={{ background: 'var(--ink-2)' }}><Icon name="swap" size={16} /></span> : <CatDot name={t.cat_name ?? title} color={t.cat_color} />}
      <div className="grow">
        <div className="title ellipsis">{title}</div>
        <div className="meta ellipsis">
          {meta}
          {t.owner === 'business' && !isTransfer && <> · <span style={{ color: 'var(--accent)' }}>Business</span></>}
          {t.status !== 'cleared' && <> · <Chip kind={t.status}>{t.status === 'expected' ? (t.kind === 'income' ? 'Expected' : 'Scheduled') : t.status}</Chip></>}
          {t.is_demo ? <> · demo</> : null}
        </div>
      </div>
      <div className="amt">
        <Money v={t.kind === 'expense' ? -t.amount : t.amount} cur={t.currency} tone={t.kind === 'income' ? 'in' : 'none'} sign={t.kind === 'income'} />
        {isTransfer && <span className="alt">{t.transfer_type?.replace('_', ' ')}</span>}
      </div>
    </button>
  );
}

export function applyFilter(rows: TxRow[], f: TxFilter, tagsOf: Map<number, string[]>): TxRow[] {
  const r = f.preset === 'custom' ? { from: f.from || '1900-01-01', to: f.to || '2999-12-31' } : presetRange(f.preset);
  const text = f.text?.toLowerCase().trim();
  return rows.filter((t) => {
    if (t.date < r.from || t.date > r.to) return false;
    if (f.account && t.account_id !== f.account && t.to_account_id !== f.account) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.category && t.category_id !== f.category && t.cat_parent !== f.category) return false;
    if (f.client && t.client_id !== f.client) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.min != null && t.amount < f.min) return false;
    if (f.max != null && t.amount > f.max) return false;
    if (f.tax === 'yes' && t.tax_deductible !== 1) return false;
    if (f.tax === 'no' && t.tax_deductible !== 0) return false;
    if (f.tag && !(tagsOf.get(t.id) ?? []).some((x) => x.toLowerCase() === f.tag!.toLowerCase())) return false;
    if (text && ![t.payee, t.description, t.notes, t.reference, t.cat_name, t.client_name].some((s) => s?.toLowerCase().includes(text))) return false;
    return true;
  });
}

export default function Transactions() {
  const { fin, db, scope } = useApp();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<TxFilter>({ preset: 'last_12' });
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<TxRow | null>(null);
  const [limit, setLimit] = useState(150);
  const p = (x: Partial<TxFilter>) => { setF((o) => ({ ...o, ...x })); setLimit(150); };

  useEffect(() => {
    const id = Number(params.get('id'));
    if (id) { const t = fin.tx.find((x) => x.id === id); if (t) setEditing(t); }
    const cat = Number(params.get('category'));
    if (cat) p({ category: cat });
  }, []);

  const tagsOf = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const r of db.all<{ tid: number; name: string }>('SELECT tt.transaction_id tid, g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id')) m.set(r.tid, [...(m.get(r.tid) ?? []), r.name]);
    return m;
  }, [fin]);
  const allTags = useMemo(() => db.all<{ name: string }>('SELECT name FROM tags ORDER BY name').map((r) => r.name), [fin]);
  const clients = db.all<{ id: number; name: string }>('SELECT id, name FROM clients ORDER BY name');

  const rows = useMemo(() => applyFilter(fin.tx.filter((t) => scope === 'all' || t.owner === scope || (t.kind === 'transfer' && (t.a_owner === scope || t.ta_owner === scope))), f, tagsOf), [fin, f, scope, tagsOf]);
  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of rows) if (t.status === 'cleared') { if (t.kind === 'income') inc += fin.conv(t.amount, t.currency); if (t.kind === 'expense') exp += fin.conv(t.amount, t.currency); }
    return { inc, exp };
  }, [rows]);

  const exportCsv = () => {
    const header = ['Date', 'Type', 'Status', 'Personal/Business', 'Account', 'To account', 'Payee', 'Description', 'Category', 'Amount', 'Currency', 'Client', 'Tags', 'Tax deductible', 'Notes'];
    download(`transactions-${f.preset}.csv`, toCSV([header, ...rows.map((t) => [t.date, t.kind, t.status, t.owner, t.a_name, t.ta_name, t.payee, t.description, t.cat_name, toDecimalString(t.kind === 'expense' ? -t.amount : t.amount), t.currency, t.client_name, (tagsOf.get(t.id) ?? []).join('; '), t.tax_deductible == null ? '' : t.tax_deductible ? 'yes' : 'no', t.notes])]), 'text/csv');
  };

  // group by day
  const groups: { date: string; items: TxRow[] }[] = [];
  for (const t of rows.slice(0, limit)) {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  }
  const activeFilters = Object.entries(f).filter(([k, v]) => k !== 'preset' && k !== 'from' && k !== 'to' && v != null && v !== '').length;

  return (<>
    <PageHead title="Transactions" sub={`${rows.length} transactions · ${RANGE_LABELS[f.preset]}`}>
      <button className="btn" onClick={exportCsv}><Icon name="download" />Export CSV</button>
    </PageHead>
    <Panel>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow" style={{ minWidth: 200 }}><Text value={f.text} onChange={(v) => p({ text: v })} placeholder="Filter by payee, description, notes, category…" aria-label="Filter text" /></div>
        <div style={{ width: 170 }}><Select value={f.preset} onChange={(v) => p({ preset: (v ?? 'last_12') as RangePreset })} options={(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} /></div>
        <Segmented label="Type" value={(f.kind ?? 'any') as string} onChange={(v) => p({ kind: v === 'any' ? null : v })} options={[{ value: 'any', label: 'All' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expenses' }, { value: 'transfer', label: 'Transfers' }]} />
        <button className="btn" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>Filters{activeFilters ? ` (${activeFilters})` : ''}</button>
      </div>
      {f.preset === 'custom' && <div className="row" style={{ marginTop: 10 }}><DateInput value={f.from} onChange={(v) => p({ from: v })} /><span className="muted">to</span><DateInput value={f.to} onChange={(v) => p({ to: v })} /></div>}
      {showFilters && (
        <div className="form-grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          <Field label="Account"><Select value={f.account} onChange={(v) => p({ account: v })} options={accountOptions(fin.accounts)} placeholder="Any" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(v) => p({ category: v })} options={[...categoryOptions(fin.categories, 'expense', 'all'), ...categoryOptions(fin.categories, 'income', 'all').map((o) => ({ ...o, group: 'Income · ' + (o.group ?? '') }))]} placeholder="Any" /></Field>
          <Field label="Client"><Select value={f.client} onChange={(v) => p({ client: v })} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="Any" /></Field>
          <Field label="Tag"><Select value={f.tag} onChange={(v) => p({ tag: v })} options={allTags.map((t) => ({ value: t, label: t }))} placeholder="Any" /></Field>
          <Field label="Status"><Select value={f.status} onChange={(v) => p({ status: v })} options={[{ value: 'cleared', label: 'Completed' }, { value: 'pending', label: 'Pending' }, { value: 'expected', label: 'Expected / scheduled' }, { value: 'cancelled', label: 'Cancelled' }]} placeholder="Any" /></Field>
          <Field label="Tax deductible"><Select value={f.tax} onChange={(v) => p({ tax: v })} options={[{ value: 'yes', label: 'Marked deductible' }, { value: 'no', label: 'Marked non-deductible' }]} placeholder="Any" /></Field>
          <Field label="Min amount"><MoneyInput value={f.min} onChange={(v) => p({ min: v })} currency="" /></Field>
          <Field label="Max amount"><MoneyInput value={f.max} onChange={(v) => p({ max: v })} currency="" /></Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setF({ preset: f.preset })}>Clear filters</button></div>
        </div>
      )}
      <div className="row wrap small" style={{ marginTop: 12, gap: "6px 18px" }}>
        <span className="muted">Completed in view:</span>
        <span>In <b className="num pos">{formatMoney(totals.inc, fin.base)}</b></span>
        <span>Out <b className="num neg">{formatMoney(totals.exp, fin.base)}</b></span>
        <span>Net <b className="num">{formatMoney(totals.inc - totals.exp, fin.base, { sign: true })}</b></span>
      </div>
    </Panel>

    <Panel flush className="" >
      {rows.length === 0 ? <Empty title="No matching transactions">Try a wider date range or clear the filters.</Empty> : (
        <div className="list">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="day-head"><span>{formatDate(g.date, 'long')}</span></div>
              {g.items.map((t) => <TxRowItem key={t.id} t={t} onOpen={() => setEditing(t)} />)}
            </div>
          ))}
          {rows.length > limit && <div style={{ padding: 14, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 300)}>Show more ({rows.length - limit} remaining)</button></div>}
        </div>
      )}
    </Panel>
    {editing && <TxForm tx={db.get('SELECT * FROM transactions WHERE id = ?', [editing.id]) as any} onClose={() => { setEditing(null); if (params.get('id')) setParams({}); }} />}
  </>);
}
