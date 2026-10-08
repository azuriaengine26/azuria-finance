// Native (Android / iOS app) integrations. Everything here is a no-op in a browser or the Mac app.
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

function toBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Phones can't "download" from inside an app, so the file is written to the app's private cache and
 * handed to the system share sheet, where it can be saved to Files / Google Drive or sent by email.
 */
export async function saveFileNative(filename: string, blob: Blob): Promise<boolean> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '-');
  const { uri } = await Filesystem.writeFile({ path: safeName, data: toBase64(await blob.arrayBuffer()), directory: Directory.Cache });
  try {
    await Share.share({ title: safeName, files: [uri], dialogTitle: 'Save or send this file' });
    return true;
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message ?? e))) return false; // the person closed the share sheet
    throw e;
  }
}

/** Light status-bar icons on the dark brand theme, dark icons on the ivory theme. */
export function setSystemBarsForTheme(dark: boolean) {
  if (!isNative()) return;
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

/** Android back gesture: close an open dialog first, then go back a screen, then leave the app. */
export async function installNativeHandlers() {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('.scrim')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    if (canGoBack && location.hash && location.hash !== '#/') history.back();
    else App.minimizeApp();
  });
  // Write the latest changes before Android may stop the app in the background.
  App.addListener('pause', () => { (window as any).__azFlush?.(); });
}
