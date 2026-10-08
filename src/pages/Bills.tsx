import { useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Money, Empty, Modal, Field, Text, Area, Select, MoneyInput, DateInput, Check, Chip, Segmented, Stat, useDraft } from '../ui/components';
import { accountOptions, categoryOptions } from '../ui/TxForm';
import { ConfirmReceived } from './IncomeExpenses';
import { FREQUENCIES, TRANSFER_TYPES, type Recurring, type TxKind, type Owner } from '../core/types';
import { saveRecurring, deleteRecurring } from '../core/repo';
import { today, formatDate, diffDays } from '../core/dates';
import { formatMoney } from '../core/money';
import { Icon } from '../ui/icons';
import type { TxRow } from '../core/finance';

export function RecurringForm({ r, onClose }: { r: Partial<Recurring>; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [d, p] = useDraft<Partial<Recurring>>({ kind: 'expense', unit: 'month', interval: 1, start_date: today(), auto_clear: 0, is_active: 1, ...r });
  const acct = fin.accounts.find((a) => a.id === d.account_id);
  const owner = (acct?.owner ?? d.owner ?? 'personal') as Owner;
  const preset = FREQUENCIES.findIndex((f) => f.unit === d.unit && f.interval === d.interval);
  const [custom, setCustom] = useState(preset < 0);
  const save = () => { if (act(() => saveRecurring(db, { ...d, owner }), d.id ? 'Recurring item updated' : 'Recurring item created') !== undefined) onClose(); };
  return (
    <Modal title={d.id ? 'Edit recurring item' : 'New recurring item'} onClose={onClose} footer={<>
      {d.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { act(() => deleteRecurring(db, d.id!), 'Deleted. Past transactions were kept.'); onClose(); }}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <Segmented label="Type" value={d.kind as TxKind} onChange={(k) => p({ kind: k, category_id: null })} options={[{ value: 'expense' as TxKind, label: 'Bill / expense' }, { value: 'income' as TxKind, label: 'Income' }, { value: 'transfer' as TxKind, label: 'Transfer / debt payment' }]} />
        <div className="form-grid">
          <Field label="Name" full><Text value={d.name} onChange={(v) => p({ name: v })} placeholder="e.g. Office internet" /></Field>
          <Field label="Amount"><MoneyInput value={d.amount} onChange={(v) => p({ amount: v ?? undefined })} currency={acct?.currency ?? 'USD'} /></Field>
          <Field label={d.kind === 'income' ? 'Deposited into' : d.kind === 'transfer' ? 'From account' : 'Paid from'}><Select value={d.account_id} onChange={(v) => p({ account_id: v })} options={accountOptions(fin.accounts, d.account_id)} placeholder="Choose…" /></Field>
          {d.kind === 'transfer' ? (<>
            <Field label="Transfer type"><Select value={d.transfer_type ?? 'transfer'} onChange={(v) => p({ transfer_type: v as any })} options={TRANSFER_TYPES.filter((t) => !['debt_proceeds', 'loan_repayment', 'loan_given'].includes(t.value)).map((t) => ({ value: t.value, label: t.label }))} /></Field>
            <Field label="To account"><Select value={d.to_account_id} onChange={(v) => p({ to_account_id: v })} options={accountOptions(fin.accounts, d.to_account_id).filter((o) => o.value !== d.account_id)} placeholder="Choose…" /></Field>
          </>) : <Field label="Category"><Select value={d.category_id} onChange={(v) => p({ category_id: v })} options={categoryOptions(fin.categories, d.kind as 'income' | 'expense', owner, d.category_id)} placeholder="Uncategorized" /></Field>}
          <Field label="Payee"><Text value={d.payee} onChange={(v) => p({ payee: v })} /></Field>
          <Field label="How often">
            <Select value={custom ? 'custom' : String(preset)} onChange={(v) => { if (v === 'custom') setCustom(true); else { setCustom(false); const f = FREQUENCIES[Number(v)]; p({ unit: f.unit, interval: f.interval }); } }} options={[...FREQUENCIES.map((f, i) => ({ value: String(i), label: f.label })), { value: 'custom', label: 'Custom…' }]} />
          </Field>
          {custom && <Field label="Every"><div className="row"><input className="input" type="number" min={1} value={d.interval ?? 1} onChange={(e) => p({ interval: Math.max(1, Number(e.target.value)) })} style={{ width: 80 }} /><Select value={d.unit} onChange={(v) => p({ unit: v as any })} options={[{ value: 'day', label: 'days' }, { value: 'week', label: 'weeks' }, { value: 'month', label: 'months' }, { value: 'year', label: 'years' }]} /></div></Field>}
          <Field label="First / next date"><DateInput value={d.start_date} onChange={(v) => p({ start_date: v })} /></Field>
          <Field label="End date (optional)"><DateInput value={d.end_date} onChange={(v) => p({ end_date: v || null })} /></Field>
          {d.kind === 'expense' && <Field label="Is it worth it?" hint="Used for the “could cancel” list"><Select value={d.subscription_value} onChange={(v) => p({ subscription_value: v as any })} options={[{ value: 'essential', label: 'Essential' }, { value: 'useful', label: 'Useful' }, { value: 'unsure', label: 'Not sure' }, { value: 'cancel', label: 'Plan to cancel' }]} placeholder="Not rated" /></Field>}
          <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
          <div className="full stack" style={{ gap: 8 }}>
            {d.kind === 'expense' && <Check checked={!!d.is_subscription} onChange={(v) => p({ is_subscription: v ? 1 : 0 })}>This is a subscription</Check>}
            {d.kind === 'expense' && <Check checked={!!d.is_bill} onChange={(v) => p({ is_bill: v ? 1 : 0 })}>This is a bill (rent, utilities, phone…)</Check>}
            <Check checked={!!d.auto_clear} onChange={(v) => p({ auto_clear: v ? 1 : 0 })}>Autopay: mark as completed automatically on each date</Check>
            <Check checked={!!d.is_active} onChange={(v) => p({ is_active: v ? 1 : 0 })}>Active</Check>
          </div>
        </div>
        <p className="tiny muted">Upcoming dates are added to your transactions as “scheduled” — they never affect balances until completed. If you import a bank statement, matching charges are linked to these instead of creating duplicates.</p>
      </div>
    </Modal>
  );
}

export default function Bills() {
  const { fin, scope, db, act } = useApp();
  const [tab, setTab] = useState<'upcoming' | 'recurring' | 'subs'>('upcoming');
  const [editing, setEditing] = useState<Partial<Recurring> | null>(null);
  const [confirm, setConfirm] = useState<TxRow | null>(null);
  const upcoming = fin.upcoming(scope, 45).filter((t) => t.kind !== 'income');
  const rules = fin.recurringViews(scope);
  const subs = fin.subscriptions(scope);
  const monthlyBills = rules.filter((r) => r.is_active && r.kind === 'expense').reduce((s, r) => s + r.monthlyBase, 0);
  const overdue = upcoming.filter((t) => t.late);

  return (<>
    <PageHead title="Bills & subscriptions" sub="Everything that repeats, what’s due next, and what you could cut.">
      <button className="btn primary" onClick={() => setEditing({ kind: 'expense', is_bill: 1 })}><Icon name="plus" />New recurring item</button>
    </PageHead>
    <div className="grid g4">
      <Stat label="Recurring costs / month" v={monthlyBills} sub="Bills + subscriptions + payroll" />
      <Stat label="Subscriptions / month" v={subs.monthly} sub={`${formatMoney(subs.annual, fin.base)} a year`} />
      <Stat label="Due in the next 30 days" v={upcoming.filter((t) => diffDays(fin.ref, t.date) <= 30).reduce((s, t) => s + t.base, 0)} />
      <Stat label="Overdue" v={overdue.reduce((s, t) => s + t.base, 0)} tone={overdue.length ? 'out' : undefined} sub={`${overdue.length} item${overdue.length === 1 ? '' : 's'}`} />
    </div>
    <div style={{ margin: '16px 0' }}><Segmented label="View" value={tab} onChange={setTab} options={[{ value: 'upcoming' as const, label: 'Upcoming' }, { value: 'recurring' as const, label: `All recurring (${rules.length})` }, { value: 'subs' as const, label: `Subscriptions (${subs.subs.length})` }]} /></div>

    {tab === 'upcoming' && (
      <Panel flush>
        {upcoming.length ? <div className="list">{upcoming.map((t) => (
          <div key={t.id} className="item">
            <div className="grow"><div className="title ellipsis">{t.payee || t.description}</div><div className="meta">{t.late ? <span className="neg">was due {formatDate(t.date)}</span> : `due ${formatDate(t.date)} · in ${diffDays(fin.ref, t.date)} days`} · {t.a_name ?? 'no account'}{t.owner === 'business' ? ' · Business' : ''}</div></div>
            <div className="amt"><Money v={t.amount} cur={t.currency} /></div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={() => setConfirm(t)}>Paid</button>
              <button className="btn ghost sm" onClick={() => act(() => db.run("UPDATE transactions SET status = 'cancelled' WHERE id = ?", [t.id]), 'Skipped this time')}>Skip</button>
            </div>
          </div>))}</div> : <Empty title="Nothing due in the next 45 days" action={<button className="btn" onClick={() => setEditing({ kind: 'expense', is_bill: 1 })}>Add a bill</button>}>Add recurring bills to see them here before they’re due.</Empty>}
      </Panel>
    )}

    {tab === 'recurring' && (
      <Panel flush>
        {rules.length ? <div className="list">{rules.map((r) => (
          <button key={r.id} className="item" onClick={() => setEditing(r)}>
            <span className="dot" style={{ background: r.kind === 'income' ? 'var(--income)' : r.kind === 'transfer' ? 'var(--ink-2)' : 'var(--spend)' }}><Icon name="repeat" size={16} /></span>
            <div className="grow"><div className="title ellipsis">{r.name} {!r.is_active && <Chip>Paused</Chip>} {r.is_subscription ? <Chip>Subscription</Chip> : null}</div><div className="meta">{r.frequency} · {r.next ? `next ${formatDate(r.next)}` : 'ended'} · {r.acct_name ?? '—'}{r.auto_clear ? ' · autopay' : ''}</div></div>
            <div className="amt"><Money v={r.amount} cur={r.currency} tone={r.kind === 'income' ? 'in' : 'none'} /><span className="alt">{formatMoney(r.monthly, r.currency)}/mo</span></div>
          </button>))}</div> : <Empty title="No recurring items" />}
      </Panel>
    )}

    {tab === 'subs' && (<div className="grid g2">
      <Panel title="Subscriptions I could cancel" flush>
        {subs.candidates.length ? <div className="list">{subs.candidates.map((s) => (
          <button key={s.id} className="item" onClick={() => setEditing(s)}>
            <div className="grow"><div className="title">{s.name}</div><div className="meta">{s.reasons.join(' · ')}</div></div>
            <div className="amt"><Money v={s.annualBase} /><span className="alt">per year</span></div>
          </button>))}</div> : <Empty title="Nothing flagged">Rate your subscriptions (essential / useful / not sure) to build this list.</Empty>}
        <p className="tiny muted" style={{ padding: '0 18px 14px' }}>Based only on how you rated each subscription and overlaps within a category — the app doesn’t know how much you use them.</p>
      </Panel>
      <Panel title="Renewing soon" flush>
        {subs.soon.length ? <div className="list">{subs.soon.map((s) => (
          <div key={s.id} className="item"><div className="grow"><div className="title">{s.name}</div><div className="meta">{formatDate(s.next)} · {s.frequency} · {s.acct_name}</div></div><div className="amt"><Money v={s.amount} cur={s.currency} /></div></div>))}</div> : <Empty title="No renewals in the next 2 weeks" />}
      </Panel>
      <Panel title="All subscriptions" flush className="span2">
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Subscription</th><th>Frequency</th><th>Next</th><th>Owner</th><th>Rating</th><th className="r">Monthly</th><th className="r">Yearly</th></tr></thead>
          <tbody>{subs.subs.map((s) => <tr key={s.id} onClick={() => setEditing(s)} style={{ cursor: 'pointer' }}><td>{s.name}</td><td>{s.frequency}</td><td>{formatDate(s.next)}</td><td>{s.owner}</td><td>{s.subscription_value ?? '—'}</td><td className="r">{formatMoney(s.monthly, s.currency)}</td><td className="r">{formatMoney(s.annual, s.currency)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>Total ({fin.base})</td><td className="r">{formatMoney(subs.monthly, fin.base)}</td><td className="r">{formatMoney(subs.annual, fin.base)}</td></tr></tfoot></table></div>
      </Panel>
    </div>)}
    {editing && <RecurringForm r={editing} onClose={() => setEditing(null)} />}
    {confirm && <ConfirmReceived t={confirm} onClose={() => setConfirm(null)} />}
  </>);
}
