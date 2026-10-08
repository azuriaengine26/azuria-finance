import type { Db } from './db';
import type { Account, Budget, Category, Debt, Invoice, Recurring, SavingsGoal, Scope, Transaction, Owner } from './types';
import { isLiabilityType, isLiquidType, frequencyLabel } from './types';
import { convert, MissingRateError, type RateTable, formatMoney, pct, parseRate } from './money';
import { addDays, addMonths, diffDays, lastMonths, monthEnd, monthKey, monthStart, monthsBetween, today, presetRange, makeISO, parseISO, monthLabel, type DateRange } from './dates';
import { getSetting } from './seed';
import { nextOccurrence } from './repo';

export interface TxRow extends Transaction {
  a_owner: Owner | null; a_type: string | null; a_cur: string | null; a_start: string | null; a_name: string | null;
  ta_owner: Owner | null; ta_type: string | null; ta_cur: string | null; ta_start: string | null; ta_name: string | null;
  cat_name: string | null; cat_parent: number | null; cat_color: string | null; client_name: string | null;
}

export interface AccountView extends Account { balance: number; balanceBase: number; pendingDelta: number; liability: boolean }

export function loadRates(db: Db): RateTable {
  const rows = db.all<{ base: string; quote: string; rate: string }>(
    `SELECT base, quote, rate FROM exchange_rates r WHERE date = (SELECT MAX(date) FROM exchange_rates r2 WHERE r2.base = r.base AND r2.quote = r.quote)`);
  const t: RateTable = {};
  for (const r of rows) t[`${r.base}>${r.quote}`] = r.rate;
  return t;
}

const inScope = (owner: string | null | undefined, scope: Scope) => scope === 'all' || owner === scope;
const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

export class Finance {
  readonly base: string;
  readonly rates: RateTable;
  readonly ref: string;
  readonly drawsAsIncome: boolean;
  readonly missingRates = new Set<string>();
  private _tx?: TxRow[];
  private _cats?: Category[];
  private _accounts?: Account[];
  private balCache = new Map<string, Map<number, number>>();

  constructor(public db: Db, ref: string = today()) {
    this.ref = ref;
    this.base = getSetting(db, 'base_currency', 'USD');
    this.rates = loadRates(db);
    this.drawsAsIncome = getSetting(db, 'owner_draws_as_personal_income', '1') === '1';
  }

  // ---------- primitives ----------
  get tx(): TxRow[] {
    return (this._tx ??= this.db.all<TxRow>(`
      SELECT t.*, a.owner a_owner, a.type a_type, a.currency a_cur, a.starting_date a_start, a.name a_name,
             ta.owner ta_owner, ta.type ta_type, ta.currency ta_cur, ta.starting_date ta_start, ta.name ta_name,
             c.name cat_name, c.parent_id cat_parent, c.color cat_color, cl.name client_name
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN accounts ta ON ta.id = t.to_account_id
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE t.deleted_at IS NULL
      ORDER BY t.date DESC, t.id DESC`));
  }
  get categories(): Category[] { return (this._cats ??= this.db.all<Category>('SELECT * FROM categories')); }
  get accounts(): Account[] { return (this._accounts ??= this.db.all<Account>('SELECT * FROM accounts ORDER BY owner DESC, name')); }
  category(id: number | null | undefined) { return id == null ? undefined : this.categories.find((c) => c.id === id); }

  /** Convert to base currency; records (rather than hides) any missing exchange rate. */
  conv(amount: number, currency: string, to: string = this.base): number {
    try { return convert(amount, currency, to, this.rates); }
    catch (e) {
      if (e instanceof MissingRateError) { this.missingRates.add(`${e.from}→${e.to}`); return 0; }
      throw e;
    }
  }

  /** Effect of a transaction on its source account, in that account's currency. */
  private sourceAmount(t: TxRow): number {
    if (t.currency === t.a_cur) return t.amount;
    return t.kind !== 'transfer' && t.to_amount != null ? t.to_amount : this.conv(t.amount, t.currency, t.a_cur!);
  }
  /** Amount arriving in the destination account of a transfer, in its currency. */
  destAmount(t: TxRow): number {
    if (t.to_amount != null) return t.to_amount;
    return t.currency === t.ta_cur ? t.amount : this.conv(t.amount, t.currency, t.ta_cur!);
  }

  // ---------- accounts ----------
  /** Balances in each account's own currency. Only cleared transactions dated on/after the account's starting date count. */
  balances(asOf: string = '2999-12-31', includePending = false): Map<number, number> {
    const key = asOf + includePending;
    const hit = this.balCache.get(key);
    if (hit) return hit;
    const m = new Map<number, number>();
    for (const a of this.accounts) m.set(a.id, a.starting_balance);
    for (const t of this.tx) {
      if (t.date > asOf) continue;
      if (t.status !== 'cleared' && !(includePending && t.status === 'pending')) continue;
      if (t.account_id && t.date >= t.a_start!) {
        const amt = this.sourceAmount(t);
        m.set(t.account_id, (m.get(t.account_id) ?? 0) + (t.kind === 'income' ? amt : -amt));
      }
      if (t.kind === 'transfer' && t.to_account_id && t.date >= t.ta_start!) {
        m.set(t.to_account_id, (m.get(t.to_account_id) ?? 0) + this.destAmount(t));
      }
    }
    this.balCache.set(key, m);
    return m;
  }

  accountViews(scope: Scope = 'all', activeOnly = false): AccountView[] {
    const bal = this.balances();
    const withPending = this.balances('2999-12-31', true);
    return this.accounts
      .filter((a) => inScope(a.owner, scope) && (!activeOnly || a.is_active))
      .map((a) => {
        const balance = bal.get(a.id) ?? 0;
        return { ...a, balance, balanceBase: this.conv(balance, a.currency), pendingDelta: (withPending.get(a.id) ?? 0) - balance, liability: isLiabilityType(a.type) };
      });
  }

  cashSummary(scope: Scope = 'all') {
    const views = this.accountViews(scope).filter((a) => a.is_active && !a.liability);
    const sum = (f: (a: AccountView) => boolean) => views.filter(f).reduce((s, a) => s + a.balanceBase, 0);
    return {
      total: sum(() => true),
      liquid: sum((a) => isLiquidType(a.type)),
      personal: sum((a) => a.owner === 'personal'),
      business: sum((a) => a.owner === 'business'),
      byAccount: views,
    };
  }

