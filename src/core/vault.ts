// Encrypted on-device storage.
//
// - The whole SQLite database is encrypted with AES-256-GCM before it touches disk.
// - The key is derived from your PIN/passcode with PBKDF2-SHA256 (600,000 iterations) and a random salt.
//   The key is non-extractable and lives only in memory while the app is unlocked.
// - Nothing is ever sent over the network. There is no server and no "recover my PIN" backdoor:
//   if the PIN is lost, the data cannot be decrypted (keep an encrypted backup file somewhere safe).

const DB_NAME = 'azuria-finance';
const STORE = 'kv';
export const KDF_ITERATIONS = 600_000;
const MAX_SNAPSHOTS = 12;

export interface Sealed { v: 1; alg: 'AES-GCM'; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; data: string; created: string; note?: string }

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------- IndexedDB key/value ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { d.close(); resolve(req.result); };
    tx.onerror = () => { d.close(); reject(tx.error); };
    tx.onabort = () => { d.close(); reject(tx.error ?? new Error('Storage write aborted (device storage may be full)')); };
  });
}
const kvGet = <T>(k: string) => kv<T>('readonly', (s) => s.get(k) as IDBRequest<T>);
const kvSet = (k: string, v: unknown) => kv('readwrite', (s) => s.put(v, k));
const kvDel = (k: IDBValidKey) => kv('readwrite', (s) => s.delete(k));
const kvKeys = () => kv<IDBValidKey[]>('readonly', (s) => s.getAllKeys());

// ---------- crypto ----------
export async function deriveKey(pin: string, salt: Uint8Array, iter = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, salt: Uint8Array, data: Uint8Array, iter = KDF_ITERATIONS, note?: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('azuria-finance:v1') }, key, data as BufferSource));
  return { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), data: b64(ct), created: new Date().toISOString(), note };
}

export async function open(key: CryptoKey, s: Sealed): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv), additionalData: enc.encode('azuria-finance:v1') }, key, unb64(s.data)));
  } catch {
    throw new WrongPinError();
  }
}

export class WrongPinError extends Error { constructor() { super('Incorrect PIN or passcode'); } }

export function validatePin(pin: string): string | null {
  if (pin.length < 6) return 'Use at least 6 characters (digits or a passphrase).';
  if (/^(\d)\1+$/.test(pin) || ['123456', '1234567', '12345678', '654321', '000000', '111111'].includes(pin)) return 'That PIN is too easy to guess.';
  return null;
}

// ---------- vault ----------
export class Vault {
  private constructor(private key: CryptoKey, private salt: Uint8Array, private iter: number) {}

  static async exists(): Promise<boolean> { return !!(await kvGet('vault')); }

  static async create(pin: string, initialData: Uint8Array): Promise<Vault> {
    const err = validatePin(pin);
    if (err) throw new Error(err);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const v = new Vault(await deriveKey(pin, salt), salt, KDF_ITERATIONS);
    await v.save(initialData);
    return v;
  }

  static async unlock(pin: string): Promise<{ vault: Vault; data: Uint8Array }> {
    await throttle();
    const sealed = await kvGet<Sealed>('vault');
    if (!sealed) throw new Error('No data found on this device.');
    const salt = unb64(sealed.salt);
    const key = await deriveKey(pin, salt, sealed.iter);
    try {
      const data = await open(key, sealed);
      clearFailures();
      return { vault: new Vault(key, salt, sealed.iter), data };
    } catch (e) {
      recordFailure();
      throw e;
    }
  }

  async save(data: Uint8Array) {
    await kvSet('vault', await seal(this.key, this.salt, data, this.iter));
    await kvSet('last_saved', new Date().toISOString());
  }

  /** Keep a rolling set of encrypted restore points (automatic daily + before risky actions). */
  async snapshot(data: Uint8Array, note: string) {
    const id = `snap:${new Date().toISOString()}`;
    await kvSet(id, await seal(this.key, this.salt, data, this.iter, note));
    const snaps = (await kvKeys()).map(String).filter((k) => k.startsWith('snap:')).sort();
    for (const old of snaps.slice(0, Math.max(0, snaps.length - MAX_SNAPSHOTS))) await kvDel(old);
  }

