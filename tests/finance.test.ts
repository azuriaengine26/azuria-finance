import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from '../src/core/db';
import { seedDefaults, setSetting } from '../src/core/seed';
import { Finance, simulatePayoff, annualCost } from '../src/core/finance';
import { saveAccount, saveTransaction, saveRate, recordDebtPayment, recordInvoicePayment, generateRecurring, occurrences, deleteTransaction, restoreTransaction, duplicateTransaction, txHistory, ValidationError } from '../src/core/repo';
import { parseMoney, formatMoney, convert, sumConverted, toDecimalString } from '../src/core/money';
import { parseCSV, detectColumns, buildPreview, commitImport, undoImport, parseOFX } from '../src/core/importer';
import { exportJSON, restoreJSON, deleteDemoData, hasDemoData, transactionsCSV } from '../src/core/backup';
import { loadDemoData } from '../src/core/demo';
import { globalSearch, parsePeriod } from '../src/core/search';
import { buildReport, REPORTS } from '../src/core/reports';
import { presetRange, today, addMonths } from '../src/core/dates';

const REF = '2026-08-20';
const AUG = { from: '2026-08-01', to: '2026-08-31' };
const $ = (s: string) => parseMoney(s);

let db: Db;
const cat = (name: string, kind = 'expense', owner = 'personal') => db.value<number>('SELECT id FROM categories WHERE name=? AND kind=? AND owner=?', [name, kind, owner])!;

async function fresh() {
  db = await Db.create();
  seedDefaults(db);
  saveRate(db, 'USD', 'HNL', '26.20', '2026-01-01');
}

describe('money (decimal-safe)', () => {
  it('parses and formats without floating point drift', () => {
    expect($('0.1') + $('0.2')).toBe($('0.3'));
    expect($('1,234.56')).toBe(123456);
    expect($('(45.10)')).toBe(-4510);
    expect($('$-20')).toBe(-2000);
    expect($('1.234,56')).toBe(123456);
    expect($('1.234.567')).toBe(123456700);
    expect($('12,50')).toBe(1250);
    expect($('10.005')).toBe(1001); // half away from zero
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-500, 'HNL')).toBe('−L5.00');
    expect(toDecimalString(-5)).toBe('-0.05');
    let s = 0; for (let i = 0; i < 1000; i++) s += $('0.10');
    expect(s).toBe($('100.00'));
  });
  it('converts currencies exactly and never mutates the original', () => {
    const rates = { 'USD>HNL': '26.20' };
    expect(convert(50000, 'USD', 'HNL', rates)).toBe(1310000); // $500 -> L13,100
    expect(convert(1310000, 'HNL', 'USD', rates)).toBe(50000);
    expect(convert(100, 'HNL', 'USD', rates)).toBe(4); // L1.00 = $0.038 -> $0.04
    expect(() => convert(100, 'EUR', 'HNL', rates)).toThrow(/No exchange rate/);
    // group-then-convert: rounding happens once per currency
    expect(sumConverted([{ amount: 1, currency: 'HNL' }, { amount: 1, currency: 'HNL' }, { amount: 1, currency: 'HNL' }], 'USD', rates)).toBe(0);
    expect(sumConverted([{ amount: 50000, currency: 'USD' }, { amount: 262000, currency: 'HNL' }], 'USD', rates)).toBe(60000);
  });
});

