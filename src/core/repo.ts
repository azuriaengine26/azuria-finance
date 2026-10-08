import type { Db } from './db';
import type { Account, Category, Transaction, TransferType, Owner, Recurring } from './types';
import { isLiabilityType } from './types';
import { addDays, addMonths, today, parseISO } from './dates';
import { convert } from './money';

export class ValidationError extends Error {}

const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---------------- Accounts ----------------
export function listAccounts(db: Db, includeInactive = true): Account[] {
  return db.all<Account>(`SELECT * FROM accounts ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY owner DESC, is_active DESC, type, name`);
}
export function getAccount(db: Db, id: number | null | undefined): Account | undefined {
  return id == null ? undefined : db.get<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
}
export function saveAccount(db: Db, a: Partial<Account>): number {
  if (!a.name?.trim()) throw new ValidationError('Account name is required');
  if (!a.currency) throw new ValidationError('Currency is required');
  const data = {
    name: a.name.trim(), type: a.type ?? 'checking', owner: a.owner ?? 'personal', institution: a.institution || null,
    currency: a.currency, starting_balance: a.starting_balance ?? 0, starting_date: a.starting_date || today(),
    notes: a.notes || null, is_active: a.is_active ?? 1, include_in_net_worth: a.include_in_net_worth ?? 1,
    low_balance_alert: a.low_balance_alert ?? null, is_demo: a.is_demo ?? 0,
  };
  if (a.id) { db.update('accounts', a.id, { ...data, updated_at: nowStamp() }); return a.id; }
  return db.insert('accounts', data);
}
export function deleteAccount(db: Db, id: number) {
  const n = db.value<number>('SELECT COUNT(*) FROM transactions WHERE account_id = ? OR to_account_id = ?', [id, id]) ?? 0;
  if (n > 0) throw new ValidationError(`This account has ${n} transactions. Deactivate it instead so your history is preserved.`);
  db.run('DELETE FROM accounts WHERE id = ?', [id]);
}

// ---------------- Categories ----------------
export function listCategories(db: Db): Category[] {
  return db.all<Category>('SELECT * FROM categories ORDER BY kind, owner, ifnull(parent_id, id), parent_id IS NOT NULL, sort, name');
}
export function saveCategory(db: Db, c: Partial<Category>): number {
  if (!c.name?.trim()) throw new ValidationError('Category name is required');
  const data = {
    name: c.name.trim(), kind: c.kind ?? 'expense', owner: c.owner ?? 'personal', parent_id: c.parent_id ?? null,
    color: c.color ?? null, tax_category: c.tax_category || null, deductible_default: c.deductible_default ?? null,
    is_archived: c.is_archived ?? 0, sort: c.sort ?? 999,
  };
  if (data.parent_id) {
    const p = db.get<Category>('SELECT * FROM categories WHERE id = ?', [data.parent_id]);
    if (!p) throw new ValidationError('Parent category not found');
    if (p.parent_id) throw new ValidationError('Subcategories can only be one level deep');
    data.kind = p.kind;
  }
  try {
    if (c.id) { db.update('categories', c.id, data); return c.id; }
    return db.insert('categories', data);
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw new ValidationError(`A category named "${data.name}" already exists here`);
    throw e;
  }
}
export function deleteCategory(db: Db, id: number) {
  const n = db.value<number>('SELECT COUNT(*) FROM transactions WHERE category_id IN (SELECT id FROM categories WHERE id = ?1 OR parent_id = ?1)', [id]) ?? 0;
  if (n > 0) {
    db.run('UPDATE categories SET is_archived = 1 WHERE id = ?1 OR parent_id = ?1', [id]);
    return 'archived' as const;
  }
  db.run('DELETE FROM categories WHERE id = ?', [id]);
  return 'deleted' as const;
}

// ---------------- Tags ----------------
export function setTags(db: Db, txId: number, names: string[]) {
  db.tx(() => {
    db.run('DELETE FROM transaction_tags WHERE transaction_id = ?', [txId]);
    for (const raw of new Set(names.map((n) => n.trim()).filter(Boolean))) {
      db.run('INSERT OR IGNORE INTO tags(name) VALUES (?)', [raw]);
      const tagId = db.value<number>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [raw]);
      db.run('INSERT OR IGNORE INTO transaction_tags(transaction_id, tag_id) VALUES (?, ?)', [txId, tagId!]);
    }
  });
}
export function getTags(db: Db, txId: number): string[] {
  return db.all<{ name: string }>('SELECT t.name FROM tags t JOIN transaction_tags tt ON tt.tag_id = t.id WHERE tt.transaction_id = ? ORDER BY t.name', [txId]).map((r) => r.name);
}

