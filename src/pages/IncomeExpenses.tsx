import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Stat, Money, Empty, Chip, Modal, Field, DateInput, MoneyInput, Select, Segmented } from '../ui/components';
import { PairBars, RankBars } from '../ui/charts';
import { TxForm, accountOptions } from '../ui/TxForm';
import { presetRange, lastMonths, formatDate, today, diffDays, RANGE_LABELS, type RangePreset } from '../core/dates';
import { markReceived } from '../core/repo';
import { formatMoney } from '../core/money';
import { MissingRates } from './Dashboard';
import { Icon } from '../ui/icons';
import type { TxRow } from '../core/finance';

export function ConfirmReceived({ t, onClose }: { t: TxRow; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [date, setDate] = useState(t.date > today() ? today() : t.date);
  const [amount, setAmount] = useState<number | null>(t.amount);
  const [account, setAccount] = useState<number | null>(t.account_id);
  return (
    <Modal title={t.kind === 'income' ? 'Mark as received' : 'Mark as paid'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!amount || !account} onClick={() => { act(() => markReceived(db, t.id, { date, amount: amount!, account_id: account! }), t.kind === 'income' ? 'Marked as received' : 'Marked as paid'); onClose(); }}>Confirm</button></>}>
      <div className="form-grid">
        <Field label="Date" ><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Actual amount"><MoneyInput value={amount} onChange={setAmount} currency={t.currency} /></Field>
        <Field label={t.kind === 'income' ? 'Deposited into' : 'Paid from'} full><Select value={account} onChange={setAccount} options={accountOptions(fin.accounts, account)} placeholder="Choose…" /></Field>
      </div>
    </Modal>
  );
}

