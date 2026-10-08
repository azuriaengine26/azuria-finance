import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Stat, Money, Progress, Empty, Chip, AltLine } from '../ui/components';
import { PairBars, RankBars, LineChart } from '../ui/charts';
import { presetRange, lastMonths, formatDate, diffDays, monthKey } from '../core/dates';
import { formatMoney } from '../core/money';
import { Icon } from '../ui/icons';
import { hasDemoData } from '../core/backup';

export function MissingRates() {
  const { fin } = useApp();
  if (!fin.missingRates.size) return null;
  return <div className="notice warn" style={{ marginBottom: 16 }}><Icon name="alert" /><span>Some amounts can’t be converted to {fin.base} ({[...fin.missingRates].join(', ')}). Add the exchange rate in <Link to="/settings">Settings → Currencies</Link>; until then they’re left out of totals.</span></div>;
}

export function Insights({ scope }: { scope: 'all' | 'personal' | 'business' }) {
  const { fin } = useApp();
  const items = fin.insights(scope);
  return (
    <Panel title="What changed">
      {items.length ? items.map((i, k) => <Link key={k} to={i.to ?? '#'} className={`insight ${i.tone}`} style={{ textDecoration: 'none' }}><i />{i.text}</Link>)
        : <p className="muted small">Insights appear once there’s at least a month of activity to compare.</p>}
    </Panel>
  );
}