  // ---------- income & expense ----------
  /** Cleared income/expense rows in scope and range. Transfers never appear here. */
  flows(scope: Scope, range: DateRange, kind?: 'income' | 'expense', statuses: string[] = ['cleared']) {
    return this.tx.filter((t) => t.kind !== 'transfer' && (!kind || t.kind === kind) && statuses.includes(t.status) && inScope(t.owner, scope) && inRange(t.date, range));
  }

  /** Owner draws/contributions crossing the business/personal line in a range. */
  ownerMovements(range: DateRange) {
    let draws = 0, contributions = 0;
    for (const t of this.tx) {
      if (t.kind !== 'transfer' || t.status !== 'cleared' || !inRange(t.date, range)) continue;
      if (t.transfer_type === 'owner_draw') draws += this.conv(t.amount, t.currency);
      if (t.transfer_type === 'owner_contribution') contributions += this.conv(t.amount, t.currency);
    }
    return { draws, contributions };
  }

  totals(scope: Scope, range: DateRange) {
    let income = 0, expense = 0;
    for (const t of this.flows(scope, range)) {
      const v = this.conv(t.amount, t.currency);
      if (t.kind === 'income') income += v; else expense += v;
    }
    const owner = this.ownerMovements(range);
    // Owner draws: never a business expense. Optionally personal income (Settings), never in the combined view.
    const drawsIncome = scope === 'personal' && this.drawsAsIncome ? owner.draws : 0;
    income += drawsIncome;
    const net = income - expense;
    return {
      income, expense, net, drawsIncome,
      ownerDraws: owner.draws, ownerContributions: owner.contributions,
      savingsRate: income > 0 ? pct(net, income) : null,
    };
  }

  byCategory(scope: Scope, range: DateRange, kind: 'income' | 'expense', rollup = true) {
    const m = new Map<number | 'none', number>();
    for (const t of this.flows(scope, range, kind)) {
      const cid: number | 'none' = t.category_id == null ? 'none' : rollup && t.cat_parent ? t.cat_parent : t.category_id;
      m.set(cid, (m.get(cid) ?? 0) + this.conv(t.amount, t.currency));
    }
    const rows = [...m.entries()].map(([id, amount]) => {
      const c = id === 'none' ? undefined : this.category(id);
      return { id, name: c?.name ?? 'Uncategorized', color: c?.color ?? '#94a3b8', owner: c?.owner, amount };
    });
    if (kind === 'income' && scope === 'personal' && this.drawsAsIncome) {
      const d = this.ownerMovements(range).draws;
      if (d) rows.push({ id: 'none', name: 'Owner draws (from business)', color: '#7c8aa5', owner: 'personal', amount: d });
    }
    return rows.sort((a, b) => b.amount - a.amount);
  }

