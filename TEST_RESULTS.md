# Test results

Run: `npm test` · 2026-10-08 07:08 UTC · Node v22.22.0

```
 ✓ tests/vault.test.ts > encrypted vault > encrypts the database at rest, unlocks only with the right PIN, survives PIN change 3335ms
 ✓ tests/finance.test.ts > money (decimal-safe) > parses and formats without floating point drift 10ms
 ✓ tests/finance.test.ts > money (decimal-safe) > converts currencies exactly and never mutates the original 3ms
 ✓ tests/finance.test.ts > accounting rules > income/expense totals, transfers never counted, business/personal separated 207ms
 ✓ tests/finance.test.ts > accounting rules > credit card: purchase is the expense, payment is a transfer (no double count) 39ms
 ✓ tests/finance.test.ts > accounting rules > cash-flow identity: net cash change equals the change in account balances 57ms
 ✓ tests/finance.test.ts > accounting rules > owner draws: not a business expense; optional personal income; neutral in combined view 46ms
 ✓ tests/finance.test.ts > accounting rules > multi-currency: original amounts preserved, converted for totals 28ms
 ✓ tests/finance.test.ts > accounting rules > starting balance is not double counted by earlier transactions 22ms
 ✓ tests/finance.test.ts > accounting rules > validation rejects bad data 18ms
 ✓ tests/finance.test.ts > accounting rules > soft delete, restore, duplicate and history 27ms
 ✓ tests/finance.test.ts > debts, receivables, net worth > debt payments split principal/interest; balances and net worth 24ms
 ✓ tests/finance.test.ts > debts, receivables, net worth > invoices: receivable is not income until paid; partial payments; overdue 46ms
 ✓ tests/finance.test.ts > debts, receivables, net worth > payoff planner: avalanche saves interest vs snowball; minimum-only is slowest 24ms
 ✓ tests/finance.test.ts > debts, receivables, net worth > savings goals: progress and required monthly 24ms
 ✓ tests/finance.test.ts > budgets > month override replaces the regular budget for that month only; subcategories, pending and currencies count 33ms
 ✓ tests/finance.test.ts > budgets > display formatting never crashes on fractional chart values 20ms
 ✓ tests/finance.test.ts > recurring transactions > anchors monthly dates to the start day (Jan 31 -> Feb 28 -> Mar 31) 22ms
 ✓ tests/finance.test.ts > recurring transactions > generates occurrences once (idempotent), auto-clears, never regenerates deleted ones 48ms
 ✓ tests/finance.test.ts > import wizard > detects header row and columns, previews, flags duplicates, matches expected, imports once 42ms
 ✓ tests/finance.test.ts > import wizard > parses signed amounts, semicolons, DMY dates and OFX 24ms
 ✓ tests/finance.test.ts > backup, demo data, search, reports > demo data loads, reports render, delete removes only demo 518ms
 ✓ tests/finance.test.ts > backup, demo data, search, reports > JSON backup round-trips exactly, and a bad file changes nothing 630ms
 ✓ tests/finance.test.ts > backup, demo data, search, reports > search understands months 11ms
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

## What the tests verify (with hand-checkable numbers)

| Area | Checked |
|---|---|
| Money | 0.1 + 0.2 = 0.3 exactly; 1,000 × $0.10 = $100.00; US & European formats; rounding |
| Currency | $500 → L13,100 at 26.20 and back; tiny HNL amounts; missing rate is reported, not guessed; original amounts never change when rates change |
| Income / expense totals | Personal, business and combined totals; pending excluded from balances |
| Transfers | Savings moves and account transfers never counted as income/expense |
| Credit cards | Purchase counted once; payment is a transfer; card balance returns to 0 |
| Owner draws | Not a business expense; optional personal income; neutral in combined view; cross-currency amount received preserved |
| Cash-flow identity | Net cash change = actual change in account balances, for All / Personal / Business |
| Debt | Principal vs. interest split; balances over time; net worth with debts |
| Invoices | Not income until paid; partial payments; overdue/due-soon; expected income not double-counted |
| Payoff planner | Avalanche < snowball interest; payoff order; total paid = principal + interest; minimum-below-interest detected |
| Savings goals | Progress, months left, required monthly, recent pace |
| Recurring | Month-end anchoring (Jan 31 → Feb 28 → Mar 31); biweekly; generated once even when re-run; deleted occurrences stay deleted; account start date respected |
| Import | Header-row detection; debit/credit columns; signed amounts; DMY dates; European decimals; OFX; in-file duplicates; already-recorded duplicates; matching scheduled items; re-import finds nothing new; undo |
| Backup | JSON round-trip reproduces identical net worth; invalid file changes nothing; CSV export row count |
| Budgets | One-month change overrides the regular budget only for that month; subcategories, pending charges and HNL→USD conversion count; business/personal kept apart |
| Display safety | Fractional chart values never crash the money formatter |
| Demo data | Loads, every report renders in every scope, no demo bank account goes negative, deletion removes only demo rows |
| Encryption | Ciphertext contains no plaintext; wrong PIN rejected; PIN change re-encrypts restore points; encrypted backup needs its PIN |

## End-to-end browser test (Chromium, desktop 1440px + iPhone 390px)

Onboarding with PIN → demo data → all 20 screens render with zero console errors → add a transaction and find it via search → transfer form → CSV/Excel/PDF report downloads → every report type → CSV import wizard (3 rows) → encrypted + JSON backup downloads → lock → wrong PIN rejected → unlock → data persisted → full page reload → data persisted → dark mode → iPhone layout with no horizontal overflow on any screen.

## Full feature sweep (Chromium at iPhone size) — 63 of 63 passed, 0 errors

Accounts (add, edit, Personal/Business switch, match balance), USD→HNL owner-draw transfer, business expense on a personal card with tags, edit / duplicate / delete + undo, filters, expected income → received, recurring subscription, mark bill paid, skip, subscriptions view, IOU add + pay, payoff planner, savings goal + contribution, client, invoice, partial payment, personal loan owed to me, budget create, one-month budget change, all 10 reports, CSV / Excel / PDF exports, transactions CSV, new category + subcategory, exchange rate, light/dark theme, notification toggles, encrypted backup, readable JSON backup, everything-as-Excel, restore point, restore from encrypted backup, change PIN, delete demo data (own data kept), lock + unlock with new PIN, no sideways scrolling on any screen, and a brand-new empty account rendering every screen without errors.

## Desktop app (Electron, run under a virtual display)

Loads from inside the bundle (`app://`), outside network requests blocked, onboarding works, an edit made right before quitting is still there after relaunch. Mac builds verified as ad-hoc signed with bundle id `com.azuriaengine.finance`.
