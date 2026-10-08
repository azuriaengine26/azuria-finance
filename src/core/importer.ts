import type { Db } from './db';
import type { Account, Category, Transaction } from './types';
import { parseMoney } from './money';
import { parseLooseDate, diffDays, addDays } from './dates';
import { normaliseTx, setTags } from './repo';

// ---------------- File parsing ----------------

/** RFC-4180 CSV parser with delimiter auto-detection (comma, semicolon, tab). Handles quotes, escaped quotes and CRLF. */
export function parseCSV(text: string, delimiter?: string): string[][] {
  text = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = [',', ';', '\t'].map((d) => ({ d, n: sample.split(d).length }));
  return counts.sort((a, b) => b.n - a.n)[0].d;
}

/** Minimal OFX/QFX statement parser (the format most banks offer as "Quicken/Money download"). */
export function parseOFX(text: string): string[][] {
  const out: string[][] = [['Date', 'Amount', 'Payee', 'Memo', 'Reference', 'Type']];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => (b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1] ?? '').trim();
  for (const b of blocks) {
    const dt = tag(b, 'DTPOSTED');
    const date = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : '';
    out.push([date, tag(b, 'TRNAMT'), tag(b, 'NAME') || tag(b, 'PAYEE'), tag(b, 'MEMO'), tag(b, 'FITID'), tag(b, 'TRNTYPE')]);
  }
  return out;
}

export async function parseExcel(buf: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v: any = r.getCell(c).value;
      if (v == null) vals.push('');
      else if (v instanceof Date) vals.push(v.toISOString().slice(0, 10));
      else if (typeof v === 'object' && 'result' in v) vals.push(String(v.result ?? ''));
      else if (typeof v === 'object' && 'text' in v) vals.push(String(v.text));
      else if (typeof v === 'object' && 'richText' in v) vals.push(v.richText.map((x: any) => x.text).join(''));
      else vals.push(String(v));
    }
    rows.push(vals.map((s) => s.trim()));
  });
  return rows;
}

// ---------------- Column detection & mapping ----------------

export type Field = 'date' | 'amount' | 'debit' | 'credit' | 'payee' | 'description' | 'category' | 'currency' | 'reference' | 'notes' | 'type';
export type Mapping = Partial<Record<Field, number>>;

const HINTS: Record<Field, RegExp> = {
  date: /^(date|fecha|posted|posting date|transaction date|trans\.? date|value date|fecha de transacci[oó]n)$|date/i,
  amount: /^(amount|monto|importe|valor|transaction amount|amt|sum)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|d[eé]bito|cargo|cargos|money out|paid out)$/i,
  credit: /^(credit|credits|deposit|deposits|cr[eé]dito|abono|abonos|money in|paid in)$/i,
  payee: /^(payee|merchant|name|vendor|comercio|beneficiario|counterparty|description 1)$/i,
  description: /^(description|descripci[oó]n|details|concepto|narrative|memo|transaction description|detalle)$/i,
  category: /^(category|categor[ií]a)$/i,
  currency: /^(currency|moneda|ccy)$/i,
  reference: /^(reference|ref|referencia|check|check number|fitid|id|transaction id|n[uú]mero)$/i,
  notes: /^(notes?|notas?|comments?)$/i,
  type: /^(type|tipo|transaction type|dr\/cr)$/i,
};

/** Find the header row (first row with ≥2 recognisable headers) and propose a mapping. */
export function detectColumns(rows: string[][]): { headerRow: number; headers: string[]; mapping: Mapping } {
  let headerRow = 0, best = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = rows[i].filter((h) => Object.values(HINTS).some((re) => re.test(h))).length;
    if (score > best) { best = score; headerRow = i; }
    if (score >= 3) break;
  }
  const headers = rows[headerRow] ?? [];
  const mapping: Mapping = {};
  const used = new Set<number>();
  const order: Field[] = ['date', 'debit', 'credit', 'amount', 'currency', 'category', 'reference', 'notes', 'type', 'payee', 'description'];
  for (const f of order) {
    // exact matches first, then loose
    let idx = headers.findIndex((h, i) => !used.has(i) && HINTS[f].test(h.trim()));
    if (idx >= 0) { mapping[f] = idx; used.add(idx); }
  }
  if (mapping.amount === undefined && mapping.debit === undefined) {
    // fall back to the first column that looks numeric in the data
    const sample = rows.slice(headerRow + 1, headerRow + 6);
    const idx = headers.findIndex((_, i) => !used.has(i) && sample.length > 0 && sample.every((r) => { try { parseMoney(r[i] ?? ''); return true; } catch { return false; } }));
    if (idx >= 0) mapping.amount = idx;
  }
  if (mapping.payee === undefined && mapping.description !== undefined) { /* description alone is fine */ }
  return { headerRow, headers, mapping };
}

