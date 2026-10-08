import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Field, Select, Text, Segmented, Chip, Empty } from '../ui/components';
import { accountOptions, categoryOptions } from '../ui/TxForm';
import { parseCSV, parseOFX, parseExcel, detectColumns, buildPreview, commitImport, undoImport, type Mapping, type Field as F, type PreviewRow, type ImportOptions } from '../core/importer';
import { formatMoney } from '../core/money';
import { formatDate } from '../core/dates';
import { Icon } from '../ui/icons';

const FIELDS: { key: F; label: string; hint?: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'amount', label: 'Amount (signed)', hint: 'One column with + and − amounts' },
  { key: 'debit', label: 'Debit / money out', hint: 'Or separate columns' },
  { key: 'credit', label: 'Credit / money in' },
  { key: 'payee', label: 'Payee / merchant' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'reference', label: 'Reference / ID', hint: 'Helps detect duplicates exactly' },
  { key: 'type', label: 'Debit/credit indicator' },
  { key: 'currency', label: 'Currency' },
  { key: 'notes', label: 'Notes' },
];

type Step = 'upload' | 'map' | 'preview' | 'done';

export default function ImportPage() {
  const { db, fin, act, snapshot, toast, setting } = useApp();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [opt, setOpt] = useState<ImportOptions>({ accountId: 0, headerRow: 0, mapping: {}, dateOrder: (setting('date_order', 'MDY') as 'MDY' | 'DMY'), signConvention: 'negative_is_expense' });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [tags, setTags] = useState('');
  const [result, setResult] = useState<{ batchId: number; imported: number; matched: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const batches = db.all<any>('SELECT b.*, a.name account FROM import_batches b LEFT JOIN accounts a ON a.id = b.account_id ORDER BY b.id DESC LIMIT 10');
  const acct = fin.accounts.find((a) => a.id === opt.accountId);
  const o = (p: Partial<ImportOptions>) => setOpt((x) => ({ ...x, ...p }));

  const load = async () => {
    if (!file || !opt.accountId) return;
    setBusy(true);
    try {
      const name = file.name.toLowerCase();
      let r: string[][];
      if (name.endsWith('.xlsx')) r = await parseExcel(await file.arrayBuffer());
      else if (name.endsWith('.xls')) throw new Error('Old .xls files aren’t supported. Open it in Excel or Numbers and save as .xlsx or .csv.');
      else if (name.endsWith('.ofx') || name.endsWith('.qfx')) r = parseOFX(await file.text());
      else if (name.endsWith('.pdf')) throw new Error('PDF statements can’t be read reliably. Download the CSV, Excel or OFX/QFX version from your bank instead.');
      else r = parseCSV(await file.text());
      if (r.length < 2) throw new Error('No rows found in this file.');
      const det = detectColumns(r);
      setRows(r);
      o({ headerRow: det.headerRow, mapping: det.mapping });
      setStep('map');
    } catch (e: any) { toast({ msg: e.message, tone: 'bad' }); }
    finally { setBusy(false); }
  };

  const headers = rows[opt.headerRow] ?? [];
  const mappingOk = opt.mapping.date !== undefined && (opt.mapping.amount !== undefined || opt.mapping.debit !== undefined || opt.mapping.credit !== undefined);
  const makePreview = () => {
    const p = act(() => buildPreview(db, rows, { ...opt, owner: acct?.owner }));
    if (p) { setPreview(p); setStep('preview'); }
  };
  const counts = useMemo(() => ({
    import: preview.filter((r) => r.action === 'import' && !r.errors.length).length,
    match: preview.filter((r) => r.action === 'match').length,
    skip: preview.filter((r) => r.action === 'skip' || r.errors.length).length,
    dup: preview.filter((r) => r.duplicate).length,
    err: preview.filter((r) => r.errors.length).length,
  }), [preview]);
  const setRow = (i: number, p: Partial<PreviewRow>) => setPreview((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const commit = async () => {
    setBusy(true);
    try {
      await snapshot(`Before importing ${file?.name}`);
      const res = act(() => commitImport(db, preview, { ...opt, owner: acct?.owner, defaultTags: tags.split(',').map((t) => t.trim()).filter(Boolean) }, file?.name ?? 'import'));
      if (res) { setResult(res); setStep('done'); }
    } finally { setBusy(false); }
  };

  return (<>
    <PageHead title="Import transactions" sub="CSV, Excel (.xlsx) and OFX/QFX bank statements. Nothing is imported until you confirm." />
    <div className="row" style={{ gap: 6, marginBottom: 16 }}>
      {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => <Chip key={s} kind={step === s ? 'biz' : ''}>{i + 1}. {{ upload: 'File & account', map: 'Columns', preview: 'Review', done: 'Done' }[s]}</Chip>)}
    </div>

    {step === 'upload' && (
      <div className="grid g2">
        <Panel title="Choose a file">
          <div className="stack">
            <Field label="Account these transactions belong to"><Select value={opt.accountId || null} onChange={(v) => o({ accountId: v ?? 0 })} options={accountOptions(fin.accounts)} placeholder="Choose…" /></Field>
            <Field label="Statement file" hint=".csv, .tsv, .txt, .xlsx, .ofx, .qfx"><input type="file" className="input" style={{ paddingTop: 8 }} accept=".csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx,.pdf,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <button className="btn primary" disabled={!file || !opt.accountId || busy} onClick={load}>{busy ? 'Reading…' : 'Read file'}</button>
          </div>
        </Panel>
        <Panel title="About bank connections">
          <div className="stack small">
            <p>This app doesn’t connect directly to your bank. Live bank feeds require a paid aggregator service and a server holding your bank credentials — which would mean your financial data leaves your device. That’s a deliberate trade-off for privacy, not a hidden feature.</p>
            <p>Instead: download a statement from online banking (most banks offer CSV, Excel or “Quicken/OFX”), then import it here. Duplicates are detected automatically, and items you already scheduled (like rent) are matched instead of added twice.</p>
            <p className="muted">The import engine is separate from the screens, so a bank-feed connector can be added later without changing how transactions are stored.</p>
          </div>
        </Panel>
        {batches.length > 0 && <Panel title="Recent imports" flush className="span2">
          <div className="list">{batches.map((b) => <div key={b.id} className="item"><div className="grow"><div className="title">{b.filename}</div><div className="meta">{b.imported_at} UTC · {b.account} · {b.row_count} rows</div></div><button className="btn sm danger" onClick={() => { act(() => undoImport(db, b.id), 'Import undone'); }}>Undo import</button></div>)}</div>
        </Panel>}
      </div>
    )}

    {step === 'map' && (
      <Panel title={`Match columns · ${file?.name}`}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          <Field label="Header row" hint="Row with the column names"><Select value={opt.headerRow} onChange={(v) => { const det = detectColumns(rows.slice(v ?? 0)); o({ headerRow: v ?? 0, mapping: det.mapping }); }} options={rows.slice(0, 15).map((r, i) => ({ value: i, label: `Row ${i + 1}: ${r.slice(0, 3).join(' | ').slice(0, 40)}` }))} /></Field>
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Select value={opt.mapping[f.key] ?? null} onChange={(v) => o({ mapping: { ...opt.mapping, [f.key]: v ?? undefined } as Mapping })} options={headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))} placeholder="— not in file —" />
            </Field>
          ))}
          <Field label="Date format"><Select value={opt.dateOrder} onChange={(v) => o({ dateOrder: (v ?? 'MDY') as any })} options={[{ value: 'MDY', label: 'Month/Day/Year (US)' }, { value: 'DMY', label: 'Day/Month/Year (Honduras, Europe)' }]} /></Field>
          {opt.mapping.amount !== undefined && opt.mapping.debit === undefined && <Field label="Amounts"><Select value={opt.signConvention} onChange={(v) => o({ signConvention: (v ?? 'negative_is_expense') as any })} options={[{ value: 'negative_is_expense', label: 'Negative = money out (most banks)' }, { value: 'positive_is_expense', label: 'Positive = money out (most credit cards)' }]} /></Field>}
          <Field label="Add tags to all (optional)"><Text value={tags} onChange={setTags} placeholder="e.g. imported-sept" /></Field>
        </div>
        <h3 style={{ margin: '18px 0 8px' }}>First rows of the file</h3>
        <div className="tbl-wrap"><table className="tbl"><thead><tr>{headers.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}{Object.entries(opt.mapping).filter(([, v]) => v === i).map(([k]) => <div key={k}><Chip kind="biz">{FIELDS.find((f) => f.key === k)?.label}</Chip></div>)}</th>)}</tr></thead>
          <tbody>{rows.slice(opt.headerRow + 1, opt.headerRow + 6).map((r, i) => <tr key={i}>{headers.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody></table></div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => setStep('upload')}>Back</button>
          <button className="btn primary" disabled={!mappingOk} onClick={makePreview}>Preview {rows.length - opt.headerRow - 1} rows</button>
          {!mappingOk && <span className="small muted">Choose at least a date and an amount (or debit/credit) column.</span>}
        </div>
      </Panel>
    )}

    {step === 'preview' && (<>
      <Panel>
        <div className="row wrap" style={{ gap: 16 }}>
          <span><b>{counts.import}</b> new</span><span><b>{counts.match}</b> match scheduled items</span><span><b>{counts.skip}</b> skipped</span>
          {counts.dup > 0 && <span className="neg">{counts.dup} possible duplicates (skipped unless you choose)</span>}
          {counts.err > 0 && <span className="neg">{counts.err} rows with problems</span>}
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn" onClick={() => setStep('map')}>Back</button>
            <button className="btn primary" disabled={busy || counts.import + counts.match === 0} onClick={commit}>Import {counts.import + counts.match} into {acct?.name}</button>
          </div>
        </div>
      </Panel>
      <Panel flush className="">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Action</th><th>Date</th><th>Payee / description</th><th className="r">Amount</th><th>Category</th><th>Notes</th></tr></thead>
          <tbody>{preview.map((r, i) => (
            <tr key={i} style={{ opacity: r.action === 'skip' ? 0.55 : 1 }}>
              <td style={{ minWidth: 130 }}>{r.errors.length ? <Chip kind="bad">Can’t import</Chip> : (
                <select className="input" style={{ height: 32 }} value={r.action} onChange={(e) => setRow(i, { action: e.target.value as any })}>
                  <option value="import">Import</option><option value="skip">Skip</option>{r.match && <option value="match">Match scheduled</option>}
                </select>)}</td>
              <td>{r.date ? formatDate(r.date) : '—'}</td>
              <td style={{ maxWidth: 280 }}><div className="ellipsis"><b>{r.payee}</b></div><div className="ellipsis tiny muted">{r.description}</div></td>
              <td className={`r ${r.kind === 'income' ? 'pos' : ''}`}>{r.kind === 'income' ? '+' : '−'}{formatMoney(r.amount, acct?.currency ?? 'USD')}</td>
              <td style={{ minWidth: 170 }}><select className="input" style={{ height: 32 }} value={r.category_id ?? ''} onChange={(e) => setRow(i, { category_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Uncategorized</option>{categoryOptions(fin.categories, r.kind, acct?.owner ?? 'personal').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                {r.categorySource === 'history' && <div className="tiny muted">from past {r.payee}</div>}</td>
              <td className="small">{r.errors.map((e) => <div key={e} className="neg">{e}</div>)}{r.duplicate && <div className="neg">{r.duplicate.level === 'exact' ? 'Already recorded' : 'Possible duplicate'}: {r.duplicate.label}</div>}{r.match && <div className="pos">Matches scheduled: {r.match.label}</div>}</td>
            </tr>))}</tbody>
        </table></div>
      </Panel>
    </>)}

    {step === 'done' && result && (
      <Panel>
        <Empty title="Import complete" action={<div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary" to="/transactions">View transactions</Link>
          <button className="btn danger" onClick={() => { act(() => undoImport(db, result.batchId), 'Import undone'); setStep('upload'); }}>Undo this import</button>
          <button className="btn" onClick={() => { setStep('upload'); setFile(null); setPreview([]); }}>Import another file</button>
        </div>}>{result.imported} added, {result.matched} matched to scheduled items, {result.skipped} skipped. A restore point was saved before importing.</Empty>
      </Panel>
    )}
    {step === 'upload' && <p className="tiny muted" style={{ marginTop: 12 }}><Icon name="lock" size={12} /> Files are read on this device only.</p>}
  </>);
}
