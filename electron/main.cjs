// Azuria Finance — desktop shell (macOS app).
// The app is served from inside the app bundle over a private app:// scheme. Nothing is loaded from
// the internet, no Node.js access is given to the page, and data stays encrypted in the user's
// Library/Application Support folder.
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, 'dist');
const ORIGIN = 'app://azuria';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: 'Azuria Finance',
    backgroundColor: '#260e0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);

  // Keep the window on the app; open real web links in the default browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Make sure the last edit is encrypted and written before the window goes away.
  let flushed = false;
  win.on('close', (e) => {
    if (flushed || quitting) return;
    e.preventDefault();
    flushThen(() => { flushed = true; win?.close(); });
  });
  win.on('closed', () => { win = null; });
}

function flushThen(cb) {
  let called = false;
  const done = () => { if (!called) { called = true; cb(); } };
  if (!win || win.isDestroyed()) return done();
  const timer = setTimeout(done, 4000);
  win.webContents.executeJavaScript('window.__azFlush ? window.__azFlush() : null', true)
    .catch(() => {}).finally(() => { clearTimeout(timer); done(); });
}

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !win) return;
  e.preventDefault();
  flushThen(() => { quitting = true; app.quit(); });
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Only system notifications may be requested; camera, microphone, location etc. are refused.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'notifications'));
  // No outbound connections from the page at all (defence in depth on top of the page's CSP).
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    callback({ cancel: !(u.startsWith('app:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('devtools:') || u.startsWith('chrome-extension:')) });
  });

  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
