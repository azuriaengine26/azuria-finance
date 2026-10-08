import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { Vault, WrongPinError, validatePin } from '../src/core/vault';
import { Db } from '../src/core/db';
import { seedDefaults } from '../src/core/seed';
import { saveAccount } from '../src/core/repo';

describe('encrypted vault', () => {
  it('encrypts the database at rest, unlocks only with the right PIN, survives PIN change', async () => {
    const db = await Db.create();
    seedDefaults(db);
    saveAccount(db, { name: 'Secret Checking 9911', type: 'checking', owner: 'personal', currency: 'USD', starting_balance: 123456 });
    const bytes = db.export();
    expect(validatePin('123456')).not.toBeNull();
    expect(validatePin('482915')).toBeNull();

    const v = await Vault.create('482915', bytes);
    expect(await Vault.exists()).toBe(true);
    // ciphertext on disk must not contain plaintext
    const raw: any = await new Promise((res) => { const r = indexedDB.open('azuria-finance', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('vault'); g.onsuccess = () => res(g.result); }; });
    expect(atob(raw.data)).not.toContain('Secret Checking');
    expect(raw.iter).toBe(600000);

    await expect(Vault.unlock('000001')).rejects.toBeInstanceOf(WrongPinError);
    const { data } = await Vault.unlock('482915');
    const db2 = await Db.create(data);
    expect(db2.value("SELECT name FROM accounts")).toBe('Secret Checking 9911');

    await v.snapshot(bytes, 'before restore');
    expect((await v.listSnapshots()).length).toBe(1);

    const file = await v.exportEncrypted(bytes);
    await expect(Vault.decryptBackupFile(file, 'wrong-pin')).rejects.toBeInstanceOf(WrongPinError);
    expect((await Vault.decryptBackupFile(file, '482915')).length).toBe(bytes.length);

    await v.changePin('new passphrase 2026', bytes);
    await expect(Vault.unlock('482915')).rejects.toBeInstanceOf(WrongPinError);
    const again = await Vault.unlock('new passphrase 2026');
    expect(again.data.length).toBe(bytes.length);
    const snaps = await again.vault.listSnapshots();
    expect((await again.vault.readSnapshot(snaps[0].id)).length).toBe(bytes.length);

    await Vault.eraseEverything();
    expect(await Vault.exists()).toBe(false);
  }, 30000);
});
