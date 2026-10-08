import { useEffect, useState, lazy, Suspense } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { loadSqlite } from './core/db';
import { Vault } from './core/vault';
import { AppProvider, useApp } from './app/context';
import { LockScreen, Onboarding, ForgotPin, type Unlocked } from './app/Gate';
import { Icon } from './ui/icons';
import { ScopeSwitch, Chip } from './ui/components';
import { TxForm } from './ui/TxForm';
import { hasDemoData } from './core/backup';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import { IncomePage, ExpensesPage } from './pages/IncomeExpenses';
import Accounts from './pages/Accounts';
import Budgets from './pages/Budgets';
import Bills from './pages/Bills';
import DebtPage from './pages/Debt';
import Savings from './pages/Savings';
import Clients from './pages/Clients';
import NetWorth from './pages/NetWorth';
import Reports from './pages/Reports';
import ImportPage from './pages/Import';
import SearchPage from './pages/Search';
import Settings from './pages/Settings';
import Azuria from './pages/Azuria';
import Alerts from './pages/Alerts';
import More from './pages/More';
import { useSystemNotifications } from './pages/Alerts';

export const NAV: { to: string; label: string; icon: string; group?: string }[] = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/azuria', label: 'Azuria', icon: 'building' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/income', label: 'Income', icon: 'in', group: 'Money flow' },
  { to: '/expenses', label: 'Expenses', icon: 'out' },
  { to: '/budgets', label: 'Budgets', icon: 'pie' },
  { to: '/bills', label: 'Bills & subscriptions', icon: 'cal' },
  { to: '/accounts', label: 'Accounts', icon: 'bank', group: 'What you have & owe' },
  { to: '/clients', label: 'Clients & invoices', icon: 'users' },
  { to: '/debt', label: 'Debt & IOUs', icon: 'debt' },
  { to: '/savings', label: 'Savings goals', icon: 'goal' },
  { to: '/networth', label: 'Net worth & health', icon: 'heart' },
  { to: '/reports', label: 'Reports', icon: 'chart', group: 'Tools' },
  { to: '/import', label: 'Import', icon: 'upload' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
];

function Shell() {
  const { lock, saveState, db, fin } = useApp();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const demo = hasDemoData(db);
  const alertCount = fin.alerts().length;
  useSystemNotifications();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  // Keyboard shortcuts on Mac: N = new transaction, / = search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || document.querySelector('.scrim')) return;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setAdding(true); }
      if (e.key === '/') { e.preventDefault(); document.getElementById('global-search')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand"><div className="brand-mark">A</div><div><b>Azuria Finance</b><span>{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved!' : 'Encrypted · saved'}</span></div></div>
        {NAV.map((n) => (
          <div key={n.to}>
            {n.group && <div className="group">{n.group}</div>}
            <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={n.icon} />{n.label}</NavLink>
          </div>
        ))}
        <div className="foot">
          <a href="#" onClick={(e) => { e.preventDefault(); lock(); }}><Icon name="lock" />Lock now</a>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <form className="search-box" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q)}`); }}>
            <Icon name="search" />
            <input id="global-search" type="search" placeholder="Search: Amazon, Peter, August 2026…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" />
          </form>
          <ScopeSwitch />
          <div className="row" style={{ marginLeft: 'auto' }}>
            {demo && <Chip kind="demo">Demo data</Chip>}
            <button className="btn ghost icon-btn" onClick={() => nav('/alerts')} aria-label={`Alerts (${alertCount})`} style={{ position: 'relative' }}>
              <Icon name="bell" />
              {alertCount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--spend)', color: '#fff', fontSize: 10.5, display: 'grid', placeItems: 'center', padding: '0 4px', fontWeight: 600 }}>{alertCount > 99 ? '99+' : alertCount}</span>}
            </button>
            <button className="btn ghost icon-btn hide-d" onClick={() => lock()} aria-label="Lock"><Icon name="lock" /></button>
            <button className="btn primary hide-m" onClick={() => setAdding(true)}><Icon name="plus" />New transaction</button>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/azuria" element={<Azuria />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/income" element={<IncomePage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/debt" element={<DebtPage />} />
            <Route path="/savings" element={<Savings />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/networth" element={<NetWorth />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
      <nav className="tabbar" aria-label="Quick">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="home" />Home</NavLink>
        <NavLink to="/transactions" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="list" />Activity</NavLink>
        <button onClick={() => setAdding(true)} aria-label="New transaction"><span className="add"><Icon name="plus" /></span></button>
        <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="bank" />Accounts</NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="more" />More</NavLink>
      </nav>
      {adding && <TxForm onClose={() => setAdding(false)} />}
    </div>
  );
}

type Phase = { k: 'loading' } | { k: 'new' } | { k: 'locked' } | { k: 'forgot' } | { k: 'open'; u: Unlocked } | { k: 'error'; msg: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  useEffect(() => {
    (async () => {
      try {
        const wasm = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
        await loadSqlite(() => wasm);
        if (!window.crypto?.subtle) throw new Error('This browser does not support the encryption this app requires. Use Safari or Chrome over HTTPS.');
        setPhase((await Vault.exists()) ? { k: 'locked' } : { k: 'new' });
      } catch (e: any) { setPhase({ k: 'error', msg: e?.message ?? String(e) }); }
    })();
  }, []);

  if (phase.k === 'loading') return <div className="gate"><p style={{ color: '#a9b8d0' }}>Loading…</p></div>;
  if (phase.k === 'error') return <div className="gate"><div className="gate-card"><h1>Can’t start</h1><p>{phase.msg}</p></div></div>;
  if (phase.k === 'new') return <Onboarding onUnlock={(u) => setPhase({ k: 'open', u })} />;
  if (phase.k === 'locked') return <LockScreen onUnlock={(u) => setPhase({ k: 'open', u })} onReset={() => setPhase({ k: 'forgot' })} />;
  if (phase.k === 'forgot') return <ForgotPin onBack={() => setPhase({ k: 'locked' })} onDone={() => setPhase({ k: 'new' })} />;
  const { db, vault } = phase.u;
  return (
    <AppProvider db={db} vault={vault} onLock={() => { db.close(); setPhase({ k: 'locked' }); }}>
      <HashRouter><Shell /></HashRouter>
    </AppProvider>
  );
}

export { lazy, Suspense };