// ---------------- Preview & duplicate detection ----------------

export interface ImportOptions {
  accountId: number;
  headerRow: number;
  mapping: Mapping;
  dateOrder: 'MDY' | 'DMY';
  /** How a single signed amount column should be read. */
  signConvention: 'negative_is_expense' | 'positive_is_expense';
  owner?: 'personal' | 'business';
  defaultTags?: string[];
}

export type RowAction = 'import' | 'skip' | 'match';

export interface PreviewRow {
  index: number; raw: string[];
  date: string | null; amount: number; kind: 'income' | 'expense';
  payee: string; description: string; reference: string; notes: string; currency: string;
  category_id: number | null; categorySource: 'file' | 'history' | 'none';
  errors: string[];
  duplicate: null | { level: 'exact' | 'likely'; txId: number; label: string };
  match: null | { txId: number; label: string };
  action: RowAction;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, ' ').replace(/\s+/g, ' ').trim();
function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)), B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return a && b && norm(a) === norm(b) ? 1 : 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

export function buildPreview(db: Db, rows: string[][], opt: ImportOptions): PreviewRow[] {
  const acct = db.get<Account>('SELECT * FROM accounts WHERE id = ?', [opt.accountId]);
  if (!acct) throw new Error('Choose the account these transactions belong to');
  const cats = db.all<Category>('SELECT * FROM categories WHERE is_archived = 0');
  const history = new Map<string, number>();
  for (const r of db.all<{ payee: string; category_id: number }>("SELECT payee, category_id FROM transactions WHERE payee IS NOT NULL AND category_id IS NOT NULL AND deleted_at IS NULL ORDER BY date ASC")) history.set(norm(r.payee), r.category_id);
  const existing = db.all<Transaction>('SELECT * FROM transactions WHERE deleted_at IS NULL AND status <> \'cancelled\' AND (account_id = ? OR to_account_id = ? OR (account_id IS NULL AND status = \'expected\'))', [acct.id, acct.id]);
  const m = opt.mapping;
  const get = (r: string[], f: Field) => (m[f] !== undefined ? (r[m[f]!] ?? '').trim() : '');
  const seenInFile = new Map<string, number>();
  const usedMatches = new Set<number>();
  const out: PreviewRow[] = [];

  rows.slice(opt.headerRow + 1).forEach((raw, i) => {
    const errors: string[] = [];
    const date = parseLooseDate(get(raw, 'date'), opt.dateOrder);
    if (!date) errors.push(`Unreadable date "${get(raw, 'date')}"`);
    let signed = 0;
    try {
      if (m.debit !== undefined || m.credit !== undefined) {
        const dr = get(raw, 'debit'), cr = get(raw, 'credit');
        const d = dr ? Math.abs(parseMoney(dr)) : 0, c = cr ? Math.abs(parseMoney(cr)) : 0;
        signed = c - d;
        if (!dr && !cr && m.amount !== undefined) signed = parseMoney(get(raw, 'amount'));
      } else {
        signed = parseMoney(get(raw, 'amount'));
        if (opt.signConvention === 'positive_is_expense') signed = -signed;
      }
      const type = get(raw, 'type').toLowerCase();
      if (type && /^(debit|dr|cargo|withdrawal|payment)$/.test(type) && signed > 0) signed = -signed;
      if (type && /^(credit|cr|abono|deposit)$/.test(type) && signed < 0) signed = -signed;
    } catch { errors.push(`Unreadable amount`); }
    if (signed === 0 && !errors.length) errors.push('Amount is zero');
    const kind: 'income' | 'expense' = signed > 0 ? 'income' : 'expense';
    const amount = Math.abs(signed);
    let payee = get(raw, 'payee');
    const description = get(raw, 'description');
    if (!payee) payee = description.split(/\s{2,}| - |\*/)[0].slice(0, 60);
    const currency = (get(raw, 'currency') || acct.currency).toUpperCase();
    if (currency !== acct.currency) errors.push(`Currency ${currency} differs from account (${acct.currency}); import into a ${currency} account`);

    // Category: explicit column → payee history → none
    let category_id: number | null = null, categorySource: PreviewRow['categorySource'] = 'none';
    const fileCat = get(raw, 'category');
    if (fileCat) {
      const c = cats.find((c) => c.kind === kind && norm(c.name) === norm(fileCat) && (c.owner === (opt.owner ?? acct.owner) || c.owner === 'both'))
        ?? cats.find((c) => c.kind === kind && norm(c.name) === norm(fileCat));
      if (c) { category_id = c.id; categorySource = 'file'; }
    }
    if (!category_id && payee) {
      const h = history.get(norm(payee));
      const hc = h ? cats.find((c) => c.id === h && c.kind === kind) : undefined;
      if (hc) { category_id = hc.id; categorySource = 'history'; }
    }

    // Duplicates against existing data
    let duplicate: PreviewRow['duplicate'] = null, match: PreviewRow['match'] = null;
    const reference = get(raw, 'reference');
    if (date && amount) {
      for (const e of existing) {
        if (e.kind === 'transfer') {
          // A transfer touching this account has the same money movement
          const dirOk = (e.account_id === acct.id && kind === 'expense') || (e.to_account_id === acct.id && kind === 'income');
          if (!dirOk) continue;
        } else if (e.kind !== kind) continue;
        const eAmt = e.kind === 'transfer' && e.to_account_id === acct.id && e.to_amount != null ? e.to_amount : e.amount;
        if (eAmt !== amount) continue;
        const dd = Math.abs(diffDays(e.date, date));
        const label = `${e.date} · ${e.payee || e.description || ''}`;
        if (e.status === 'expected' && dd <= 7) { if (!usedMatches.has(e.id) && !match) match = { txId: e.id, label }; continue; }
        if (reference && e.reference && e.reference === reference) { duplicate = { level: 'exact', txId: e.id, label }; break; }
        const sim = similarity(payee + ' ' + description, (e.payee ?? '') + ' ' + (e.description ?? ''));
        if (dd === 0 && (sim >= 0.5 || !e.payee)) { duplicate = { level: 'exact', txId: e.id, label }; break; }
        if (dd <= 3 && !duplicate) duplicate = { level: 'likely', txId: e.id, label };
      }
    }
    // Duplicates within the file itself
    const key = `${date}|${signed}|${norm(payee + description)}|${reference}`;
    const prior = seenInFile.get(key);
    if (prior !== undefined && !duplicate) duplicate = { level: 'likely', txId: -1, label: `Same as row ${prior + 1} in this file` };
    seenInFile.set(key, i);
    if (match && !duplicate) usedMatches.add(match.txId);
    else match = null;

    const action: RowAction = errors.length ? 'skip' : duplicate ? 'skip' : match ? 'match' : 'import';
    out.push({ index: i, raw, date, amount, kind, payee, description, reference, notes: get(raw, 'notes'), currency, category_id, categorySource, errors, duplicate, match, action });
  });
  return out;
}

