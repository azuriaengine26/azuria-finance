import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Stat, Select, Money } from '../ui/components';
import { PairBars, RankBars } from '../ui/charts';
import { presetRange, lastMonths, RANGE_LABELS, type RangePreset } from '../core/dates';
import { formatMoney, pct } from '../core/money';
import { MissingRates, Insights } from './Dashboard';

export default function Azuria() {
  const { fin, setting } = useApp();
  const [range, setRange] = useState<RangePreset>('this_month');
  const r = presetRange(range, fin.ref);
  const t = fin.totals('business', r);
  const cats = fin.byCategory('business', r, 'expense');
  const amt = (...names: string[]) => cats.filter((c) => names.includes(c.name)).reduce((s, c) => s + c.amount, 0);
  const contractors = amt('Contractors'), software = amt('Software'), marketing = amt('Marketing', 'Advertising'), payroll = amt('Payroll');
  const operating = t.expense - contractors - software - marketing - payroll;
  const clients = fin.byClient('business', r);
  const rec = fin.receivables('business');
  const cash = fin.cashSummary('business');
  const debt = fin.debtSummary('business');
  const cf = fin.cashFlow('business', r);
  const months = fin.monthly('business', lastMonths(fin.ref, 12));
  const margin = t.income ? pct(t.net, t.income) : null;
  const name = setting('business_name', 'Azuria Engine');
  const labour = contractors + payroll;

  return (<>
    <PageHead title={name} sub="Business only. Owner draws are shown separately — they are not business expenses.">
      <Select value={range} onChange={(v) => setRange((v ?? 'this_month') as RangePreset)} options={(['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'last_12'] as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} />
    </PageHead>
    <MissingRates />
    <section className="ledger" aria-label="Business summary">
      <div className="cell"><div className="lbl">Net profit · {RANGE_LABELS[range].toLowerCase()}</div><div className="big">{formatMoney(t.net, fin.base)}</div><div className="alt">{margin != null ? `${margin}% margin` : 'No revenue in this period'}</div></div>
      <div className="cell"><div className="lbl">Revenue</div><div className="mid" style={{ color: '#7fe0bd' }}>{formatMoney(t.income, fin.base)}</div><div className="alt">{clients.length} paying client{clients.length === 1 ? '' : 's'}</div></div>
      <div className="cell"><div className="lbl">Expenses</div><div className="mid">{formatMoney(t.expense, fin.base)}</div><div className="alt">{t.income ? `${pct(labour, t.income)}% of revenue on agents` : '—'}</div></div>
      <div className="cell"><div className="lbl">Owner draws</div><div className="mid">{formatMoney(t.ownerDraws, fin.base)}</div><div className="alt">Profit after draws {formatMoney(t.net - t.ownerDraws, fin.base, { sign: true })}</div></div>
    </section>

    <div className="grid g4" style={{ marginTop: 16 }}>
      <Stat label="Contractor costs" v={contractors} sub={t.expense ? `${pct(contractors, t.expense)}% of expenses` : undefined} />
      <Stat label="Payroll" v={payroll} />
      <Stat label="Software" v={software} />
      <Stat label="Marketing & ads" v={marketing} />
      <Stat label="Other operating expenses" v={operating} />
      <Stat label="Outstanding invoices" v={rec.invoicesTotal} sub={rec.overdue ? <span className="neg">{formatMoney(rec.overdue, fin.base)} overdue</span> : 'None overdue'} />
      <Stat label="Business cash" v={cash.total} />
      <Stat label="Business debt" v={debt.total} sub={`Cash flow this period ${formatMoney(cf.netCash, fin.base, { sign: true })}`} />
    </div>

    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Revenue vs. expenses, last 12 months" className="span2"><PairBars data={months.map((m) => ({ label: m.label, a: m.income, b: m.expense }))} aLabel="Revenue" bLabel="Expenses" showNet /></Panel>
      <Insights scope="business" />
    </div>
    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Revenue by client" action={<Link className="link" to="/clients">Clients</Link>}>{clients.length ? <RankBars rows={clients.map((c) => ({ name: c.name, amount: c.amount, color: 'var(--income)' }))} /> : <p className="muted small">No client payments in this period.</p>}</Panel>
      <Panel title="Top expenses">{cats.length ? <RankBars rows={cats} max={8} /> : <p className="muted small">No expenses in this period.</p>}</Panel>
      <Panel title="Cash flow">
        <div className="stack small" style={{ gap: 8 }}>
          {[['Revenue received', cf.income], ['Expenses paid', -cf.expense], ['Card & loan payments (internal)', 0], ['Debt payments', -cf.debtPayments], ['Borrowed', cf.debtProceeds], ['Owner draws / contributions', cf.transfersIn - cf.transfersOut]].map(([l, v]) => (
            l === 'Card & loan payments (internal)' ? <div key={String(l)} className="spread muted"><span>Card payments (already counted as expenses)</span><span className="num">{formatMoney(cf.cardPayments, fin.base)}</span></div>
              : <div key={String(l)} className="spread"><span>{l}</span><Money v={v as number} sign tone="auto" /></div>))}
          <div className="spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><b>Net change in business cash</b><Money v={cf.netCash} sign tone="auto" /></div>
        </div>
      </Panel>
    </div>
  </>);
}
