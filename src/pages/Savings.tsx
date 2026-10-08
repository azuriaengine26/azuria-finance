import { useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Empty, Modal, Field, Text, Area, Select, MoneyInput, DateInput, CurrencySelect, Segmented, Stat, Progress, Chip, useDraft } from '../ui/components';
import { addContribution } from '../core/repo';
import { today, formatDate, presetRange } from '../core/dates';
import { formatMoney } from '../core/money';
import type { SavingsGoal, Owner } from '../core/types';
import { Icon } from '../ui/icons';

const GOAL_TYPES = ['emergency', 'vacation', 'car', 'house', 'business', 'taxes', 'investment', 'other'].map((v) => ({ value: v, label: { emergency: 'Emergency fund', vacation: 'Vacation', car: 'New car', house: 'House', business: 'Business expansion', taxes: 'Taxes', investment: 'Investment', other: 'Other' }[v]! }));

function GoalForm({ g, onClose }: { g: Partial<SavingsGoal>; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [d, p] = useDraft<Partial<SavingsGoal>>({ type: 'emergency', owner: 'personal', currency: fin.base, starting_amount: 0, ...g });
  const save = () => {
    const ok = act(() => {
      if (!d.name?.trim()) throw new Error('Give the goal a name');
      if (!d.target_amount || d.target_amount <= 0) throw new Error('Set a target amount');
      const data = { name: d.name.trim(), type: d.type, owner: d.owner, target_amount: d.target_amount, currency: d.currency, starting_amount: d.starting_amount ?? 0, account_id: d.account_id ?? null, deadline: d.deadline || null, monthly_target: d.monthly_target ?? null, notes: d.notes || null, is_closed: d.is_closed ?? 0 };
      if (d.id) db.update('savings_goals', d.id, data); else db.insert('savings_goals', data);
      return true;
    }, 'Goal saved');
    if (ok) onClose();
  };
  return (
    <Modal title={d.id ? 'Edit goal' : 'New savings goal'} onClose={onClose} footer={<>
      {d.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { act(() => db.run('DELETE FROM savings_goals WHERE id = ?', [d.id!]), 'Goal deleted'); onClose(); }}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save goal</button></>}>
      <div className="form-grid">
        <Field label="Name" full><Text value={d.name} onChange={(v) => p({ name: v })} placeholder="e.g. Emergency fund" /></Field>
        <Field label="Kind"><Select value={d.type} onChange={(v) => p({ type: v ?? 'other' })} options={GOAL_TYPES} /></Field>
        <Field label="For"><Segmented label="Owner" value={(d.owner ?? 'personal') as Owner} onChange={(v) => p({ owner: v })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} /></Field>
        <Field label="Target amount"><MoneyInput value={d.target_amount} onChange={(v) => p({ target_amount: v ?? undefined })} currency={d.currency ?? fin.base} /></Field>
        <Field label="Currency"><CurrencySelect value={d.currency ?? fin.base} onChange={(v) => p({ currency: v })} /></Field>
        <Field label="Track with an account" hint="Progress follows that account’s balance"><Select value={d.account_id} onChange={(v) => p({ account_id: v })} options={fin.accounts.filter((a) => a.is_active && ['savings', 'checking', 'investment', 'cash', 'other_asset'].includes(a.type)).map((a) => ({ value: a.id, label: a.name }))} placeholder="No — I’ll log contributions" /></Field>
        {!d.account_id && <Field label="Already saved"><MoneyInput value={d.starting_amount} onChange={(v) => p({ starting_amount: v ?? 0 })} currency={d.currency ?? fin.base} /></Field>}
        <Field label="Deadline"><DateInput value={d.deadline} onChange={(v) => p({ deadline: v || null })} /></Field>
        <Field label="Planned monthly contribution"><MoneyInput value={d.monthly_target} onChange={(v) => p({ monthly_target: v })} currency={d.currency ?? fin.base} /></Field>
        <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
      </div>
    </Modal>
  );
}

function Contribute({ g, onClose }: { g: any; onClose: () => void }) {
  const { db, act } = useApp();
  const [amount, setAmount] = useState<number | null>(g.monthly_target ?? null);
  const [date, setDate] = useState(today());
  const [withdraw, setWithdraw] = useState(false);
  return (
    <Modal title={`Update “${g.name}”`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!amount} onClick={() => { act(() => addContribution(db, g.id, withdraw ? -amount! : amount!, date), 'Goal updated'); onClose(); }}>{withdraw ? 'Record withdrawal' : 'Add contribution'}</button></>}>
      <div className="stack">
        <Segmented label="Direction" value={withdraw ? 'out' : 'in'} onChange={(v) => setWithdraw(v === 'out')} options={[{ value: 'in', label: 'Add money' }, { value: 'out', label: 'Take money out' }]} />
        <div className="form-grid"><Field label="Amount"><MoneyInput value={amount} onChange={setAmount} currency={g.currency} /></Field><Field label="Date"><DateInput value={date} onChange={setDate} /></Field></div>
        <p className="tiny muted">This tracks progress toward the goal only. To actually move money between accounts, record a transfer.</p>
      </div>
    </Modal>
  );
}

