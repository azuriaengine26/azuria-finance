// Builds "Azuria Finance.app" for Apple Silicon and Intel Macs, ad-hoc signs it, and zips it.
//   npm run build:mac
// Signing: on a Mac this uses `codesign` (ad-hoc, or your Developer ID if APPLE_SIGN_IDENTITY is set);
// elsewhere it uses `rcodesign` (https://github.com/indygreg/apple-platform-rs) if found on PATH or in RCODESIGN.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const stage = path.join(root, 'build/desktop');
const out = path.join(root, 'release');

console.log('1/4 Building the web app…');
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });

console.log('2/4 Staging the desktop app…');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
rmSync(path.join(stage, 'dist/sw.js'), { force: true });
cpSync(path.join(root, 'electron/main.cjs'), path.join(stage, 'main.cjs'));
writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'azuria-finance', productName: 'Azuria Finance', version: pkg.version, main: 'main.cjs', private: true }, null, 2));

console.log('3/4 Packaging for macOS (Apple Silicon + Intel)…');
rmSync(out, { recursive: true, force: true });
const apps = await packager({
  dir: stage, out, overwrite: true, asar: true, prune: false,
  name: 'Azuria Finance', executableName: 'Azuria Finance',
  platform: 'darwin', arch: ['arm64', 'x64'], electronVersion,
  icon: path.join(root, 'electron/icon.icns'),
  appBundleId: 'com.azuriaengine.finance', appCategoryType: 'public.app-category.finance',
  appCopyright: `© ${new Date().getFullYear()} Azuria Engine`, appVersion: pkg.version, buildVersion: pkg.version,
  darwinDarkModeSupport: true, osxSign: false,
  extendInfo: { NSHumanReadableCopyright: 'Azuria Engine', LSApplicationCategoryType: 'public.app-category.finance' },
});

console.log('4/4 Signing and zipping…');
const rcodesign = process.env.RCODESIGN || 'rcodesign';
for (const dir of apps) {
  const arch = dir.endsWith('arm64') ? 'apple-silicon' : 'intel';
  const app = path.join(dir, 'Azuria Finance.app');
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--deep', '--sign', process.env.APPLE_SIGN_IDENTITY || '-', app], { stdio: 'inherit' });
  } else {
    try { execFileSync(rcodesign, ['sign', app], { stdio: 'inherit' }); }
    catch { console.warn('  ! rcodesign not found: the app is NOT signed and will not open on Apple Silicon until signed (see README).'); }
  }
  const zip = path.join(out, `Azuria-Finance-${pkg.version}-mac-${arch}.zip`);
  // -y keeps the framework symlinks intact, which macOS requires.
  execFileSync('zip', ['-qry', zip, 'Azuria Finance.app'], { cwd: dir });
  console.log('  ✓', path.relative(root, zip));
}
if (!existsSync(out)) process.exit(1);
