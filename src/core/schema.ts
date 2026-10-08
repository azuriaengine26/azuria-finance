// Versioned migrations. Each entry runs once, tracked by PRAGMA user_version.
// Never edit a shipped migration — append a new one.

export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type TEXT NOT NULL CHECK (type IN ('checking','savings','cash','credit_card','investment','paypal','stripe','payment','loan','other_asset','other_liability')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  institution TEXT,
  currency TEXT NOT NULL,
  starting_balance INTEGER NOT NULL DEFAULT 0,
  starting_date TEXT NOT NULL DEFAULT (date('now')),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  include_in_net_worth INTEGER NOT NULL DEFAULT 1,
  low_balance_alert INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_owner ON accounts(owner);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business','both')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  color TEXT,
  tax_category TEXT,
  deductible_default INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE UNIQUE INDEX uq_categories ON categories(kind, owner, ifnull(parent_id,0), name COLLATE NOCASE);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client','person','vendor')),
  company TEXT, contact TEXT, email TEXT, phone TEXT,
  payment_terms_days INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_projects_client ON projects(client_id);

CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  transfer_type TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  payee TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  debt_id INTEGER REFERENCES debts(id) ON DELETE SET NULL,
  unit TEXT NOT NULL CHECK (unit IN ('day','week','month','year')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  start_date TEXT NOT NULL,
  end_date TEXT,
  auto_clear INTEGER NOT NULL DEFAULT 0,
  is_bill INTEGER NOT NULL DEFAULT 0,
  is_subscription INTEGER NOT NULL DEFAULT 0,
  subscription_value TEXT CHECK (subscription_value IS NULL OR subscription_value IN ('essential','useful','unsure','cancel')),
  tax_deductible INTEGER,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE debts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  creditor TEXT,
  type TEXT NOT NULL CHECK (type IN ('credit_card','personal_loan','business_loan','person','vendor','contractor','other')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  currency TEXT NOT NULL,
  original_amount INTEGER NOT NULL DEFAULT 0,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  balance_date TEXT NOT NULL DEFAULT (date('now')),
  interest_rate TEXT NOT NULL DEFAULT '0',
  minimum_payment INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  due_date TEXT,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT,
  target_payoff_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  notes TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT,
  kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','loan')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','void')),
  payment_method TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_invoice_number ON invoices(number) WHERE number IS NOT NULL AND kind = 'invoice';
CREATE INDEX idx_invoices_client ON invoices(client_id);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
  status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('expected','pending','cleared','cancelled')),
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  to_amount INTEGER CHECK (to_amount IS NULL OR to_amount >= 0),
  transfer_type TEXT CHECK (transfer_type IS NULL OR transfer_type IN ('transfer','savings','owner_draw','owner_contribution','debt_payment','debt_proceeds','loan_given','loan_repayment')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  payee TEXT,
  description TEXT,
  notes TEXT,
  reference TEXT,
  payment_method TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  tax_deductible INTEGER CHECK (tax_deductible IS NULL OR tax_deductible IN (0,1)),
  tax_category TEXT,
  tax_notes TEXT,
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  occurrence_date TEXT,
  debt_id INTEGER REFERENCES debts(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  expected_date TEXT,
  import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind = 'transfer' OR account_id IS NOT NULL OR status IN ('expected','cancelled')),
  CHECK (kind <> 'transfer' OR account_id IS NOT NULL OR to_account_id IS NOT NULL),
  CHECK (account_id IS NULL OR to_account_id IS NULL OR account_id <> to_account_id),
  CHECK (kind = 'transfer' OR (to_account_id IS NULL AND transfer_type IS NULL))
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_account ON transactions(account_id);
CREATE INDEX idx_tx_to_account ON transactions(to_account_id);
CREATE INDEX idx_tx_category ON transactions(category_id);
CREATE INDEX idx_tx_client ON transactions(client_id);
CREATE INDEX idx_tx_scope ON transactions(owner, kind, date);
CREATE INDEX idx_tx_invoice ON transactions(invoice_id);
CREATE INDEX idx_tx_debt ON transactions(debt_id);
CREATE UNIQUE INDEX uq_tx_occurrence ON transactions(recurring_id, occurrence_date) WHERE recurring_id IS NOT NULL;

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'receipt' CHECK (doc_type IN ('receipt','invoice','contract','statement','other')),
  date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attach_tx ON attachments(transaction_id);

CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','charge','adjustment')),
  principal INTEGER NOT NULL,
  interest INTEGER NOT NULL DEFAULT 0 CHECK (interest >= 0),
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_debt_payments ON debt_payments(debt_id, date);

CREATE TABLE savings_goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  currency TEXT NOT NULL,
  starting_amount INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  deadline TEXT,
  monthly_target INTEGER,
  notes TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE goal_contributions (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_goal_contrib ON goal_contributions(goal_id, date);

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL CHECK (owner IN ('personal','business')),
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_budget ON budgets(owner, ifnull(category_id,0), ifnull(month,''));

CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate TEXT NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (base, quote, date)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_json TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit ON audit_log(entity, entity_id);

-- History is preserved: every change to a transaction/invoice/account/debt keeps the previous version.
CREATE TRIGGER trg_tx_audit_upd AFTER UPDATE ON transactions BEGIN
  INSERT INTO audit_log(entity, entity_id, action, old_json) VALUES ('transaction', OLD.id,
    CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete'
         WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN 'restore' ELSE 'update' END,
    json_object('date',OLD.date,'kind',OLD.kind,'status',OLD.status,'owner',OLD.owner,'account_id',OLD.account_id,
      'to_account_id',OLD.to_account_id,'amount',OLD.amount,'currency',OLD.currency,'category_id',OLD.category_id,
      'payee',OLD.payee,'description',OLD.description,'notes',OLD.notes,'transfer_type',OLD.transfer_type));
END;
CREATE TRIGGER trg_tx_audit_del AFTER DELETE ON transactions BEGIN
  INSERT INTO audit_log(entity, entity_id, action, old_json) VALUES ('transaction', OLD.id, 'purge',
    json_object('date',OLD.date,'kind',OLD.kind,'amount',OLD.amount,'currency',OLD.currency,'payee',OLD.payee));
END;
CREATE TRIGGER trg_inv_audit AFTER UPDATE ON invoices BEGIN
  INSERT INTO audit_log(entity, entity_id, action, old_json) VALUES ('invoice', OLD.id, 'update',
    json_object('number',OLD.number,'amount',OLD.amount,'status',OLD.status,'due_date',OLD.due_date));
END;
CREATE TRIGGER trg_acct_audit AFTER UPDATE ON accounts BEGIN
  INSERT INTO audit_log(entity, entity_id, action, old_json) VALUES ('account', OLD.id, 'update',
    json_object('name',OLD.name,'starting_balance',OLD.starting_balance,'currency',OLD.currency,'is_active',OLD.is_active));
END;
CREATE TRIGGER trg_debt_audit AFTER UPDATE ON debts BEGIN
  INSERT INTO audit_log(entity, entity_id, action, old_json) VALUES ('debt', OLD.id, 'update',
    json_object('name',OLD.name,'opening_balance',OLD.opening_balance,'interest_rate',OLD.interest_rate,'minimum_payment',OLD.minimum_payment));
END;
`,
];
