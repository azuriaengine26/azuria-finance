import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Empty, Stat, Money, Chip } from '../ui/components';
import { TxForm } from '../ui/TxForm';
import { globalSearch } from '../core/search';
import { formatDate } from '../core/dates';
import { formatMoney } from '../core/money';

export default function SearchPage() {
  const { db, fin } = useApp();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [open, setOpen] = useState<number | null>(null);
  const res = useMemo(() => globalSearch(db, q), [q, fin]);
  const tx = res.transactions.filter((t: any) => t.status !== 'cancelled');
  const sum = (k: string) => tx.filter((t: any) => t.kind === k && t.status === 'cleared').reduce((s: number, t: any) => s + fin.conv(t.amount, t.currency), 0);
  const total = tx.length + res.clients.length + res.invoices.length + res.accounts.length + res.debts.length;

  return (<>
    <PageHead title={q ? `“${q}”` : 'Search'} sub={res.period ? `All activity in ${res.period.label}` : `${total} results across transactions, clients, invoices, accounts and debts`} />
    {!q && <Panel><Empty title="Search everything">Try a merchant (Amazon), a person (Peter), an amount (500) or a month (August 2026).</Empty></Panel>}
    {q && (<>
      {tx.length > 0 && <div className="grid g3" style={{ marginBottom: 16 }}><Stat label="Money in" v={sum('income')} tone="in" /><Stat label="Money out" v={sum('expense')} tone="out" /><Stat label="Transactions" sub={res.period ? `${res.period.from} – ${res.period.to}` : 'Completed amounts only in totals'}><div className="val">{tx.length}</div></Stat></div>}
      {(res.clients.length > 0 || res.accounts.length > 0 || res.debts.length > 0) && (
        <Panel title="People, accounts & debts" flush>
          <div className="list">
            {res.clients.map((c: any) => <Link key={'c' + c.id} to="/clients" className="item"><div className="grow"><div className="title">{c.name}</div><div className="meta">{c.kind} {c.company ? '· ' + c.company : ''}</div></div></Link>)}
            {res.accounts.map((a: any) => <Link key={'a' + a.id} to="/accounts" className="item"><div className="grow"><div className="title">{a.name}</div><div className="meta">Account · {a.institution ?? a.type}</div></div><div className="amt"><Money v={fin.balances().get(a.id) ?? 0} cur={a.currency} /></div></Link>)}
            {res.debts.map((d: any) => <Link key={'d' + d.id} to="/debt" className="item"><div className="grow"><div className="title">{d.name}</div><div className="meta">Debt · {d.creditor}</div></div></Link>)}
          </div>
        </Panel>
      )}
      {res.invoices.length > 0 && <Panel title="Invoices & loans" flush className=""><div className="list">{res.invoices.map((i: any) => { const s = fin.invoiceState(i, fin.ref); return <Link key={i.id} to="/clients" className="item"><div className="grow"><div className="title">{i.number ?? 'Loan'} · {i.client_name}</div><div className="meta">Issued {formatDate(i.issue_date)}</div></div><Chip kind={s.state}>{s.state.replace('_', ' ')}</Chip><div className="amt"><Money v={i.amount} cur={i.currency} /></div></Link>; })}</div></Panel>}
      <Panel title={`Transactions (${tx.length}${tx.length === 200 ? '+' : ''})`} flush className="">
        {tx.length ? <div className="list">{tx.map((t: any) => (
          <button key={t.id} className="item" onClick={() => setOpen(t.id)}>
            <div className="grow"><div className="title ellipsis">{t.payee || t.description || t.category_name || 'Transfer'}</div><div className="meta">{formatDate(t.date)} · {t.kind === 'transfer' ? `${t.account_name ?? 'external'} → ${t.to_account_name ?? 'external'}` : `${t.category_name ?? 'Uncategorized'} · ${t.account_name ?? ''}`}{t.client_name ? ` · ${t.client_name}` : ''}{t.status !== 'cleared' ? ` · ${t.status}` : ''}</div></div>
            <div className="amt"><span className={`num ${t.kind === 'income' ? 'pos' : ''}`}>{t.kind === 'expense' ? '−' : t.kind === 'income' ? '+' : ''}{formatMoney(t.amount, t.currency)}</span></div>
          </button>))}</div> : <Empty title="No transactions found" />}
      </Panel>
    </>)}
    {open && <TxForm tx={db.get('SELECT * FROM transactions WHERE id = ?', [open]) as any} onClose={() => setOpen(null)} />}
  </>);
}