export default function Savings() {
  const { fin, scope } = useApp();
  const [editing, setEditing] = useState<Partial<SavingsGoal> | null>(null);
  const [contrib, setContrib] = useState<any>(null);
  const goals = fin.goals(scope);
  const m = fin.totals(scope, presetRange('this_month', fin.ref));
  const y = fin.totals(scope, presetRange('this_year', fin.ref));
  return (<>
    <PageHead title="Savings goals" sub="“Saved” means income minus expenses. Moving money into savings is a transfer, never spending.">
      <button className="btn primary" onClick={() => setEditing({ owner: scope === 'business' ? 'business' : 'personal' })}><Icon name="plus" />New goal</button>
    </PageHead>
    <div className="grid g4">
      <Stat label="Saved this month" v={m.net} tone="auto" sub={m.savingsRate != null ? `${m.savingsRate}% of income` : undefined} />
      <Stat label="Saved this year" v={y.net} tone="auto" sub={y.savingsRate != null ? `${y.savingsRate}% savings rate` : undefined} />
      <Stat label="Toward goals" v={goals.reduce((s, g) => s + fin.conv(g.current, g.currency), 0)} />
      <Stat label="Still to save" v={goals.reduce((s, g) => s + fin.conv(g.remaining, g.currency), 0)} />
    </div>
    {goals.length === 0 ? <Panel className=""><Empty title="No goals yet" action={<button className="btn primary" onClick={() => setEditing({})}>Create a goal</button>}>Emergency fund, taxes, a trip, business expansion — set a target and a date.</Empty></Panel> : (
      <div className="grid g2" style={{ marginTop: 16 }}>
        {goals.map((g) => (
          <Panel key={g.id} title={<>{g.name} {g.owner === 'business' && <Chip kind="biz">Business</Chip>} {g.is_demo ? <Chip kind="demo">Demo</Chip> : null}</>} action={<button className="btn ghost sm" onClick={() => setEditing(g)} aria-label="Edit goal"><Icon name="edit" /></button>}>
            <div className="spread"><span className="fig" style={{ fontSize: 26 }}>{formatMoney(g.current, g.currency)}</span><span className="muted small num">of {formatMoney(g.target_amount, g.currency)}</span></div>
            <div style={{ margin: '10px 0' }}><Progress value={g.progress} status={g.remaining === 0 ? 'ok' : g.onTrack === false ? 'warn' : 'ok'} /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="small"><div className="muted">Progress</div><b>{g.progress}%</b></div>
              <div className="small"><div className="muted">Remaining</div><b className="num">{formatMoney(g.remaining, g.currency)}</b></div>
              <div className="small"><div className="muted">Deadline</div><b>{g.deadline ? formatDate(g.deadline) : '—'}</b>{g.deadlinePassed && <span className="neg"> (passed)</span>}</div>
              <div className="small"><div className="muted">Needed per month</div><b className="num">{g.requiredMonthly != null ? formatMoney(g.requiredMonthly, g.currency) : '—'}</b>{g.monthly_target ? <span className="muted"> · plan {formatMoney(g.monthly_target, g.currency)}</span> : null}</div>
            </div>
            <p className="small" style={{ marginTop: 10 }}>
              {g.remaining === 0 ? 'Goal reached.' : g.pace > 0 ? <>Recent pace: <b className="num">{formatMoney(g.pace, g.currency)}</b>/month → about {g.monthsAtPace} months to go{g.onTrack === false ? <span className="neg"> — behind the deadline</span> : g.onTrack ? <span className="pos"> — on track</span> : ''}.</> : <span className="muted">No contributions in the last 3 months, so no projection yet.</span>}
            </p>
            {!g.account_id && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setContrib(g)}>Add or withdraw</button>}
            {g.account_id && <p className="tiny muted" style={{ marginTop: 8 }}>Follows the balance of {fin.accounts.find((a) => a.id === g.account_id)?.name}.</p>}
          </Panel>
        ))}
      </div>
    )}
    {editing && <GoalForm g={editing} onClose={() => setEditing(null)} />}
    {contrib && <Contribute g={contrib} onClose={() => setContrib(null)} />}
  </>);
}