  async dailySnapshot(data: Uint8Array) {
    const day = new Date().toISOString().slice(0, 10);
    const snaps = (await kvKeys()).map(String).filter((k) => k.startsWith('snap:'));
    if (!snaps.some((k) => k.slice(5, 15) === day)) await this.snapshot(data, 'Automatic daily restore point');
  }

  async listSnapshots(): Promise<{ id: string; created: string; note: string; size: number }[]> {
    const keys = (await kvKeys()).map(String).filter((k) => k.startsWith('snap:')).sort().reverse();
    const out = [];
    for (const k of keys) { const s = await kvGet<Sealed>(k); if (s) out.push({ id: k, created: s.created, note: s.note ?? '', size: Math.round((s.data.length * 3) / 4) }); }
    return out;
  }

  async readSnapshot(id: string): Promise<Uint8Array> {
    const s = await kvGet<Sealed>(id);
    if (!s) throw new Error('Restore point not found');
    return open(this.key, s);
  }

  /** Re-encrypt everything under a new PIN. The old PIN must already have unlocked this vault. */
  async changePin(newPin: string, currentData: Uint8Array) {
    const err = validatePin(newPin);
    if (err) throw new Error(err);
    const snaps = await this.listSnapshots();
    const plain = await Promise.all(snaps.map(async (s) => ({ ...s, data: await this.readSnapshot(s.id) })));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    this.key = await deriveKey(newPin, salt);
    this.salt = salt; this.iter = KDF_ITERATIONS;
    await this.save(currentData);
    for (const s of plain) await kvSet(s.id, { ...(await seal(this.key, this.salt, s.data, this.iter, s.note)), created: s.created });
  }

  /** Portable encrypted backup file (same encryption; needs the PIN that was active when it was made). */
  async exportEncrypted(data: Uint8Array): Promise<string> {
    return JSON.stringify({ app: 'azuria-finance', kind: 'encrypted-backup', ...(await seal(this.key, this.salt, data, this.iter, 'Encrypted backup')) });
  }

  static async decryptBackupFile(text: string, pin: string): Promise<Uint8Array> {
    let s: any;
    try { s = JSON.parse(text); } catch { throw new Error('This file is not a backup.'); }
    if (s?.app !== 'azuria-finance' || s?.kind !== 'encrypted-backup') throw new Error('This is not an Azuria Finance encrypted backup.');
    const key = await deriveKey(pin, unb64(s.salt), s.iter);
    return open(key, s);
  }

  static async lastSaved(): Promise<string | undefined> { return kvGet<string>('last_saved'); }

  static async eraseEverything() {
    for (const k of await kvKeys()) await kvDel(k);
    try { localStorage.removeItem('az_fail'); } catch { /* ignore */ }
  }
}

// ---------- brute-force slowdown ----------
// The real protection is the encryption + slow key derivation; this just makes casual guessing painful.
function failures(): { n: number; at: number } { try { return JSON.parse(localStorage.getItem('az_fail') || '{"n":0,"at":0}'); } catch { return { n: 0, at: 0 }; } }
function recordFailure() { const f = failures(); try { localStorage.setItem('az_fail', JSON.stringify({ n: f.n + 1, at: Date.now() })); } catch { /* ignore */ } }
function clearFailures() { try { localStorage.removeItem('az_fail'); } catch { /* ignore */ } }
export function lockoutRemaining(): number {
  const f = failures();
  if (f.n < 5) return 0;
  const wait = Math.min(15 * 60_000, 30_000 * 2 ** (f.n - 5));
  return Math.max(0, f.at + wait - Date.now());
}
async function throttle() {
  const ms = lockoutRemaining();
  if (ms > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(ms / 1000)} seconds.`);
}