export function IncomePage() {
  const { fin, scope } = useApp();
  const [confirm, setConfirm] = useState<TxRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState<RangePreset>('this_year');
  const ov = fin.incomeOverview(scope);
  const r = presetRange(range, fin.ref);
  const open = ov.items.filter((i) => i.state === 'expected' || i.state === 'pending' || i.state === 'late').sort((a, b) => a.date.localeCompare(b.date));
  const received = ov.items.filter((i) => i.state === 'received').slice(0, 12);
  const byClient = fin.byClient(scope, r);
  const bySource = fin.byCategory(scope, r, 'income');
  const months = fin.monthly(scope, lastMonths(fin.ref, 12));

  return (<>
    <PageHead title="Income" sub="Expected vs. received — only received money counts in totals and balances.">
      <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add expected income</button>
    </PageHead>
    <MissingRates />
    <div className="grid g4">
      <Stat label="Expected this month" v={ov.expectedThisMonth} sub="Scheduled income + open invoices due" />
      <Stat label="Expected next month" v={ov.expectedNextMonth} />
      <Stat label="Received this month" v={ov.receivedThisMonth} tone="in" sub={`This year ${formatMoney(ov.receivedThisYear, fin.base, { compact: true })}`} />
      <Stat label="Late" v={ov.lateTotal} tone={ov.lateTotal ? 'out' : undefined} sub="Past due date and not received" />
    </div>

    <div className="grid g2" style={{ marginTop: 16 }}>
      <Panel title="Waiting to be received" flush>
        {open.length || ov.invoicesDue.length ? <div className="list">
          {open.map((t) => (
            <div key={t.id} className="item">
              <div className="grow"><div className="title ellipsis">{t.payee || t.description}</div><div className="meta">{t.client_name ? t.client_name + ' · ' : ''}{t.state === 'late' ? <span className="neg">expected {formatDate(t.date)} ({diffDays(t.date, fin.ref)} days late)</span> : `expected ${formatDate(t.date)}`} · {t.a_name ?? 'account not set'}</div></div>
              <div className="amt"><Money v={t.amount} cur={t.currency} /></div>
              <button className="btn sm" onClick={() => setConfirm(t)}>Received</button>
            </div>
          ))}
          {ov.invoicesDue.map((i) => (
            <Link key={'i' + i.id} to="/clients" className="item">
              <div className="grow"><div className="title ellipsis">{i.kind === 'loan' ? 'Loan to ' : 'Invoice '}{i.number ?? ''} — {i.client_name}</div><div className="meta">{i.due_date ? `due ${formatDate(i.due_date)}` : 'no due date'} · <Chip kind={i.state}>{i.state.replace('_', ' ')}</Chip></div></div>
              <div className="amt"><Money v={i.outstanding} cur={i.currency} /></div>
            </Link>
          ))}
        </div> : <Empty title="Nothing outstanding">Add expected income or create invoices to see what’s coming.</Empty>}
      </Panel>
      <Panel title="Received recently" flush>
        {received.length ? <div className="list">{received.map((t) => (
          <div key={t.id} className="item">
            <div className="grow"><div className="title ellipsis">{t.payee || t.description}</div><div className="meta">{formatDate(t.date)} · {t.cat_name ?? 'Uncategorized'} · {t.a_name}{t.expected_date && t.expected_date !== t.date ? ` · expected ${formatDate(t.expected_date)}` : ''}</div></div>
            <div className="amt"><Money v={t.amount} cur={t.currency} tone="in" /></div>
          </div>))}</div> : <Empty title="No income yet" />}
      </Panel>
    </div>

    <Panel title="Income by month" className="" action={null}>
      <PairBars data={months.map((m) => ({ label: m.label, a: m.income }))} aLabel="Income received" height={200} />
    </Panel>

    <div className="row" style={{ margin: '16px 0 8px' }}><Select value={range} onChange={(v) => setRange((v ?? 'this_year') as RangePreset)} options={(['this_month', 'last_month', 'this_quarter', 'this_year', 'last_year', 'last_12'] as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} /></div>
    <div className="grid g2">
      <Panel title="By client / payer">{byClient.length ? <RankBars rows={byClient.map((c) => ({ name: c.name, amount: c.amount, color: 'var(--income)' }))} /> : <p className="muted small">No income in this period.</p>}</Panel>
      <Panel title="By source">{bySource.length ? <RankBars rows={bySource} /> : <p className="muted small">No income in this period.</p>}</Panel>
    </div>
    {confirm && <ConfirmReceived t={confirm} onClose={() => setConfirm(null)} />}
    {adding && <TxForm initial={{ kind: 'income', status: 'expected', owner: scope === 'personal' ? 'personal' : 'business', account_id: fin.accounts.find((a) => a.owner === (scope === 'personal' ? 'personal' : 'business') && a.is_active && a.type === 'checking')?.id ?? null }} onClose={() => setAdding(false)} />}
  </>);
}

export function ExpensesPage() {
  const { fin, scope } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState<RangePreset>('this_month');
  const [view, setView] = useState<'cat' | 'payee'>('cat');
  const r = presetRange(range, fin.ref);
  const t = fin.totals(scope, r);
  const biz = fin.totals('business', r), per = fin.totals('personal', r);
  const cats = fin.byCategory(scope, r, 'expense');
  const payees = fin.byPayee(scope, r, 'expense');
  const months = fin.monthly(scope, lastMonths(fin.ref, 12));
  const recurring = fin.recurringViews(scope).filter((x) => x.is_active && x.kind === 'expense').reduce((s, x) => s + x.monthlyBase, 0);
  const yr = fin.totals(scope, presetRange('this_year', fin.ref));

  return (<>
    <PageHead title="Expenses" sub="Where the money goes. Transfers, savings moves and card payments are never counted here.">
      <Select value={range} onChange={(v) => setRange((v ?? 'this_month') as RangePreset)} options={(['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'last_12'] as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} />
    </PageHead>
    <MissingRates />
    <div className="grid g4">
      <Stat label={`Spent · ${RANGE_LABELS[range].toLowerCase()}`} v={t.expense} tone="out" />
      <Stat label="This year" v={yr.expense} />
      {scope === 'all' ? <><Stat label="Business" v={biz.expense} /><Stat label="Personal" v={per.expense} /></>
        : <><Stat label="Recurring, per month" v={recurring} sub="Bills + subscriptions" /><Stat label="Largest category" v={cats[0]?.amount ?? 0} sub={cats[0]?.name ?? '—'} /></>}
    </div>
    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title={view === 'cat' ? 'By category' : 'By merchant'} action={<Segmented label="Group by" value={view} onChange={setView} options={[{ value: 'cat' as const, label: 'Category' }, { value: 'payee' as const, label: 'Merchant' }]} />}>
        {(view === 'cat' ? cats : payees).length ? <RankBars rows={view === 'cat' ? cats : payees.map((p) => ({ ...p, color: 'var(--spend)' }))} max={12} onPick={(name) => { const c = cats.find((x) => x.name === name); if (view === 'cat' && c && typeof c.id === 'number') nav(`/transactions?category=${c.id}`); }} /> : <p className="muted small">No expenses in this period.</p>}
      </Panel>
      <Panel title="Spending by month" className="span2">
        <PairBars data={months.map((m) => ({ label: m.label, a: m.expense }))} aLabel="Expenses" height={240} aColor="var(--spend)" />
      </Panel>
    </div>
  </>);
}
