import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Field, Text, Select, Check, Segmented, Modal, Confirm, CurrencySelect, DateInput, Chip, Empty, download } from '../ui/components';
import { saveRate, saveCategory, deleteCategory, restoreTransaction, purgeTransaction } from '../core/repo';
import { exportJSON, restoreJSON, validateBackup, transactionsCSV, deleteDemoData, hasDemoData, TABLES } from '../core/backup';
import { loadDemoData } from '../core/demo';
import { Vault, validatePin, KDF_ITERATIONS, WrongPinError } from '../core/vault';
import { biometricStatus, enrollBiometric, disableBiometric, biometricErrorMessage, type BiometricStatus } from '../app/biometric';
import { Db } from '../core/db';
import { today, formatDate } from '../core/dates';
import { formatMoney, CURRENCIES } from '../core/money';
import type { Category, Owner } from '../core/types';
import { Icon } from '../ui/icons';

const NOTIFY = [
  ['notify_bills', 'Upcoming and overdue bills'], ['notify_debt', 'Upcoming debt payments'], ['notify_invoices', 'Overdue invoices'],
  ['notify_unusual', 'Unusually large expenses'], ['notify_budget', 'Budgets almost used or exceeded'], ['notify_subscriptions', 'Subscription renewals'],
  ['notify_low_balance', 'Low account balance'], ['notify_goals', 'Savings goal milestones'],
];

function CategoryEditor() {
  const { db, fin, act } = useApp();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [owner, setOwner] = useState<Owner>('personal');
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const cats = fin.categories.filter((c) => c.kind === kind && (c.owner === owner || c.owner === 'both') && (showArchived || !c.is_archived));
  const parents = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const usage = new Map(db.all<{ category_id: number; n: number }>('SELECT category_id, COUNT(*) n FROM transactions WHERE deleted_at IS NULL GROUP BY category_id').map((r) => [r.category_id, r.n]));
  return (
    <Panel title="Categories" action={<button className="btn sm" onClick={() => setEdit({ kind, owner })}><Icon name="plus" />Add</button>}>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'expense' as const, label: 'Expenses' }, { value: 'income' as const, label: 'Income' }]} />
        <Segmented label="Owner" value={owner} onChange={setOwner} options={[{ value: 'personal' as Owner, label: 'Personal' }, { value: 'business' as Owner, label: 'Business' }]} />
        <Check checked={showArchived} onChange={setShowArchived}>Show archived</Check>
      </div>
      <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
        {parents.map((p) => (
          <div key={p.id}>
            <button className="item" onClick={() => setEdit(p)}><span className="dot" style={{ background: p.color ?? '#9a8a78', width: 14, height: 14, borderRadius: 4 }} /><span className="grow title">{p.name} {p.is_archived ? <Chip>Archived</Chip> : null}</span><span className="meta">{usage.get(p.id) ?? 0} uses{p.tax_category ? ` · tax: ${p.tax_category}` : ''}</span></button>
            {cats.filter((c) => c.parent_id === p.id).map((s) => <button key={s.id} className="item" style={{ paddingLeft: 46 }} onClick={() => setEdit(s)}><span className="grow">{s.name}</span><span className="meta">{usage.get(s.id) ?? 0} uses</span></button>)}
          </div>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'New category'} onClose={() => setEdit(null)} footer={<>
          {edit.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { const r = act(() => deleteCategory(db, edit.id!)); if (r) setEdit(null); }}>{(usage.get(edit.id) ?? 0) > 0 ? 'Archive' : 'Delete'}</button>}
          {edit.id && edit.is_archived ? <button className="btn" onClick={() => { act(() => db.update('categories', edit.id!, { is_archived: 0 }), 'Restored'); setEdit(null); }}>Unarchive</button> : null}
          <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn primary" onClick={() => { if (act(() => saveCategory(db, edit), 'Category saved') !== undefined) setEdit(null); }}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name"><Text value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
            <Field label="Subcategory of"><Select value={edit.parent_id} onChange={(v) => setEdit({ ...edit, parent_id: v })} options={parents.filter((p) => p.id !== edit.id).map((p) => ({ value: p.id, label: p.name }))} placeholder="None (top level)" /></Field>
            <Field label="Colour"><input type="color" className="input" value={edit.color ?? '#b8934e'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            {kind === 'expense' && <Field label="Tax category"><Text value={edit.tax_category} onChange={(v) => setEdit({ ...edit, tax_category: v })} placeholder="e.g. Office expense" /></Field>}
            {kind === 'expense' && <div className="full"><Check checked={edit.deductible_default === 1} onChange={(v) => setEdit({ ...edit, deductible_default: v ? 1 : null })}>Usually tax-deductible (can be changed per transaction)</Check></div>}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function RatesEditor() {
  const { db, fin, act } = useApp();
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('HNL');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(today());
  const rows = db.all<any>('SELECT * FROM exchange_rates ORDER BY date DESC, base, quote LIMIT 30');
  return (
    <Panel title="Currencies & exchange rates">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', alignItems: 'end' }}>
        <Field label="1 unit of"><Select value={base} onChange={(v) => setBase(v ?? 'USD')} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code }))} /></Field>
        <Field label="equals"><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(',', '.'))} placeholder={fin.rates['USD>HNL'] ?? '26.20'} /></Field>
        <Field label="of"><Select value={quote} onChange={(v) => setQuote(v ?? 'HNL')} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code }))} /></Field>
        <Field label="As of"><DateInput value={date} onChange={setDate} /></Field>
        <button className="btn primary" onClick={() => { if (act(() => saveRate(db, base, quote, rate, date), 'Rate saved') !== undefined) setRate(''); }}>Save rate</button>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Rates are entered by you — the app never goes online to fetch them. The latest rate is used to convert totals; every transaction keeps its original amount and currency. For lempiras, the Banco Central de Honduras publishes a daily reference rate.</p>
      <div className="tbl-wrap" style={{ marginTop: 12 }}><table className="tbl"><thead><tr><th>Date</th><th>Rate</th><th>Source</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{formatDate(r.date)}</td><td className="num">1 {r.base} = {r.rate} {r.quote}</td><td>{r.source === 'demo' ? <Chip kind="demo">Demo — replace</Chip> : r.source}</td><td className="r"><button className="btn ghost sm danger" onClick={() => act(() => db.run('DELETE FROM exchange_rates WHERE id = ?', [r.id]), 'Rate removed')}>Remove</button></td></tr>)}</tbody></table></div>
    </Panel>
  );
}

