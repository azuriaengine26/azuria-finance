# Azuria Finance

Private personal + business finance for one owner (built for Emma / Azuria Engine).
Personal and business money are kept completely separate, with a combined view one tap away.
Everything runs **on your device**, encrypted with your PIN. There is no server, no account, no tracking.

---

## What's in version 1.0

| Area | What it does |
|---|---|
| **Dashboard** | Net worth, cash & bank (personal/business split), month and year income/expenses, savings rate, money owed to you, 12-month cash flow, spending by category, insights, upcoming bills, debt, goals, budgets, accounts. Switch **All / Personal / Azuria** anywhere. Every headline total also shows its HNL (or USD) equivalent. |
| **Azuria dashboard** | Revenue, expenses, net profit & margin, contractor / payroll / software / marketing / other costs, revenue by client, outstanding invoices, business cash & debt, owner draws, business cash-flow statement. |
| **Accounts** | Unlimited personal/business accounts (checking, savings, cash, cards, investments, PayPal, Stripe, loans…), any currency, starting balance + date, active/inactive, low-balance alerts, "match to bank balance", 6-month sparkline. |
| **Transactions** | Income / expense / transfer, status (completed, pending, expected/scheduled, cancelled), personal/business, category & subcategory, payee, description, notes, tags, client & project, payment method, reference, tax fields, receipts/photos, original currency + amount charged. Edit, delete (with undo + trash), duplicate, full change history. Filter by date, account, type, category, merchant, amount, tags, client, tax status. CSV export. |
| **Transfers** | Typed transfers that are *never* income or expense: between accounts, to savings, owner draw (business→personal), owner contribution, credit-card/debt payment, borrowed money, money lent, loan repaid. Cross-currency transfers keep the exact amount received. |
| **Income** | Expected vs. pending vs. received vs. late vs. cancelled; expected this/next month (scheduled items + open invoices, de-duplicated); by client, source and month; "mark received". |
| **Expenses** | By category or merchant, by month, business vs. personal, recurring share. |
| **Budgets** | Monthly budgets per category (incl. subcategories) or whole personal/business spending, every month or one month only; mixed currencies; progress bars with "almost used / over" states; pace warning. |
| **Bills & subscriptions** | Recurring income, bills, subscriptions, payroll, transfers and debt payments (daily → yearly + custom). Occurrences are generated exactly once; autopay option; "paid" / "skip". Monthly & annual subscription cost, renewals, and a **"Subscriptions I could cancel"** list based on your own ratings and overlaps. |
| **Debt & IOUs** | Loans, cards (linked to card accounts), money borrowed from people, vendor/contractor balances. Payment history, interest split, priority, due dates, progress, debt-to-income. **Payoff planner**: avalanche vs. snowball vs. minimums with timeline, total interest and chart — calculations, not decisions. |
| **Savings goals** | Target, current (contributions or a linked account), deadline, monthly plan, required per month, recent pace & projection. |
| **Clients & invoices** | Clients/people/vendors, projects, invoices with auto numbering, due dates from payment terms, partial payments, current/due-soon/overdue/paid, "who owes me", personal loans owed to you. |
| **Net worth & health** | Assets/liabilities breakdown, 24-month history, and 8 health metrics with plain explanations (savings rate, expense ratio, DTI, cash flow, emergency-fund months, recurring share, business margin, net-worth change). |
| **Reports** | Income statement, business P&L, personal spending, cash flow, net worth, debt, savings, tax-related summary, category-by-month, client income. Any period. Export **CSV, Excel, PDF**. |
| **Tax** | Deductible / non-deductible / category default, tax category & notes, tax summary with a clear disclaimer. |
| **Multi-currency** | USD, HNL, EUR, MXN, GTQ. Original amount & currency are always stored; conversion uses your rates (exact math), never overwrites. |
| **Import** | CSV, TSV, Excel (.xlsx), OFX/QFX bank statements → detect header row & columns → map → preview → duplicate & scheduled-item matching → confirm → import. Undo any import. |
| **Search** | Global: "Amazon", "Peter", "500", "August 2026", "agosto 2026", "2026-08". |
| **Alerts** | Bills, debt payments, overdue invoices, unusual expenses, budgets, renewals, low balances, goal milestones — each switchable. |
| **Security** | PIN/passphrase → PBKDF2-SHA256 (600k) → AES-256-GCM encryption of the whole database, auto-lock, brute-force slowdown, no network access (strict CSP). |
| **Backup** | Encrypted backup file, full JSON backup, transactions CSV, everything-as-Excel; restore with confirmation; 12 rolling encrypted restore points (daily + before risky actions). |
| **Design** | Light & dark mode, iPhone layout (bottom tabs, sheets, safe areas), Mac layout (sidebar, keyboard: `N` new transaction, `/` search). |

