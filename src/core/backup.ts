import type { Db } from './db';
import { toDecimalString } from './money';

// Insert order respects foreign keys.
export const TABLES = ['users', 'settings', 'accounts', 'categories', 'clients', 'projects', 'debts', 'recurring', 'invoices', 'import_batches',
  'transactions', 'tags', 'transaction_tags', 'attachments', 'debt_payments', 'savings_goals', 'goal_contributions', 'budgets', 'exchange_rates', 'audit_log'] as const;

export const APP_ID = 'azuria-finance';

function toB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b: string): Uint8Array {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

/** Complete, human-readable backup of every table (attachments included as base64). */
export function exportJSON(db: Db): string {
  const tables: Record<string, any[]> = {};
  for (const t of TABLES) {
    tables[t] = db.all(`SELECT * FROM ${t}`).map((r) => {
      const o: any = { ...r };
      for (const [k, v] of Object.entries(o)) if (v instanceof Uint8Array) o[k] = { $b64: toB64(v) };
      return o;
    });
  }
  return JSON.stringify({ app: APP_ID, kind: 'full-backup', schema_version: db.version, exported_at: new Date().toISOString(), tables }, null, 1);
}

export function validateBackup(json: string): { ok: true; data: any; counts: Record<string, number> } | { ok: false; error: string } {
  let data: any;
  try { data = JSON.parse(json); } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
  if (data?.app !== APP_ID || data?.kind !== 'full-backup' || typeof data.tables !== 'object') return { ok: false, error: 'This is not an Azuria Finance backup file.' };
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = Array.isArray(data.tables[t]) ? data.tables[t].length : 0;
  return { ok: true, data, counts };
}

/** Replace ALL data with the backup, atomically. Rolls back fully on any constraint failure. */
export function restoreJSON(db: Db, json: string) {
  const v = validateBackup(json);
  if (!v.ok) throw new Error(v.error);
  if (v.data.schema_version > db.version) throw new Error('This backup is from a newer version of the app. Update the app first.');
  db.raw.run('PRAGMA foreign_keys = OFF');
  try {
    db.tx(() => {
      for (const t of [...TABLES].reverse()) db.run(`DELETE FROM ${t}`);
      db.run('DELETE FROM audit_log'); // delete triggers above logged the wipe; the backup's own history replaces it
      for (const t of TABLES) {
        for (const row of v.data.tables[t] ?? []) {
          const r: any = {};
          for (const [k, val] of Object.entries(row)) r[k] = val && typeof val === 'object' && '$b64' in (val as any) ? fromB64((val as any).$b64) : val;
          db.insert(t, r);
        }
      }
      const fk = db.all('PRAGMA foreign_key_check');
      if (fk.length) throw new Error(`Backup has ${fk.length} broken references; nothing was changed.`);
    });
  } finally {
    db.raw.run('PRAGMA foreign_keys = ON');
  }
}

// ---------------- CSV ----------------
export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Guard against spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function transactionsCSV(db: Db, includeDeleted = false): string {
  const rows = db.all<any>(`
    SELECT t.*, a.name account, ta.name to_account, c.name category, pc.name parent_category, cl.name client, p.name project,
      (SELECT group_concat(g.name, '; ') FROM tags g JOIN transaction_tags tt ON tt.tag_id = g.id WHERE tt.transaction_id = t.id) tags
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
    LEFT JOIN clients cl ON cl.id = t.client_id LEFT JOIN projects p ON p.id = t.project_id
    ${includeDeleted ? '' : 'WHERE t.deleted_at IS NULL'} ORDER BY t.date, t.id`);
  const header = ['ID', 'Date', 'Type', 'Status', 'Personal/Business', 'Account', 'To account', 'Transfer type', 'Amount', 'Currency', 'Amount received (to account)', 'Category', 'Subcategory', 'Payee', 'Description', 'Notes', 'Reference', 'Payment method', 'Client', 'Project', 'Tags', 'Tax deductible', 'Tax category', 'Tax notes', 'Expected date', 'Demo'];
  return toCSV([header, ...rows.map((t) => [
    t.id, t.date, t.kind, t.status, t.owner, t.account, t.to_account, t.transfer_type, toDecimalString(t.kind === 'expense' ? -t.amount : t.amount), t.currency,
    t.to_amount != null ? toDecimalString(t.to_amount) : '', t.parent_category ?? t.category, t.parent_category ? t.category : '', t.payee, t.description, t.notes, t.reference,
    t.payment_method, t.client, t.project, t.tags, t.tax_deductible == null ? '' : t.tax_deductible ? 'yes' : 'no', t.tax_category, t.tax_notes, t.expected_date, t.is_demo ? 'yes' : '',
  ])]);
}

export function hasDemoData(db: Db): boolean {
  return !!db.value("SELECT 1 FROM accounts WHERE is_demo = 1 UNION SELECT 1 FROM transactions WHERE is_demo = 1 LIMIT 1");
}

/** Remove everything flagged as demo, leaving real data untouched. */
export function deleteDemoData(db: Db) {
  db.tx(() => {
    const demoTx = 'SELECT id FROM transactions WHERE is_demo = 1 OR account_id IN (SELECT id FROM accounts WHERE is_demo = 1) OR to_account_id IN (SELECT id FROM accounts WHERE is_demo = 1)';
    db.run(`DELETE FROM debt_payments WHERE is_demo = 1 OR transaction_id IN (${demoTx})`);
    db.run(`DELETE FROM transactions WHERE id IN (${demoTx})`);
    db.run('DELETE FROM goal_contributions WHERE is_demo = 1');
    db.run('DELETE FROM savings_goals WHERE is_demo = 1');
    db.run('DELETE FROM budgets WHERE is_demo = 1');
    db.run('DELETE FROM recurring WHERE is_demo = 1');
    db.run('DELETE FROM invoices WHERE is_demo = 1');
    db.run('DELETE FROM debts WHERE is_demo = 1');
    db.run('DELETE FROM projects WHERE is_demo = 1');
    db.run('DELETE FROM clients WHERE is_demo = 1 AND id NOT IN (SELECT client_id FROM invoices WHERE client_id IS NOT NULL)');
    db.run('DELETE FROM import_batches WHERE id NOT IN (SELECT import_batch_id FROM transactions WHERE import_batch_id IS NOT NULL)');
    db.run('DELETE FROM accounts WHERE is_demo = 1');
    db.run("DELETE FROM exchange_rates WHERE source = 'demo'");
    db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM transaction_tags)');
    db.run("DELETE FROM audit_log WHERE entity = 'transaction' AND entity_id NOT IN (SELECT id FROM transactions)");
  });
}
