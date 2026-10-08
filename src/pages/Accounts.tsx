import { useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Money, Empty, Modal, Field, Text, Area, Select, MoneyInput, DateInput, CurrencySelect, Check, Chip, Segmented, Stat, useDraft } from '../ui/components';
import { TxForm } from '../ui/TxForm';
import { Spark } from '../ui/charts';
import { ACCOUNT_TYPES, isLiabilityType, type Account, type Owner } from '../core/types';
import { saveAccount, deleteAccount } from '../core/repo';
import { today, lastMonths, monthEnd } from '../core/dates';
import { formatMoney } from '../core/money';
import { Icon } from '../ui/icons';
import type { AccountView } from '../core/finance';

function AccountForm({ acct, onClose }: { acct?: Account | null; onClose: () => void }) {
  const { db, act, scope } = useApp();
  const [d, p] = useDraft<Partial<Account>>(acct ?? { type: 'checking', owner: scope === 'business' ? 'business' : 'personal', currency: 'USD', starting_balance: 0, starting_date: today(), is_active: 1, include_in_net_worth: 1 });
  const liability = isLiabilityType(d.type ?? '');
  // Liabilities are stored as negative balances; the form asks for "amount owed" to keep it intuitive.
  const [owed, setOwed] = useState<number | null>(liability ? -(d.starting_balance ?? 0) : null);
  const save = () => {
    const starting_balance = liability ? -(owed ?? 0) : d.starting_balance ?? 0;
    if (act(() => saveAccount(db, { ...d, starting_balance }), acct ? 'Account updated' : 'Account added') !== undefined) onClose();
  };
  return (
    <Modal title={acct ? 'Edit account' : 'New account'} onClose={onClose} footer={<>
      {acct && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { if (act(() => deleteAccount(db, acct.id), 'Account deleted') !== undefined) onClose(); }}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{acct ? 'Save changes' : 'Add account'}</button></>}>
      <div className="form-grid">
        <Field label="Name" full><Text value={d.name} onChange={(v) => p({ name: v })} placeholder="e.g. Azuria Business Checking" /></Field>
        <Field label="Belongs to"><Segmented label="Owner" value={(d.owner ?? 'personal') as Owner} onChange={(v) => p({ owner: v })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} /></Field>
        <Field label="Type"><Select value={d.type} onChange={(v) => { p({ type: v as any }); if (isLiabilityType(v ?? '') && owed == null) setOwed(0); }} options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label, group: t.liability ? 'Owed (liabilities)' : 'Money you have' }))} /></Field>
        <Field label="Institution"><Text value={d.institution} onChange={(v) => p({ institution: v })} placeholder="Bank or provider" /></Field>
        <Field label="Currency" hint={acct ? 'Can’t be changed once transactions exist' : undefined}><CurrencySelect value={d.currency ?? 'USD'} onChange={(v) => p({ currency: v })} /></Field>
        {liability
          ? <Field label="Amount owed on start date" hint="The card or loan balance you owed"><MoneyInput value={owed} onChange={setOwed} currency={d.currency ?? 'USD'} /></Field>
          : <Field label="Balance on start date" hint="From your bank statement"><MoneyInput value={d.starting_balance} onChange={(v) => p({ starting_balance: v ?? 0 })} currency={d.currency ?? 'USD'} allowNegative /></Field>}
        <Field label="Start date" hint="Transactions before this date don’t change the balance"><DateInput value={d.starting_date} onChange={(v) => p({ starting_date: v })} /></Field>
        {!liability && <Field label="Low-balance alert below"><MoneyInput value={d.low_balance_alert} onChange={(v) => p({ low_balance_alert: v })} currency={d.currency ?? 'USD'} /></Field>}
        <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
        <div className="full stack" style={{ gap: 8 }}>
          <Check checked={!!d.include_in_net_worth} onChange={(v) => p({ include_in_net_worth: v ? 1 : 0 })}>Include in net worth</Check>
          <Check checked={!!d.is_active} onChange={(v) => p({ is_active: v ? 1 : 0 })}>Active (inactive accounts keep their history but are hidden from pickers)</Check>
        </div>
      </div>
    </Modal>
  );
}

