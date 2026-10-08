import type { Db } from './db';
import { MONTH_NAMES, monthEnd, pad } from './dates';
import { parseMoney } from './money';

export interface SearchResults {
  query: string;
  period: { from: string; to: string; label: string } | null;
  amount: number | null;
  transactions: any[];
  clients: any[];
  invoices: any[];
  accounts: any[];
  debts: any[];
}

/** Recognise "August 2026", "aug 2026", "2026-08", "08/2026" or a bare year. */
export function parsePeriod(q: string): { from: string; to: string; label: string } | null {
  const s = q.trim().toLowerCase();
  let m = s.match(/^([a-záéíóú]+)\.?\s+(\d{4})$/);
  if (m) {
    const idx = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m![1].slice(0, 3)));
    const es = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].indexOf(m[1].slice(0, 3));
    const mi = idx >= 0 ? idx : es;
    if (mi >= 0) { const from = `${m[2]}-${pad(mi + 1)}-01`; return { from, to: monthEnd(from), label: `${MONTH_NAMES[mi]} ${m[2]}` }; }
  }
  m = s.match(/^(\d{4})[-/](\d{1,2})$/) ?? null;
  if (m) { const from = `${m[1]}-${pad(+m[2])}-01`; return { from, to: monthEnd(from), label: `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` }; }
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m && +m[1] <= 12) { const from = `${m[2]}-${pad(+m[1])}-01`; return { from, to: monthEnd(from), label: `${MONTH_NAMES[+m[1] - 1]} ${m[2]}` }; }
  m = s.match(/^(19|20)\d{2}$/);
  if (m) return { from: `${s}-01-01`, to: `${s}-12-31`, label: s };
  return null;
}

export function globalSearch(db: Db, q: string, limit = 200): SearchResults {
  const query = q.trim();
  const res: SearchResults = { query, period: null, amount: null, transactions: [], clients: [], invoices: [], accounts: [], debts: [] };
  if (!query) return res;
  const period = parsePeriod(query);
  res.period = period;
  let amount: number | null = null;
  if (/^[$L]?\s?[\d,]+(\.\d{1,2})?$/.test(query)) { try { amount = parseMoney(query); } catch { /* not an amount */ } }
  res.amount = amount;
  const like = `%${query.replace(/[%_]/g, (c) => '\\' + c)}%`;
  const base = `SELECT t.*, a.name account_name, ta.name to_account_name, c.name category_name, cl.name client_name
    FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.deleted_at IS NULL AND `;
  if (period) {
    res.transactions = db.all(base + 't.date BETWEEN ? AND ? ORDER BY t.date DESC LIMIT ?', [period.from, period.to, limit]);
  } else {
    const conds = ['t.payee LIKE :q ESCAPE \'\\\'', 't.description LIKE :q ESCAPE \'\\\'', 't.notes LIKE :q ESCAPE \'\\\'', 't.reference LIKE :q ESCAPE \'\\\'', 'c.name LIKE :q ESCAPE \'\\\'', 'cl.name LIKE :q ESCAPE \'\\\'', 'a.name LIKE :q ESCAPE \'\\\'',
      "EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id AND g.name LIKE :q ESCAPE '\\')"];
    if (amount != null) conds.push('t.amount = :amt', 't.to_amount = :amt');
    res.transactions = db.all(base + `(${conds.join(' OR ')}) ORDER BY t.date DESC LIMIT :lim`, { q: like, amt: amount, lim: limit });
    res.clients = db.all("SELECT * FROM clients WHERE name LIKE :q ESCAPE '\\' OR company LIKE :q ESCAPE '\\' OR contact LIKE :q ESCAPE '\\' OR email LIKE :q ESCAPE '\\' LIMIT 20", { q: like });
    res.invoices = db.all("SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.number LIKE :q ESCAPE '\\' OR c.name LIKE :q ESCAPE '\\' OR i.notes LIKE :q ESCAPE '\\' ORDER BY i.issue_date DESC LIMIT 30", { q: like });
    res.accounts = db.all("SELECT * FROM accounts WHERE name LIKE :q ESCAPE '\\' OR institution LIKE :q ESCAPE '\\' LIMIT 10", { q: like });
    res.debts = db.all("SELECT * FROM debts WHERE name LIKE :q ESCAPE '\\' OR creditor LIKE :q ESCAPE '\\' LIMIT 10", { q: like });
  }
  return res;
}
