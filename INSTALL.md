# Installing Azuria Finance

Each device keeps its own encrypted copy of your data. To move data between devices, use
**Settings → Backup → Encrypted backup** on one device and **Restore from a backup file** on the other.

---

## MacBook — download the app

**1. Pick the right download.** Apple menu → *About This Mac*:

| It says | Download |
|---|---|
| Chip: Apple M1 / M2 / M3 / M4 | `Azuria-Finance-1.1.0-mac-apple-silicon.zip` |
| Processor: Intel | `Azuria-Finance-1.1.0-mac-intel.zip` |

**2. Unzip and move it.** Double-click the zip. Drag **Azuria Finance** into your **Applications** folder.

**3. Open it the first time.** Double-click Azuria Finance. macOS will say it can't verify the developer — click **Done**.

**4. Allow it once.** Open **System Settings → Privacy & Security**, scroll down to the message about Azuria Finance, click **Open Anyway**, enter your Mac password, then click **Open**. From now on it opens normally, like any app (you can keep it in the Dock).

**If macOS says the app "is damaged"**, open the Terminal app and paste this line, then press Return and open the app again:

```
xattr -cr "/Applications/Azuria Finance.app"
```

Why the extra step: Apple only skips it for apps signed with a paid Apple Developer certificate ($99/year) and notarized by Apple. The app is safe to allow — it never connects to the internet. If you get an Apple Developer account later, the build script signs and notarizes automatically (see README).

---

## iPhone — two ways

Apple doesn't allow installing iPhone apps from a downloaded file, so the iPhone version comes either from a web address you add to your Home Screen, or from Xcode on your Mac.

### Option A — Home Screen app (recommended, free, 5 minutes)

The app files need to live at a private HTTPS address. Your data never goes there — only the app itself. Easiest host:

1. On your Mac, go to **app.netlify.com** and sign up (free; "Sign up with GitHub" works).
2. Choose **Add new site → Deploy manually**.
3. Drag the **`dist`** folder (inside `azuria-finance.zip`) onto the page. Netlify gives you an address like `https://something.netlify.app`.
4. On your iPhone, open that address in **Safari**.
5. Tap **Share** → **Add to Home Screen** → **Add**.
6. Open Azuria Finance from the Home Screen, set your PIN, and restore your encrypted backup from the Mac if you want the same data.

### Option B — Native iPhone app through Xcode

1. Install **Xcode** from the Mac App Store.
2. Unzip `azuria-finance.zip`, open Terminal in that folder and run: `npm install`, then `npm run build`, then `npx cap sync ios`, then `npx cap open ios`.
3. In Xcode: click the **App** target → **Signing & Capabilities** → choose your Apple ID as Team.
4. Plug in your iPhone, select it at the top, and press **Run** (▶).

With a free Apple ID the app must be re-installed every 7 days; with a paid Apple Developer account it lasts a year and can go to TestFlight.

---

## Mac in the browser (no install)

Open the same Netlify address in Safari on the Mac → **File → Add to Dock**.

## First steps after installing

1. **Settings → Currencies:** enter today's USD→HNL rate (the demo rate is only an example).
2. **Settings → Data → Delete all demo data.**
3. **Accounts → Add account** for each real account, with its balance from your bank statement.
4. **Import** your bank statements (CSV, Excel or OFX/QFX) or add transactions by hand.
5. **Settings → Backup → Encrypted backup** once a week, saved to iCloud Drive.
