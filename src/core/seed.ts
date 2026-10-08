import type { Db } from './db';

const PALETTE = ['#4f7cff', '#22b07d', '#f2a33a', '#e5566b', '#8b5cf6', '#14b8c4', '#ec7a3c', '#6b8e23', '#d946a8', '#64748b'];

export const DEFAULT_CATEGORIES: { kind: 'income' | 'expense'; owner: 'personal' | 'business'; names: string[]; tax?: Record<string, string> }[] = [
  { kind: 'expense', owner: 'personal', names: ['Housing', 'Utilities', 'Groceries', 'Restaurants', 'Transportation', 'Gas', 'Travel', 'Entertainment', 'Shopping', 'Clothing', 'Subscriptions', 'Healthcare', 'Insurance', 'Education', 'Pets', 'Gifts', 'Family', 'Personal care', 'Interest & fees', 'Other'] },
  {
    kind: 'expense', owner: 'business',
    names: ['Payroll', 'Contractors', 'Software', 'Advertising', 'Marketing', 'Office', 'Equipment', 'Internet', 'Phone', 'Bank fees', 'Payment processing', 'Travel', 'Meals', 'Professional services', 'Legal', 'Accounting', 'Taxes', 'Training', 'Client expenses', 'Interest & fees', 'Other'],
    tax: { Payroll: 'Wages', Contractors: 'Contract labor', Software: 'Office expense', Advertising: 'Advertising', Marketing: 'Advertising', Office: 'Office expense', Equipment: 'Depreciable assets', Internet: 'Utilities', Phone: 'Utilities', 'Bank fees': 'Other expenses', 'Payment processing': 'Other expenses', Travel: 'Travel', Meals: 'Meals', 'Professional services': 'Legal & professional', Legal: 'Legal & professional', Accounting: 'Legal & professional', Taxes: 'Taxes & licenses', Training: 'Other expenses', 'Client expenses': 'Other expenses', 'Interest & fees': 'Interest' },
  },
  { kind: 'income', owner: 'business', names: ['Client payments', 'Consulting', 'Call center revenue', 'Sales commissions', 'Freelance income', 'Other business income'] },
  { kind: 'income', owner: 'personal', names: ['Salary', 'Investment income', 'Freelance income', 'Other personal income'] },
];

export function seedDefaults(db: Db) {
  db.tx(() => {
    if (!db.value('SELECT COUNT(*) FROM users')) db.insert('users', { name: 'Owner' });
    if (db.value<number>('SELECT COUNT(*) FROM categories') === 0) {
      let i = 0;
      for (const group of DEFAULT_CATEGORIES) {
        group.names.forEach((name, idx) => {
          const deductible = group.owner === 'business' && group.kind === 'expense' && name !== 'Taxes' && name !== 'Other' ? 1 : null;
          db.insert('categories', {
            name, kind: group.kind, owner: group.owner, color: PALETTE[i++ % PALETTE.length], sort: idx,
            tax_category: group.tax?.[name] ?? null, deductible_default: deductible,
          });
        });
      }
    }
    const defaults: Record<string, string> = {
      base_currency: 'USD',
      business_name: 'Azuria Engine',
      owner_draws_as_personal_income: '1',
      date_order: 'MDY',
      auto_lock_minutes: '5',
      theme: 'system',
      notify_bills: '1', notify_debt: '1', notify_invoices: '1', notify_unusual: '1', notify_budget: '1',
      notify_subscriptions: '1', notify_low_balance: '1', notify_goals: '1',
      unusual_expense_multiplier: '3',
      bill_lookahead_days: '14',
    };
    for (const [k, v] of Object.entries(defaults)) db.run('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', [k, v]);
  });
}

export function getSetting(db: Db, key: string, fallback = ''): string {
  return db.value<string>('SELECT value FROM settings WHERE key = ?', [key]) ?? fallback;
}
export function setSetting(db: Db, key: string, value: string) {
  db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