function Security() {
  const { db, vault, act, toast, setting, updateSetting, lock } = useApp();
  const [show, setShow] = useState(false);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<BiometricStatus>({ available: false, enrolled: false, reason: 'checking' });
  const [bioPin, setBioPin] = useState<string | null>(null);
  useEffect(() => { biometricStatus().then(setBio); }, []);
  const turnOnBio = async () => {
    if (!bioPin) return;
    setBusy(true);
    try {
      await Vault.unlock(bioPin); // confirms the PIN before it is stored behind the fingerprint
      await enrollBiometric(bioPin);
      setBioPin(null);
      setBio(await biometricStatus());
      toast('Fingerprint unlock is on');
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') toast({ msg: e instanceof WrongPinError ? 'That PIN isn’t right.' : biometricErrorMessage(e) ?? e.message, tone: 'bad' });
    } finally { setBusy(false); }
  };
  const turnOffBio = async () => { await disableBiometric(); setBio(await biometricStatus()); toast('Fingerprint unlock is off'); };
  const change = async () => {
    setBusy(true);
    try {
      await Vault.unlock(current); // verifies the current PIN
      await vault.changePin(p1, db.export());
      if (bio.enrolled) {
        // Fingerprint unlock stores the PIN, so it has to be re-confirmed with the new one.
        try { await enrollBiometric(p1); toast('PIN changed. Fingerprint unlock now uses the new PIN. Older encrypted backup files still need the old PIN.'); }
        catch { await disableBiometric(); toast({ msg: 'PIN changed. Fingerprint unlock was turned off — turn it on again below.', tone: 'bad' }); }
        setBio(await biometricStatus());
      } else toast('PIN changed. Older encrypted backup files still need the old PIN.');
      setShow(false); setP1(''); setP2(''); setCurrent('');
    } catch (e: any) { toast({ msg: e.message, tone: 'bad' }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Security">
      <div className="stack">
        <div className="notice"><Icon name="lock" /><span>All data — including receipts — is stored encrypted on this device with AES-256-GCM. The key comes from your PIN through PBKDF2-SHA256 ({KDF_ITERATIONS.toLocaleString()} rounds) and exists only in memory while unlocked. Nothing is sent to any server, and there is no PIN recovery.</span></div>
        <Field label="Lock automatically after"><Select value={setting('auto_lock_minutes', '5')} onChange={(v) => updateSetting('auto_lock_minutes', v ?? '5')} options={[['1', '1 minute'], ['2', '2 minutes'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['0', 'Never (not recommended)']].map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <div className="row wrap"><button className="btn" onClick={() => setShow(true)}>Change PIN</button><button className="btn" onClick={() => lock()}><Icon name="lock" />Lock now</button></div>
        <div className="panel" style={{ background: 'var(--surface-2)' }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <h3 className="row" style={{ gap: 8 }}><Icon name="fingerprint" size={20} />Fingerprint unlock</h3>
              <p className="small muted" style={{ marginTop: 4 }}>
                {bio.enrolled ? 'On. Your PIN is locked inside this phone’s security chip and only released by your fingerprint.'
                  : bio.available ? 'Unlock with your fingerprint instead of typing your PIN. Your PIN is stored in this phone’s security chip and only released after a fingerprint scan.'
                  : bio.reason === 'none_enrolled' ? 'Add a fingerprint in your phone’s Settings → Security and privacy → Biometrics first.'
                  : bio.reason === 'checking' ? 'Checking…'
                  : 'Available in the Android app on phones with a fingerprint sensor. Face ID for iPhone and Touch ID for Mac are not in this version yet.'}
              </p>
            </div>
            {bio.enrolled ? <button className="btn" onClick={turnOffBio}>Turn off</button>
              : bio.available ? <button className="btn primary" onClick={() => setBioPin('')}>Turn on</button> : null}
          </div>
          {bioPin !== null && !bio.enrolled && (
            <div className="stack" style={{ marginTop: 12 }}>
              <Field label="Enter your PIN to confirm"><input className="input" type="password" autoComplete="current-password" value={bioPin} onChange={(e) => setBioPin(e.target.value)} /></Field>
              <div className="row"><button className="btn" onClick={() => setBioPin(null)}>Cancel</button><button className="btn primary" disabled={busy || !bioPin} onClick={turnOnBio}>{busy ? 'Waiting for fingerprint…' : 'Continue'}</button></div>
            </div>
          )}
        </div>
      </div>
      {show && <Modal title="Change PIN" onClose={() => setShow(false)} footer={<><button className="btn" onClick={() => setShow(false)}>Cancel</button><button className="btn primary" disabled={busy || !current || !p1 || p1 !== p2 || !!validatePin(p1)} onClick={change}>{busy ? 'Re-encrypting…' : 'Change PIN'}</button></>}>
        <div className="stack">
          <Field label="Current PIN"><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New PIN" hint={p1 ? validatePin(p1) ?? 'Looks good' : 'At least 6 characters'}><input className="input" type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat new PIN" hint={p2 && p1 !== p2 ? 'Doesn’t match' : undefined}><input className="input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
        </div>
      </Modal>}
    </Panel>
  );
}

function Backup() {
  const { db, vault, toast, snapshot, act } = useApp();
  const [snaps, setSnaps] = useState<{ id: string; created: string; note: string; size: number }[]>([]);
  const [restoreFile, setRestoreFile] = useState<{ name: string; text: string } | null>(null);
  const [filePin, setFilePin] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [restoreSnap, setRestoreSnap] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | undefined>();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const refresh = () => { vault.listSnapshots().then(setSnaps); Vault.lastSaved().then(setLastSaved); };
  useEffect(() => { refresh(); navigator.storage?.persisted?.().then(setPersisted).catch(() => {}); }, []);
  const stamp = today();

  const applyBytes = async (bytes: Uint8Array, label: string) => {
    const incoming = await Db.create(bytes); // validates & migrates
    const json = exportJSON(incoming);
    incoming.close();
    await snapshot(`Before restoring ${label}`);
    restoreJSON(db, json);
    toast(`Restored from ${label}. A restore point of your previous data was saved.`);
    refresh();
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    try {
      if (restoreFile.text.includes('"encrypted-backup"')) await applyBytes(await Vault.decryptBackupFile(restoreFile.text, filePin), restoreFile.name);
      else {
        const v = validateBackup(restoreFile.text);
        if (!v.ok) throw new Error(v.error);
        await snapshot(`Before restoring ${restoreFile.name}`);
        restoreJSON(db, restoreFile.text);
        toast('Backup restored. A restore point of your previous data was saved.');
        refresh();
      }
      setRestoreFile(null); setConfirmWord(''); setFilePin('');
    } catch (e: any) { toast({ msg: e.message, tone: 'bad' }); }
  };

  const exportAllExcel = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    for (const t of TABLES.filter((t) => !['attachments', 'audit_log', 'settings'].includes(t))) {
      const rows = db.all(`SELECT * FROM ${t}`);
      const ws = wb.addWorksheet(t);
      if (!rows.length) continue;
      ws.addRow(Object.keys(rows[0])).font = { bold: true };
      for (const r of rows) ws.addRow(Object.values(r));
    }
    wb.addWorksheet('README').addRow(['Amounts are stored in minor units (cents/centavos): divide by 100. Liability account balances are negative.']);
    download(`azuria-finance-all-data-${stamp}.xlsx`, await wb.xlsx.writeBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <Panel title="Backup & restore">
      <div className="stack">
        <div className="small muted">Last saved on this device: {lastSaved ? new Date(lastSaved).toLocaleString() : '—'} · Storage {persisted ? 'protected from automatic clean-up' : 'may be cleared by the browser if space runs low — install the app to your Home Screen / Dock and keep backups'}.</div>
        <div className="row wrap">
          <button className="btn primary" onClick={async () => download(`azuria-finance-${stamp}.encrypted.json`, await vault.exportEncrypted(db.export()), 'application/json')}><Icon name="download" />Encrypted backup</button>
          <button className="btn" onClick={() => download(`azuria-finance-${stamp}.readable.json`, exportJSON(db), 'application/json')}><Icon name="download" />JSON backup (not encrypted)</button>
          <button className="btn" onClick={() => download(`transactions-${stamp}.csv`, transactionsCSV(db), 'text/csv')}><Icon name="download" />Transactions CSV</button>
          <button className="btn" onClick={() => act(() => { exportAllExcel(); })}><Icon name="download" />Everything as Excel</button>
        </div>
        <p className="small muted">Keep a recent encrypted backup somewhere safe (iCloud Drive, a USB drive). It opens only with the PIN you have when you create it. JSON and CSV files are readable by anyone who gets them.</p>
        <label className="btn" style={{ alignSelf: 'flex-start' }}><Icon name="upload" />Restore from a backup file…<input type="file" hidden accept=".azfin,.json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRestoreFile({ name: f.name, text: await f.text() }); e.target.value = ''; }} /></label>

        <h3 style={{ marginTop: 8 }}>Restore points on this device</h3>
        <p className="small muted">Saved automatically once a day and before imports, restores and deleting demo data. The newest 12 are kept, encrypted.</p>
        {snaps.length ? <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>{snaps.map((s) => (
          <div key={s.id} className="item"><div className="grow"><div className="title">{new Date(s.created).toLocaleString()}</div><div className="meta">{s.note} · {Math.round(s.size / 1024)} KB</div></div><button className="btn sm" onClick={() => setRestoreSnap(s.id)}>Restore</button></div>))}</div>
          : <p className="small muted">None yet.</p>}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { await snapshot('Manual restore point'); refresh(); toast('Restore point saved'); }}>Save a restore point now</button>
      </div>
      {restoreFile && (
        <Modal title="Replace all data?" onClose={() => setRestoreFile(null)} footer={<><button className="btn" onClick={() => setRestoreFile(null)}>Cancel</button><button className="btn danger solid" disabled={confirmWord !== 'RESTORE'} onClick={doRestore}>Replace my data</button></>}>
          <div className="stack">
            <p>Restoring <b>{restoreFile.name}</b> replaces everything currently in the app. A restore point of your current data is saved first, so you can go back.</p>
            {restoreFile.text.includes('"encrypted-backup"') && <Field label="PIN used when this backup was made"><input className="input" type="password" value={filePin} onChange={(e) => setFilePin(e.target.value)} /></Field>}
            {(() => { const v = restoreFile.text.includes('"encrypted-backup"') ? null : validateBackup(restoreFile.text); return v && (v.ok ? <p className="small muted">Contains {v.counts.transactions} transactions, {v.counts.accounts} accounts, {v.counts.invoices} invoices.</p> : <p className="neg small">{v.error}</p>); })()}
            <Field label="Type RESTORE to confirm"><input className="input" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
      {restoreSnap && <Confirm title="Restore this point?" confirmLabel="Restore" danger onClose={() => setRestoreSnap(null)} onConfirm={async () => { try { await applyBytes(await vault.readSnapshot(restoreSnap), 'a restore point'); } catch (e: any) { toast({ msg: e.message, tone: 'bad' }); } }}>
        <p>Your current data will be replaced by this restore point. A restore point of the current state is saved first.</p>
      </Confirm>}
    </Panel>
  );
}

function DataTools() {
  const { db, act, snapshot, toast, fin } = useApp();
  const [confirm, setConfirm] = useState<'demo' | 'load' | 'erase' | null>(null);
  const [eraseWord, setEraseWord] = useState('');
  const demo = hasDemoData(db);
  const trash = db.all<any>('SELECT * FROM transactions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50');
  return (<>
    <Panel title="Demo data">
      {demo ? <div className="stack"><p className="small">Demo accounts, clients and transactions are marked “demo”. Removing them keeps anything you created yourself (unless you added it to a demo account).</p><button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm('demo')}>Delete all demo data</button></div>
        : <div className="stack"><p className="small muted">No demo data. You can load sample data to explore; it can be removed again in one step.</p><button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm('load')}>Load demo data</button></div>}
    </Panel>
    <Panel title="Recently deleted" flush>
      {trash.length ? <div className="list">{trash.map((t) => (
        <div key={t.id} className="item"><div className="grow"><div className="title">{t.payee || t.description || t.kind}</div><div className="meta">{formatDate(t.date)} · deleted {t.deleted_at} UTC</div></div><div className="amt">{formatMoney(t.amount, t.currency)}</div>
          <button className="btn sm" onClick={() => act(() => restoreTransaction(db, t.id), 'Restored')}>Restore</button>
          <button className="btn ghost sm danger" onClick={() => act(() => purgeTransaction(db, t.id), 'Permanently deleted')}>Delete forever</button></div>))}</div>
        : <Empty title="Nothing deleted">Deleted transactions stay here until you remove them for good.</Empty>}
    </Panel>
    <Panel title="Erase this device">
      <div className="stack"><p className="small">Permanently removes all data, restore points and the PIN from this device. Export a backup first.</p><button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm('erase')}>Erase everything…</button></div>
    </Panel>
    {confirm === 'demo' && <Confirm title="Delete demo data?" confirmLabel="Delete demo data" danger onClose={() => setConfirm(null)} onConfirm={async () => { await snapshot('Before deleting demo data'); act(() => deleteDemoData(db), 'Demo data deleted — a restore point was saved first'); }}><p>All demo accounts, clients, invoices, debts, goals, budgets and their transactions will be removed. Categories and settings stay.</p></Confirm>}
    {confirm === 'load' && <Confirm title="Load demo data?" confirmLabel="Load demo data" onClose={() => setConfirm(null)} onConfirm={() => act(() => loadDemoData(db), 'Demo data loaded')}><p>Adds a year of sample activity, clearly marked as demo.</p></Confirm>}
    {confirm === 'erase' && <Modal title="Erase everything on this device" onClose={() => setConfirm(null)} footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn danger solid" disabled={eraseWord !== 'ERASE'} onClick={async () => { await Vault.eraseEverything(); location.reload(); }}>Erase</button></>}>
      <div className="stack"><p>This can’t be undone. Type ERASE to confirm.</p><input className="input" value={eraseWord} onChange={(e) => setEraseWord(e.target.value)} /></div></Modal>}
    <p className="tiny muted">{fin.tx.length} transactions · schema v{db.version} · integrity {db.integrityCheck()}</p>
  </>);
}

export default function Settings() {
  const { setting, updateSetting } = useApp();
  const [tab, setTab] = useState(() => (location.hash.includes('notifications') ? 'notify' : 'prefs'));
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const toggle = (k: string) => <Check checked={setting(k, '1') === '1'} onChange={(v) => updateSetting(k, v ? '1' : '0')}>{NOTIFY.find((n) => n[0] === k)?.[1]}</Check>;
  return (<>
    <PageHead title="Settings" />
    <div style={{ marginBottom: 16, overflowX: 'auto' }}>
      <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: 'prefs', label: 'Preferences' }, { value: 'cats', label: 'Categories' }, { value: 'fx', label: 'Currencies' }, { value: 'security', label: 'Security' }, { value: 'notify', label: 'Notifications' }, { value: 'backup', label: 'Backup' }, { value: 'data', label: 'Data' }]} />
    </div>
    {tab === 'prefs' && <Panel title="Preferences">
      <div className="form-grid">
        <Field label="Main currency" hint="Totals and charts are shown in this currency"><CurrencySelect value={setting('base_currency', 'USD')} onChange={(v) => updateSetting('base_currency', v)} /></Field>
        <Field label="Also show amounts in"><Select value={setting('show_secondary', '1') === '1' ? setting('secondary_currency', 'HNL') : ''} onChange={(v) => { updateSetting('show_secondary', v ? '1' : '0'); if (v) updateSetting('secondary_currency', v); }} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code }))} placeholder="Don’t show a second currency" /></Field>
        <Field label="Business name"><Text value={setting('business_name', 'Azuria Engine')} onChange={(v) => updateSetting('business_name', v)} /></Field>
        <Field label="Appearance"><Segmented label="Theme" value={setting('theme', 'dark')} onChange={(v) => updateSetting('theme', v)} options={[{ value: 'dark', label: 'Azuria (dark)' }, { value: 'light', label: 'Ivory (light)' }, { value: 'system', label: 'Match device' }]} /></Field>
        <Field label="Date format in imported files"><Select value={setting('date_order', 'MDY')} onChange={(v) => updateSetting('date_order', v ?? 'MDY')} options={[{ value: 'MDY', label: 'Month/Day/Year' }, { value: 'DMY', label: 'Day/Month/Year' }]} /></Field>
        <div className="full stack" style={{ gap: 6 }}>
          <Check checked={setting('owner_draws_as_personal_income', '1') === '1'} onChange={(v) => updateSetting('owner_draws_as_personal_income', v ? '1' : '0')}>Count owner draws from the business as personal income</Check>
          <p className="small muted">When you pay yourself from Azuria, the business never records it as an expense. With this on, the Personal view treats it as income (useful if draws are how you get paid). The combined view never counts it, so nothing is double-counted.</p>
        </div>
      </div>
    </Panel>}
    {tab === 'cats' && <CategoryEditor />}
    {tab === 'fx' && <RatesEditor />}
    {tab === 'security' && <Security />}
    {tab === 'notify' && <Panel title="Notifications">
      <div className="stack">
        <div className="grid g2" style={{ gap: 10 }}>{NOTIFY.map(([k]) => <div key={k}>{toggle(k)}</div>)}</div>
        <div className="form-grid">
          <Field label="Warn about bills due within"><Select value={setting('bill_lookahead_days', '14')} onChange={(v) => updateSetting('bill_lookahead_days', v ?? '14')} options={['3', '7', '14', '30'].map((v) => ({ value: v, label: `${v} days` }))} /></Field>
          <Field label="“Unusual” means an expense at least"><Select value={setting('unusual_expense_multiplier', '3')} onChange={(v) => updateSetting('unusual_expense_multiplier', v ?? '3')} options={['2', '3', '5'].map((v) => ({ value: v, label: `${v}× the usual amount for its category` }))} /></Field>
        </div>
        <h3>System notifications</h3>
        {perm === 'unsupported' ? <p className="small muted">This browser doesn’t support notifications. On iPhone they work once the app is added to the Home Screen (iOS 16.4+).</p> : <>
          <Check checked={setting('system_notifications', '0') === '1' && perm === 'granted'} onChange={async (v) => { if (v && perm !== 'granted') { const p = await Notification.requestPermission(); setPerm(p); if (p !== 'granted') return; } updateSetting('system_notifications', v ? '1' : '0'); }}>Show alerts as system notifications when I open the app</Check>
          <p className="small muted">Honest limitation: because no server ever sees your data, nothing can wake the app to notify you while it’s closed. Alerts are checked each time you open or unlock it, and always appear on the Alerts screen. Scheduled reminders while closed need the native iPhone build (local notifications) — see the README.</p>
        </>}
      </div>
    </Panel>}
    {tab === 'backup' && <Backup />}
    {tab === 'data' && <DataTools />}
  </>);
}
