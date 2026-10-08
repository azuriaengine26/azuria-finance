import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Money, Empty, Modal, Field, Text, Area, Select, MoneyInput, DateInput, CurrencySelect, Chip, Segmented, Stat, Progress, useDraft } from '../ui/components';
import { accountOptions } from '../ui/TxForm';
import { MultiLine } from '../ui/charts';
import { simulatePayoff } from '../core/finance';
import { recordDebtPayment, adjustDebt } from '../core/repo';
import { today, formatDate, addMonths, diffDays, monthLabel, monthKey } from '../core/dates';
import { formatMoney } from '../core/money';
import type { Debt, Owner } from '../core/types';
import { Icon } from '../ui/icons';

const TYPES = [
  { value: 'credit_card', label: 'Credit card' }, { value: 'personal_loan', label: 'Personal loan' }, { value: 'business_loan', label: 'Business loan' },
  { value: 'person', label: 'Money borrowed from a person' }, { value: 'vendor', label: 'Vendor / supplier' }, { value: 'contractor', label: 'Contractor' }, { value: 'other', label: 'Other liability' },
];
const IOU_TYPES = ['person', 'vendor', 'contractor'];

function DebtForm({ debt, onClose }: { debt: Partial<Debt>; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [d, p] = useDraft<Partial<Debt>>({ type: 'personal_loan', owner: 'personal', currency: fin.base, interest_rate: '0', minimum_payment: 0, priority: 'medium', balance_date: today(), frequency: 'monthly', ...debt });
  const linkable = fin.accounts.filter((a) => ['credit_card', 'loan', 'other_liability'].includes(a.type));
  const save = () => {
    const ok = act(() => {
      if (!d.name?.trim()) throw new Error('Name is required');
      if (!/^\d+(\.\d+)?$/.test(String(d.interest_rate ?? '0'))) throw new Error('Interest rate must be a number like 18.99');
      const acct = linkable.find((a) => a.id === d.account_id);
      const data: any = { name: d.name.trim(), creditor: d.creditor || null, type: d.type, owner: acct?.owner ?? d.owner, account_id: d.account_id ?? null, currency: acct?.currency ?? d.currency,
        original_amount: d.original_amount ?? 0, opening_balance: d.account_id ? 0 : d.opening_balance ?? 0, balance_date: d.balance_date || today(), interest_rate: String(d.interest_rate || '0'),
        minimum_payment: d.minimum_payment ?? 0, due_day: d.due_day || null, due_date: d.due_date || null, frequency: d.frequency, start_date: d.start_date || null,
        target_payoff_date: d.target_payoff_date || null, priority: d.priority, notes: d.notes || null, is_closed: d.is_closed ?? 0 };
      if (d.id) db.update('debts', d.id, data); else db.insert('debts', data);
      return true;
    }, d.id ? 'Debt updated' : 'Debt added');
    if (ok) onClose();
  };
  return (
    <Modal title={d.id ? 'Edit debt' : 'Add debt or IOU'} onClose={onClose} footer={<>
      {d.id && <button className="btn" style={{ marginRight: 'auto' }} onClick={() => { act(() => db.update('debts', d.id!, { is_closed: d.is_closed ? 0 : 1 }), d.is_closed ? 'Reopened' : 'Marked as closed'); onClose(); }}>{d.is_closed ? 'Reopen' : 'Mark closed'}</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" full><Text value={d.name} onChange={(v) => p({ name: v })} placeholder="e.g. Car loan, Loan from Carlos" /></Field>
        <Field label="Type"><Select value={d.type} onChange={(v) => p({ type: v ?? 'other' })} options={TYPES} /></Field>
        <Field label="Who you owe"><Text value={d.creditor} onChange={(v) => p({ creditor: v })} /></Field>
        <Field label="Linked card/loan account" hint="If you track this card as an account, its balance is used automatically"><Select value={d.account_id} onChange={(v) => p({ account_id: v })} options={linkable.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} placeholder="Not linked — track balance here" /></Field>
        {!d.account_id && <>
          <Field label="Belongs to"><Segmented label="Owner" value={(d.owner ?? 'personal') as Owner} onChange={(v) => p({ owner: v })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} /></Field>
          <Field label="Currency"><CurrencySelect value={d.currency ?? fin.base} onChange={(v) => p({ currency: v })} /></Field>
          <Field label="Balance owed" hint="As of the date below"><MoneyInput value={d.opening_balance} onChange={(v) => p({ opening_balance: v ?? 0 })} currency={d.currency ?? fin.base} /></Field>
          <Field label="Balance as of"><DateInput value={d.balance_date} onChange={(v) => p({ balance_date: v })} /></Field>
        </>}
        <Field label="Original amount"><MoneyInput value={d.original_amount} onChange={(v) => p({ original_amount: v ?? 0 })} currency={d.currency ?? fin.base} /></Field>
        <Field label="Interest rate (APR %)"><input className="input" inputMode="decimal" value={d.interest_rate ?? ''} onChange={(e) => p({ interest_rate: e.target.value.replace(',', '.') })} /></Field>
        <Field label="Minimum payment"><MoneyInput value={d.minimum_payment} onChange={(v) => p({ minimum_payment: v ?? 0 })} currency={d.currency ?? fin.base} /></Field>
        <Field label="Payment frequency"><Select value={d.frequency} onChange={(v) => p({ frequency: v ?? 'monthly' })} options={['weekly', 'biweekly', 'monthly', 'quarterly', 'one-time'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} /></Field>
        <Field label="Due day of month"><input className="input" type="number" min={1} max={31} value={d.due_day ?? ''} onChange={(e) => p({ due_day: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Or a single due date"><DateInput value={d.due_date} onChange={(v) => p({ due_date: v || null })} /></Field>
        <Field label="Priority"><Select value={d.priority} onChange={(v) => p({ priority: (v ?? 'medium') as any })} options={['low', 'medium', 'high', 'critical'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} /></Field>
        <Field label="Start date"><DateInput value={d.start_date} onChange={(v) => p({ start_date: v || null })} /></Field>
        <Field label="Target payoff date"><DateInput value={d.target_payoff_date} onChange={(v) => p({ target_payoff_date: v || null })} /></Field>
        <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
      </div>
    </Modal>
  );
}

function PayDebt({ debt, onClose }: { debt: any; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [mode, setMode] = useState<'pay' | 'charge'>('pay');
  const [amount, setAmount] = useState<number | null>(debt.minimum_payment || null);
  const [interest, setInterest] = useState<number | null>(null);
  const [from, setFrom] = useState<number | null>(fin.accounts.find((a) => a.owner === debt.owner && a.type === 'checking' && a.is_active)?.id ?? null);
  const [date, setDate] = useState(today());
  const fromAcct = fin.accounts.find((a) => a.id === from);
  const go = () => {
    const ok = act(() => mode === 'pay'
      ? recordDebtPayment(db, debt.id, { date, amount: amount!, interest: interest ?? 0, from_account_id: from! })
      : adjustDebt(db, debt.id, { date, amount: amount!, kind: 'charge' }), mode === 'pay' ? 'Payment recorded' : 'Balance increased');
    if (ok !== undefined) onClose();
  };
  return (
    <Modal title={debt.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!amount || (mode === 'pay' && !from)} onClick={go}>{mode === 'pay' ? 'Record payment' : 'Add to balance'}</button></>}>
      <div className="stack">
        {!debt.account_id && <Segmented label="Action" value={mode} onChange={setMode} options={[{ value: 'pay' as const, label: 'Make a payment' }, { value: 'charge' as const, label: 'Borrowed more / interest' }]} />}
        <div className="form-grid">
          <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} currency={mode === 'pay' ? fromAcct?.currency ?? debt.currency : debt.currency} /></Field>
          <Field label="Date"><DateInput value={date} onChange={setDate} /></Field>
          {mode === 'pay' && <>
            <Field label="Paid from"><Select value={from} onChange={setFrom} options={accountOptions(fin.accounts.filter((a) => a.id !== debt.account_id), from)} placeholder="Choose…" /></Field>
            <Field label="Of which interest/fees" hint="Interest is an expense; the rest reduces the balance"><MoneyInput value={interest} onChange={setInterest} currency={fromAcct?.currency ?? debt.currency} /></Field>
          </>}
        </div>
        {mode === 'pay' && fromAcct && fromAcct.currency !== debt.currency && <div className="notice"><Icon name="info" /><span>Paying a {debt.currency} debt from a {fromAcct.currency} account: the debt is reduced using your current exchange rate.</span></div>}
      </div>
    </Modal>
  );
}

function Planner({ debts }: { debts: any[] }) {
  const { fin } = useApp();
  const eligible = debts.filter((d) => d.balance > 0 && d.minimum_payment > 0);
  const sumMin = eligible.reduce((s, d) => s + fin.conv(d.minimum_payment, d.currency), 0);
  const [budget, setBudget] = useState<number | null>(Math.ceil((sumMin * 1.25) / 10000) * 10000);
  const input = eligible.map((d) => ({ id: d.id, name: d.name, balance: d.balanceBase, apr: d.interest_rate || '0', minimum: fin.conv(d.minimum_payment, d.currency) }));
  const results = useMemo(() => ({
    avalanche: simulatePayoff(input, budget ?? sumMin, 'avalanche'),
    snowball: simulatePayoff(input, budget ?? sumMin, 'snowball'),
    minimum: simulatePayoff(input, sumMin, 'minimum'),
  }), [budget, fin]);
  if (!eligible.length) return <Panel title="Payoff planner"><p className="muted small">Add debts with a minimum payment to compare payoff strategies.</p></Panel>;
  const when = (m: number | null) => (m == null ? 'Not within 50 years' : `${monthLabel(monthKey(addMonths(fin.ref, m)))} (${m} mo)`);
  const rows = [
    { key: 'avalanche', name: 'Avalanche — highest interest first', r: results.avalanche, color: 'var(--azure)' },
    { key: 'snowball', name: 'Snowball — smallest balance first', r: results.snowball, color: 'var(--income)' },
    { key: 'minimum', name: 'Minimum payments only', r: results.minimum, color: 'var(--spend)' },
  ];
  const savings = results.snowball.totalInterest - results.avalanche.totalInterest;
  return (
    <Panel title="Payoff planner">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Field label={`Total you can put toward debt each month (${fin.base})`} hint={`Minimums add up to ${formatMoney(sumMin, fin.base)}`}><MoneyInput value={budget} onChange={setBudget} currency={fin.base} /></Field>
      </div>
      {(budget ?? 0) < sumMin && <div className="notice warn" style={{ marginBottom: 12 }}><Icon name="alert" /><span>That’s less than your minimum payments; the plan uses the minimums ({formatMoney(sumMin, fin.base)}).</span></div>}
      {results.minimum.stuck.length > 0 && <div className="notice bad" style={{ marginBottom: 12 }}><Icon name="alert" /><span>{results.minimum.stuck.join(', ')}: the minimum payment doesn’t cover the monthly interest, so the balance would never go down on minimums alone.</span></div>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Strategy</th><th>Debt-free</th><th className="r">Total interest</th><th>Pays off first</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.key}><td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: x.color, marginRight: 8 }} />{x.name}</td><td>{when(x.r.months)}</td><td className="r">{formatMoney(x.r.totalInterest, fin.base)}</td><td>{x.r.order[0]?.name ?? '—'}</td></tr>)}</tbody></table></div>
      <div style={{ marginTop: 14 }}><MultiLine series={[rows[2], rows[1], rows[0]].map((x) => ({ name: x.name.split(' —')[0], color: x.color, values: x.r.series.slice(0, 361), dashed: x.key === 'avalanche' }))} /></div>
      <div className="stack small" style={{ marginTop: 12, gap: 6 }}>
        <p><b>How to read this:</b> {savings > 0 ? `Avalanche costs ${formatMoney(savings, fin.base)} less in interest than snowball with this budget.` : 'Both methods cost about the same in interest here.'} Snowball clears small balances sooner, which some people find motivating. Paying more than the minimums is what shortens the timeline most.</p>
        <p className="muted">Assumes interest compounds monthly at each APR, no new charges, and the same total payment every month. Order of payoff (avalanche): {results.avalanche.order.map((o) => `${o.name} (month ${o.month})`).join(' → ') || '—'}. This is a calculation, not financial advice — the choice is yours.</p>
      </div>
    </Panel>
  );
}

export default function DebtPage() {
  const { fin, scope } = useApp();
  const [editing, setEditing] = useState<Partial<Debt> | null>(null);
  const [paying, setPaying] = useState<any>(null);
  const [showHist, setShowHist] = useState<number | null>(null);
  const s = fin.debtSummary(scope);
  const loans = s.debts.filter((d) => !IOU_TYPES.includes(d.type));
  const ious = s.debts.filter((d) => IOU_TYPES.includes(d.type));
  const upcoming = s.debts.filter((d) => d.nextDue && d.balance > 0).sort((a, b) => a.nextDue!.localeCompare(b.nextDue!)).slice(0, 5);
  const prioChip = (p: string) => <Chip kind={p === 'critical' || p === 'high' ? 'bad' : p === 'medium' ? 'warn' : ''}>{p} priority</Chip>;

  const list = (rows: typeof s.debts) => (
    <div className="list">{rows.map((d) => (
      <div key={d.id}>
        <div className="item">
          <div className="grow">
            <div className="title ellipsis">{d.name} {d.is_demo ? <Chip kind="demo">Demo</Chip> : null}</div>
            <div className="meta">{d.creditor ?? ''}{d.interest_rate !== '0' ? ` · ${d.interest_rate}% APR` : ''}{d.minimum_payment ? ` · min ${formatMoney(d.minimum_payment, d.currency)}` : ''}{d.nextDue ? ` · due ${formatDate(d.nextDue)}` : ''}{d.account_id ? ' · linked account' : ''}</div>
            {d.progress != null && <div style={{ marginTop: 6, maxWidth: 320 }}><Progress value={d.progress} status="ok" /></div>}
          </div>
          <div className="hide-m">{prioChip(d.priority)}</div>
          <div className="amt"><Money v={d.balance} cur={d.currency} tone={d.balance > 0 ? 'out' : 'none'} /><span className="alt">{d.paidThisMonth ? `paid ${formatMoney(d.paidThisMonth, d.currency)} this month` : 'owed'}</span></div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setPaying(d)}>Pay</button>
            <button className="btn ghost sm" onClick={() => setShowHist(showHist === d.id ? null : d.id)} aria-label="History"><Icon name="list" /></button>
            <button className="btn ghost sm" onClick={() => setEditing(d)} aria-label="Edit"><Icon name="edit" /></button>
          </div>
        </div>
        {showHist === d.id && <div style={{ padding: '0 18px 12px' }} className="small">
          {d.account_id ? <p className="muted">Payments to the linked account appear in Transactions.</p> : d.history.length ? d.history.map((h: any) => <div key={h.id} className="spread muted"><span>{formatDate(h.date)} · {h.kind}</span><span className="num">{formatMoney(-h.principal, d.currency, { sign: true })}{h.interest ? ` (+${formatMoney(h.interest, d.currency)} interest)` : ''}</span></div>) : <p className="muted">No payments yet.</p>}
        </div>}
      </div>))}</div>
  );

  return (<>
    <PageHead title="Debt & IOUs" sub="What you owe — loans, cards, and money owed to people.">
      <button className="btn primary" onClick={() => setEditing({ owner: scope === 'business' ? 'business' : 'personal' })}><Icon name="plus" />Add debt or IOU</button>
    </PageHead>
    <div className="grid g4">
      <Stat label="Total debt" v={s.total} tone={s.total ? 'out' : undefined} />
      <Stat label="Paid this month" v={s.paidThisMonth} tone="in" />
      <Stat label="Minimum payments / month" v={s.minimums} />
      <Stat label="Debt-to-income" sub={`Minimums ÷ avg monthly income (${formatMoney(s.avgIncome, fin.base, { compact: true })})`}><div className="val">{s.dti != null ? `${s.dti}%` : '—'}</div></Stat>
    </div>
    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Loans & cards" flush className="span2">{loans.length ? list(loans) : <Empty title="No loans or cards" />}</Panel>
      <Panel title="Upcoming payments" flush>{upcoming.length ? <div className="list">{upcoming.map((d) => <div key={d.id} className="item"><div className="grow"><div className="title">{d.name}</div><div className="meta">{formatDate(d.nextDue)} · in {diffDays(fin.ref, d.nextDue!)} days</div></div><div className="amt"><Money v={d.minimum_payment || d.balance} cur={d.currency} /><span className="alt">{d.minimum_payment ? 'minimum' : 'balance due'}</span></div></div>)}</div> : <Empty title="No due dates set" />}</Panel>
    </div>
    <Panel title="Money I owe people & vendors" flush className="">{ious.length ? list(ious) : <Empty title="No IOUs" action={<button className="btn" onClick={() => setEditing({ type: 'person' })}>Add an IOU</button>}>Track money borrowed from friends and family, or owed to vendors and contractors.</Empty>}</Panel>
    <Planner debts={s.debts} />
    {editing && <DebtForm debt={editing} onClose={() => setEditing(null)} />}
    {paying && <PayDebt debt={paying} onClose={() => setPaying(null)} />}
  </>);
}

export { Area };
