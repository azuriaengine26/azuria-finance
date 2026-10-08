import { useEffect, useState } from 'react';
import { Db } from '../core/db';
import { Vault, validatePin, lockoutRemaining, WrongPinError } from '../core/vault';
import { seedDefaults } from '../core/seed';
import { loadDemoData } from '../core/demo';
import { generateRecurring } from '../core/repo';
import { restoreJSON } from '../core/backup';

export type Unlocked = { db: Db; vault: Vault };

function BrandMark() {
  return <div className="row" style={{ gap: 12 }}><div className="brand-mark" style={{ width: 40, height: 40, fontSize: 19 }}>A</div><div><b style={{ color: '#fff', fontSize: 17 }}>Azuria Finance</b><div style={{ color: '#a9b8d0', fontSize: 13 }}>Personal + business money, on your device</div></div></div>;
}

async function openDb(bytes: Uint8Array): Promise<Db> {
  const db = await Db.create(bytes);
  seedDefaults(db); // adds any new default settings after an update
  if (db.integrityCheck() !== 'ok') throw new Error('Your data failed an integrity check. Restore a recent restore point or backup from Settings.');
  generateRecurring(db);
  return db;
}

export function LockScreen({ onUnlock, onReset }: { onUnlock: (u: Unlocked) => void; onReset: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(lockoutRemaining());
  useEffect(() => { if (wait <= 0) return; const t = setInterval(() => setWait(lockoutRemaining()), 1000); return () => clearInterval(t); }, [wait > 0]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { vault, data } = await Vault.unlock(pin);
      const db = await openDb(data);
      vault.dailySnapshot(db.export()).catch(() => {});
      onUnlock({ db, vault });
    } catch (e: any) {
      setErr(e instanceof WrongPinError ? 'That PIN didn’t unlock your data. Try again.' : e.message);
      setWait(lockoutRemaining());
      setPin('');
    } finally { setBusy(false); }
  };
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <BrandMark />
        <h1>Unlock</h1>
        <p>Your data is encrypted on this device. Enter your PIN or passcode.</p>
        <input className="input" type="password" autoComplete="current-password" inputMode="text" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN or passcode" disabled={busy || wait > 0} />
        {err && <div className="err" role="alert">{err}</div>}
        {wait > 0 && <div className="err">Too many attempts — wait {Math.ceil(wait / 1000)}s.</div>}
        <button className="btn primary" disabled={busy || !pin || wait > 0}>{busy ? 'Decrypting…' : 'Unlock'}</button>
        <button type="button" className="btn" onClick={onReset}>Forgot PIN?</button>
      </form>
    </div>
  );
}

export function ForgotPin({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  return (
    <div className="gate">
      <div className="gate-card">
        <BrandMark />
        <h1>Forgot your PIN?</h1>
        <p>There is no recovery: your PIN is the encryption key, and nobody — including this app — can decrypt your data without it.</p>
        <p>You can erase the data on this device and start again, then restore from a backup file (an encrypted backup needs the PIN it was made with; a JSON backup does not).</p>
        <label className="stack" style={{ gap: 6 }}><span style={{ color: '#dce4f0' }}>Type ERASE to confirm</span><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <button className="btn danger solid" disabled={confirm !== 'ERASE'} onClick={async () => { await Vault.eraseEverything(); onDone(); }}>Erase this device’s data</button>
        <button className="btn" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

export function Onboarding({ onUnlock }: { onUnlock: (u: Unlocked) => void }) {
  const [step, setStep] = useState<'intro' | 'pin' | 'start'>('intro');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [mode, setMode] = useState<'demo' | 'empty' | 'restore'>('demo');
  const [file, setFile] = useState<File | null>(null);
  const [filePin, setFilePin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pinErr = pin ? validatePin(pin) : null;

  const finish = async () => {
    setBusy(true); setErr('');
    try {
      let db: Db;
      if (mode === 'restore') {
        if (!file) throw new Error('Choose a backup file');
        const text = await file.text();
        if (text.includes('"encrypted-backup"')) db = await Db.create(await Vault.decryptBackupFile(text, filePin));
        else { db = await Db.create(); restoreJSON(db, text); }
        seedDefaults(db);
      } else {
        db = await Db.create();
        seedDefaults(db);
        if (mode === 'demo') loadDemoData(db);
      }
      generateRecurring(db);
      const vault = await Vault.create(pin, db.export());
      try { await navigator.storage?.persist?.(); } catch { /* optional */ }
      onUnlock({ db, vault });
    } catch (e: any) {
      setErr(e instanceof WrongPinError ? 'That PIN doesn’t open this backup file.' : e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <BrandMark />
        {step === 'intro' && (<>
          <h1>One place for every dollar and lempira</h1>
          <p>Track personal and Azuria business money separately, with a combined picture whenever you want it.</p>
          <ul style={{ color: '#c9d3e3', paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li>Your data stays on this device, encrypted with a PIN only you know.</li>
            <li>Nothing is sent to any server. No bank passwords are ever asked for.</li>
            <li>Import bank statements (CSV, Excel, OFX) whenever you like.</li>
          </ul>
          {import.meta.env.MODE === 'single' && <p style={{ fontSize: 13.5, border: '1px solid #2a3c5c', borderRadius: 10, padding: '10px 12px' }}>Viewing this inside Claude? It’s a live preview: everything works except file downloads (exports and backups), which the preview window blocks. For your real finances, use your installed copy so you can make backups.</p>}
          <button className="btn primary" onClick={() => setStep('pin')}>Set up</button>
        </>)}
        {step === 'pin' && (<>
          <h1>Create a PIN or passcode</h1>
          <p>At least 6 characters. A longer passphrase is stronger. If you lose it, the data can’t be recovered — you’ll be able to export backups from Settings.</p>
          <input className="input" type="password" autoComplete="new-password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="New PIN" placeholder="PIN" />
          <input className="input" type="password" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value)} aria-label="Repeat PIN" placeholder="Repeat PIN" />
          {pinErr && <div className="err">{pinErr}</div>}
          {pin2 && pin !== pin2 && <div className="err">The two entries don’t match.</div>}
          <button className="btn primary" disabled={!pin || !!pinErr || pin !== pin2} onClick={() => setStep('start')}>Continue</button>
        </>)}
        {step === 'start' && (<>
          <h1>How do you want to start?</h1>
          <div className="stack" style={{ gap: 10 }}>
            <button type="button" className="choice" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}><b>Explore with demo data</b><span>A year of sample activity, clearly marked. Delete it in one tap when you’re ready.</span></button>
            <button type="button" className="choice" aria-pressed={mode === 'empty'} onClick={() => setMode('empty')}><b>Start fresh</b><span>Empty, with sensible categories ready to use.</span></button>
            <button type="button" className="choice" aria-pressed={mode === 'restore'} onClick={() => setMode('restore')}><b>Restore a backup</b><span>From an Azuria Finance backup file (.json or encrypted).</span></button>
          </div>
          {mode === 'restore' && (<>
            <input type="file" accept=".json,.azfin,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ color: '#c9d3e3' }} />
            <input className="input" type="password" value={filePin} onChange={(e) => setFilePin(e.target.value)} placeholder="PIN of the encrypted backup (if any)" style={{ fontSize: 15, letterSpacing: 0 }} />
          </>)}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy} onClick={finish}>{busy ? 'Encrypting…' : 'Open my finances'}</button>
          <button className="btn" onClick={() => setStep('pin')}>Back</button>
        </>)}
      </div>
    </div>
  );
}

export { openDb };