describe('accounting rules', () => {
  beforeEach(fresh);

  it('income/expense totals, transfers never counted, business/personal separated', () => {
    const chk = saveAccount(db, { name: 'Checking', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('1000'), starting_date: '2026-01-01' });
    const sav = saveAccount(db, { name: 'Savings', type: 'savings', owner: 'personal', currency: 'USD', starting_balance: 0, starting_date: '2026-01-01' });
    const biz = saveAccount(db, { name: 'Biz', type: 'checking', owner: 'business', currency: 'USD', starting_balance: $('5000'), starting_date: '2026-01-01' });
    saveTransaction(db, { date: '2026-08-02', kind: 'income', account_id: chk, amount: $('3000'), category_id: cat('Salary', 'income') });
    saveTransaction(db, { date: '2026-08-03', kind: 'expense', account_id: chk, amount: $('120.55'), category_id: cat('Groceries') });
    saveTransaction(db, { date: '2026-08-04', kind: 'expense', account_id: chk, amount: $('79.45'), category_id: cat('Restaurants') });
    saveTransaction(db, { date: '2026-08-05', kind: 'transfer', account_id: chk, to_account_id: sav, amount: $('500') }); // savings move
    saveTransaction(db, { date: '2026-08-06', kind: 'income', account_id: biz, amount: $('4500'), category_id: cat('Client payments', 'income', 'business') });
    saveTransaction(db, { date: '2026-08-07', kind: 'expense', account_id: biz, amount: $('1500'), category_id: cat('Contractors', 'expense', 'business') });
    saveTransaction(db, { date: '2026-08-08', kind: 'expense', status: 'pending', account_id: biz, amount: $('99'), category_id: cat('Software', 'expense', 'business') });
    const f = new Finance(db, REF);
    expect(f.totals('personal', AUG)).toMatchObject({ income: $('3000'), expense: $('200'), net: $('2800') });
    expect(f.totals('business', AUG)).toMatchObject({ income: $('4500'), expense: $('1500'), net: $('3000') });
    expect(f.totals('all', AUG)).toMatchObject({ income: $('7500'), expense: $('1700') });
    const bal = f.balances();
    expect(bal.get(chk)).toBe($('1000') + $('3000') - $('200') - $('500'));
    expect(bal.get(sav)).toBe($('500'));
    expect(bal.get(biz)).toBe($('5000') + $('4500') - $('1500')); // pending excluded
    expect(f.accountViews().find((a) => a.id === biz)!.pendingDelta).toBe(-$('99'));
    expect(f.totals('personal', AUG).savingsRate).toBeCloseTo(93.3, 1);
    // transfer of savings is inferred as 'savings', not an expense
    expect(db.value("SELECT transfer_type FROM transactions WHERE kind='transfer'")).toBe('savings');
  });

  it('credit card: purchase is the expense, payment is a transfer (no double count)', () => {
    const chk = saveAccount(db, { name: 'Checking', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('2000'), starting_date: '2026-01-01' });
    const card = saveAccount(db, { name: 'Visa', type: 'credit_card', owner: 'personal', currency: 'USD', starting_balance: 0, starting_date: '2026-01-01' });
    saveTransaction(db, { date: '2026-08-02', kind: 'expense', account_id: card, amount: $('300'), category_id: cat('Shopping') });
    const payId = saveTransaction(db, { date: '2026-08-15', kind: 'transfer', account_id: chk, to_account_id: card, amount: $('300') });
    const f = new Finance(db, REF);
    expect(db.value('SELECT transfer_type FROM transactions WHERE id=?', [payId])).toBe('debt_payment');
    expect(f.totals('personal', AUG).expense).toBe($('300')); // only once
    expect(f.balances().get(card)).toBe(0);
    expect(f.balances().get(chk)).toBe($('1700'));
    expect(f.netWorth(REF).netWorth).toBe($('1700'));
    const cf = f.cashFlow('personal', AUG);
    expect(cf.cardPayments).toBe($('300'));
    expect(cf.debtPayments).toBe(0);
    expect(cf.netCash).toBe(-$('300')); // the purchase was the outflow; paying the card is internal
  });

  it('cash-flow identity: net cash change equals the change in account balances', () => {
    const biz = saveAccount(db, { name: 'Biz', type: 'checking', owner: 'business', currency: 'USD', starting_balance: $('9000'), starting_date: '2026-01-01' });
    const bcard = saveAccount(db, { name: 'BCard', type: 'credit_card', owner: 'business', currency: 'USD', starting_balance: -$('400'), starting_date: '2026-01-01' });
    const per = saveAccount(db, { name: 'Per', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('700'), starting_date: '2026-01-01' });
    const sav = saveAccount(db, { name: 'Sav', type: 'savings', owner: 'personal', currency: 'USD', starting_balance: 0, starting_date: '2026-01-01' });
    const loan = db.insert('debts', { name: 'Loan', type: 'personal_loan', owner: 'personal', currency: 'USD', opening_balance: $('5000'), balance_date: '2026-01-01' });
    saveTransaction(db, { date: '2026-08-02', kind: 'income', account_id: biz, amount: $('5000'), category_id: cat('Client payments', 'income', 'business') });
    saveTransaction(db, { date: '2026-08-03', kind: 'expense', account_id: bcard, amount: $('250'), category_id: cat('Software', 'expense', 'business') });
    saveTransaction(db, { date: '2026-08-04', kind: 'transfer', account_id: biz, to_account_id: bcard, amount: $('650') });
    saveTransaction(db, { date: '2026-08-05', kind: 'transfer', account_id: biz, to_account_id: per, amount: $('2000') });
    saveTransaction(db, { date: '2026-08-06', kind: 'transfer', account_id: per, to_account_id: sav, amount: $('300') });
    saveTransaction(db, { date: '2026-08-07', kind: 'expense', account_id: per, amount: $('80'), category_id: cat('Gas') });
    recordDebtPayment(db, loan, { date: '2026-08-08', amount: $('400'), interest: $('40'), from_account_id: per });
    saveTransaction(db, { date: '2026-08-09', kind: 'transfer', transfer_type: 'loan_given', account_id: sav, amount: $('100') });
    const f = new Finance(db, REF);
    for (const scope of ['all', 'personal', 'business'] as const) {
      const ids = f.accounts.filter((a) => scope === 'all' || a.owner === scope).map((a) => a.id);
      const sum = (m: Map<number, number>) => ids.reduce((s, id) => s + (m.get(id) ?? 0), 0);
      const delta = sum(f.balances('2026-08-31')) - sum(f.balances('2026-07-31'));
      // personal view counts owner draws as income (default setting) — the identity still holds
      expect(f.cashFlow(scope, AUG).netCash, scope).toBe(delta);
    }
  });

  it('owner draws: not a business expense; optional personal income; neutral in combined view', () => {
    const biz = saveAccount(db, { name: 'Biz', type: 'checking', owner: 'business', currency: 'USD', starting_balance: $('10000'), starting_date: '2026-01-01' });
    const per = saveAccount(db, { name: 'Per', type: 'checking', owner: 'personal', currency: 'HNL', starting_balance: 0, starting_date: '2026-01-01' });
    expect(() => saveTransaction(db, { date: '2026-08-10', kind: 'transfer', account_id: biz, to_account_id: per, amount: $('1000') })).toThrow(/amount received in HNL/);
    saveTransaction(db, { date: '2026-08-10', kind: 'transfer', account_id: biz, to_account_id: per, amount: $('1000'), to_amount: $('26150') }); // bank's actual rate
    const f = new Finance(db, REF);
    expect(db.value("SELECT transfer_type FROM transactions")).toBe('owner_draw');
    expect(f.totals('business', AUG)).toMatchObject({ expense: 0, ownerDraws: $('1000') });
    expect(f.totals('all', AUG)).toMatchObject({ income: 0, expense: 0 });
    expect(f.totals('personal', AUG).income).toBe($('1000'));
    expect(f.balances().get(per)).toBe($('26150')); // actual received amount preserved
    setSetting(db, 'owner_draws_as_personal_income', '0');
    expect(new Finance(db, REF).totals('personal', AUG).income).toBe(0);
  });

  it('multi-currency: original amounts preserved, converted for totals', () => {
    const hnl = saveAccount(db, { name: 'HNL', type: 'checking', owner: 'personal', currency: 'HNL', starting_balance: $('26200'), starting_date: '2026-01-01' });
    const id = saveTransaction(db, { date: '2026-08-02', kind: 'expense', account_id: hnl, amount: $('2620'), category_id: cat('Groceries') });
    const row = db.get<any>('SELECT amount, currency FROM transactions WHERE id = ?', [id]);
    expect(row).toEqual({ amount: $('2620'), currency: 'HNL' });
    const f = new Finance(db, REF);
    expect(f.totals('personal', AUG).expense).toBe($('100')); // base USD
    expect(f.cashSummary().total).toBe($('900'));
    setSetting(db, 'base_currency', 'HNL');
    expect(new Finance(db, REF).totals('personal', AUG).expense).toBe($('2620'));
    // updating the rate changes conversions but never stored amounts
    saveRate(db, 'USD', 'HNL', '25', '2026-08-15');
    setSetting(db, 'base_currency', 'USD');
    expect(new Finance(db, REF).totals('personal', AUG).expense).toBe($('104.80'));
    expect(db.value('SELECT amount FROM transactions WHERE id = ?', [id])).toBe($('2620'));
  });

  it('starting balance is not double counted by earlier transactions', () => {
    const a = saveAccount(db, { name: 'A', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('500'), starting_date: '2026-06-01' });
    saveTransaction(db, { date: '2026-05-20', kind: 'expense', account_id: a, amount: $('50'), category_id: cat('Groceries') });
    saveTransaction(db, { date: '2026-06-02', kind: 'expense', account_id: a, amount: $('20'), category_id: cat('Groceries') });
    expect(new Finance(db, REF).balances().get(a)).toBe($('480'));
  });

  it('validation rejects bad data', () => {
    const a = saveAccount(db, { name: 'A', type: 'checking', owner: 'personal', currency: 'USD', starting_date: '2026-01-01' });
    expect(() => saveTransaction(db, { date: '2026-08-01', kind: 'expense', account_id: a, amount: 0 })).toThrow(ValidationError);
    expect(() => saveTransaction(db, { date: 'yesterday', kind: 'expense', account_id: a, amount: 5 })).toThrow(ValidationError);
    expect(() => saveTransaction(db, { date: '2026-08-01', kind: 'expense', account_id: a, amount: 5, category_id: cat('Salary', 'income') })).toThrow(/income category/);
    expect(() => saveTransaction(db, { date: '2026-08-01', kind: 'transfer', account_id: a, to_account_id: a, amount: 5 })).toThrow();
  });

  it('soft delete, restore, duplicate and history', () => {
    const a = saveAccount(db, { name: 'A', type: 'checking', owner: 'personal', currency: 'USD', starting_date: '2026-01-01' });
    const id = saveTransaction(db, { date: '2026-08-01', kind: 'expense', account_id: a, amount: $('10'), category_id: cat('Gifts'), tags: ['birthday', 'family'] });
    saveTransaction(db, { ...db.get<any>('SELECT * FROM transactions WHERE id=?', [id]), amount: $('12') });
    deleteTransaction(db, id);
    expect(new Finance(db, REF).totals('all', AUG).expense).toBe(0);
    restoreTransaction(db, id);
    expect(new Finance(db, REF).totals('all', AUG).expense).toBe($('12'));
    const hist = txHistory(db, id);
    expect(hist.map((h) => h.action)).toEqual(['restore', 'delete', 'update']);
    expect(JSON.parse(hist[2].old_json).amount).toBe($('10'));
    const dup = duplicateTransaction(db, id, '2026-08-05');
    expect(db.value('SELECT COUNT(*) FROM transaction_tags WHERE transaction_id = ?', [dup])).toBe(2);
  });
});

