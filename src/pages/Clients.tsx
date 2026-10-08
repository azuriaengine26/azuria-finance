import { useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Money, Empty, Modal, Field, Text, Area, Select, MoneyInput, DateInput, CurrencySelect, Segmented, Stat, Chip, useDraft } from '../ui/components';
import { accountOptions } from '../ui/TxForm';
import { recordInvoicePayment, nextInvoiceNumber } from '../core/repo';
import { today, formatDate, addDays, presetRange } from '../core/dates';
import { formatMoney } from '../core/money';
import type { Client, Invoice, Owner } from '../core/types';
import { Icon } from '../ui/icons';

const STATE_LABEL: Record<string, string> = { current: 'Current', due_soon: 'Due soon', overdue: 'Overdue', partial: 'Partly paid', paid: 'Paid', draft: 'Draft', void: 'Void' };

function ClientForm({ c, onClose }: { c: Partial<Client>; onClose: () => void }) {
  const { db, act } = useApp();
  const [d, p] = useDraft<Partial<Client>>({ kind: 'client', currency: 'USD', payment_terms_days: 15, ...c });
  const [newProject, setNewProject] = useState('');
  const projects = d.id ? db.all<{ id: number; name: string; status: string }>('SELECT * FROM projects WHERE client_id = ?', [d.id]) : [];
  const save = () => {
    const ok = act(() => {
      if (!d.name?.trim()) throw new Error('Name is required');
      const data = { name: d.name.trim(), kind: d.kind, company: d.company || null, contact: d.contact || null, email: d.email || null, phone: d.phone || null, payment_terms_days: d.payment_terms_days ?? null, currency: d.currency, notes: d.notes || null, is_archived: d.is_archived ?? 0 };
      if (d.id) db.update('clients', d.id, data); else db.insert('clients', data);
      return true;
    }, 'Saved');
    if (ok) onClose();
  };
  return (
    <Modal title={d.id ? 'Edit contact' : 'New client or person'} onClose={onClose} footer={<>
      {d.id && <button className="btn" style={{ marginRight: 'auto' }} onClick={() => { act(() => db.update('clients', d.id!, { is_archived: d.is_archived ? 0 : 1 }), d.is_archived ? 'Restored' : 'Archived'); onClose(); }}>{d.is_archived ? 'Unarchive' : 'Archive'}</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" full><Text value={d.name} onChange={(v) => p({ name: v })} /></Field>
        <Field label="Type"><Select value={d.kind} onChange={(v) => p({ kind: (v ?? 'client') as any })} options={[{ value: 'client', label: 'Business client' }, { value: 'person', label: 'Person (friend, family)' }, { value: 'vendor', label: 'Vendor' }]} /></Field>
        <Field label="Company"><Text value={d.company} onChange={(v) => p({ company: v })} /></Field>
        <Field label="Contact person"><Text value={d.contact} onChange={(v) => p({ contact: v })} /></Field>
        <Field label="Email"><Text type="email" value={d.email} onChange={(v) => p({ email: v })} /></Field>
        <Field label="Phone"><Text type="tel" value={d.phone} onChange={(v) => p({ phone: v })} /></Field>
        <Field label="Payment terms (days)"><input className="input" type="number" min={0} value={d.payment_terms_days ?? ''} onChange={(e) => p({ payment_terms_days: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Currency"><CurrencySelect value={d.currency ?? 'USD'} onChange={(v) => p({ currency: v })} /></Field>
        <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
        {d.id && <div className="full stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 500 }}>Projects</span>
          {projects.map((pr) => <div key={pr.id} className="spread small"><span>{pr.name}</span><Chip>{pr.status}</Chip></div>)}
          <div className="row"><Text value={newProject} onChange={setNewProject} placeholder="New project name" /><button className="btn" disabled={!newProject.trim()} onClick={() => { act(() => db.insert('projects', { client_id: d.id, name: newProject.trim() }), 'Project added'); setNewProject(''); }}>Add</button></div>
        </div>}
      </div>
    </Modal>
  );
}

function InvoiceForm({ inv, onClose }: { inv: Partial<Invoice>; onClose: () => void }) {
  const { db, act } = useApp();
  const clients = db.all<Client>('SELECT * FROM clients WHERE is_archived = 0 OR id = ? ORDER BY name', [inv.client_id ?? 0]);
  const [d, p] = useDraft<Partial<Invoice>>({ kind: 'invoice', owner: 'business', currency: 'USD', status: 'sent', issue_date: today(), number: inv.kind === 'loan' ? null : nextInvoiceNumber(db), ...inv });
  const client = clients.find((c) => c.id === d.client_id);
  const projects = db.all<{ id: number; name: string }>('SELECT id, name FROM projects WHERE client_id = ?', [d.client_id ?? 0]);
  const save = () => {
    const ok = act(() => {
      if (!d.client_id) throw new Error(d.kind === 'loan' ? 'Choose who owes you' : 'Choose a client');
      if (!d.amount) throw new Error('Enter the amount');
      const data = { number: d.kind === 'invoice' ? (d.number || null) : null, kind: d.kind, owner: d.kind === 'loan' ? d.owner : 'business', client_id: d.client_id, project_id: d.project_id ?? null, amount: d.amount, currency: d.currency, issue_date: d.issue_date, due_date: d.due_date || null, status: d.status, payment_method: d.payment_method || null, notes: d.notes || null };
      try { if (d.id) db.update('invoices', d.id, data); else db.insert('invoices', data); }
      catch (e: any) { if (String(e.message).includes('UNIQUE')) throw new Error(`Invoice number ${d.number} is already used`); throw e; }
      return true;
    }, d.id ? 'Updated' : d.kind === 'loan' ? 'Loan recorded' : 'Invoice created');
    if (ok) onClose();
  };
  return (
    <Modal title={d.id ? (d.kind === 'loan' ? 'Edit loan' : `Invoice ${d.number ?? ''}`) : d.kind === 'loan' ? 'Money someone owes me' : 'New invoice'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label={d.kind === 'loan' ? 'Who owes you' : 'Client'}><Select value={d.client_id} onChange={(v) => { const c = clients.find((x) => x.id === v); p({ client_id: v, currency: c?.currency ?? d.currency, due_date: d.due_date || (c?.payment_terms_days != null ? addDays(d.issue_date ?? today(), c.payment_terms_days) : null) }); }} options={clients.filter((c) => d.kind === 'loan' || c.kind !== 'person').map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose…" /></Field>
        {d.kind === 'invoice' ? <Field label="Invoice number"><Text value={d.number} onChange={(v) => p({ number: v })} /></Field>
          : <Field label="For"><Segmented label="Owner" value={(d.owner ?? 'personal') as Owner} onChange={(v) => p({ owner: v })} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} /></Field>}
        <Field label="Amount"><MoneyInput value={d.amount} onChange={(v) => p({ amount: v ?? undefined })} currency={d.currency ?? 'USD'} /></Field>
        <Field label="Currency"><CurrencySelect value={d.currency ?? 'USD'} onChange={(v) => p({ currency: v })} /></Field>
        <Field label={d.kind === 'loan' ? 'Date lent' : 'Issue date'}><DateInput value={d.issue_date} onChange={(v) => p({ issue_date: v })} /></Field>
        <Field label={d.kind === 'loan' ? 'Expected back by' : 'Due date'} hint={client?.payment_terms_days != null && d.kind === 'invoice' ? `Terms: net ${client.payment_terms_days}` : undefined}><DateInput value={d.due_date} onChange={(v) => p({ due_date: v || null })} /></Field>
        {d.kind === 'invoice' && <Field label="Project"><Select value={d.project_id} onChange={(v) => p({ project_id: v })} options={projects.map((x) => ({ value: x.id, label: x.name }))} placeholder="None" /></Field>}
        <Field label="Status"><Select value={d.status} onChange={(v) => p({ status: (v ?? 'sent') as any })} options={[{ value: 'draft', label: 'Draft (not counted)' }, { value: 'sent', label: d.kind === 'loan' ? 'Active' : 'Sent' }, { value: 'void', label: 'Void / cancelled' }]} /></Field>
        <Field label="Payment method"><Text value={d.payment_method} onChange={(v) => p({ payment_method: v })} placeholder="ACH, wire, PayPal…" /></Field>
        <Field label="Notes" full><Area value={d.notes} onChange={(v) => p({ notes: v })} /></Field>
      </div>
      {d.kind === 'loan' && !d.id && <p className="tiny muted" style={{ marginTop: 10 }}>To also record the money leaving your account, add a transfer of type “Money lent to someone”.</p>}
    </Modal>
  );
}

function RecordPayment({ inv, onClose }: { inv: any; onClose: () => void }) {
  const { db, fin, act } = useApp();
  const defAcct = fin.accounts.find((a) => a.owner === inv.owner && a.currency === inv.currency && a.is_active && !['credit_card', 'loan'].includes(a.type));
  const [account, setAccount] = useState<number | null>(defAcct?.id ?? null);
  const acct = fin.accounts.find((a) => a.id === account);
  const [amount, setAmount] = useState<number | null>(acct && acct.currency !== inv.currency ? fin.conv(inv.outstanding, inv.currency, acct.currency) : inv.outstanding);
  const [date, setDate] = useState(today());
  return (
    <Modal title={`Payment from ${inv.client_name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!amount || !account} onClick={() => { if (act(() => recordInvoicePayment(db, inv.id, { date, amount: amount!, account_id: account! }), 'Payment recorded') !== undefined) onClose(); }}>Record payment</button></>}>
      <div className="stack">
        <p>Outstanding: <b className="num">{formatMoney(inv.outstanding, inv.currency)}</b> of {formatMoney(inv.amount, inv.currency)}</p>
        <div className="form-grid">
          <Field label="Received into"><Select value={account} onChange={(v) => { setAccount(v); const a = fin.accounts.find((x) => x.id === v); if (a) setAmount(fin.conv(inv.outstanding, inv.currency, a.currency)); }} options={accountOptions(fin.accounts, account)} placeholder="Choose…" /></Field>
          <Field label="Date"><DateInput value={date} onChange={setDate} /></Field>
          <Field label={`Amount received${acct ? ` (${acct.currency})` : ''}`} hint="Enter less for a partial payment"><MoneyInput value={amount} onChange={setAmount} currency={acct?.currency ?? inv.currency} /></Field>
        </div>
        <p className="tiny muted">{inv.kind === 'loan' ? 'A loan repayment is recorded as money coming back to you — not income.' : 'This records business income on the payment date (cash basis) and reduces what the client owes.'}</p>
      </div>
    </Modal>
  );
}

export default function Clients() {
  const { fin, db, scope } = useApp();
  const [filter, setFilter] = useState<'open' | 'overdue' | 'paid' | 'all'>('open');
  const [editInv, setEditInv] = useState<Partial<Invoice> | null>(null);
  const [editClient, setEditClient] = useState<Partial<Client> | null>(null);
  const [paying, setPaying] = useState<any>(null);
  const rec = fin.receivables(scope);
  const yr = presetRange('this_year', fin.ref);
  const income = new Map(fin.byClient('all', yr).map((c) => [c.client_id, c.amount]));
  const clients = db.all<Client>('SELECT * FROM clients ORDER BY is_archived, name');
  const shown = rec.all.filter((i) => filter === 'all' ? true : filter === 'open' ? i.outstanding > 0 : filter === 'overdue' ? i.state === 'overdue' : i.state === 'paid');

  return (<>
    <PageHead title="Clients & money owed to you" sub="Invoices are receivables until paid; payments count as income on the day you receive them.">
      <button className="btn" onClick={() => setEditInv({ kind: 'loan', owner: 'personal' })}>Someone owes me</button>
      <button className="btn" onClick={() => setEditClient({})}><Icon name="plus" />Client</button>
      <button className="btn primary" onClick={() => setEditInv({ kind: 'invoice' })}><Icon name="plus" />Invoice</button>
    </PageHead>
    <div className="grid g4">
      <Stat label="Total owed to you" v={rec.total} sub={rec.loansTotal ? `Incl. ${formatMoney(rec.loansTotal, fin.base)} personal loans` : `${rec.open.length} open`} />
      <Stat label="Current" v={rec.current} sub={`Due soon ${formatMoney(rec.dueSoon, fin.base)}`} />
      <Stat label="Overdue" v={rec.overdue} tone={rec.overdue ? 'out' : undefined} sub={`${rec.overdueCount} invoice${rec.overdueCount === 1 ? '' : 's'}`} />
      <Stat label="Paid this month" v={rec.paidThisMonth} tone="in" />
    </div>
    <div className="grid g3" style={{ marginTop: 16 }}>
      <Panel title="Who owes you" flush>
        {rec.byClient.length ? <div className="list">{rec.byClient.map((c) => (
          <div key={String(c.client_id)} className="item"><div className="grow"><div className="title">{c.name}</div><div className="meta">{c.count} open{c.overdue ? <> · <span className="neg">{formatMoney(c.overdue, fin.base)} overdue</span></> : ''}</div></div><div className="amt"><Money v={c.outstanding} /></div></div>))}</div>
          : <Empty title="Nobody owes you right now" />}
      </Panel>
      <Panel title="Invoices & loans" flush className="span2" action={<div style={{ paddingRight: 18 }}><Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'open' as const, label: 'Open' }, { value: 'overdue' as const, label: 'Overdue' }, { value: 'paid' as const, label: 'Paid' }, { value: 'all' as const, label: 'All' }]} /></div>}>
        {shown.length ? <div className="list">{shown.map((i) => (
          <div key={i.id} className="item">
            <div className="grow"><div className="title ellipsis">{i.kind === 'loan' ? `Loan · ${i.client_name}` : `${i.number ?? 'Invoice'} · ${i.client_name}`} {i.is_demo ? <Chip kind="demo">Demo</Chip> : null}</div>
              <div className="meta">Issued {formatDate(i.issue_date)}{i.due_date ? ` · due ${formatDate(i.due_date)}` : ''}{i.state === 'overdue' ? ` · ${i.days_overdue} days late` : ''}{i.paid > 0 && i.outstanding > 0 ? ` · paid ${formatMoney(i.paid, i.currency)}` : ''}</div></div>
            <Chip kind={i.state}>{STATE_LABEL[i.state] ?? i.state}</Chip>
            <div className="amt"><Money v={i.outstanding > 0 ? i.outstanding : i.amount} cur={i.currency} /><span className="alt">{i.outstanding > 0 ? 'outstanding' : 'total'}</span></div>
            <div className="row" style={{ gap: 4 }}>
              {i.outstanding > 0 && <button className="btn sm" onClick={() => setPaying(i)}>Paid</button>}
              <button className="btn ghost sm" onClick={() => setEditInv(i)} aria-label="Edit"><Icon name="edit" /></button>
            </div>
          </div>))}</div> : <Empty title="Nothing here" />}
      </Panel>
    </div>
    <Panel title="Clients & contacts" flush className="">
      {clients.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th className="hide-m">Contact</th><th className="hide-m">Terms</th><th className="r">Received this year</th><th className="r">Owed now</th></tr></thead>
        <tbody>{clients.map((c) => { const owed = rec.byClient.find((b) => b.client_id === c.id)?.outstanding ?? 0; return (
          <tr key={c.id} onClick={() => setEditClient(c)} style={{ cursor: 'pointer', opacity: c.is_archived ? 0.5 : 1 }}><td><b>{c.name}</b>{c.kind !== 'client' && <span className="muted"> · {c.kind}</span>}</td><td className="hide-m">{[c.contact, c.email].filter(Boolean).join(' · ')}</td><td className="hide-m">{c.payment_terms_days != null ? `Net ${c.payment_terms_days}` : '—'}</td><td className="r">{formatMoney(income.get(c.id) ?? 0, fin.base)}</td><td className={`r ${owed ? 'neg' : ''}`}>{formatMoney(owed, fin.base)}</td></tr>); })}</tbody></table></div>
        : <Empty title="No clients yet" action={<button className="btn primary" onClick={() => setEditClient({})}>Add a client</button>} />}
    </Panel>
    {editInv && <InvoiceForm inv={editInv} onClose={() => setEditInv(null)} />}
    {editClient && <ClientForm c={editClient} onClose={() => setEditClient(null)} />}
    {paying && <RecordPayment inv={paying} onClose={() => setPaying(null)} />}
  </>);
}
