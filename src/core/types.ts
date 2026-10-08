export type Owner = 'personal' | 'business';
export type Scope = 'all' | Owner;
export type TxKind = 'income' | 'expense' | 'transfer';
export type TxStatus = 'expected' | 'pending' | 'cleared' | 'cancelled';
export type TransferType = 'transfer' | 'savings' | 'owner_draw' | 'owner_contribution' | 'debt_payment' | 'debt_proceeds' | 'loan_given' | 'loan_repayment';

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'investment' | 'paypal' | 'stripe' | 'payment' | 'loan' | 'other_asset' | 'other_liability';

export const ACCOUNT_TYPES: { value: AccountType; label: string; liability: boolean; liquid: boolean }[] = [
  { value: 'checking', label: 'Checking', liability: false, liquid: true },
  { value: 'savings', label: 'Savings', liability: false, liquid: true },
  { value: 'cash', label: 'Cash', liability: false, liquid: true },
  { value: 'paypal', label: 'PayPal', liability: false, liquid: true },
  { value: 'stripe', label: 'Stripe', liability: false, liquid: true },
  { value: 'payment', label: 'Other payment account', liability: false, liquid: true },
  { value: 'investment', label: 'Investment', liability: false, liquid: false },
  { value: 'other_asset', label: 'Other asset', liability: false, liquid: false },
  { value: 'credit_card', label: 'Credit card', liability: true, liquid: false },
  { value: 'loan', label: 'Loan account', liability: true, liquid: false },
  { value: 'other_liability', label: 'Other liability', liability: true, liquid: false },
];
export const isLiabilityType = (t: string) => !!ACCOUNT_TYPES.find((a) => a.value === t)?.liability;
export const isLiquidType = (t: string) => !!ACCOUNT_TYPES.find((a) => a.value === t)?.liquid;

export const TRANSFER_TYPES: { value: TransferType; label: string; hint: string }[] = [
  { value: 'transfer', label: 'Transfer between accounts', hint: 'Moves money, not income or expense' },
  { value: 'savings', label: 'Move to savings', hint: 'Counts toward "saved", never an expense' },
  { value: 'owner_draw', label: 'Owner draw (business → personal)', hint: 'Not a business expense; optional personal income' },
  { value: 'owner_contribution', label: 'Owner contribution (personal → business)', hint: 'Capital put into the business' },
  { value: 'debt_payment', label: 'Debt / credit card payment', hint: 'Reduces debt; the original purchases were the expense' },
  { value: 'debt_proceeds', label: 'Borrowed money received', hint: 'Cash in from a loan, not income' },
  { value: 'loan_given', label: 'Money lent to someone', hint: 'Creates money owed to you' },
  { value: 'loan_repayment', label: 'Loan repaid to me', hint: 'Someone paying you back, not income' },
];

export interface Account {
  id: number; name: string; type: AccountType; owner: Owner; institution: string | null; currency: string;
  starting_balance: number; starting_date: string; notes: string | null; is_active: number;
  include_in_net_worth: number; low_balance_alert: number | null; is_demo: number;
}

export interface Category {
  id: number; name: string; kind: 'income' | 'expense'; owner: Owner | 'both'; parent_id: number | null;
  color: string | null; tax_category: string | null; deductible_default: number | null; is_archived: number; sort: number;
}

export interface Transaction {
  id: number; date: string; kind: TxKind; status: TxStatus; owner: Owner;
  account_id: number | null; to_account_id: number | null; to_amount: number | null; transfer_type: TransferType | null;
  amount: number; currency: string; category_id: number | null; payee: string | null; description: string | null;
  notes: string | null; reference: string | null; payment_method: string | null; client_id: number | null; project_id: number | null;
  tax_deductible: number | null; tax_category: string | null; tax_notes: string | null;
  recurring_id: number | null; occurrence_date: string | null; debt_id: number | null; invoice_id: number | null;
  expected_date: string | null; import_batch_id: number | null; is_demo: number; deleted_at: string | null;
  created_at: string; updated_at: string;
}

export interface Client {
  id: number; name: string; kind: 'client' | 'person' | 'vendor'; company: string | null; contact: string | null;
  email: string | null; phone: string | null; payment_terms_days: number | null; currency: string; notes: string | null;
  is_archived: number; is_demo: number;
}

export interface Project { id: number; client_id: number | null; name: string; status: string; notes: string | null; is_demo: number }

export interface Invoice {
  id: number; number: string | null; kind: 'invoice' | 'loan'; owner: Owner; client_id: number | null; project_id: number | null;
  amount: number; currency: string; issue_date: string; due_date: string | null; status: 'draft' | 'sent' | 'void';
  payment_method: string | null; notes: string | null; is_demo: number;
}

export interface Debt {
  id: number; name: string; creditor: string | null; type: string; owner: Owner; account_id: number | null; currency: string;
  original_amount: number; opening_balance: number; balance_date: string; interest_rate: string; minimum_payment: number;
  due_day: number | null; due_date: string | null; frequency: string; start_date: string | null; target_payoff_date: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical'; notes: string | null; is_closed: number; is_demo: number;
}

export interface DebtPayment { id: number; debt_id: number; date: string; kind: 'payment' | 'charge' | 'adjustment'; principal: number; interest: number; transaction_id: number | null; notes: string | null }

export interface Recurring {
  id: number; name: string; kind: TxKind; owner: Owner; account_id: number | null; to_account_id: number | null;
  transfer_type: TransferType | null; amount: number; currency: string; category_id: number | null; payee: string | null;
  client_id: number | null; debt_id: number | null; unit: 'day' | 'week' | 'month' | 'year'; interval: number;
  start_date: string; end_date: string | null; auto_clear: number; is_bill: number; is_subscription: number;
  subscription_value: 'essential' | 'useful' | 'unsure' | 'cancel' | null; tax_deductible: number | null; notes: string | null;
  is_active: number; is_demo: number;
}

export interface SavingsGoal {
  id: number; name: string; type: string; owner: Owner; target_amount: number; currency: string; starting_amount: number;
  account_id: number | null; deadline: string | null; monthly_target: number | null; notes: string | null; is_closed: number; is_demo: number;
}

export interface Budget { id: number; owner: Owner; category_id: number | null; month: string | null; amount: number; currency: string; is_demo: number }

export interface Attachment { id: number; transaction_id: number | null; filename: string; mime: string; size: number; doc_type: string; date: string | null; notes: string | null; created_at: string }

export const FREQUENCIES: { label: string; unit: Recurring['unit']; interval: number }[] = [
  { label: 'Daily', unit: 'day', interval: 1 },
  { label: 'Weekly', unit: 'week', interval: 1 },
  { label: 'Biweekly', unit: 'week', interval: 2 },
  { label: 'Monthly', unit: 'month', interval: 1 },
  { label: 'Quarterly', unit: 'month', interval: 3 },
  { label: 'Yearly', unit: 'year', interval: 1 },
];

export function frequencyLabel(unit: string, interval: number): string {
  const f = FREQUENCIES.find((x) => x.unit === unit && x.interval === interval);
  if (f) return f.label;
  return `Every ${interval} ${unit}s`;
}