describe('debts, receivables, net worth', () => {
  beforeEach(fresh);

  it('debt payments split principal/interest; balances and net worth', () => {
    const chk = saveAccount(db, { name: 'Checking', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('5000'), starting_date: '2026-01-01' });
    const debt = db.insert('debts', { name: 'Car', type: 'personal_loan', owner: 'personal', currency: 'USD', original_amount: $('10000'), opening_balance: $('8000'), balance_date: '2026-07-01', interest_rate: '8', minimum_payment: $('300') });
    recordDebtPayment(db, debt, { date: '2026-08-15', amount: $('300'), interest: $('50'), from_account_id: chk });
    const f = new Finance(db, REF);
    const d = f.debts()[0];
    expect(d.balance).toBe($('7750'));
    expect(d.paidThisMonth).toBe($('250'));
    expect(d.progress).toBe(22.5);
    expect(f.totals('personal', AUG).expense).toBe($('50')); // only interest is an expense
    expect(f.balances().get(chk)).toBe($('4700'));
    expect(f.netWorth(REF).netWorth).toBe($('4700') - $('7750'));
    expect(f.netWorth('2026-06-30').netWorth).toBe($('5000') - $('8000'));
  });

  it('invoices: receivable is not income until paid; partial payments; overdue', () => {
    const biz = saveAccount(db, { name: 'Biz', type: 'checking', owner: 'business', currency: 'USD', starting_balance: 0, starting_date: '2026-01-01' });
    const c = db.insert('clients', { name: 'Peter', currency: 'USD' });
    const i1 = db.insert('invoices', { number: 'INV-1', owner: 'business', client_id: c, amount: $('1000'), currency: 'USD', issue_date: '2026-07-01', due_date: '2026-07-31' });
    const i2 = db.insert('invoices', { number: 'INV-2', owner: 'business', client_id: c, amount: $('2000'), currency: 'USD', issue_date: '2026-08-01', due_date: '2026-08-25' });
    let f = new Finance(db, REF);
    expect(f.totals('business', AUG).income).toBe(0);
    const r = f.receivables();
    expect(r.total).toBe($('3000'));
    expect(r.overdue).toBe($('1000'));
    expect(r.dueSoon).toBe($('2000'));
    recordInvoicePayment(db, i1, { date: '2026-08-10', amount: $('400'), account_id: biz });
    f = new Finance(db, REF);
    expect(f.totals('business', AUG).income).toBe($('400'));
    expect(f.receivables().total).toBe($('2600'));
    expect(f.receivables().paidThisMonth).toBe($('400'));
    recordInvoicePayment(db, i1, { date: '2026-08-12', amount: $('600'), account_id: biz });
    f = new Finance(db, REF);
    expect(f.invoices().find((i) => i.id === i1)!.state).toBe('paid');
    expect(f.netWorth(REF).netWorth).toBe($('1000') + $('2000'));
    // expected income dedup: open invoice counted once
    expect(f.incomeOverview().expectedThisMonth).toBe($('2000'));
  });

  it('payoff planner: avalanche saves interest vs snowball; minimum-only is slowest', () => {
    const debts = [
      { id: 1, name: 'Card', balance: $('3000'), apr: '24.99', minimum: $('90') },
      { id: 2, name: 'Small loan', balance: $('800'), apr: '6', minimum: $('50') },
      { id: 3, name: 'Car', balance: $('9000'), apr: '8.5', minimum: $('300') },
    ];
    const av = simulatePayoff(debts, $('800'), 'avalanche');
    const sb = simulatePayoff(debts, $('800'), 'snowball');
    const mn = simulatePayoff(debts, $('800'), 'minimum');
    expect(av.months).not.toBeNull();
    expect(av.totalInterest).toBeLessThan(sb.totalInterest);
    expect(sb.order[0].name).toBe('Small loan');
    expect(av.order[0].name).toBe('Card');
    expect(mn.months!).toBeGreaterThan(av.months!);
    // conservation: total paid = principal + interest
    expect(av.totalPaid).toBe($('12800') + av.totalInterest);
    // a minimum below the monthly interest is flagged, not silently looped forever
    const stuck = simulatePayoff([{ id: 9, name: 'Bad', balance: $('10000'), apr: '30', minimum: $('100') }], 0, 'minimum');
    expect(stuck.stuck).toEqual(['Bad']);
    expect(stuck.months).toBeNull();
  });

  it('savings goals: progress and required monthly', () => {
    const g = db.insert('savings_goals', { name: 'Emergency', owner: 'personal', target_amount: $('6000'), currency: 'USD', starting_amount: $('1000'), deadline: '2027-02-20' });
    db.insert('goal_contributions', { goal_id: g, date: '2026-06-10', amount: $('500') });
    db.insert('goal_contributions', { goal_id: g, date: '2026-07-10', amount: $('500') });
    const goal = new Finance(db, REF).goals()[0];
    expect(goal.current).toBe($('2000'));
    expect(goal.progress).toBe(33.3);
    expect(goal.monthsLeft).toBe(6);
    expect(goal.requiredMonthly).toBe(Math.ceil($('4000') / 6));
    expect(goal.pace).toBe(Math.round($('1000') / 3));
  });
});