export interface ImportResult { batchId: number; imported: number; matched: number; skipped: number }

/** Commit the confirmed preview atomically. Nothing is written if any row fails validation. */
export function commitImport(db: Db, preview: PreviewRow[], opt: ImportOptions, filename: string): ImportResult {
  const acct = db.get<Account>('SELECT * FROM accounts WHERE id = ?', [opt.accountId])!;
  return db.tx(() => {
    const batchId = db.insert('import_batches', { filename, account_id: acct.id, row_count: 0 });
    let imported = 0, matched = 0, skipped = 0;
    for (const r of preview) {
      if (r.action === 'skip' || r.errors.length) { skipped++; continue; }
      if (r.action === 'match' && r.match) {
        db.run("UPDATE transactions SET status = 'cleared', expected_date = ifnull(expected_date, date), date = ?, account_id = ?, import_batch_id = ?, reference = ifnull(reference, ?), updated_at = datetime('now') WHERE id = ?",
          [r.date, acct.id, batchId, r.reference || null, r.match.txId]);
        matched++;
        continue;
      }
      const data = normaliseTx(db, {
        date: r.date!, kind: r.kind, status: 'cleared', owner: opt.owner ?? acct.owner, account_id: acct.id, amount: r.amount, currency: acct.currency,
        category_id: r.category_id, payee: r.payee, description: r.description, reference: r.reference, notes: r.notes, import_batch_id: batchId,
      });
      const id = db.insert('transactions', data);
      if (opt.defaultTags?.length) setTags(db, id, opt.defaultTags);
      imported++;
    }
    db.run('UPDATE import_batches SET row_count = ? WHERE id = ?', [imported + matched, batchId]);
    return { batchId, imported, matched, skipped };
  });
}

/** Undo an import: soft-deletes the rows it created and returns matched items to "expected". */
export function undoImport(db: Db, batchId: number) {
  db.tx(() => {
    // Rows created by the import have no expected_date; rows that matched an expected item do.
    db.run("UPDATE transactions SET deleted_at = datetime('now') WHERE import_batch_id = ? AND expected_date IS NULL AND deleted_at IS NULL", [batchId]);
    db.run("UPDATE transactions SET status = 'expected', date = expected_date, import_batch_id = NULL WHERE import_batch_id = ? AND expected_date IS NOT NULL", [batchId]);
    db.run('DELETE FROM import_batches WHERE id = ?', [batchId]);
  });
}

export { addDays };
