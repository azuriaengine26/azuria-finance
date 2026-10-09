# Installing Azuria Finance

Each device keeps its own encrypted copy of your data. To move data between devices, use
**Settings → Backup → Encrypted backup** on one device and **Restore from a backup file** on the other.

---

## MacBook — download the app

**1. Download.** Go to **github.com/azuriaengine26/azuria-finance/releases** and pick the file for your Mac (Apple menu → *About This Mac*):

| It says | Download |
|---|---|
| Chip: Apple M1 / M2 / M3 / M4 | `Azuria-Finance-…-mac-apple-silicon.dmg` |
| Processor: Intel | `Azuria-Finance-…-mac-intel.dmg` |

**2. Install.** Open the `.dmg` and drag **Azuria Finance** onto the **Applications** folder shown next to it.

**3. Open it the first time.** Double-click Azuria Finance. macOS will say it can't verify the developer — click **Done**.

**4. Allow it once.** Open **System Settings → Privacy & Security**, scroll down to the message about Azuria Finance, click **Open Anyway**, enter your Mac password, then click **Open**. From now on it opens normally, like any app (you can keep it in the Dock).

**If macOS says the app "is damaged"**, open the Terminal app and paste this line, then press Return and open the app again:

```
xattr -cr "/Applications/Azuria Finance.app"
```

Why the extra step: Apple only skips it for apps signed with a paid Apple Developer certificate ($99/year) and notarized by Apple. The app is safe to allow — the only thing it ever downloads is the daily public USD→HNL rate from Wise; your data never leaves the Mac. If you get an Apple Developer account later, the build script signs and notarizes automatically (see README).

---

## iPhone — two ways

Apple doesn't allow installing iPhone apps from a downloaded file, so the iPhone version comes either from a web address you add to your Home Screen, or from Xcode on your Mac.

### Option A — Home Screen app (recommended, free, 2 minutes)

1. On your iPhone, open **Safari** and go to **azuriaengine26.github.io/azuria-finance**
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open Azuria Finance from the Home Screen, set your PIN, and restore your encrypted backup from the Mac if you want the same data.

Only the app's files live at that address. Your financial data stays encrypted on the iPhone and is never uploaded.

### Option B — Native iPhone app through Xcode

1. Install **Xcode** from the Mac App Store.
2. Unzip `azuria-finance.zip`, open Terminal in that folder and run: `npm install`, then `npm run build`, then `npx cap sync ios`, then `npx cap open ios`.
3. In Xcode: click the **App** target → **Signing & Capabilities** → choose your Apple ID as Team.
4. Plug in your iPhone, select it at the top, and press **Run** (▶).

With a free Apple ID the app must be re-installed every 7 days; with a paid Apple Developer account it lasts a year and can go to TestFlight.

---

## Samsung Galaxy / Android — install the APK

1. On the phone, open **github.com/azuriaengine26/azuria-finance/releases** in Chrome or Samsung Internet.
2. Under the newest release, tap **Assets**, then `Azuria-Finance-…-android.apk`. Confirm the download.
3. Open the downloaded file (notification or **My Files → Downloads**).
4. The first time, Android asks to allow installs from your browser: tap **Settings**, turn on **Allow from this source**, go back, tap **Install**.
5. If **Google Play Protect** says the app is unrecognised, tap **More details → Install anyway** (it isn't from the Play Store, so Play Protect doesn't know it yet).
6. Open **Azuria Finance**, set your PIN, and restore an encrypted backup if you want your data from another device.

**Fingerprint unlock:** Settings → Security → Fingerprint unlock → **Turn on**, enter your PIN, then touch the sensor. Your PIN is locked in the phone's security chip and only released by your fingerprint. (Samsung's face unlock can't protect app keys, so the fingerprint sensor is used.) If you add or remove fingerprints on the phone, the app turns this off for safety and asks for your PIN once.

Exports and backups open Android's share sheet: choose **Save to Drive**, **My Files**, or send by email.
Updates: install the newer APK the same way — your data stays, because every version is signed with the same key.

## Mac in the browser (no install)

Open **azuriaengine26.github.io/azuria-finance** in Safari on the Mac → **File → Add to Dock**.

## First steps after installing

1. **Settings → Currencies:** the USD→HNL rate updates itself daily from Wise. Tap **Update now** once to replace the demo rate straight away.
2. **Settings → Data → Delete all demo data.**
3. **Accounts → Add account** for each real account, with its balance from your bank statement.
4. **Import** your bank statements (CSV, Excel or OFX/QFX) or add transactions by hand.
5. **Settings → Backup → Encrypted backup** once a week, saved to iCloud Drive.