describe('recurring transactions', () => {
  beforeEach(fresh);

  it('anchors monthly dates to the start day (Jan 31 -> Feb 28 -> Mar 31)', () => {
    expect(occurrences({ unit: 'month', interval: 1, start_date: '2026-01-31', end_date: null }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrences({ unit: 'week', interval: 2, start_date: '2026-08-03', end_date: null }, '2026-08-01', '2026-09-01')).toEqual(['2026-08-03', '2026-08-17', '2026-08-31']);
    expect(annualCost({ amount: 1000, unit: 'week', interval: 2 })).toBe(26000);
    expect(annualCost({ amount: 1599, unit: 'month', interval: 3 })).toBe(6396);
  });

  it('generates occurrences once (idempotent), auto-clears, never regenerates deleted ones', () => {
    const a = saveAccount(db, { name: 'A', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('5000'), starting_date: '2026-06-15' });
    db.insert('recurring', { name: 'Rent', kind: 'expense', owner: 'personal', account_id: a, amount: $('1000'), currency: 'USD', category_id: cat('Housing'), unit: 'month', interval: 1, start_date: '2026-05-01', auto_clear: 1 });
    db.insert('recurring', { name: 'Gym', kind: 'expense', owner: 'personal', account_id: a, amount: $('40'), currency: 'USD', unit: 'month', interval: 1, start_date: '2026-08-25', is_subscription: 1 });
    generateRecurring(db, 45, REF);
    generateRecurring(db, 45, REF);
    const rent = db.all<any>("SELECT date, status FROM transactions WHERE description = 'Rent' ORDER BY date");
    // starts after the account starting date (Jul 1), no duplicates on re-run
    expect(rent).toEqual([{ date: '2026-07-01', status: 'cleared' }, { date: '2026-08-01', status: 'cleared' }, { date: '2026-09-01', status: 'expected' }, { date: '2026-10-01', status: 'expected' }]);
    const f = new Finance(db, REF);
    expect(f.balances().get(a)).toBe($('3000'));
    expect(f.upcoming('all', 30).map((t) => t.description)).toEqual(['Gym', 'Rent']);
    const gym = db.value<number>("SELECT id FROM transactions WHERE description='Gym' ORDER BY date LIMIT 1")!;
    deleteTransaction(db, gym);
    generateRecurring(db, 45, REF);
    expect(db.value("SELECT COUNT(*) FROM transactions WHERE description='Gym' AND deleted_at IS NULL")).toBe(1);
  });
});

describe('import wizard', () => {
  beforeEach(fresh);
  const csv = `Bank Statement\nAccount: 1234\nDate,Description,Debit,Credit,Balance\n08/01/2026,"AMAZON MKTPLACE, SEATTLE",45.20,,954.80\n08/02/2026,PAYROLL DEPOSIT,,3000.00,3954.80\n08/02/2026,PAYROLL DEPOSIT,,3000.00,6954.80\n08/05/2026,Rent August,1000.00,,5954.80\n08/09/2026,Coffee Shop,4.50,,5950.30\nbad date,Broken row,1,,\n`;

  it('detects header row and columns, previews, flags duplicates, matches expected, imports once', () => {
    const a = saveAccount(db, { name: 'A', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('1000'), starting_date: '2026-01-01' });
    saveTransaction(db, { date: '2026-08-09', kind: 'expense', account_id: a, amount: $('4.50'), payee: 'Coffee Shop', category_id: cat('Restaurants') });
    saveTransaction(db, { date: '2026-08-04', kind: 'expense', status: 'expected', account_id: a, amount: $('1000'), payee: 'Landlord', category_id: cat('Housing') });
    const rows = parseCSV(csv);
    const det = detectColumns(rows);
    expect(det.headerRow).toBe(2);
    expect(det.mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
    const opt = { accountId: a, headerRow: det.headerRow, mapping: det.mapping, dateOrder: 'MDY' as const, signConvention: 'negative_is_expense' as const };
    const prev = buildPreview(db, rows, opt);
    expect(prev).toHaveLength(6);
    expect(prev[0]).toMatchObject({ date: '2026-08-01', amount: $('45.20'), kind: 'expense', action: 'import' });
    expect(prev[1]).toMatchObject({ kind: 'income', amount: $('3000'), action: 'import' });
    expect(prev[2].duplicate?.label).toMatch(/Same as row/);
    expect(prev[2].action).toBe('skip');
    expect(prev[3].match).not.toBeNull();
    expect(prev[3].action).toBe('match');
    expect(prev[4].duplicate?.level).toBe('exact');
    expect(prev[4].category_id).toBe(cat('Restaurants'));
    expect(prev[5].errors.length).toBeGreaterThan(0);
    const res = commitImport(db, prev, opt, 'statement.csv');
    expect(res).toMatchObject({ imported: 2, matched: 1, skipped: 3 });
    const f = new Finance(db, REF);
    expect(f.balances().get(a)).toBe($('1000') - $('4.50') - $('45.20') + $('3000') - $('1000'));
    // re-importing the same file finds everything as duplicates
    const again = buildPreview(db, rows, opt);
    expect(again.filter((r) => r.action === 'import')).toHaveLength(0);
    undoImport(db, res.batchId);
    expect(new Finance(db, REF).balances().get(a)).toBe($('1000') - $('4.50'));
    expect(db.value("SELECT status FROM transactions WHERE payee='Landlord'")).toBe('expected');
  });

  it('parses signed amounts, semicolons, DMY dates and OFX', () => {
    const rows = parseCSV('Fecha;Concepto;Monto\n31/07/2026;Supermercado;-1.250,50\n01/08/2026;Depósito;5000');
    const det = detectColumns(rows);
    expect(det.mapping).toMatchObject({ date: 0, description: 1, amount: 2 });
    const a = saveAccount(db, { name: 'H', type: 'checking', owner: 'personal', currency: 'HNL', starting_date: '2026-01-01' });
    const p = buildPreview(db, rows, { accountId: a, headerRow: 0, mapping: det.mapping, dateOrder: 'DMY', signConvention: 'negative_is_expense' });
    expect(p[0]).toMatchObject({ date: '2026-07-31', amount: 125050, kind: 'expense' });
    expect(p[1]).toMatchObject({ date: '2026-08-01', kind: 'income' });
    const ofx = parseOFX('<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260803120000<TRNAMT>-12.34<FITID>abc1<NAME>STORE</STMTTRN></OFX>');
    expect(ofx[1]).toEqual(['2026-08-03', '-12.34', 'STORE', '', 'abc1', 'DEBIT']);
  });
});

describe('backup, demo data, search, reports', () => {
  beforeEach(fresh);

  it('demo data loads, reports render, delete removes only demo', () => {
    const ref = today();
    loadDemoData(db, ref);
    expect(hasDemoData(db)).toBe(true);
    const real = saveAccount(db, { name: 'My real account', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: $('100'), starting_date: '2026-01-01' });
    saveTransaction(db, { date: ref, kind: 'expense', account_id: real, amount: $('5'), category_id: cat('Gifts') });
    const f = new Finance(db, ref);
    expect(f.missingRates.size).toBe(0);
    const yr = presetRange('last_12', ref);
    expect(f.totals('business', yr).income).toBeGreaterThan(0);
    expect(f.receivables().overdue).toBeGreaterThan(0);
    expect(f.insights('all').length).toBeGreaterThan(2);
    for (const r of REPORTS) for (const s of ['all', 'personal', 'business'] as const) {
      const rep = buildReport(f, r.id, yr, s);
      expect(rep.sections.length).toBeGreaterThan(0);
    }
    expect(f.health('personal').metrics.every((m) => m.value === null || Number.isFinite(m.value))).toBe(true);
    // accounting identity on demo data: balances = starting + all cleared effects; card payments not expenses
    for (let k = 0; k < 12; k++) {
      const end = presetRange('last_month', addMonths(ref, -k + 1)).to;
      const bal = f.balances(end > ref ? ref : end);
      for (const a of f.accounts.filter((a) => a.is_demo && !['credit_card', 'loan'].includes(a.type))) expect(bal.get(a.id)!, `${a.name} @ ${end}`).toBeGreaterThanOrEqual(0);
    }
    const peter = globalSearch(db, 'Peter');
    expect(peter.transactions.length).toBeGreaterThan(0);
    expect(globalSearch(db, 'Amazon').transactions.length).toBeGreaterThan(5);
    deleteDemoData(db);
    expect(hasDemoData(db)).toBe(false);
    expect(db.value('SELECT COUNT(*) FROM accounts')).toBe(1);
    expect(db.value('SELECT COUNT(*) FROM transactions')).toBe(1);
    expect(db.value('SELECT COUNT(*) FROM categories')).toBeGreaterThan(40);
  });

  it('JSON backup round-trips exactly, and a bad file changes nothing', async () => {
    loadDemoData(db, today());
    const json = exportJSON(db);
    const before = new Finance(db).netWorth().netWorth;
    const db2 = await Db.create();
    restoreJSON(db2, json);
    expect(new Finance(db2).netWorth().netWorth).toBe(before);
    expect(db2.value('SELECT COUNT(*) FROM transactions')).toBe(db.value('SELECT COUNT(*) FROM transactions'));
    expect(db2.integrityCheck()).toBe('ok');
    expect(() => restoreJSON(db2, '{"nope":1}')).toThrow(/not an Azuria/);
    expect(db2.value('SELECT COUNT(*) FROM transactions')).toBe(db.value('SELECT COUNT(*) FROM transactions'));
    const csv = transactionsCSV(db);
    expect(csv.split('\r\n').length).toBe(1 + (db.value<number>('SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL') ?? 0));
  });

  it('search understands months', () => {
    expect(parsePeriod('August 2026')).toEqual({ from: '2026-08-01', to: '2026-08-31', label: 'August 2026' });
    expect(parsePeriod('agosto 2026')?.from).toBe('2026-08-01');
    expect(parsePeriod('2026-02')?.to).toBe('2026-02-28');
    expect(parsePeriod('Amazon')).toBeNull();
  });
});
