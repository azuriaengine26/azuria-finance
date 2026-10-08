import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installNativeHandlers } from './app/native';

if (/Electron/.test(navigator.userAgent)) document.documentElement.classList.add('desktop-app');
installNativeHandlers();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Offline support for the installed app (not used inside the native wrapper or the single-file build).
if ('serviceWorker' in navigator && location.protocol === 'https:' && !(window as any).Capacitor && import.meta.env.MODE !== 'single') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
