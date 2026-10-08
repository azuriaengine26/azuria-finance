import { useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Empty, Modal, Field, Select, MoneyInput, CurrencySelect, Segmented, Progress, Chip, Check, useDraft } from '../ui/components';
import { categoryOptions } from '../ui/TxForm';
import { addMonths, monthKey, monthLabel, monthEnd } from '../core/dates';
import { formatMoney } from '../core/money';
import type { Budget, Owner } from '../core/types';
import { Icon } from '../ui/icons';

function BudgetForm({ b, month, onClose }: { b: Partial<Budget>; month: string; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const [d, p] = useDraft<Partial<Budget>>(b);
  const [onlyThisMonth, setOnly] = useState(!!b.month);
  const save = () => {
    if (!d.amount && d.amount !== 0) return act(() => { throw new Error('Enter a budget amount'); });
    const data = { owner: d.owner, category_id: d.category_id ?? null, amount: d.amount, currency: d.currency ?? fin.base, month: onlyThisMonth ? month : null };
    const ok = act(() => {
      if (d.id) db.update('budgets', d.id, data);
      else {
        const exists = db.value('SELECT id FROM budgets WHERE owner = ? AND ifnull(category_id,0) = ? AND ifnull(month,\'\') = ?', [data.owner!, data.category_id ?? 0, data.month ?? '']);
        if (exists) throw new Error('A budget for this category already exists — edit it instead.');
        db.insert('budgets', data);
      }
      return true;
    }, 'Budget saved');
    if (ok) onClose();
  };
  return (
    <Modal title={d.id ? 'Edit budget' : 'New budget'} onClose={onClose} footer={<>
      {d.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { act(() => db.run('DELETE FROM budgets WHERE id = ?', [d.id!]), 'Budget removed'); onClose(); }}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save budget</button></>}>
      <div className="form-grid">
        <Field label="For"><Segmented label="Owner" value={(d.owner ?? 'personal') as Owner} onChange={(v) => p({ owner: v, category_id: null })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} /></Field>
        <Field label="Category" hint="Includes its subcategories"><Select value={d.category_id} onChange={(v) => p({ category_id: v })} options={categoryOptions(fin.categories, 'expense', (d.owner ?? 'personal') as Owner)} placeholder={`All ${d.owner ?? 'personal'} spending`} /></Field>
        <Field label="Monthly amount"><MoneyInput value={d.amount} onChange={(v) => p({ amount: v ?? undefined })} currency={d.currency ?? fin.base} /></Field>
        <Field label="Currency"><CurrencySelect value={d.currency ?? fin.base} onChange={(v) => p({ currency: v })} /></Field>
        <div className="full"><Check checked={onlyThisMonth} onChange={setOnly}>Only for {monthLabel(month)} (otherwise every month)</Check></div>
      </div>
    </Modal>
  );
}

export default function Budgets() {
  const { fin, scope } = useApp();
  const [month, setMonth] = useState(monthKey(fin.ref));
  const [editing, setEditing] = useState<Partial<Budget> | null>(null);
  const rows = fin.budgets(month, scope);
  const range = { from: month + '-01', to: monthEnd(month + '-01') };
  const budgetedCats = new Set(rows.map((r) => r.category_id));
  const unbudgeted = fin.byCategory(scope, range, 'expense').filter((c) => typeof c.id === 'number' && !budgetedCats.has(c.id as number)).slice(0, 6);
  const defOwner: Owner = scope === 'business' ? 'business' : 'personal';
  const sumBy = (o: Owner) => rows.filter((r) => r.owner === o && r.category_id != null);

  return (<>
    <PageHead title="Budgets" sub="Monthly limits. Pending charges count toward a budget so you see them early.">
      <div className="row"><button className="btn icon-btn" aria-label="Previous month" onClick={() => setMonth(monthKey(addMonths(month + '-01', -1)))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel(month)}</b><button className="btn icon-btn" aria-label="Next month" onClick={() => setMonth(monthKey(addMonths(month + '-01', 1)))}>›</button></div>
      <button className="btn primary" onClick={() => setEditing({ owner: defOwner, currency: fin.base })}><Icon name="plus" />New budget</button>
    </PageHead>
    {rows.length === 0 ? <Panel><Empty title="No budgets yet" action={<button className="btn primary" onClick={() => setEditing({ owner: defOwner, currency: fin.base })}>Create a budget</button>}>Set a monthly limit for a category, or for all personal or business spending.</Empty></Panel> : (
      <div className="grid g2">
        {(['personal', 'business'] as Owner[]).filter((o) => rows.some((r) => r.owner === o)).map((o) => (
          <Panel key={o} title={o === 'business' ? 'Business' : 'Personal'} flush>
            <div className="list">{rows.filter((r) => r.owner === o).map((b) => (
              <button key={b.id} className="item" onClick={() => setEditing(b)} style={{ display: 'block' }}>
                <div className="spread"><span className="title">{b.name} {b.month && <Chip>{monthLabel(b.month, true)} only</Chip>}</span><Chip kind={b.status}>{b.status === 'over' ? 'Over budget' : b.status === 'warn' ? 'Almost used' : 'On track'}</Chip></div>
                <div style={{ margin: '8px 0 6px' }}><Progress value={b.used} status={b.status} /></div>
                <div className="spread small"><span className="num">{formatMoney(b.spent, b.currency)} of {formatMoney(b.amount, b.currency)} · {Math.round(b.used)}%</span><span className={`num ${b.remaining < 0 ? 'neg' : 'muted'}`}>{b.remaining < 0 ? `${formatMoney(-b.remaining, b.currency)} over` : `${formatMoney(b.remaining, b.currency)} left`}</span></div>
                {b.pace != null && b.pace > 1.15 && b.status === 'ok' && <div className="tiny" style={{ color: 'var(--warn)', marginTop: 4 }}>Spending faster than the month is passing</div>}
              </button>))}</div>
            {sumBy(o).length > 1 && <div className="day-head"><span>Category budgets total</span><span className="num">{formatMoney(sumBy(o).reduce((s, r) => s + fin.conv(r.spent, r.currency), 0), fin.base)} of {formatMoney(sumBy(o).reduce((s, r) => s + fin.conv(r.amount, r.currency), 0), fin.base)}</span></div>}
          </Panel>
        ))}
      </div>
    )}
    {unbudgeted.length > 0 && (
      <Panel title="Spending without a budget this month">
        <div className="row wrap">{unbudgeted.map((c) => <button key={String(c.id)} className="btn sm" onClick={() => setEditing({ owner: (c.owner === 'business' ? 'business' : 'personal') as Owner, category_id: c.id as number, currency: fin.base, amount: Math.ceil(c.amount / 10000) * 10000 })}>{c.name} · {formatMoney(c.amount, fin.base)}</button>)}</div>
      </Panel>
    )}
    {editing && <BudgetForm b={editing} month={month} onClose={() => setEditing(null)} />}
  </>);
}