// ---------------- Transactions ----------------
export type TxInput = Partial<Transaction> & { tags?: string[] };

/** Pick a sensible transfer type from the two accounts involved. */
export function inferTransferType(from?: Account, to?: Account): TransferType {
  if (from && to) {
    if (isLiabilityType(to.type)) return 'debt_payment';
    if (from.owner === 'business' && to.owner === 'personal') return 'owner_draw';
    if (from.owner === 'personal' && to.owner === 'business') return 'owner_contribution';
    if (to.type === 'savings') return 'savings';
  }
  return 'transfer';
}

export function normaliseTx(db: Db, t: TxInput): Omit<Transaction, 'id' | 'created_at' | 'updated_at' | 'deleted_at'> {
  const kind = t.kind ?? 'expense';
  if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new ValidationError('A valid date is required');
  if (!Number.isSafeInteger(t.amount) || (t.amount as number) <= 0) throw new ValidationError('Amount must be greater than zero');
  const status = t.status ?? 'cleared';
  const acct = getAccount(db, t.account_id);
  const to = getAccount(db, t.to_account_id);
  if (t.account_id && !acct) throw new ValidationError('Account not found');
  if (t.to_account_id && !to) throw new ValidationError('Destination account not found');

  let owner: Owner = t.owner ?? acct?.owner ?? to?.owner ?? 'personal';
  let currency = t.currency ?? acct?.currency ?? to?.currency ?? 'USD';
  let transfer_type: TransferType | null = null;
  let to_amount = t.to_amount ?? null;
  let category_id = t.category_id ?? null;

  if (kind === 'transfer') {
    transfer_type = t.transfer_type ?? inferTransferType(acct, to);
    const external = ['debt_payment', 'loan_given'].includes(transfer_type) ? 'dest' : ['debt_proceeds', 'loan_repayment'].includes(transfer_type) ? 'source' : null;
    if (!acct && !to) throw new ValidationError('A transfer needs at least one account');
    if (!external && (!acct || !to)) throw new ValidationError('Choose both the "from" and "to" account');
    if (acct && to && acct.id === to.id) throw new ValidationError('From and To accounts must be different');
    if (transfer_type === 'debt_payment' && !to && !t.debt_id) throw new ValidationError('Choose the debt or credit card being paid');
    if (acct) currency = acct.currency;
    else if (to) currency = to.currency;
    if (acct && to && acct.currency !== to.currency && to_amount == null) throw new ValidationError(`Enter the amount received in ${to.currency} (accounts use different currencies)`);
    if (acct && to && acct.currency === to.currency) to_amount = null;
    owner = acct?.owner ?? to!.owner;
    category_id = null;
  } else {
    if (category_id) {
      const c = db.get<Category>('SELECT * FROM categories WHERE id = ?', [category_id]);
      if (!c) throw new ValidationError('Category not found');
      if (c.kind !== kind) throw new ValidationError(`"${c.name}" is an ${c.kind} category`);
    }
    if (!acct && !['expected', 'cancelled'].includes(status)) throw new ValidationError('Choose an account (only expected items can skip it)');
    if (acct && acct.currency === currency) to_amount = null;
  }

  return {
    date: t.date, kind, status, owner,
    account_id: acct?.id ?? null, to_account_id: kind === 'transfer' ? to?.id ?? null : null, to_amount,
    transfer_type, amount: t.amount as number, currency, category_id,
    payee: t.payee?.trim() || null, description: t.description?.trim() || null, notes: t.notes?.trim() || null,
    reference: t.reference?.trim() || null, payment_method: t.payment_method || null,
    client_id: t.client_id ?? null, project_id: t.project_id ?? null,
    tax_deductible: t.tax_deductible ?? null, tax_category: t.tax_category || null, tax_notes: t.tax_notes || null,
    recurring_id: t.recurring_id ?? null, occurrence_date: t.occurrence_date ?? null,
    debt_id: t.debt_id ?? null, invoice_id: t.invoice_id ?? null, expected_date: t.expected_date ?? null,
    import_batch_id: t.import_batch_id ?? null, is_demo: t.is_demo ?? 0,
  };
}

export function saveTransaction(db: Db, t: TxInput): number {
  const data = normaliseTx(db, t);
  return db.tx(() => {
    let id: number;
    if (t.id) {
      db.update('transactions', t.id, { ...data, updated_at: nowStamp() });
      id = t.id;
    } else {
      id = db.insert('transactions', data);
    }
    if (t.tags) setTags(db, id, t.tags);
    return id;
  });
}

