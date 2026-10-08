// Fingerprint unlock (Android app). The PIN is kept encrypted by a key in the phone's security
// hardware that only works after a successful fingerprint scan — see BiometricVaultPlugin.java.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface BiometricStatus { available: boolean; enrolled: boolean; reason: string }
interface BiometricVaultPlugin {
  status(): Promise<BiometricStatus>;
  enroll(o: { secret: string; title?: string; subtitle?: string }): Promise<void>;
  unlock(o?: { title?: string; subtitle?: string }): Promise<{ secret: string }>;
  disable(): Promise<void>;
}

const native = registerPlugin<BiometricVaultPlugin>('BiometricVault');

/** Tests can provide a stand-in; on Android the real plugin is used; elsewhere biometrics are unavailable. */
function impl(): BiometricVaultPlugin | null {
  const mock = (window as any).__azBiometricMock as BiometricVaultPlugin | undefined;
  if (mock) return mock;
  return Capacitor.getPlatform() === 'android' ? native : null;
}

export const biometricLabel = 'fingerprint';

export async function biometricStatus(): Promise<BiometricStatus> {
  const b = impl();
  if (!b) return { available: false, enrolled: false, reason: 'unsupported' };
  try { return await b.status(); } catch { return { available: false, enrolled: false, reason: 'unsupported' }; }
}

export async function enrollBiometric(pin: string): Promise<void> {
  const b = impl();
  if (!b) throw new Error('Fingerprint unlock isn’t available on this device.');
  await b.enroll({ secret: pin, title: 'Turn on fingerprint unlock', subtitle: 'Confirm with your fingerprint' });
}

/** Resolves with the PIN, or rejects with an error whose `code` is CANCELLED, KEY_INVALIDATED, LOCKOUT, NOT_ENROLLED… */
export async function unlockWithBiometric(): Promise<string> {
  const b = impl();
  if (!b) throw Object.assign(new Error('Not available'), { code: 'UNAVAILABLE' });
  const { secret } = await b.unlock({ title: 'Unlock Azuria Finance', subtitle: 'Use your fingerprint' });
  return secret;
}

export async function disableBiometric(): Promise<void> {
  await impl()?.disable().catch(() => {});
}

export function biometricErrorMessage(e: any): string | null {
  const code = e?.code ?? '';
  if (code === 'CANCELLED') return null;
  if (code === 'KEY_INVALIDATED') return 'The fingerprints on this phone changed, so fingerprint unlock was turned off for safety. Enter your PIN, then turn it on again in Settings → Security.';
  if (code === 'LOCKOUT') return 'Too many fingerprint attempts. Use your PIN.';
  if (code === 'NOT_ENROLLED') return 'Fingerprint unlock isn’t set up. Use your PIN.';
  return e?.message ? `Fingerprint unlock didn’t work: ${e.message}` : 'Fingerprint unlock didn’t work. Use your PIN.';
}