### Accounting rules (the part that matters most)

* Money is stored as **integer cents/centavos**. Currency conversion uses exact rational (BigInt) arithmetic, rounding once. No floating point touches money.
* **Transfers are never income or expenses.** Savings moves, card payments, owner draws, loans in/out are all transfers.
* **Credit cards:** the purchase is the expense; paying the card is a transfer (no double count). Interest you record is an expense.
* **Owner draws** are never a business expense. In the *Personal* view they can count as income (setting, on by default because that's how an owner gets paid); in *All* they cancel out.
* **Cash basis:** invoices are receivables (part of net worth) until paid; the payment is the income.
* Only **completed** transactions affect balances. Pending is shown separately; expected/scheduled items never touch balances.
* An account's **starting balance** applies from its start date; earlier transactions don't change it (prevents double counting when importing history).
* **History is preserved:** deletes are soft (trash + undo); every edit of a transaction, invoice, account or debt is recorded by database triggers.
* **Cash-flow identity** is tested: net cash change always equals the actual change in account balances.

---

## Run it

Requirements: Node.js 20+ (tested on Node 22).

```bash
npm install
npm run dev          # http://localhost:5173 (development)
npm test             # automated financial tests
npm run build        # production build -> dist/
npm run preview      # serve dist/ on http://localhost:4173
npm run build:single # whole app in ONE file -> dist-single/index.html
```

The app needs a secure context for encryption: `https://…` or `http://localhost`.

## Install on iPhone

**Option A — Home Screen app (works today, no Apple developer account):**
1. Host the `dist/` folder on any HTTPS static host (see *Deployment*).
2. Open the URL in **Safari** on the iPhone → Share → **Add to Home Screen**.
3. Open it from the Home Screen icon, set your PIN, and use it like an app (full screen, offline).

Installing to the Home Screen matters: iOS can clear website storage that hasn't been used for a while, but Home Screen apps are exempt. Still keep backups.

**Option B — Native app via Xcode / TestFlight / App Store** (needs a Mac with Xcode 16+ and an Apple Developer account for TestFlight/App Store):
```bash
npm install
npm run build
npx cap sync ios
npx cap open ios        # opens ios/App/App.xcodeproj in Xcode
```
In Xcode: select the *App* target → *Signing & Capabilities* → choose your Team (bundle ID `com.azuriaengine.finance`, change if needed) → pick your iPhone → **Run**. For TestFlight: *Product → Archive → Distribute App*. The project uses Swift Package Manager (no CocoaPods). Export compliance: the app uses only standard OS-provided encryption to protect your own data; `ITSAppUsesNonExemptEncryption` is set to `false` — confirm this answer in App Store Connect's questionnaire.

## Install on MacBook

* **Safari (macOS Sonoma or later):** open the hosted URL → *File → Add to Dock*. It runs in its own window with its own icon.
* **Chrome / Edge:** open the URL → install icon in the address bar.
* **Native:** on Apple-Silicon Macs, the iPhone/iPad build from Xcode can run on the Mac ("My Mac (Designed for iPad)" destination), and can be offered on the Mac App Store from the same build.

Each device keeps its **own encrypted copy**. To move data between iPhone and Mac, export an encrypted backup on one and restore it on the other (Settings → Backup). There's no automatic sync in v1 — on purpose, since sync requires a server.

## Deployment

The app is a static site: no server code, no database server, no API keys.

* **Netlify:** drag the `dist/` folder onto app.netlify.com/drop.
* **Vercel / Cloudflare Pages:** build command `npm run build`, output directory `dist`.
* **GitHub Pages:** push `dist/` to a `gh-pages` branch (paths are relative, so sub-paths work).

Your financial data is **never** uploaded to the host — it only serves the app files. Use a private, unguessable URL if you want, but the data is safe either way: it lives encrypted on each device.

## Environment variables

**None.** There are no API keys, secrets or server settings. `.env*` files are git-ignored so nothing sensitive can be committed by accident. If a future version adds a bank-feed or sync service, its keys must live on that server, never in this front-end.

## Backup & restore

Settings → **Backup**:
* **Encrypted backup** (`.azfin`) — everything, encrypted; opens only with the PIN you had when you made it. Recommended: weekly, to iCloud Drive or a USB drive.
* **JSON backup** — everything in readable form (keep it somewhere private).
* **Transactions CSV** / **Everything as Excel** — for your accountant or spreadsheets.
* **Restore from a backup file** — replaces all data after you type RESTORE; a restore point of the current data is saved first.
* **Restore points** — 12 encrypted snapshots on the device (daily, and before imports, restores and deleting demo data).

New device or forgot your PIN: on the welcome screen choose **Restore a backup**. There is no PIN recovery — the PIN *is* the key.

## Demo data

On first launch you can start with a year of clearly-labelled demo data. Remove it any time: Settings → **Data → Delete all demo data**. Your own entries stay.

## Security model — what's real, and what isn't (yet)

Real: AES-256-GCM encryption at rest of all data and attachments; PBKDF2-SHA256 600,000-iteration key derivation; key kept only in memory while unlocked; auto-lock (default 5 min, including in background); attempt slowdown after 5 wrong PINs; Content-Security-Policy that blocks connections to any other website; no third parties; formula-injection-safe CSV export.

Honest limitations of v1:
* **Face ID / Touch ID** is not implemented. A web app can't securely tie a local encryption key to Face ID, and I didn't want to fake it with a "Face ID screen" that doesn't protect anything. In the native build this is the next step (Keychain item protected by biometrics holding the vault key).
* **Notifications while the app is closed** aren't possible without a server (which would see your data). Alerts are computed whenever you open the app and can be shown as system notifications then. The native build can add scheduled local notifications.
* **Bank connections** are not included. Live bank feeds need a licensed aggregator and a server holding bank credentials. Import statements instead (CSV/Excel/OFX). The importer is a separate module, so a feed can be plugged in later.
* **Receipt scanning (OCR)** is not included; receipts can be photographed and attached. On-device OCR (Apple Vision) fits the native build.
* **PDF bank statements** can't be parsed reliably; download CSV/Excel/OFX from your bank.

## Project structure

```
src/core/      pure TypeScript engine (no UI) — fully unit-tested
  money.ts       decimal-safe money + exact FX conversion
  dates.ts       calendar math, period presets, loose date parsing
  schema.ts      SQLite migrations (tables, constraints, indexes, audit triggers)
  db.ts          SQLite (sql.js/WASM) wrapper, transactions, migrations
  repo.ts        validated writes: accounts, transactions, transfers, recurring, invoices, debts
  finance.ts     all calculations: balances, totals, cash flow, net worth, AR, debt, payoff, goals, budgets, insights, health, alerts
  importer.ts    CSV/Excel/OFX parsing, column detection, preview, duplicate detection, commit/undo
  reports.ts     10 reports as structured tables
  backup.ts      JSON backup/restore, CSV, demo-data removal
  vault.ts       encryption, PIN, restore points, encrypted backup files
  demo.ts        clearly-flagged sample data
  search.ts      global search
src/app/       app state, auto-save, auto-lock, onboarding & lock screens
src/ui/        components, charts (SVG), transaction form, exporters
src/pages/     one file per screen
tests/         vitest suites
ios/           Capacitor Xcode project
```

Database tables: users, settings, accounts, categories (with subcategories), clients, projects, invoices, transactions, tags, transaction_tags, attachments, recurring, debts, debt_payments, savings_goals, goal_contributions, budgets, exchange_rates, import_batches, audit_log.

## Roadmap (suggested next steps)

1. Native iPhone build polish: Face ID unlock, scheduled local notifications, share-sheet import of bank files.
2. Receipt OCR with on-device Apple Vision (suggest merchant/amount/date, confirm before saving).
3. Optional end-to-end-encrypted sync between iPhone and Mac.
4. Optional bank feeds via an aggregator, behind your own small server.