export function getTransaction(db: Db, id: number): Transaction | undefined {
  return db.get<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
}

/** Soft delete: the row and its history stay in the database (restorable from Settings → Trash). */
export function deleteTransaction(db: Db, id: number) {
  db.run('UPDATE transactions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [nowStamp(), id]);
}
export function restoreTransaction(db: Db, id: number) {
  db.run('UPDATE transactions SET deleted_at = NULL WHERE id = ?', [id]);
}
export function purgeTransaction(db: Db, id: number) {
  db.run('DELETE FROM transactions WHERE id = ? AND deleted_at IS NOT NULL', [id]);
}

export function duplicateTransaction(db: Db, id: number, date = today()): number {
  const t = getTransaction(db, id);
  if (!t) throw new ValidationError('Transaction not found');
  const tags = getTags(db, id);
  return saveTransaction(db, { ...t, id: undefined, date, status: 'cleared', recurring_id: null, occurrence_date: null, import_batch_id: null, invoice_id: null, tags });
}

export function txHistory(db: Db, id: number) {
  return db.all<{ action: string; old_json: string; at: string }>("SELECT action, old_json, at FROM audit_log WHERE entity = 'transaction' AND entity_id = ? ORDER BY id DESC", [id]);
}

// ---------------- Recurring ----------------

/** Occurrence dates of a rule between from..to inclusive, anchored to the start date (no drift). */
export function occurrences(rule: Pick<Recurring, 'unit' | 'interval' | 'start_date' | 'end_date'>, from: string, to: string, max = 2000): string[] {
  const out: string[] = [];
  const anchorDay = parseISO(rule.start_date).d;
  const end = rule.end_date && rule.end_date < to ? rule.end_date : to;
  for (let k = 0; k < max; k++) {
    let d: string;
    const step = k * rule.interval;
    if (rule.unit === 'day') d = addDays(rule.start_date, step);
    else if (rule.unit === 'week') d = addDays(rule.start_date, step * 7);
    else if (rule.unit === 'month') d = addMonths(rule.start_date, step, anchorDay);
    else d = addMonths(rule.start_date, step * 12, anchorDay);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule: Recurring, onOrAfter = today()): string | null {
  return occurrences(rule, onOrAfter, addDays(onOrAfter, 800))[0] ?? null;
}

/**
 * Materialise recurring rules into individual transactions up to `horizon`.
 * Each occurrence is unique by (recurring_id, occurrence_date), enforced by a unique index,
 * so running this repeatedly never double-counts. Occurrences before the account's
 * starting date are skipped (the starting balance already includes them).
 */
export function generateRecurring(db: Db, horizonDays = 45, ref = today()): number {
  const horizon = addDays(ref, horizonDays);
  let created = 0;
  db.tx(() => {
    const rules = db.all<Recurring>('SELECT * FROM recurring WHERE is_active = 1');
    for (const r of rules) {
      const acct = getAccount(db, r.account_id) ?? getAccount(db, r.to_account_id);
      const from = acct && acct.starting_date > r.start_date ? acct.starting_date : r.start_date;
      for (const d of occurrences(r, from, horizon)) {
        const exists = db.value('SELECT 1 FROM transactions WHERE recurring_id = ? AND occurrence_date = ?', [r.id, d]);
        if (exists) continue;
        const status = r.auto_clear && d <= ref ? 'cleared' : 'expected';
        try {
          const data = normaliseTx(db, {
            date: d, kind: r.kind, status, owner: r.owner, account_id: r.account_id, to_account_id: r.to_account_id,
            transfer_type: r.transfer_type, amount: r.amount, currency: r.currency, category_id: r.category_id, payee: r.payee,
            description: r.name, client_id: r.client_id, debt_id: r.debt_id, tax_deductible: r.tax_deductible,
            recurring_id: r.id, occurrence_date: d, is_demo: r.is_demo,
          });
          db.run(`INSERT OR IGNORE INTO transactions (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map((k) => ':' + k).join(',')})`, data as any);
          created++;
        } catch (e) {
          // A rule that no longer validates (e.g. deleted account) is skipped rather than blocking others.
          console.warn('Skipping recurring rule', r.id, e);
        }
      }
    }
    db.run(`UPDATE transactions SET status = 'cleared', updated_at = ?
            WHERE status = 'expected' AND deleted_at IS NULL AND date <= ?
              AND recurring_id IN (SELECT id FROM recurring WHERE auto_clear = 1 AND is_active = 1)`, [nowStamp(), ref]);
  });
  return created;
}

export function saveRecurring(db: Db, r: Partial<Recurring>): number {
  if (!r.name?.trim()) throw new ValidationError('Name is required');
  if (!r.amount || r.amount <= 0) throw new ValidationError('Amount must be greater than zero');
  if (!r.start_date) throw new ValidationError('Start date is required');
  if (r.kind === 'transfer' && !r.to_account_id && r.transfer_type !== 'debt_payment') throw new ValidationError('Choose the destination account');
  if (!r.account_id && r.kind !== 'transfer') throw new ValidationError('Choose an account');
  const acct = getAccount(db, r.account_id) ?? getAccount(db, r.to_account_id);
  const data = {
    name: r.name.trim(), kind: r.kind ?? 'expense', owner: r.owner ?? acct?.owner ?? 'personal',
    account_id: r.account_id ?? null, to_account_id: r.kind === 'transfer' ? r.to_account_id ?? null : null,
    transfer_type: r.kind === 'transfer' ? r.transfer_type ?? 'transfer' : null,
    amount: r.amount, currency: acct?.currency ?? r.currency ?? 'USD', category_id: r.kind === 'transfer' ? null : r.category_id ?? null,
    payee: r.payee || null, client_id: r.client_id ?? null, debt_id: r.debt_id ?? null, unit: r.unit ?? 'month', interval: r.interval ?? 1,
    start_date: r.start_date, end_date: r.end_date || null, auto_clear: r.auto_clear ?? 0, is_bill: r.is_bill ?? 0,
    is_subscription: r.is_subscription ?? 0, subscription_value: r.subscription_value ?? null, tax_deductible: r.tax_deductible ?? null,
    notes: r.notes || null, is_active: r.is_active ?? 1, is_demo: r.is_demo ?? 0,
  };
  return db.tx(() => {
    let id: number;
    if (r.id) {
      db.update('recurring', r.id, data);
      id = r.id;
      // Replace future, still-expected occurrences so edits apply going forward; history is untouched.
      db.run("DELETE FROM transactions WHERE recurring_id = ? AND status = 'expected' AND date >= ? AND deleted_at IS NULL", [id, today()]);
    } else id = db.insert('recurring', data);
    generateRecurring(db);
    return id;
  });
}

export function deleteRecurring(db: Db, id: number) {
  db.tx(() => {
    db.run("DELETE FROM transactions WHERE recurring_id = ? AND status = 'expected' AND date >= ?", [id, today()]);
    db.run('DELETE FROM recurring WHERE id = ?', [id]);
  });
}

/** Confirm an expected item happened (optionally with the real amount/date). */
export function markReceived(db: Db, txId: number, patch: { date?: string; amount?: number; account_id?: number } = {}) {
  const t = getTransaction(db, txId);
  if (!t) throw new ValidationError('Transaction not found');
  saveTransaction(db, { ...t, status: 'cleared', expected_date: t.expected_date ?? t.date, date: patch.date ?? (t.date > today() ? today() : t.date), amount: patch.amount ?? t.amount, account_id: patch.account_id ?? t.account_id });
}

// ---------------- Invoices / receivables ----------------

export function recordInvoicePayment(db: Db, invoiceId: number, p: { date: string; amount: number; account_id: number; payment_method?: string; category_id?: number | null }) {
  const inv = db.get<any>('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) throw new ValidationError('Invoice not found');
  const acct = getAccount(db, p.account_id);
  if (!acct) throw new ValidationError('Choose the account the money went into');
  return db.tx(() => {
    // Revenue is recognised when cash is received (cash basis); the invoice itself is a receivable, not income.
    // If the client paid in a different currency than the account, convert at display time.
    if (inv.kind === 'loan') {
      return saveTransaction(db, { date: p.date, kind: 'transfer', transfer_type: 'loan_repayment', to_account_id: acct.id, amount: p.amount, currency: acct.currency, invoice_id: invoiceId, client_id: inv.client_id, payee: clientName(db, inv.client_id), description: `Repayment: ${inv.notes || 'loan'}`, payment_method: p.payment_method });
    }
    let cat = p.category_id ?? db.value<number>("SELECT id FROM categories WHERE kind='income' AND owner IN (?, 'both') AND name = 'Client payments'", [inv.owner]) ?? null;
    return saveTransaction(db, {
      date: p.date, kind: 'income', status: 'cleared', owner: inv.owner, account_id: acct.id, amount: p.amount, currency: acct.currency,
      category_id: cat, client_id: inv.client_id, project_id: inv.project_id, invoice_id: invoiceId, reference: inv.number,
      payee: clientName(db, inv.client_id), description: `Payment for invoice ${inv.number ?? ''}`.trim(), payment_method: p.payment_method ?? inv.payment_method,
    });
  });
}
function clientName(db: Db, id: number | null) { return id ? db.value<string>('SELECT name FROM clients WHERE id = ?', [id]) ?? null : null; }

export function nextInvoiceNumber(db: Db): string {
  const y = today().slice(0, 4);
  const last = db.value<string>("SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1", [`INV-${y}-%`]);
  const n = last ? Number(last.split('-')[2]) + 1 : 1;
  return `INV-${y}-${String(n).padStart(3, '0')}`;
}

// ---------------- Debts ----------------

/** Pay a debt from an account. For card/loan accounts this is a transfer into that account; otherwise it is logged against the debt. Interest (if any) is recorded as an expense. */
export function recordDebtPayment(db: Db, debtId: number, p: { date: string; amount: number; interest?: number; from_account_id: number; notes?: string }) {
  const debt = db.get<any>('SELECT * FROM debts WHERE id = ?', [debtId]);
  if (!debt) throw new ValidationError('Debt not found');
  if (!p.amount || p.amount <= 0) throw new ValidationError('Payment amount must be greater than zero');
  const interest = p.interest ?? 0;
  if (interest < 0 || interest > p.amount) throw new ValidationError('Interest must be between 0 and the payment amount');
  const from = getAccount(db, p.from_account_id);
  if (!from) throw new ValidationError('Choose the account you paid from');
  return db.tx(() => {
    const principal = p.amount - interest;
    let txId: number | null = null;
    if (principal > 0) {
      txId = saveTransaction(db, {
        date: p.date, kind: 'transfer', transfer_type: 'debt_payment', account_id: from.id,
        to_account_id: debt.account_id ?? null, debt_id: debt.id, amount: principal, currency: from.currency,
        payee: debt.creditor || debt.name, description: `Payment: ${debt.name}`, notes: p.notes,
      });
    }
    if (interest > 0) {
      const cat = db.value<number>("SELECT id FROM categories WHERE kind='expense' AND owner = ? AND name = 'Interest & fees'", [debt.owner]) ?? null;
      saveTransaction(db, { date: p.date, kind: 'expense', owner: debt.owner, account_id: from.id, amount: interest, currency: from.currency, category_id: cat, payee: debt.creditor || debt.name, description: `Interest: ${debt.name}`, debt_id: debt.id, tax_deductible: debt.owner === 'business' ? 1 : null });
    }
    if (!debt.account_id && principal > 0) {
      // The debt ledger is kept in the debt's own currency.
      const rates = Object.fromEntries(db.all<{ base: string; quote: string; rate: string }>('SELECT base, quote, rate FROM exchange_rates ORDER BY date').map((r) => [`${r.base}>${r.quote}`, r.rate]));
      const toDebt = (v: number) => (from.currency === debt.currency ? v : convert(v, from.currency, debt.currency, rates));
      db.insert('debt_payments', { debt_id: debt.id, date: p.date, kind: 'payment', principal: toDebt(principal), interest: toDebt(interest), transaction_id: txId, notes: p.notes || null });
    }
    return txId;
  });
}

export function adjustDebt(db: Db, debtId: number, p: { date: string; amount: number; kind: 'charge' | 'adjustment'; notes?: string }) {
  // charge: positive amount increases what you owe; adjustment: signed (negative reduces)
  db.insert('debt_payments', { debt_id: debtId, date: p.date, kind: p.kind, principal: -p.amount, interest: 0, notes: p.notes || null });
}

// ---------------- Savings goals ----------------
export function addContribution(db: Db, goalId: number, amount: number, date = today(), notes?: string) {
  if (!amount) throw new ValidationError('Enter an amount');
  db.insert('goal_contributions', { goal_id: goalId, date, amount, notes: notes || null });
}

// ---------------- Exchange rates ----------------
export function saveRate(db: Db, base: string, quote: string, rate: string, date = today(), source = 'manual') {
  if (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) <= 0) throw new ValidationError('Rate must be a positive number like 26.25');
  if (base === quote) throw new ValidationError('Pick two different currencies');
  db.run('INSERT INTO exchange_rates(base, quote, rate, date, source) VALUES (?,?,?,?,?) ON CONFLICT(base, quote, date) DO UPDATE SET rate = excluded.rate, source = excluded.source', [base, quote, rate, date, source]);
}