  byClient(scope: Scope, range: DateRange) {
    const m = new Map<string, { client_id: number | null; name: string; amount: number; count: number }>();
    for (const t of this.flows(scope, range, 'income')) {
      const key = String(t.client_id ?? 'none');
      const e = m.get(key) ?? { client_id: t.client_id, name: t.client_name ?? (t.payee || 'No client'), amount: 0, count: 0 };
      e.amount += this.conv(t.amount, t.currency); e.count++;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }

  byPayee(scope: Scope, range: DateRange, kind: 'income' | 'expense') {
    const m = new Map<string, number>();
    for (const t of this.flows(scope, range, kind)) {
      const k = t.payee || t.description || '—';
      m.set(k, (m.get(k) ?? 0) + this.conv(t.amount, t.currency));
    }
    return [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }

  monthly(scope: Scope, months: string[]) {
    return months.map((mk) => {
      const r = { from: mk + '-01', to: monthEnd(mk + '-01') };
      const t = this.totals(scope, r);
      return { month: mk, label: monthLabel(mk, true), income: t.income, expense: t.expense, net: t.net };
    });
  }

  /** Full cash-flow statement: operating (income/expense) + financing movements that change cash but aren't income/expense. */
  cashFlow(scope: Scope, range: DateRange) {
    const t = this.totals(scope, range);
    let debtPayments = 0, cardPayments = 0, debtProceeds = 0, loansGiven = 0, loansRepaid = 0, toSavings = 0, crossIn = 0, crossOut = 0;
    for (const x of this.tx) {
      if (x.kind !== 'transfer' || x.status !== 'cleared' || !inRange(x.date, range)) continue;
      const v = this.conv(x.amount, x.currency);
      const srcIn = x.account_id ? inScope(x.a_owner, scope) : false;
      const dstIn = x.to_account_id ? inScope(x.ta_owner, scope) : false;
      switch (x.transfer_type) {
        // Paying a card/loan ACCOUNT you track is internal (the card purchases were already the outflow).
        // Only payments to debts tracked outside your accounts leave your money.
        case 'debt_payment': if (srcIn && !dstIn) debtPayments += v; else if (srcIn && dstIn) cardPayments += v; break;
        case 'debt_proceeds': if (dstIn) debtProceeds += v; break;
        case 'loan_given': if (srcIn) loansGiven += v; break;
        case 'loan_repayment': if (dstIn) loansRepaid += v; break;
        case 'savings': if (srcIn && dstIn) toSavings += v; break;
      }
      // Owner draws/contributions cross scopes; in a single-scope view they move cash in/out.
      if (scope !== 'all' && x.transfer_type !== 'debt_payment' && x.account_id && x.to_account_id) {
        if (dstIn && !srcIn) crossIn += v;
        if (srcIn && !dstIn) crossOut += v;
      }
    }
    // If draws are already counted as personal income, don't count them again as an inflow.
    if (scope === 'personal' && this.drawsAsIncome) crossIn -= t.drawsIncome;
    const netOperating = t.income - t.expense;
    const netCash = netOperating - debtPayments + debtProceeds - loansGiven + loansRepaid + crossIn - crossOut;
    return { income: t.income, expense: t.expense, netOperating, debtPayments, cardPayments, debtProceeds, loansGiven, loansRepaid, transfersIn: crossIn, transfersOut: crossOut, toSavings, netCash };
  }

  // ---------- receivables ----------
  invoices(): (Invoice & { client_name: string | null; paid: number; outstanding: number; state: string; days_overdue: number })[] {
    const rows = this.db.all<Invoice & { client_name: string | null }>('SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.issue_date DESC, i.id DESC');
    return rows.map((inv) => this.invoiceState(inv, this.ref));
  }

  invoiceState<T extends Invoice>(inv: T, asOf: string) {
    let paid = 0;
    for (const t of this.tx) {
      if (t.invoice_id !== inv.id || t.status !== 'cleared' || t.date > asOf) continue;
      if (t.kind === 'income' || t.transfer_type === 'loan_repayment') {
        const cur = t.kind === 'income' ? t.currency : (t.ta_cur ?? t.currency);
        const amt = t.kind === 'income' ? t.amount : this.destAmount(t);
        paid += this.conv(amt, cur, inv.currency);
      }
    }
    let outstanding = Math.max(0, inv.amount - paid);
    // A payment received in another currency can leave a tiny FX residue; treat <1% as settled.
    if (paid > 0 && outstanding * 100 < inv.amount) outstanding = 0;
    const days_overdue = inv.due_date ? diffDays(inv.due_date, asOf) : 0;
    let state: string;
    if (inv.status === 'void') state = 'void';
    else if (inv.status === 'draft') state = 'draft';
    else if (outstanding === 0) state = 'paid';
    else if (inv.due_date && inv.due_date < asOf) state = 'overdue';
    else if (inv.due_date && diffDays(asOf, inv.due_date) <= 7) state = 'due_soon';
    else state = paid > 0 ? 'partial' : 'current';
    return { ...inv, paid, outstanding: inv.status === 'void' || inv.status === 'draft' ? 0 : outstanding, state, days_overdue };
  }

  receivables(scope: Scope = 'all') {
    const inv = this.invoices().filter((i) => inScope(i.owner, scope));
    const open = inv.filter((i) => i.outstanding > 0);
    const sum = (xs: typeof inv) => xs.reduce((s, i) => s + this.conv(i.outstanding, i.currency), 0);
    const month = presetRange('this_month', this.ref);
    const paidThisMonth = this.tx.filter((t) => t.invoice_id && t.status === 'cleared' && inRange(t.date, month) && (t.kind === 'income' || t.transfer_type === 'loan_repayment') && inScope(t.owner, scope))
      .reduce((s, t) => s + this.conv(t.amount, t.currency), 0);
    const byClient = new Map<string, { client_id: number | null; name: string; outstanding: number; overdue: number; count: number }>();
    for (const i of open) {
      const k = String(i.client_id);
      const e = byClient.get(k) ?? { client_id: i.client_id, name: i.client_name ?? 'Unknown', outstanding: 0, overdue: 0, count: 0 };
      const v = this.conv(i.outstanding, i.currency);
      e.outstanding += v; e.count++;
      if (i.state === 'overdue') e.overdue += v;
      byClient.set(k, e);
    }
    return {
      total: sum(open),
      invoicesTotal: sum(open.filter((i) => i.kind === 'invoice')),
      loansTotal: sum(open.filter((i) => i.kind === 'loan')),
      current: sum(open.filter((i) => i.state === 'current' || i.state === 'partial')),
      dueSoon: sum(open.filter((i) => i.state === 'due_soon')),
      overdue: sum(open.filter((i) => i.state === 'overdue')),
      overdueCount: open.filter((i) => i.state === 'overdue').length,
      paidThisMonth,
      open, all: inv,
      byClient: [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding),
    };
  }

  // ---------- debts ----------
  debtBalance(d: Debt, asOf: string = this.ref): number {
    if (d.account_id) {
      const acct = this.accounts.find((a) => a.id === d.account_id);
      const bal = this.balances(asOf).get(d.account_id) ?? 0;
      return acct ? this.conv(-bal, acct.currency, d.currency) : 0;
    }
    if (d.start_date && asOf < d.start_date) return 0;
    if (asOf < d.balance_date) return d.opening_balance;
    const delta = this.db.value<number>('SELECT ifnull(SUM(principal),0) FROM debt_payments WHERE debt_id = ? AND date >= ? AND date <= ?', [d.id, d.balance_date, asOf]) ?? 0;
    return d.opening_balance - delta;
  }

  debts(scope: Scope = 'all', includeClosed = false) {
    const month = presetRange('this_month', this.ref);
    return this.db.all<Debt>(`SELECT * FROM debts ${includeClosed ? '' : 'WHERE is_closed = 0'} ORDER BY priority = 'critical' DESC, priority = 'high' DESC, name`)
      .filter((d) => inScope(d.owner, scope))
      .map((d) => {
        const balance = this.debtBalance(d);
        let paidThisMonth = 0;
        for (const t of this.tx) {
          if (t.kind !== 'transfer' || t.status !== 'cleared' || !inRange(t.date, month)) continue;
          if (t.debt_id === d.id || (d.account_id && t.to_account_id === d.account_id)) paidThisMonth += this.conv(d.account_id && t.to_account_id === d.account_id ? this.destAmount(t) : t.amount, d.account_id ? (t.ta_cur ?? t.currency) : t.currency, d.currency);
        }
        const nextDue = d.due_day ? nextDueDate(d.due_day, this.ref) : d.due_date;
        const original = d.original_amount || d.opening_balance;
        const progress = original > 0 ? Math.max(0, Math.min(100, pct(original - balance, original) ?? 0)) : null;
        return { ...d, balance, balanceBase: this.conv(balance, d.currency), paidThisMonth, nextDue, progress, history: this.db.all<any>('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY date DESC', [d.id]) };
      });
  }

  debtSummary(scope: Scope = 'all') {
    const ds = this.debts(scope);
    const total = ds.reduce((s, d) => s + d.balanceBase, 0);
    const minimums = ds.reduce((s, d) => s + this.conv(d.minimum_payment, d.currency), 0);
    const paidThisMonth = ds.reduce((s, d) => s + this.conv(d.paidThisMonth, d.currency), 0);
    const original = ds.reduce((s, d) => s + this.conv(d.original_amount || d.opening_balance, d.currency), 0);
    // Debt-to-income = monthly minimum payments / average monthly gross income (last 3 complete months).
    const avgIncome = this.avgMonthly(scope, 'income', 3);
    return { debts: ds, total, minimums, paidThisMonth, original, paidOff: Math.max(0, original - total), dti: avgIncome > 0 ? pct(minimums, avgIncome) : null, avgIncome };
  }

  /** Average monthly income or expense over the last n COMPLETE months. */
  avgMonthly(scope: Scope, kind: 'income' | 'expense', n = 3): number {
    const end = monthEnd(addMonths(monthStart(this.ref), -1));
    const start = addMonths(monthStart(this.ref), -n);
    const t = this.totals(scope, { from: start, to: end });
    return Math.round((kind === 'income' ? t.income : t.expense) / n);
  }

  // ---------- net worth ----------
  netWorth(asOf: string = this.ref, scope: Scope = 'all') {
    const bal = this.balances(asOf);
    const assets: Record<string, number> = { Cash: 0, 'Bank accounts': 0, Savings: 0, Investments: 0, 'Money owed to me': 0, 'Other assets': 0 };
    const liabilities: Record<string, number> = { 'Credit cards': 0, Loans: 0, 'Money I owe': 0, 'Other liabilities': 0 };
    for (const a of this.accounts) {
      if (!a.include_in_net_worth || !inScope(a.owner, scope)) continue;
      if (a.starting_date > asOf) continue;
      const v = this.conv(bal.get(a.id) ?? 0, a.currency);
      if (v >= 0) {
        const bucket = a.type === 'cash' ? 'Cash' : a.type === 'savings' ? 'Savings' : a.type === 'investment' ? 'Investments' : a.type === 'other_asset' ? 'Other assets' : isLiabilityType(a.type) ? 'Other assets' : 'Bank accounts';
        assets[bucket] += v;
      } else {
        const bucket = a.type === 'credit_card' ? 'Credit cards' : a.type === 'loan' ? 'Loans' : 'Other liabilities';
        liabilities[bucket] += -v;
      }
    }
    for (const inv of this.db.all<Invoice>("SELECT * FROM invoices WHERE status = 'sent' AND issue_date <= ?", [asOf])) {
      if (!inScope(inv.owner, scope)) continue;
      assets['Money owed to me'] += this.conv(this.invoiceState(inv, asOf).outstanding, inv.currency);
    }
    for (const d of this.db.all<Debt>('SELECT * FROM debts WHERE account_id IS NULL')) {
      if (!inScope(d.owner, scope)) continue;
      const b = this.conv(this.debtBalance(d, asOf), d.currency);
      if (b <= 0) continue;
      const bucket = ['person', 'vendor', 'contractor'].includes(d.type) ? 'Money I owe' : d.type === 'credit_card' ? 'Credit cards' : d.type.includes('loan') ? 'Loans' : 'Other liabilities';
      liabilities[bucket] += b;
    }
    const totalAssets = Object.values(assets).reduce((a, b) => a + b, 0);
    const totalLiabilities = Object.values(liabilities).reduce((a, b) => a + b, 0);
    return { assets, liabilities, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
  }

  netWorthHistory(months = 12, scope: Scope = 'all') {
    return lastMonths(this.ref, months).map((mk) => {
      const end = mk === monthKey(this.ref) ? this.ref : monthEnd(mk + '-01');
      const nw = this.netWorth(end, scope);
      return { month: mk, label: monthLabel(mk, true), assets: nw.totalAssets, liabilities: nw.totalLiabilities, netWorth: nw.netWorth };
    });
  }

  // ---------- savings goals ----------
  goals(scope: Scope = 'all', includeClosed = false) {
    const goals = this.db.all<SavingsGoal>(`SELECT * FROM savings_goals ${includeClosed ? '' : 'WHERE is_closed = 0'} ORDER BY deadline IS NULL, deadline`).filter((g) => inScope(g.owner, scope));
    return goals.map((g) => {
      let current: number;
      let pace: number; // average monthly progress over the last 3 complete months
      const from3 = addMonths(monthStart(this.ref), -3);
      const end3 = monthEnd(addMonths(monthStart(this.ref), -1));
      if (g.account_id) {
        const acct = this.accounts.find((a) => a.id === g.account_id);
        const now = this.balances().get(g.account_id) ?? 0;
        const before = this.balances(addDays(from3, -1)).get(g.account_id) ?? 0;
        const after = this.balances(end3).get(g.account_id) ?? 0;
        current = acct ? this.conv(now, acct.currency, g.currency) : 0;
        pace = acct ? Math.round(this.conv(after - before, acct.currency, g.currency) / 3) : 0;
      } else {
        current = g.starting_amount + (this.db.value<number>('SELECT ifnull(SUM(amount),0) FROM goal_contributions WHERE goal_id = ?', [g.id]) ?? 0);
        pace = Math.round((this.db.value<number>('SELECT ifnull(SUM(amount),0) FROM goal_contributions WHERE goal_id = ? AND date BETWEEN ? AND ?', [g.id, from3, end3]) ?? 0) / 3);
      }
      const remaining = Math.max(0, g.target_amount - current);
      const monthsLeft = g.deadline ? Math.max(1, monthsBetween(this.ref, g.deadline) + (parseISO(g.deadline).d >= parseISO(this.ref).d ? 0 : 0)) : null;
      const requiredMonthly = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
      const monthsAtPace = remaining === 0 ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
      const progress = Math.min(100, pct(current, g.target_amount) ?? 0);
      const onTrack = remaining === 0 ? true : monthsAtPace != null && monthsLeft != null ? monthsAtPace <= monthsLeft : null;
      return { ...g, current, remaining, monthsLeft, requiredMonthly, pace, monthsAtPace, progress, onTrack, deadlinePassed: !!g.deadline && g.deadline < this.ref && remaining > 0 };
    });
  }

  // ---------- budgets ----------
  budgets(month: string = monthKey(this.ref), scope: Scope = 'all') {
    const all = this.db.all<Budget>('SELECT * FROM budgets WHERE month IS NULL OR month = ?', [month]);
    // Month-specific budgets override the default monthly budget for the same owner+category.
    const map = new Map<string, Budget>();
    for (const b of all.filter((b) => !b.month)) map.set(`${b.owner}:${b.category_id ?? 0}`, b);
    for (const b of all.filter((b) => b.month)) map.set(`${b.owner}:${b.category_id ?? 0}`, b);
    const range = { from: month + '-01', to: monthEnd(month + '-01') };
    const elapsed = month === monthKey(this.ref) ? parseISO(this.ref).d / parseISO(monthEnd(this.ref)).d : month < monthKey(this.ref) ? 1 : 0;
    return [...map.values()].filter((b) => inScope(b.owner, scope)).map((b) => {
      const cat = this.category(b.category_id);
      const childIds = b.category_id ? new Set([b.category_id, ...this.categories.filter((c) => c.parent_id === b.category_id).map((c) => c.id)]) : null;
      const spent = this.flows(b.owner, range, 'expense', ['cleared', 'pending'])
        .filter((t) => !childIds || (t.category_id != null && childIds.has(t.category_id)))
        .reduce((s, t) => s + this.conv(t.amount, t.currency, b.currency), 0);
      const used = b.amount > 0 ? pct(spent, b.amount)! : spent > 0 ? 100 : 0;
      const status = used > 100 ? 'over' : used >= 85 ? 'warn' : 'ok';
      return { ...b, name: cat?.name ?? (b.owner === 'business' ? 'All business spending' : 'All personal spending'), color: cat?.color ?? '#64748b', spent, remaining: b.amount - spent, used, status, pace: elapsed > 0 && b.amount > 0 ? used / (elapsed * 100) : null };
    }).sort((a, b) => b.used - a.used);
  }

  // ---------- recurring, bills & subscriptions ----------
  recurringViews(scope: Scope = 'all') {
    const rules = this.db.all<Recurring & { cat_name: string | null; acct_name: string | null }>('SELECT r.*, c.name cat_name, a.name acct_name FROM recurring r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN accounts a ON a.id = r.account_id ORDER BY r.is_active DESC, r.name');
    return rules.filter((r) => inScope(r.owner, scope)).map((r) => {
      const annual = annualCost(r);
      return { ...r, annual, monthly: Math.round(annual / 12), annualBase: this.conv(annual, r.currency), monthlyBase: this.conv(Math.round(annual / 12), r.currency), next: r.is_active ? nextOccurrence(r, this.ref) : null, frequency: frequencyLabel(r.unit, r.interval) };
    });
  }

  subscriptions(scope: Scope = 'all') {
    const subs = this.recurringViews(scope).filter((r) => r.is_subscription && r.is_active);
    const monthly = subs.reduce((s, r) => s + r.monthlyBase, 0);
    const annual = subs.reduce((s, r) => s + r.annualBase, 0);
    const soon = subs.filter((r) => r.next && diffDays(this.ref, r.next) <= 14).sort((a, b) => a.next!.localeCompare(b.next!));
    // Candidates are based on what YOU rated, plus overlapping services in the same category.
    const byCat = new Map<number, number>();
    for (const s of subs) if (s.category_id) byCat.set(s.category_id, (byCat.get(s.category_id) ?? 0) + 1);
    const candidates = subs.map((s) => {
      const reasons: string[] = [];
      if (s.subscription_value === 'cancel') reasons.push('You marked it to cancel');
      if (s.subscription_value === 'unsure') reasons.push('You marked it "unsure"');
      if (!s.subscription_value) reasons.push('Not rated yet — is it worth it?');
      if (s.category_id && (byCat.get(s.category_id) ?? 0) > 1 && s.subscription_value !== 'essential') reasons.push(`One of ${byCat.get(s.category_id)} subscriptions in ${s.cat_name}`);
      return { ...s, reasons };
    }).filter((s) => s.subscription_value !== 'essential' && s.reasons.length).sort((a, b) => b.annualBase - a.annualBase);
    return { subs, monthly, annual, soon, candidates };
  }

  /** Expected (not yet happened) items, oldest first. Late = expected/pending and dated before today. */
  upcoming(scope: Scope = 'all', days = 30, kind?: 'income' | 'expense' | 'transfer') {
    const until = addDays(this.ref, days);
    return this.tx.filter((t) => (t.status === 'expected' || t.status === 'pending') && t.date <= until && inScope(t.owner, scope) && (!kind || t.kind === kind))
      .map((t) => ({ ...t, late: t.date < this.ref, base: this.conv(t.amount, t.currency) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------- income tracking ----------
  incomeOverview(scope: Scope = 'all') {
    const thisM = presetRange('this_month', this.ref);
    const nextStart = addMonths(monthStart(this.ref), 1);
    const nextM = { from: nextStart, to: monthEnd(nextStart) };
    const income = this.tx.filter((t) => t.kind === 'income' && inScope(t.owner, scope));
    const statusOf = (t: TxRow) => t.status === 'cleared' ? 'received' : t.status === 'cancelled' ? 'cancelled' : t.date < this.ref ? 'late' : t.status;
    const rec = this.receivables(scope);
    const linkedInvoices = new Set(income.filter((t) => t.status === 'expected' || t.status === 'pending').map((t) => t.invoice_id).filter(Boolean));
    // Expected = scheduled income items + open invoices due in the period that don't already have a scheduled item (no double count).
    const expectedIn = (r: DateRange) =>
      income.filter((t) => (t.status === 'expected' || t.status === 'pending') && inRange(t.date, r)).reduce((s, t) => s + this.conv(t.amount, t.currency), 0) +
      rec.open.filter((i) => i.kind === 'invoice' && !linkedInvoices.has(i.id) && i.due_date && inRange(i.due_date, r)).reduce((s, i) => s + this.conv(i.outstanding, i.currency), 0);
    const late = income.filter((t) => statusOf(t) === 'late');
    return {
      expectedThisMonth: expectedIn(thisM),
      expectedNextMonth: expectedIn(nextM),
      receivedThisMonth: this.totals(scope, thisM).income,
      receivedThisYear: this.totals(scope, presetRange('this_year', this.ref)).income,
      lateTotal: late.reduce((s, t) => s + this.conv(t.amount, t.currency), 0) + rec.overdue,
      items: income.map((t) => ({ ...t, state: statusOf(t), base: this.conv(t.amount, t.currency) })),
      invoicesDue: rec.open.filter((i) => !linkedInvoices.has(i.id)),
    };
  }

  // ---------- tax ----------
  taxSummary(range: DateRange) {
    const biz = this.totals('business', range);
    const rows = this.flows('business', range, 'expense');
    const deductibleOf = (t: TxRow) => t.tax_deductible ?? this.category(t.category_id)?.deductible_default ?? (t.cat_parent ? this.category(t.cat_parent)?.deductible_default : null) ?? null;
    let deductible = 0, nonDeductible = 0, unmarked = 0;
    const byTaxCat = new Map<string, number>();
    for (const t of rows) {
      const v = this.conv(t.amount, t.currency);
      const d = deductibleOf(t);
      if (d === 1) {
        deductible += v;
        const tc = t.tax_category || this.category(t.category_id)?.tax_category || 'Unassigned';
        byTaxCat.set(tc, (byTaxCat.get(tc) ?? 0) + v);
      } else if (d === 0) nonDeductible += v; else unmarked += v;
    }
    const personalDeductible = this.flows('personal', range, 'expense').filter((t) => t.tax_deductible === 1).reduce((s, t) => s + this.conv(t.amount, t.currency), 0);
    return {
      revenue: biz.income, expenses: biz.expense, netBusinessIncome: biz.income - biz.expense, deductible, nonDeductible, unmarked, personalDeductible,
      byTaxCategory: [...byTaxCat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
      deductibleRows: rows.filter((t) => deductibleOf(t) === 1),
    };
  }

  // ---------- health ----------
  health(scope: Scope = 'personal') {
    const n = 3;
    const end = monthEnd(addMonths(monthStart(this.ref), -1));
    const start = addMonths(monthStart(this.ref), -n);
    const t = this.totals(scope, { from: start, to: end });
    const avgIncome = Math.round(t.income / n), avgExpense = Math.round(t.expense / n);
    const debt = this.debtSummary(scope);
    const liquid = this.accountViews(scope).filter((a) => a.is_active && isLiquidType(a.type)).reduce((s, a) => s + a.balanceBase, 0);
    const recurringMonthly = this.recurringViews(scope).filter((r) => r.is_active && r.kind === 'expense').reduce((s, r) => s + r.monthlyBase, 0);
    const biz = this.totals('business', { from: start, to: end });
    const nwNow = this.netWorth(this.ref, scope).netWorth;
    const nwThen = this.netWorth(monthEnd(addMonths(monthStart(this.ref), -4)), scope).netWorth;
    return {
      period: `${monthLabel(monthKey(start), true)} – ${monthLabel(monthKey(end), true)}`,
      metrics: [
        { key: 'savings_rate', label: 'Savings rate', value: t.income > 0 ? pct(t.income - t.expense, t.income) : null, unit: '%', good: (v: number) => v >= 20, warn: (v: number) => v < 10,
          explain: 'Share of income left after expenses over the last 3 complete months. 20%+ is commonly considered healthy; below 10% leaves little cushion.' },
        { key: 'expense_ratio', label: 'Expense-to-income', value: t.income > 0 ? pct(t.expense, t.income) : null, unit: '%', good: (v: number) => v <= 80, warn: (v: number) => v > 95,
          explain: 'Expenses divided by income. Above 100% means spending more than you earn.' },
        { key: 'dti', label: 'Debt-to-income', value: debt.dti, unit: '%', good: (v: number) => v <= 20, warn: (v: number) => v > 36,
          explain: 'Monthly minimum debt payments divided by average monthly income. Lenders often look for 36% or less.' },
        { key: 'cash_flow', label: 'Avg monthly cash flow', value: avgIncome - avgExpense, unit: 'money', good: (v: number) => v > 0, warn: (v: number) => v < 0,
          explain: 'Average income minus expenses per month. Negative means savings or debt are covering the gap.' },
        { key: 'emergency', label: 'Emergency fund coverage', value: avgExpense > 0 ? Math.round((liquid / avgExpense) * 10) / 10 : null, unit: 'months', good: (v: number) => v >= 6, warn: (v: number) => v < 3,
          explain: 'How many months of average expenses your liquid accounts (cash, checking, savings, PayPal/Stripe) could cover. 3–6 months is a common target.' },
        { key: 'recurring', label: 'Recurring share of spending', value: avgExpense > 0 ? pct(recurringMonthly, avgExpense) : null, unit: '%', good: (v: number) => v <= 50, warn: (v: number) => v > 75,
          explain: 'Monthly cost of recurring bills and subscriptions as a share of average spending. A high share means less flexibility.' },
        { key: 'margin', label: 'Business profit margin', value: biz.income > 0 ? pct(biz.income - biz.expense, biz.income) : null, unit: '%', good: (v: number) => v >= 20, warn: (v: number) => v < 5,
          explain: 'Business revenue minus business expenses, as a share of revenue (last 3 complete months). Owner draws are not expenses.' },
        { key: 'nw_growth', label: 'Net worth change (3 mo)', value: nwNow - nwThen, unit: 'money', good: (v: number) => v > 0, warn: (v: number) => v < 0,
          explain: 'Change in net worth over roughly the last three months.' },
      ],
    };
  }

  // ---------- insights (only from stored data) ----------
  insights(scope: Scope = 'all'): { text: string; tone: 'good' | 'bad' | 'neutral'; to?: string }[] {
    const out: { text: string; tone: 'good' | 'bad' | 'neutral'; to?: string }[] = [];
    const f = (v: number) => formatMoney(v, this.base);
    const day = parseISO(this.ref).d;
    const thisR = { from: monthStart(this.ref), to: this.ref };
    const lastStart = addMonths(monthStart(this.ref), -1);
    const lastR = { from: lastStart, to: makeISO(parseISO(lastStart).y, parseISO(lastStart).m, day) };
    const threshold = this.conv(5000, 'USD');
    const now = new Map(this.byCategory(scope, thisR, 'expense').map((c) => [c.name, c.amount]));
    const prev = new Map(this.byCategory(scope, lastR, 'expense').map((c) => [c.name, c.amount]));
    const changes: { name: string; ch: number; diff: number }[] = [];
    for (const [name, a] of now) {
      const b = prev.get(name);
      if (b && b >= threshold && a >= threshold) changes.push({ name, ch: ((a - b) / b) * 100, diff: a - b });
    }
    changes.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    for (const c of changes.filter((c) => Math.abs(c.ch) >= 20).slice(0, 2)) {
      out.push({ text: `You spent ${Math.round(Math.abs(c.ch))}% ${c.ch > 0 ? 'more' : 'less'} on ${c.name.toLowerCase()} so far this month than by the same day last month (${f(Math.abs(c.diff))} ${c.ch > 0 ? 'more' : 'less'}).`, tone: c.ch > 0 ? 'bad' : 'good', to: '/expenses' });
    }
    const top = [...now.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) out.push({ text: `Your largest expense category this month is ${top[0].toLowerCase()} (${f(top[1])}).`, tone: 'neutral', to: '/expenses' });
    if (scope !== 'personal') {
      const rec = this.receivables(scope);
      if (rec.overdue > 0) out.push({ text: `You have ${f(rec.overdue)} in ${rec.overdueCount === 1 ? 'an invoice' : rec.overdueCount + ' invoices'} currently overdue.`, tone: 'bad', to: '/clients' });
      const m1 = addMonths(monthStart(this.ref), -1), m2 = addMonths(monthStart(this.ref), -2);
      const a = this.totals('business', { from: m1, to: monthEnd(m1) }), b = this.totals('business', { from: m2, to: monthEnd(m2) });
      if (a.income > 0 && b.income > 0) {
        const ma = Math.round(((a.income - a.expense) / a.income) * 100), mb = Math.round(((b.income - b.expense) / b.income) * 100);
        if (ma !== mb) out.push({ text: `Business profit margin ${ma > mb ? 'increased' : 'decreased'} from ${mb}% in ${monthLabel(monthKey(m2))} to ${ma}% in ${monthLabel(monthKey(m1))}.`, tone: ma > mb ? 'good' : 'bad', to: '/azuria' });
      }
    }
    const rv = this.recurringViews(scope).filter((r) => r.is_active && r.kind === 'expense');
    const monthAgo = addDays(this.ref, -30);
    const nowRec = rv.filter((r) => r.start_date <= this.ref).reduce((s, r) => s + r.monthlyBase, 0);
    const thenRec = rv.filter((r) => r.start_date <= monthAgo && (r as any).created_at?.slice(0, 10) <= monthAgo).reduce((s, r) => s + r.monthlyBase, 0);
    if (thenRec > 0 && nowRec !== thenRec) out.push({ text: `Your recurring expenses ${nowRec > thenRec ? 'increased' : 'decreased'} by ${f(Math.abs(nowRec - thenRec))}/month compared with 30 days ago.`, tone: nowRec > thenRec ? 'bad' : 'good', to: '/bills' });
    for (const g of this.goals(scope).slice(0, 3)) {
      if (g.remaining === 0) out.push({ text: `You've reached your "${g.name}" goal. 🎉`, tone: 'good', to: '/savings' });
      else if (g.monthsAtPace != null) out.push({ text: `At your recent pace you'll reach "${g.name}" in about ${g.monthsAtPace} month${g.monthsAtPace === 1 ? '' : 's'}${g.monthsLeft != null ? (g.onTrack ? ' — on track for your deadline' : ` — ${g.monthsLeft} month${g.monthsLeft === 1 ? '' : 's'} left before the deadline`) : ''}.`, tone: g.onTrack === false ? 'bad' : 'good', to: '/savings' });
    }
    const over = this.budgets(monthKey(this.ref), scope).filter((b) => b.status === 'over');
    if (over.length) out.push({ text: `${over.length} budget${over.length > 1 ? 's are' : ' is'} over the limit this month: ${over.map((b) => b.name).slice(0, 3).join(', ')}.`, tone: 'bad', to: '/budgets' });
    return out;
  }

  // ---------- alerts / notifications ----------
  alerts() {
    const s = (k: string) => getSetting(this.db, k, '1') === '1';
    const dismissed = new Set<string>(JSON.parse(getSetting(this.db, 'dismissed_alerts', '[]')));
    const out: { key: string; type: string; title: string; detail: string; severity: 'info' | 'warn' | 'danger'; to: string }[] = [];
    const look = Number(getSetting(this.db, 'bill_lookahead_days', '14'));
    const f = (v: number, c = this.base) => formatMoney(v, c);
    if (s('notify_bills')) for (const t of this.upcoming('all', look, 'expense')) {
      out.push({ key: `bill:${t.id}`, type: 'Bills', title: `${t.late ? 'Overdue' : 'Upcoming'}: ${t.payee || t.description || 'Bill'}`, detail: `${f(t.amount, t.currency)} · ${t.late ? 'was due' : 'due'} ${t.date}`, severity: t.late ? 'danger' : 'info', to: '/bills' });
    }
    if (s('notify_debt')) for (const d of this.debts()) {
      if (d.nextDue && diffDays(this.ref, d.nextDue) <= 7 && d.balance > 0) out.push({ key: `debt:${d.id}:${d.nextDue}`, type: 'Debt', title: `Debt payment due: ${d.name}`, detail: `Minimum ${f(d.minimum_payment, d.currency)} · due ${d.nextDue}`, severity: diffDays(this.ref, d.nextDue) < 0 ? 'danger' : 'warn', to: '/debt' });
    }
    if (s('notify_invoices')) for (const i of this.receivables().open.filter((i) => i.state === 'overdue')) {
      out.push({ key: `inv:${i.id}`, type: 'Invoices', title: `Overdue: ${i.number ?? 'loan'} — ${i.client_name ?? ''}`, detail: `${f(i.outstanding, i.currency)} · ${i.days_overdue} days late`, severity: 'danger', to: '/clients' });
    }
    if (s('notify_unusual')) {
      const mult = Number(getSetting(this.db, 'unusual_expense_multiplier', '3'));
      const since = addDays(this.ref, -7), histFrom = addMonths(this.ref, -6);
      for (const t of this.tx.filter((t) => t.kind === 'expense' && t.status === 'cleared' && t.date >= since && t.date <= this.ref)) {
        const hist = this.tx.filter((h) => h.kind === 'expense' && h.status === 'cleared' && h.category_id === t.category_id && h.id !== t.id && h.date >= histFrom && h.date < since).map((h) => this.conv(h.amount, h.currency)).sort((a, b) => a - b);
        if (hist.length < 3) continue;
        const median = hist[Math.floor(hist.length / 2)];
        const v = this.conv(t.amount, t.currency);
        if (median > 0 && v >= median * mult) out.push({ key: `unusual:${t.id}`, type: 'Unusual expense', title: `Large ${t.cat_name ?? ''} expense: ${t.payee ?? ''}`, detail: `${f(t.amount, t.currency)} — about ${Math.round(v / median)}× your typical ${t.cat_name?.toLowerCase() ?? ''} expense`, severity: 'warn', to: `/transactions?id=${t.id}` });
      }
    }
    if (s('notify_budget')) for (const b of this.budgets()) {
      if (b.status !== 'ok') out.push({ key: `budget:${b.id}:${monthKey(this.ref)}:${b.status}`, type: 'Budgets', title: `${b.status === 'over' ? 'Budget exceeded' : 'Budget almost used'}: ${b.name}`, detail: `${f(b.spent, b.currency)} of ${f(b.amount, b.currency)} (${Math.round(b.used)}%)`, severity: b.status === 'over' ? 'danger' : 'warn', to: '/budgets' });
    }
    if (s('notify_subscriptions')) for (const r of this.subscriptions().soon.filter((r) => diffDays(this.ref, r.next!) <= 7)) {
      out.push({ key: `sub:${r.id}:${r.next}`, type: 'Subscriptions', title: `Renews soon: ${r.name}`, detail: `${f(r.amount, r.currency)} on ${r.next}`, severity: 'info', to: '/bills' });
    }
    if (s('notify_low_balance')) for (const a of this.accountViews('all', true)) {
      if (a.low_balance_alert != null && !a.liability && a.balance < a.low_balance_alert) out.push({ key: `low:${a.id}:${this.ref}`, type: 'Low balance', title: `Low balance: ${a.name}`, detail: `${f(a.balance, a.currency)} (alert below ${f(a.low_balance_alert, a.currency)})`, severity: 'warn', to: '/accounts' });
    }
    if (s('notify_goals')) for (const g of this.goals()) {
      const milestone = [100, 75, 50, 25].find((m) => g.progress >= m);
      if (milestone) out.push({ key: `goal:${g.id}:${milestone}`, type: 'Savings goals', title: milestone === 100 ? `Goal reached: ${g.name}` : `${milestone}% of "${g.name}" saved`, detail: `${f(g.current, g.currency)} of ${f(g.target_amount, g.currency)}`, severity: 'info', to: '/savings' });
    }
    return out.filter((a) => !dismissed.has(a.key));
  }
}

export function nextDueDate(dueDay: number, ref: string): string {
  const { y, m, d } = parseISO(ref);
  return d <= dueDay ? makeISO(y, m, dueDay) : makeISO(y, m + 1, dueDay);
}

/** Annualised cost of a recurring rule in its own currency, exact integer arithmetic. */
export function annualCost(r: Pick<Recurring, 'amount' | 'unit' | 'interval'>): number {
  const a = BigInt(r.amount), i = BigInt(r.interval);
  const num = r.unit === 'day' ? a * 365n : r.unit === 'week' ? a * 52n : r.unit === 'month' ? a * 12n : a;
  return Number((num * 2n + i) / (2n * i));
}

// ---------- debt payoff planner (pure) ----------
export interface PayoffDebt { id: number; name: string; balance: number; apr: string; minimum: number }
export interface PayoffResult {
  method: string; months: number | null; totalInterest: number; totalPaid: number; order: { id: number; name: string; month: number }[];
  series: number[]; stuck: string[];
}

/**
 * Month-by-month simulation. Interest accrues monthly at APR/12 (rounded to the cent each month).
 * Every debt gets its minimum; the remaining budget goes to the target debt chosen by the method.
 * When a debt is paid off its minimum rolls into the extra payment.
 */
export function simulatePayoff(debts: PayoffDebt[], monthlyBudget: number, method: 'avalanche' | 'snowball' | 'minimum', maxMonths = 600): PayoffResult {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, bal: d.balance, rate: parseRate(d.apr || '0'), paidMonth: 0 }));
  const sumMin = ds.reduce((s, d) => s + d.minimum, 0);
  const budget = method === 'minimum' ? sumMin : Math.max(monthlyBudget, sumMin);
  const order: PayoffResult['order'] = [];
  const series: number[] = [ds.reduce((s, d) => s + d.bal, 0)];
  let totalInterest = 0, totalPaid = 0, month = 0;
  const stuck = ds.filter((d) => {
    const monthlyInterest = Number((BigInt(d.bal) * d.rate.num) / (d.rate.den * 1200n));
    return d.minimum <= monthlyInterest;
  }).map((d) => d.name);
  const pick = () => {
    const open = ds.filter((d) => d.bal > 0);
    if (method === 'snowball') return open.sort((a, b) => a.bal - b.bal || cmpRate(b.rate, a.rate))[0];
    return open.sort((a, b) => cmpRate(b.rate, a.rate) || a.bal - b.bal)[0];
  };
  while (ds.some((d) => d.bal > 0) && month < maxMonths) {
    month++;
    for (const d of ds) if (d.bal > 0) {
      const interest = Number((BigInt(d.bal) * d.rate.num * 2n + d.rate.den * 1200n) / (d.rate.den * 2400n));
      d.bal += interest; totalInterest += interest;
    }
    let pool = budget;
    for (const d of ds) if (d.bal > 0) { const p = Math.min(d.minimum, d.bal, pool); d.bal -= p; pool -= p; totalPaid += p; }
    if (method !== 'minimum') {
      let target = pick();
      while (pool > 0 && target) {
        const p = Math.min(pool, target.bal); target.bal -= p; pool -= p; totalPaid += p;
        if (target.bal === 0) target = pick();
      }
    }
    for (const d of ds) if (d.bal === 0 && !d.paidMonth) { d.paidMonth = month; order.push({ id: d.id, name: d.name, month }); }
    series.push(ds.reduce((s, d) => s + d.bal, 0));
  }
  const done = ds.every((d) => d.bal === 0);
  return { method, months: done ? month : null, totalInterest, totalPaid, order, series, stuck };
}
function cmpRate(a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }) {
  const x = a.num * b.den, y = b.num * a.den;
  return x > y ? 1 : x < y ? -1 : 0;
}
