import type { Finance } from './finance';
import type { Scope } from './types';
import { formatDate, lastMonths, monthLabel, monthKey, monthEnd, type DateRange, addMonths, monthStart } from './dates';
import { pct } from './money';

export type Cell = string | number | null | { m: number; c: string } | { p: number | null };
export interface Section { title?: string; columns: string[]; rows: Cell[][]; totals?: Cell[]; align?: ('l' | 'r')[] }
export interface Report { id: string; title: string; subtitle: string; sections: Section[]; notes: string[]; chart?: { label: string; values: { label: string; a: number; b?: number }[]; aLabel: string; bLabel?: string } }

export const REPORTS: { id: string; title: string; scoped: boolean; description: string }[] = [
  { id: 'income_statement', title: 'Income statement', scoped: true, description: 'Income and expenses by category for the period' },
  { id: 'business_pl', title: 'Business profit & loss', scoped: false, description: 'Azuria revenue, expenses, net profit and margin' },
  { id: 'personal_spending', title: 'Personal spending', scoped: false, description: 'Where your personal money went' },
  { id: 'cash_flow', title: 'Cash flow', scoped: true, description: 'Money in, money out, and financing movements by month' },
  { id: 'net_worth', title: 'Net worth', scoped: true, description: 'Assets, liabilities and net worth by month' },
  { id: 'debt', title: 'Debt', scoped: true, description: 'Balances, rates, payments and progress' },
  { id: 'savings', title: 'Savings', scoped: true, description: 'Savings rate by month and goal progress' },
  { id: 'tax', title: 'Tax-related expenses', scoped: false, description: 'Business revenue, potentially deductible expenses' },
  { id: 'category_spending', title: 'Category spending', scoped: true, description: 'Spending per category per month' },
  { id: 'client_income', title: 'Client income', scoped: false, description: 'Invoiced, received and outstanding by client' },
];

export const TAX_DISCLAIMER = 'Tax treatment depends on your jurisdiction (e.g. Honduras, the U.S.) and your specific situation. "Potentially deductible" only reflects how you marked transactions. This is organisational information, not tax advice — verify everything with a qualified tax professional.';

const SCOPE_LABEL: Record<Scope, string> = { all: 'Personal + Business', personal: 'Personal', business: 'Business' };

function monthsIn(r: DateRange): string[] {
  const out: string[] = [];
  let m = monthKey(r.from);
  const end = monthKey(r.to);
  while (m <= end && out.length < 60) { out.push(m); m = monthKey(addMonths(m + '-01', 1)); }
  return out;
}