function Reconcile({ a, onClose }: { a: AccountView; onClose: () => void }) {
  const { db, act } = useApp();
  const liability = a.liability;
  const [actual, setActual] = useState<number | null>(liability ? -a.balance : a.balance);
  const target = actual == null ? null : liability ? -actual : actual;
  const diff = target == null ? 0 : target - a.balance;
  return (
    <Modal title={`Match balance: ${a.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!diff} onClick={() => { act(() => saveAccount(db, { ...a, starting_balance: a.starting_balance + diff }), 'Balance matched'); onClose(); }}>Adjust by {formatMoney(diff, a.currency, { sign: true })}</button></>}>
      <div className="stack">
        <p>The app calculates <b className="num">{formatMoney(liability ? -a.balance : a.balance, a.currency)}</b>{liability ? ' owed' : ''}. What does your bank show?</p>
        <MoneyInput big value={actual} onChange={setActual} currency={a.currency} allowNegative={!liability} />
        <div className="notice"><Icon name="info" /><span>First check for missing or duplicate transactions. If the difference is real (fees, interest, an old error), this adjusts the opening balance — no fake income or expense is created, and the previous value is kept in the change history.</span></div>
      </div>
    </Modal>
  );
}

export default function Accounts() {
  const { fin, scope } = useApp();
  const [editing, setEditing] = useState<Account | null | 'new'>(null);
  const [transfer, setTransfer] = useState<number | null | 'any'>(null);
  const [rec, setRec] = useState<AccountView | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const views = fin.accountViews(scope).filter((a) => showInactive || a.is_active);
  const cash = fin.cashSummary(scope);
  const owedOnCards = views.filter((a) => a.liability).reduce((s, a) => s + Math.max(0, -a.balanceBase), 0);
  const months = lastMonths(fin.ref, 6).map((m) => monthEnd(m + '-01'));
  const history = (id: number) => months.map((d) => fin.balances(d > fin.ref ? fin.ref : d).get(id) ?? 0);

  const group = (owner: Owner) => views.filter((a) => a.owner === owner);
  return (<>
    <PageHead title="Accounts" sub="Balances include completed transactions only; pending amounts are shown separately.">
      <button className="btn" onClick={() => setTransfer('any')}><Icon name="swap" />Transfer</button>
      <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add account</button>
    </PageHead>
    <div className="grid g4">
      <Stat label="Cash & bank" v={cash.total} />
      <Stat label="Personal" v={cash.personal} />
      <Stat label="Business" v={cash.business} />
      <Stat label="Owed on cards & loans" v={owedOnCards} tone={owedOnCards ? 'out' : undefined} />
    </div>
    {views.length === 0 && <Panel className=""><Empty title="No accounts yet" action={<button className="btn primary" onClick={() => setEditing('new')}>Add an account</button>}>Add checking, savings, cards, PayPal, Stripe, cash — personal and business.</Empty></Panel>}
    {(['personal', 'business'] as Owner[]).filter((o) => scope === 'all' || scope === o).map((o) => group(o).length > 0 && (
      <Panel key={o} title={o === 'business' ? 'Business accounts' : 'Personal accounts'} flush className="" action={<span className="small muted" style={{ paddingRight: 18 }}>{group(o).length} accounts</span>}>
        <div className="list">
          {group(o).map((a) => (
            <div key={a.id} className="item">
              <div className="grow">
                <div className="title ellipsis">{a.name} {!a.is_active && <Chip>Inactive</Chip>} {a.is_demo ? <Chip kind="demo">Demo</Chip> : null}</div>
                <div className="meta">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}{a.institution ? ` · ${a.institution}` : ''} · {a.currency}{a.pendingDelta ? ` · pending ${formatMoney(a.pendingDelta, a.currency, { sign: true })}` : ''}</div>
              </div>
              <div className="hide-m"><Spark values={history(a.id)} color={a.liability ? 'var(--spend)' : 'var(--accent)'} /></div>
              <div className="amt" style={{ minWidth: 120 }}>
                {a.liability ? <><Money v={-a.balance} cur={a.currency} tone={a.balance < 0 ? 'out' : 'none'} /><span className="alt">owed</span></> : <Money v={a.balance} cur={a.currency} alt={a.currency !== fin.base} />}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn ghost sm" onClick={() => setRec(a)} title="Match to bank balance" aria-label={`Match balance of ${a.name}`}><Icon name="scale" /></button>
                <button className="btn ghost sm" onClick={() => setTransfer(a.id)} aria-label={`Transfer from ${a.name}`}><Icon name="swap" /></button>
                <button className="btn ghost sm" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}><Icon name="edit" /></button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    ))}
    <div style={{ marginTop: 12 }}><label className="check small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive accounts</label></div>
    {editing && <AccountForm acct={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    {transfer && <TxForm initial={{ kind: 'transfer', account_id: transfer === 'any' ? undefined : transfer }} onClose={() => setTransfer(null)} />}
    {rec && <Reconcile a={rec} onClose={() => setRec(null)} />}
  </>);
}