export default function Dashboard() {
  const { fin, scope, db, setting } = useApp();
  const nav = useNavigate();
  const month = presetRange('this_month', fin.ref);
  const year = presetRange('this_year', fin.ref);
  const tm = fin.totals(scope, month);
  const ty = fin.totals(scope, year);
  const cash = fin.cashSummary(scope);
  const nw = fin.netWorth(fin.ref, scope);
  const hist = fin.netWorthHistory(12, scope);
  const series = fin.monthly(scope, lastMonths(fin.ref, 12));
  const spend = fin.byCategory(scope, month, 'expense');
  const incomeBy = fin.byCategory(scope, month, 'income');
  const rec = fin.receivables(scope);
  const debt = fin.debtSummary(scope);
  const goals = fin.goals(scope);
  const budgets = fin.budgets(monthKey(fin.ref), scope).slice(0, 4);
  const upcoming = fin.upcoming(scope, 14).slice(0, 7);
  const accounts = fin.accountViews(scope, true);
  const prevNw = hist.length > 1 ? hist[hist.length - 2].netWorth : null;
  const scopeName = scope === 'all' ? 'Everything' : scope === 'personal' ? 'Personal' : setting('business_name', 'Business');

  if (!accounts.length) {
    return (<>
      <PageHead title="Welcome" sub="Add your first account to start tracking." />
      <Panel><Empty title="No accounts yet" action={<div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" to="/accounts">Add an account</Link><Link className="btn" to="/import">Import a statement</Link></div>}>Start with the accounts you use most: checking, savings, a credit card, PayPal, cash.</Empty></Panel>
    </>);
  }

  return (<>
    <PageHead title={scopeName} sub={`${formatDate(fin.ref, 'long')} · amounts in ${fin.base}`} />
    {hasDemoData(db) && <div className="notice" style={{ marginBottom: 16 }}><Icon name="info" /><span>You’re looking at demo data. When you’re ready, remove it in <Link to="/settings">Settings → Data</Link> — your own entries stay.</span></div>}
    <MissingRates />

    <section className="ledger" aria-label="Summary">
      <div className="cell">
        <div className="lbl">Net worth</div>
        <div className="big">{formatMoney(nw.netWorth, fin.base)}</div>
        <AltLine v={nw.netWorth} />
        {prevNw != null && <div className="alt" style={{ color: nw.netWorth >= prevNw ? '#7fe0bd' : '#ff9cad' }}>{formatMoney(nw.netWorth - prevNw, fin.base, { sign: true })} since last month-end</div>}
      </div>
      <div className="cell">
        <div className="lbl">Cash & bank</div>
        <div className="mid">{formatMoney(cash.total, fin.base)}</div>
        {scope === 'all' ? <div className="alt">Personal {formatMoney(cash.personal, fin.base, { compact: true })} · Business {formatMoney(cash.business, fin.base, { compact: true })}</div> : <AltLine v={cash.total} />}
      </div>
      <div className="cell">
        <div className="lbl">In this month</div>
        <div className="mid" style={{ color: '#7fe0bd' }}>{formatMoney(tm.income, fin.base)}</div>
        <div className="alt">Out {formatMoney(tm.expense, fin.base)}</div>
      </div>
      <div className="cell">
        <div className="lbl">Net this month</div>
        <div className="mid" style={{ color: tm.net >= 0 ? '#7fe0bd' : '#ff9cad' }}>{formatMoney(tm.net, fin.base, { sign: true })}</div>
        <div className="alt">{tm.income === 0 ? 'No income yet this month' : tm.net < 0 ? 'Spending is ahead of income so far' : `${tm.savingsRate}% of income kept`}</div>
      </div>
    </section>

    <div className="grid g4" style={{ marginTop: 16 }}>
      <Stat label="Income this year" v={ty.income} tone="in" sub={scope === 'all' ? `Business ${formatMoney(fin.totals('business', year).income, fin.base, { compact: true })} · Personal ${formatMoney(fin.totals('personal', year).income, fin.base, { compact: true })}` : undefined} />
      <Stat label="Expenses this year" v={ty.expense} tone="out" sub={scope === 'all' ? `Business ${formatMoney(fin.totals('business', year).expense, fin.base, { compact: true })} · Personal ${formatMoney(fin.totals('personal', year).expense, fin.base, { compact: true })}` : undefined} />
      <Stat label="Saved this year" v={ty.net} tone="auto" sub={ty.savingsRate != null ? `Savings rate ${ty.savingsRate}%` : undefined} />
      <Stat label="Owed to you" v={rec.total} sub={rec.overdue ? <span className="neg">{formatMoney(rec.overdue, fin.base)} overdue</span> : `${rec.open.length} open`} />
    </div>

    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Cash flow, last 12 months" className="span2" action={<Link className="link" to="/reports">Reports</Link>}>
        <PairBars data={series.map((m) => ({ label: m.label, a: m.income, b: m.expense }))} aLabel="Money in" bLabel="Money out" showNet />
      </Panel>
      <Panel title="Spending this month" action={<Link className="link" to="/expenses">Details</Link>}>
        {spend.length ? <RankBars rows={spend} max={7} onPick={() => nav('/expenses')} /> : <p className="muted small">No spending recorded this month.</p>}
      </Panel>
    </div>

    <div className="grid g3" style={{ marginTop: 16 }}>
      <Insights scope={scope} />
      <Panel title="Coming up (14 days)" flush action={<Link className="link" to="/bills" style={{ paddingRight: 18 }}>All bills</Link>}>
        {upcoming.length ? <div className="list">{upcoming.map((t) => (
          <div key={t.id} className="item">
            <div className="grow"><div className="title ellipsis">{t.payee || t.description}</div><div className="meta">{t.late ? <span className="neg">{Math.abs(diffDays(t.date, fin.ref))} days late</span> : formatDate(t.date)} · {t.kind === 'income' ? 'Income' : t.kind === 'transfer' ? 'Transfer' : 'Bill'}</div></div>
            <div className="amt"><Money v={t.amount} cur={t.currency} tone={t.kind === 'income' ? 'in' : 'none'} /></div>
          </div>))}</div> : <Empty title="Nothing due">No bills or expected income in the next two weeks.</Empty>}
      </Panel>
      <Panel title="Income this month" action={<Link className="link" to="/income">Details</Link>}>
        {incomeBy.length ? <RankBars rows={incomeBy.map((c) => ({ ...c, color: 'var(--income)' }))} max={6} /> : <p className="muted small">No income received yet this month.</p>}
      </Panel>
    </div>

    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Net worth" className="span2" action={<Link className="link" to="/networth">Breakdown</Link>}>
        <div className="row small muted" style={{ gap: 18, marginBottom: 8 }}><span>Assets <b className="num" style={{ color: 'var(--ink)' }}>{formatMoney(nw.totalAssets, fin.base)}</b></span><span>Liabilities <b className="num" style={{ color: 'var(--ink)' }}>{formatMoney(nw.totalLiabilities, fin.base)}</b></span></div>
        <LineChart data={hist.map((h) => ({ label: h.label, v: h.netWorth }))} label="Net worth by month" />
      </Panel>
      <Panel title="Debt" action={<Link className="link" to="/debt">Plan payoff</Link>}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="spread"><span className="muted small">Total owed</span><b className="fig" style={{ fontSize: 22 }}>{formatMoney(debt.total, fin.base)}</b></div>
          <div className="spread small"><span className="muted">Minimum payments / month</span><Money v={debt.minimums} /></div>
          <div className="spread small"><span className="muted">Paid this month</span><Money v={debt.paidThisMonth} /></div>
          <div className="spread small"><span className="muted">Debt-to-income</span><span>{debt.dti != null ? `${debt.dti}%` : '—'}</span></div>
          <div className="spread small"><span className="muted">Paid off so far</span><Money v={debt.paidOff} /></div>
          <Progress value={debt.original ? (debt.paidOff / debt.original) * 100 : 0} status="ok" />
        </div>
      </Panel>
    </div>

    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Savings goals" action={<Link className="link" to="/savings">All goals</Link>}>
        {goals.length ? <div className="stack">{goals.slice(0, 4).map((g) => (
          <div key={g.id}><div className="spread small"><b>{g.name}</b><span className="num">{formatMoney(g.current, g.currency)} / {formatMoney(g.target_amount, g.currency, { compact: true })}</span></div><Progress value={g.progress} status={g.onTrack === false ? 'warn' : 'ok'} />{g.requiredMonthly != null && g.remaining > 0 && <div className="tiny muted" style={{ marginTop: 3 }}>{formatMoney(g.requiredMonthly, g.currency)}/month to hit {formatDate(g.deadline)}</div>}</div>))}</div>
          : <p className="muted small">No goals yet. <Link to="/savings">Create one</Link>.</p>}
      </Panel>
      <Panel title="Budgets this month" action={<Link className="link" to="/budgets">All budgets</Link>}>
        {budgets.length ? <div className="stack">{budgets.map((b) => (
          <div key={b.id}><div className="spread small"><b>{b.name}</b><span className="num">{formatMoney(b.spent, b.currency)} of {formatMoney(b.amount, b.currency, { compact: true })}</span></div><Progress value={b.used} status={b.status} /></div>))}</div>
          : <p className="muted small">No budgets set. <Link to="/budgets">Set one</Link>.</p>}
      </Panel>
      <Panel title="Accounts" flush action={<Link className="link" to="/accounts" style={{ paddingRight: 18 }}>Manage</Link>}>
        <div className="list">{accounts.slice(0, 7).map((a) => (
          <Link key={a.id} to="/accounts" className="item">
            <div className="grow"><div className="title ellipsis">{a.name}</div><div className="meta">{a.institution ?? a.type.replace('_', ' ')}{a.is_demo ? ' · demo' : ''}</div></div>
            <div className="amt"><Money v={a.balance} cur={a.currency} tone={a.balance < 0 ? 'out' : 'none'} /></div>
          </Link>))}</div>
      </Panel>
    </div>
  </>);
}

export { Chip };