export function buildReport(f: Finance, id: string, range: DateRange, scope: Scope): Report {
  const B = f.base;
  const money = (m: number): Cell => ({ m, c: B });
  const sub = `${formatDate(range.from)} – ${formatDate(range.to)} · amounts in ${B}`;
  const notes: string[] = [];
  if (f.missingRates.size) notes.push(`Missing exchange rates (${[...f.missingRates].join(', ')}): those amounts are excluded. Add rates in Settings.`);
  const basis = 'Cash basis: income counts when received, expenses when paid. Transfers, savings moves, credit-card payments and owner draws are never counted as income or expenses.';

  switch (id) {
    case 'income_statement': case 'business_pl': {
      const s: Scope = id === 'business_pl' ? 'business' : scope;
      const inc = f.byCategory(s, range, 'income', false);
      const exp = f.byCategory(s, range, 'expense', false);
      const t = f.totals(s, range);
      const sections: Section[] = [
        { title: id === 'business_pl' ? 'Revenue' : 'Income', columns: ['Category', 'Amount', '% of total'], rows: inc.map((c) => [c.name, money(c.amount), { p: pct(c.amount, t.income) }]), totals: ['Total', money(t.income), { p: 100 }] },
        { title: 'Expenses', columns: ['Category', 'Amount', '% of total'], rows: exp.map((c) => [c.name, money(c.amount), { p: pct(c.amount, t.expense) }]), totals: ['Total', money(t.expense), { p: 100 }] },
        { title: 'Result', columns: ['', 'Amount'], rows: [
          [id === 'business_pl' ? 'Net profit' : 'Net income', money(t.net)],
          [id === 'business_pl' ? 'Profit margin' : 'Savings rate', { p: t.income ? pct(t.net, t.income) : null }],
          ...(s === 'business' ? [['Owner draws (not an expense)', money(t.ownerDraws)] as Cell[], ['Owner contributions (not revenue)', money(t.ownerContributions)] as Cell[]] : []),
        ] },
      ];
      if (id === 'business_pl') {
        const clients = f.byClient('business', range);
        sections.splice(1, 0, { title: 'Revenue by client', columns: ['Client', 'Amount', '% of revenue'], rows: clients.map((c) => [c.name, money(c.amount), { p: pct(c.amount, t.income) }]) });
      }
      if (s === 'personal' && t.drawsIncome) notes.push('Owner draws from the business are counted as personal income (Settings → Preferences).');
      notes.push(basis);
      const months = monthsIn(range);
      return { id, title: id === 'business_pl' ? `${'Azuria'} profit & loss` : 'Income statement', subtitle: `${SCOPE_LABEL[s]} · ${sub}`, sections, notes,
        chart: months.length > 1 ? { label: 'By month', aLabel: 'Income', bLabel: 'Expenses', values: f.monthly(s, months).map((m) => ({ label: m.label, a: m.income, b: m.expense })) } : undefined };
    }
    case 'personal_spending': {
      const exp = f.byCategory('personal', range, 'expense', false);
      const total = exp.reduce((a, b) => a + b.amount, 0);
      const n = Math.max(1, monthsIn(range).length);
      const payees = f.byPayee('personal', range, 'expense').slice(0, 15);
      notes.push(basis);
      return { id, title: 'Personal spending report', subtitle: sub, notes, sections: [
        { title: 'By category', columns: ['Category', 'Total', 'Monthly avg', '% of spending'], rows: exp.map((c) => [c.name, money(c.amount), money(Math.round(c.amount / n)), { p: pct(c.amount, total) }]), totals: ['Total', money(total), money(Math.round(total / n)), { p: 100 }] },
        { title: 'Top merchants', columns: ['Merchant', 'Total'], rows: payees.map((p) => [p.name, money(p.amount)]) },
      ] };
    }
    case 'cash_flow': {
      const months = monthsIn(range);
      const rows = months.map((mk) => {
        const cf = f.cashFlow(scope, { from: mk + '-01', to: monthEnd(mk + '-01') });
        return [monthLabel(mk), money(cf.income), money(cf.expense), money(cf.netOperating), money(-cf.debtPayments + cf.debtProceeds), money(cf.transfersIn - cf.transfersOut), money(cf.loansRepaid - cf.loansGiven), money(cf.netCash)] as Cell[];
      });
      const tot = f.cashFlow(scope, range);
      notes.push('Debt payments reduce cash but are not expenses (the purchases or interest were the expense). "Between personal/business" shows owner draws and contributions in single-scope views.');
      return { id, title: 'Cash flow report', subtitle: `${SCOPE_LABEL[scope]} · ${sub}`, notes, sections: [{
        columns: ['Month', 'Money in', 'Money out', 'Net (in − out)', 'Debt payments / borrowing', 'Between personal/business', 'Loans to others', 'Net change in cash'], rows,
        totals: ['Total', money(tot.income), money(tot.expense), money(tot.netOperating), money(-tot.debtPayments + tot.debtProceeds), money(tot.transfersIn - tot.transfersOut), money(tot.loansRepaid - tot.loansGiven), money(tot.netCash)],
      }], chart: { label: 'Cash flow', aLabel: 'Money in', bLabel: 'Money out', values: months.map((mk, i) => ({ label: monthLabel(mk, true), a: (rows[i][1] as any).m, b: (rows[i][2] as any).m })) } };
    }
    case 'net_worth': {
      const months = monthsIn(range);
      const rows = months.map((mk) => {
        const end = mk === monthKey(f.ref) ? f.ref : monthEnd(mk + '-01');
        const nw = f.netWorth(end, scope);
        return { mk, nw };
      });
      const last = rows[rows.length - 1]?.nw ?? f.netWorth(f.ref, scope);
      return { id, title: 'Net worth report', subtitle: `${SCOPE_LABEL[scope]} · ${sub}`, notes: ['Net worth = assets − liabilities. Money owed to you counts as an asset; debts you track (including money owed to people) count as liabilities.', ...notes], sections: [
        { title: 'By month (month-end)', columns: ['Month', 'Assets', 'Liabilities', 'Net worth', 'Change'], rows: rows.map((r, i) => [monthLabel(r.mk), money(r.nw.totalAssets), money(r.nw.totalLiabilities), money(r.nw.netWorth), i ? money(r.nw.netWorth - rows[i - 1].nw.netWorth) : null]) },
        { title: 'Breakdown at end of period', columns: ['Item', 'Amount'], rows: [
          ...Object.entries(last.assets).filter(([, v]) => v).map(([k, v]) => [`Asset · ${k}`, money(v)] as Cell[]),
          ...Object.entries(last.liabilities).filter(([, v]) => v).map(([k, v]) => [`Liability · ${k}`, money(-v)] as Cell[]),
        ], totals: ['Net worth', money(last.netWorth)] },
      ], chart: { label: 'Net worth', aLabel: 'Net worth', values: rows.map((r) => ({ label: monthLabel(r.mk, true), a: r.nw.netWorth })) } };
    }
    case 'debt': {
      const ds = f.debtSummary(scope);
      const paidIn = (d: any) => f.tx.filter((t) => t.kind === 'transfer' && t.status === 'cleared' && t.date >= range.from && t.date <= range.to && (t.debt_id === d.id || (d.account_id && t.to_account_id === d.account_id))).reduce((s, t) => s + f.conv(t.amount, t.currency), 0);
      const interestIn = (d: any) => f.tx.filter((t) => t.kind === 'expense' && t.debt_id === d.id && t.status === 'cleared' && t.date >= range.from && t.date <= range.to).reduce((s, t) => s + f.conv(t.amount, t.currency), 0);
      return { id, title: 'Debt report', subtitle: `${SCOPE_LABEL[scope]} · ${sub}`, notes: ['Balances are as of today. Interest is only known when you record it (e.g. the interest part of a loan payment).', ...notes], sections: [{
        columns: ['Debt', 'Creditor', 'Balance', 'APR', 'Minimum', 'Paid in period', 'Interest in period', 'Progress'],
        rows: ds.debts.map((d) => [d.name, d.creditor, { m: d.balance, c: d.currency }, d.interest_rate + '%', { m: d.minimum_payment, c: d.currency }, money(paidIn(d)), money(interestIn(d)), { p: d.progress }]),
        totals: ['Total', '', money(ds.total), '', money(ds.minimums), '', '', null],
      }, { title: 'Summary', columns: ['Metric', 'Value'], rows: [['Total debt', money(ds.total)], ['Monthly minimums', money(ds.minimums)], ['Debt-to-income', { p: ds.dti }]] }] };
    }
    case 'savings': {
      const months = monthsIn(range);
      const rows = f.monthly(scope, months).map((m) => [monthLabel(m.month), money(m.income), money(m.expense), money(m.net), { p: m.income ? pct(m.net, m.income) : null }] as Cell[]);
      const goals = f.goals(scope);
      return { id, title: 'Savings report', subtitle: `${SCOPE_LABEL[scope]} · ${sub}`, notes: ['"Saved" = income − expenses for the month. Moving money into a savings account is a transfer, not spending.', ...notes], sections: [
        { title: 'Savings rate by month', columns: ['Month', 'Income', 'Expenses', 'Saved', 'Savings rate'], rows },
        { title: 'Goals', columns: ['Goal', 'Current', 'Target', 'Progress', 'Needed / month', 'Deadline'], rows: goals.map((g) => [g.name, { m: g.current, c: g.currency }, { m: g.target_amount, c: g.currency }, { p: g.progress }, g.requiredMonthly != null ? { m: g.requiredMonthly, c: g.currency } : '—', g.deadline ? formatDate(g.deadline) : '—']) },
      ] };
    }
    case 'tax': {
      const t = f.taxSummary(range);
      return { id, title: 'Tax-related summary', subtitle: sub, notes: [TAX_DISCLAIMER, ...notes], sections: [
        { title: 'Business summary', columns: ['Item', 'Amount'], rows: [['Business revenue', money(t.revenue)], ['Business expenses', money(t.expenses)], ['Potentially deductible expenses', money(t.deductible)], ['Marked non-deductible', money(t.nonDeductible)], ['Not yet marked', money(t.unmarked)], ['Net business income', money(t.netBusinessIncome)], ['Personal expenses marked deductible', money(t.personalDeductible)]] },
        { title: 'Potentially deductible by tax category', columns: ['Tax category', 'Amount'], rows: t.byTaxCategory.map((c) => [c.name, money(c.amount)]) },
        { title: 'Deductible transactions', columns: ['Date', 'Payee', 'Category', 'Amount', 'Tax notes'], rows: t.deductibleRows.map((r) => [r.date, r.payee ?? r.description, r.cat_name, { m: r.amount, c: r.currency }, r.tax_notes]) },
      ] };
    }
    case 'category_spending': {
      const months = monthsIn(range).slice(-12);
      const cats = f.byCategory(scope, range, 'expense');
      const matrix = months.map((mk) => new Map(f.byCategory(scope, { from: mk + '-01', to: monthEnd(mk + '-01') }, 'expense').map((c) => [c.name, c.amount])));
      return { id, title: 'Category spending', subtitle: `${SCOPE_LABEL[scope]} · ${sub}`, notes, sections: [{
        columns: ['Category', ...months.map((m) => monthLabel(m, true)), 'Total'],
        rows: cats.map((c) => [c.name, ...matrix.map((mm) => (mm.get(c.name) ? money(mm.get(c.name)!) : null)), money(c.amount)]),
        totals: ['Total', ...matrix.map((mm) => money([...mm.values()].reduce((a, b) => a + b, 0))), money(cats.reduce((a, b) => a + b.amount, 0))],
      }] };
    }
    case 'client_income': {
      const inv = f.invoices().filter((i) => i.kind === 'invoice' && i.issue_date >= range.from && i.issue_date <= range.to && i.status !== 'void');
      const received = new Map(f.byClient('business', range).map((c) => [String(c.client_id), c.amount]));
      const by = new Map<string, { name: string; invoiced: number; outstanding: number; count: number }>();
      for (const i of inv) {
        const e = by.get(String(i.client_id)) ?? { name: i.client_name ?? '—', invoiced: 0, outstanding: 0, count: 0 };
        e.invoiced += f.conv(i.amount, i.currency); e.outstanding += f.conv(i.outstanding, i.currency); e.count++;
        by.set(String(i.client_id), e);
      }
      for (const c of f.byClient('business', range)) if (!by.has(String(c.client_id))) by.set(String(c.client_id), { name: c.name, invoiced: 0, outstanding: 0, count: 0 });
      const rows = [...by.entries()].map(([k, e]) => [e.name, e.count, money(e.invoiced), money(received.get(k) ?? 0), money(e.outstanding)] as Cell[]).sort((a: any, b: any) => b[3].m - a[3].m);
      return { id, title: 'Client income report', subtitle: sub, notes: ['"Received" counts payments dated in the period (any invoice). "Invoiced/Outstanding" cover invoices issued in the period.', ...notes], sections: [
        { columns: ['Client', 'Invoices', 'Invoiced', 'Received', 'Outstanding'], rows },
        { title: 'Invoices', columns: ['Number', 'Client', 'Issued', 'Due', 'Amount', 'Paid', 'Status'], rows: inv.map((i) => [i.number, i.client_name, i.issue_date, i.due_date, { m: i.amount, c: i.currency }, { m: i.paid, c: i.currency }, i.state.replace('_', ' ')]) },
      ] };
    }
  }
  throw new Error('Unknown report ' + id);
}

export { lastMonths, monthStart };
