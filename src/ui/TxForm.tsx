import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../app/context';
import type { Transaction, TxKind, Owner, Category, Account, TransferType } from '../core/types';
import { TRANSFER_TYPES, isLiabilityType } from '../core/types';
import { saveTransaction, deleteTransaction, duplicateTransaction, getTags, txHistory, inferTransferType, restoreTransaction } from '../core/repo';
import { formatMoney } from '../core/money';
import { today, formatDate } from '../core/dates';
import { Modal, Field, Text, Area, DateInput, Select, MoneyInput, Segmented, Check, Chip } from './components';
import { Icon } from './icons';

export function accountOptions(accounts: Account[], includeId?: number | null) {
  return accounts.filter((a) => a.is_active || a.id === includeId).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, group: a.owner === 'business' ? 'Business' : 'Personal' }));
}

export function categoryOptions(cats: Category[], kind: 'income' | 'expense', owner: Owner | 'all', includeId?: number | null) {
  const pool = cats.filter((c) => c.kind === kind && (owner === 'all' || c.owner === owner || c.owner === 'both') && (!c.is_archived || c.id === includeId));
  const parents = pool.filter((c) => !c.parent_id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const out: { value: number; label: string; group?: string }[] = [];
  for (const p of parents) {
    const g = owner === 'all' ? (p.owner === 'business' ? 'Business' : 'Personal') : undefined;
    out.push({ value: p.id, label: p.name, group: g });
    for (const s of pool.filter((c) => c.parent_id === p.id)) out.push({ value: s.id, label: `${p.name} › ${s.name}`, group: g });
  }
  return out;
}

async function shrinkImage(file: File): Promise<{ data: Uint8Array; mime: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { data: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/octet-stream' };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.82));
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
}

export function TxForm({ tx, initial, onClose }: { tx?: Transaction | null; initial?: Partial<Transaction>; onClose: () => void }) {
  const { db, fin, act, toast } = useApp();
  const accounts = fin.accounts;
  const editing = !!tx?.id;
  const lastUsed = db.value<number>("SELECT account_id FROM transactions WHERE account_id IS NOT NULL AND kind <> 'transfer' AND deleted_at IS NULL AND recurring_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 1");
  const firstAcct = accounts.find((a) => a.id === lastUsed && a.is_active) ?? accounts.find((a) => a.is_active && !isLiabilityType(a.type)) ?? accounts[0];
  const [d, setD] = useState<Partial<Transaction>>(() => tx ? { ...tx } : {
    kind: 'expense', status: 'cleared', date: today(), account_id: firstAcct?.id ?? null, owner: firstAcct?.owner ?? 'personal', currency: firstAcct?.currency ?? fin.base, ...initial,
  });
  const [tags, setTags] = useState<string>(() => (tx?.id ? getTags(db, tx.id).join(', ') : ''));
  const [more, setMore] = useState(() => !!(tx && (tx.client_id || tx.reference || tx.tax_deductible != null || tx.notes || tx.payment_method)));
  const [pending, setPending] = useState<File[]>([]);
  const [showHist, setShowHist] = useState(false);
  const p = (x: Partial<Transaction>) => setD((o) => ({ ...o, ...x }));

  const acct = accounts.find((a) => a.id === d.account_id);
  const toAcct = accounts.find((a) => a.id === d.to_account_id);
  const kind = d.kind as TxKind;
  const owner = (d.owner ?? acct?.owner ?? 'personal') as Owner;

  // Keep currency + owner in sync with the chosen account (owner can be overridden afterwards).
  useEffect(() => {
    if (!acct) return;
    if (kind === 'transfer' || !editing || d.currency === undefined) p({ currency: acct.currency });
    if (!editing) p({ owner: acct.owner });
  }, [d.account_id]);
  useEffect(() => {
    if (kind === 'transfer' && !editing) p({ transfer_type: inferTransferType(acct, toAcct) });
  }, [d.account_id, d.to_account_id, kind]);

  const crossCurrency = kind === 'transfer' ? !!(acct && toAcct && acct.currency !== toAcct.currency) : !!(acct && d.currency && acct.currency !== d.currency);
  const settleCur = kind === 'transfer' ? toAcct?.currency : acct?.currency;
  useEffect(() => {
    if (crossCurrency && d.amount && settleCur && d.to_amount == null) p({ to_amount: fin.conv(d.amount, kind === 'transfer' ? acct!.currency : d.currency!, settleCur) });
    if (!crossCurrency && d.to_amount != null) p({ to_amount: null });
  }, [crossCurrency, d.amount]);

  const cats = useMemo(() => kind === 'transfer' ? [] : categoryOptions(fin.categories, kind, owner, d.category_id), [kind, owner, fin]);
  const clients = db.all<{ id: number; name: string }>('SELECT id, name FROM clients WHERE is_archived = 0 OR id = ? ORDER BY name', [d.client_id ?? 0]);
  const projects = db.all<{ id: number; name: string }>('SELECT id, name FROM projects WHERE client_id IS ? OR id = ? ORDER BY name', [d.client_id ?? null, d.project_id ?? 0]);
  const payees = useMemo(() => db.all<{ payee: string }>('SELECT payee FROM transactions WHERE payee IS NOT NULL AND deleted_at IS NULL GROUP BY payee ORDER BY MAX(date) DESC LIMIT 300').map((r) => r.payee), []);
  const attachments = tx?.id ? db.all<any>('SELECT id, filename, mime, size, doc_type FROM attachments WHERE transaction_id = ?', [tx.id]) : [];

  // Suggest a category from this payee's history.
  const onPayee = (v: string) => {
    p({ payee: v });
    if (!d.category_id && kind !== 'transfer') {
      const c = db.value<number>('SELECT category_id FROM transactions t JOIN categories c ON c.id = t.category_id WHERE payee = ? AND c.kind = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 1', [v, kind]);
      if (c) p({ payee: v, category_id: c });
    }
  };

  const save = async () => {
    const shape = kind === 'transfer' ? { account_id: needsFrom ? d.account_id : null, to_account_id: needsTo || !needsFrom ? d.to_account_id : null } : {};
    const id = act(() => saveTransaction(db, { ...d, ...shape, tags:tags.split(',').map((t) => t.trim()).filter(Boolean) }));
    if (id == null) return;
    for (const f of pending) {
      if (f.size > 15 * 1024 * 1024) { toast({ msg: `${f.name} is larger than 15 MB and was not attached`, tone: 'bad' }); continue; }
      const { data, mime } = await shrinkImage(f);
      db.insert('attachments', { transaction_id: id, filename: f.name, mime, size: data.length, data, doc_type: /invoice/i.test(f.name) ? 'invoice' : 'receipt', date: d.date });
    }
    toast(editing ? 'Transaction updated' : 'Transaction saved');
    onClose();
  };

  const openAttachment = (id: number) => {
    const r = db.get<any>('SELECT data, mime FROM attachments WHERE id = ?', [id]);
    if (!r) return;
    const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const transferInfo = TRANSFER_TYPES.find((t) => t.value === d.transfer_type);
  const needsFrom = !(kind === 'transfer' && ['debt_proceeds', 'loan_repayment'].includes(d.transfer_type ?? ''));
  const needsTo = kind === 'transfer' && needsFrom && d.transfer_type !== 'loan_given';

  return (
    <Modal title={editing ? 'Edit transaction' : 'New transaction'} onClose={onClose} footer={<>
      {editing && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { act(() => deleteTransaction(db, tx!.id)); toast({ msg: 'Transaction deleted', action: { label: 'Undo', run: () => restoreTransaction(db, tx!.id) } }); onClose(); }}><Icon name="trash" />Delete</button>}
      {editing && <button className="btn" onClick={() => { const id = act(() => duplicateTransaction(db, tx!.id)); if (id) { toast('Duplicated with today’s date'); onClose(); } }}><Icon name="copy" />Duplicate</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}>{editing ? 'Save changes' : 'Save transaction'}</button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        <Segmented label="Type" value={kind} onChange={(k) => p({ kind: k, category_id: null, transfer_type: k === 'transfer' ? inferTransferType(acct, toAcct) : null, to_account_id: k === 'transfer' ? d.to_account_id : null })}
          options={[{ value: 'expense' as TxKind, label: 'Expense' }, { value: 'income' as TxKind, label: 'Income' }, { value: 'transfer' as TxKind, label: 'Transfer' }]} />
        <MoneyInput big value={d.amount} onChange={(v) => p({ amount: v ?? undefined, to_amount: crossCurrency ? null : d.to_amount })} currency={kind === 'transfer' ? (acct?.currency ?? toAcct?.currency ?? 'USD') : (d.currency ?? acct?.currency ?? 'USD')} />

        <div className="form-grid">
          {kind === 'transfer' ? (<>
            <Field label="Transfer type" full hint={transferInfo?.hint}>
              <Select value={d.transfer_type ?? 'transfer'} onChange={(v) => p({ transfer_type: (v ?? 'transfer') as TransferType })} options={TRANSFER_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
            </Field>
            {needsFrom && <Field label="From account"><Select value={d.account_id} onChange={(v) => p({ account_id: v })} options={accountOptions(accounts, d.account_id)} placeholder="Choose…" /></Field>}
            {needsTo && <Field label={d.transfer_type === 'debt_payment' ? 'Card or loan account (optional)' : 'To account'} hint={d.transfer_type === 'debt_payment' && !d.to_account_id ? 'Or pay a tracked debt from the Debt screen' : undefined}><Select value={d.to_account_id} onChange={(v) => p({ to_account_id: v })} options={accountOptions(accounts, d.to_account_id).filter((o) => o.value !== d.account_id)} placeholder={d.transfer_type === 'debt_payment' ? 'None' : 'Choose…'} /></Field>}
            {!needsFrom && <Field label="Into account"><Select value={d.to_account_id} onChange={(v) => p({ to_account_id: v })} options={accountOptions(accounts, d.to_account_id)} placeholder="Choose…" /></Field>}
            {crossCurrency && toAcct && <Field label={`Amount received in ${toAcct.currency}`} hint="What actually arrived — kept exactly as entered"><MoneyInput value={d.to_amount} onChange={(v) => p({ to_amount: v })} currency={toAcct.currency} /></Field>}
          </>) : (<>
            <Field label="Account"><Select value={d.account_id} onChange={(v) => p({ account_id: v })} options={accountOptions(accounts, d.account_id)} placeholder={d.status === 'expected' ? 'Not decided yet' : 'Choose…'} /></Field>
            <Field label="Category"><Select value={d.category_id} onChange={(v) => p({ category_id: v })} options={cats} placeholder="Uncategorized" /></Field>
          </>)}
          <Field label="Date"><DateInput value={d.date} onChange={(v) => p({ date: v })} required /></Field>
          <Field label="Status" hint={d.status === 'expected' ? 'Not counted in balances until confirmed' : d.status === 'pending' ? 'Shown separately from your available balance' : undefined}>
            <Select value={d.status} onChange={(v) => p({ status: (v ?? 'cleared') as any })} options={[{ value: 'cleared', label: kind === 'income' ? 'Received' : 'Completed' }, { value: 'pending', label: 'Pending' }, { value: 'expected', label: kind === 'income' ? 'Expected' : 'Scheduled' }, { value: 'cancelled', label: 'Cancelled' }]} />
          </Field>
          <Field label={kind === 'income' ? 'From (payer)' : kind === 'expense' ? 'Merchant / payee' : 'Payee'}>
            <Text value={d.payee} onChange={onPayee} list="payees" placeholder={kind === 'income' ? 'Client or person' : 'e.g. Amazon'} />
            <datalist id="payees">{payees.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label="Description"><Text value={d.description} onChange={(v) => p({ description: v })} placeholder="What was it for?" /></Field>
          {kind !== 'transfer' && (
            <Field label="Belongs to" hint={acct && owner !== acct.owner ? `Paid from a ${acct.owner} account — recorded as ${owner}` : undefined}>
              <Segmented label="Personal or business" value={owner} onChange={(o) => p({ owner: o, category_id: null })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} />
            </Field>
          )}
          {kind !== 'transfer' && crossCurrency && acct && (
            <Field label={`Charged to account in ${acct.currency}`}><MoneyInput value={d.to_amount} onChange={(v) => p({ to_amount: v })} currency={acct.currency} /></Field>
          )}
        </div>

        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Hide details' : 'More details: client, tags, tax, receipts'}</button>
        {more && (
          <div className="form-grid">
            {kind !== 'transfer' && <Field label="Original currency" hint="If the price was in another currency"><Select value={d.currency} onChange={(v) => p({ currency: v ?? acct?.currency, to_amount: null })} options={['USD', 'HNL', 'EUR', 'MXN', 'GTQ'].map((c) => ({ value: c, label: c }))} /></Field>}
            <Field label="Client"><Select value={d.client_id} onChange={(v) => p({ client_id: v, project_id: null })} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="None" /></Field>
            <Field label="Project"><Select value={d.project_id} onChange={(v) => p({ project_id: v })} options={projects.map((c) => ({ value: c.id, label: c.name }))} placeholder="None" /></Field>
            <Field label="Payment method"><Select value={d.payment_method} onChange={(v) => p({ payment_method: v })} options={['Card', 'Bank transfer', 'ACH', 'Wire', 'Cash', 'PayPal', 'Stripe', 'Check', 'Other'].map((x) => ({ value: x, label: x }))} placeholder="—" /></Field>
            <Field label="Reference / invoice #"><Text value={d.reference} onChange={(v) => p({ reference: v })} /></Field>
            <Field label="Tags" hint="Separate with commas" full><Text value={tags} onChange={setTags} placeholder="e.g. trip, reimbursable" /></Field>
            {kind === 'expense' && (<>
              <Field label="Tax deductible?"><Select value={d.tax_deductible == null ? 'unset' : d.tax_deductible ? 'yes' : 'no'} onChange={(v) => p({ tax_deductible: v === 'yes' ? 1 : v === 'no' ? 0 : null })} options={[{ value: 'unset', label: 'Use category default' }, { value: 'yes', label: 'Yes — potentially deductible' }, { value: 'no', label: 'No' }]} /></Field>
              <Field label="Tax category"><Text value={d.tax_category} onChange={(v) => p({ tax_category: v })} placeholder={fin.category(d.category_id)?.tax_category ?? 'e.g. Office expense'} /></Field>
              <Field label="Tax notes" full><Text value={d.tax_notes} onChange={(v) => p({ tax_notes: v })} /></Field>
            </>)}
            <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
            <div className="full stack" style={{ gap: 8 }}>
              <span className="small" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Receipts & documents</span>
              {attachments.map((a) => (
                <div key={a.id} className="spread small">
                  <button className="btn ghost sm" onClick={() => openAttachment(a.id)}><Icon name="paperclip" />{a.filename}</button>
                  <span className="muted">{Math.round(a.size / 1024)} KB · {a.doc_type}</span>
                  <button className="btn ghost sm danger" onClick={() => act(() => db.run('DELETE FROM attachments WHERE id = ?', [a.id]), 'Attachment removed')}>Remove</button>
                </div>
              ))}
              {pending.map((f) => <div key={f.name} className="small muted">Will attach: {f.name}</div>)}
              <label className="btn sm" style={{ alignSelf: 'flex-start' }}><Icon name="paperclip" />Attach file or photo<input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => setPending([...pending, ...Array.from(e.target.files ?? [])])} /></label>
              <small className="muted">Files are stored encrypted with your data. Photos are resized to save space.</small>
            </div>
          </div>
        )}

        {editing && (
          <div className="small">
            <button className="btn ghost sm" onClick={() => setShowHist(!showHist)}>{showHist ? 'Hide change history' : 'Show change history'}</button>
            {showHist && (
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                <div className="muted">Created {tx!.created_at} UTC{tx!.import_batch_id ? ' by import' : tx!.recurring_id ? ' from a recurring rule' : ''}</div>
                {txHistory(db, tx!.id).map((h, i) => { const o = JSON.parse(h.old_json || '{}'); return <div key={i} className="muted">{h.at} UTC — {h.action}: previously {o.amount != null ? formatMoney(o.amount, o.currency) : ''} · {o.date} · {o.status}{o.payee ? ' · ' + o.payee : ''}</div>; })}
              </div>
            )}
          </div>
        )}
        {d.recurring_id && <div className="notice"><Icon name="repeat" /><span>Generated from a recurring rule. Editing this occurrence won’t change the rule.</span></div>}
        {d.invoice_id && <div className="notice"><Icon name="file" /><span>Linked to an invoice; changing the amount updates what the client still owes.</span></div>}
      </div>
    </Modal>
  );
}

export { Chip, formatDate };
