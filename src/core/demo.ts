import type { Db } from './db';
import { saveAccount, saveTransaction, saveRecurring, recordInvoicePayment, recordDebtPayment, saveRate, addContribution, generateRecurring } from './repo';
import { addDays, addMonths, monthStart, today, makeISO, parseISO, monthEnd } from './dates';
import { convert, parseMoney } from './money';

/**
 * Realistic, clearly-flagged sample data (every row has is_demo = 1).
 * Settings → Data → "Delete demo data" removes all of it and nothing else.
 */
export function loadDemoData(db: Db, ref = today()) {
  let seed = 20260807;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const between = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100); // dollars -> cents
  const usd = (v: number) => Math.round(v * 100);
  const cat = (name: string, kind: 'income' | 'expense', owner: 'personal' | 'business') =>
    db.value<number>('SELECT id FROM categories WHERE name = ? AND kind = ? AND owner = ? AND parent_id IS NULL', [name, kind, owner]) ?? null;
  const start = addMonths(monthStart(ref), -11);
  const D = 1;

  db.tx(() => {
    saveRate(db, 'USD', 'HNL', '26.20', start, 'demo');
    const rates = { 'USD>HNL': '26.20' };
    const toHNL = (c: number) => convert(c, 'USD', 'HNL', rates);

    // ---- Accounts ----
    const pChk = saveAccount(db, { name: 'Personal Checking', type: 'checking', owner: 'personal', institution: 'Demo Bank', currency: 'HNL', starting_balance: parseMoney('45000'), starting_date: start, is_demo: D, low_balance_alert: parseMoney('8000') });
    const pSav = saveAccount(db, { name: 'Personal Savings', type: 'savings', owner: 'personal', institution: 'Demo Bank', currency: 'USD', starting_balance: usd(3000), starting_date: start, is_demo: D });
    const pVisa = saveAccount(db, { name: 'Personal Visa', type: 'credit_card', owner: 'personal', institution: 'Demo Card Co.', currency: 'USD', starting_balance: usd(-450), starting_date: start, is_demo: D });
    const pCash = saveAccount(db, { name: 'Cash Wallet', type: 'cash', owner: 'personal', currency: 'HNL', starting_balance: parseMoney('2000'), starting_date: start, is_demo: D });
    const bChk = saveAccount(db, { name: 'Azuria Business Checking', type: 'checking', owner: 'business', institution: 'Demo Bank', currency: 'USD', starting_balance: usd(15000), starting_date: start, is_demo: D, low_balance_alert: usd(2500) });
    const bPP = saveAccount(db, { name: 'Azuria PayPal', type: 'paypal', owner: 'business', institution: 'PayPal', currency: 'USD', starting_balance: usd(500), starting_date: start, is_demo: D });
    const bCard = saveAccount(db, { name: 'Azuria Business Card', type: 'credit_card', owner: 'business', institution: 'Demo Card Co.', currency: 'USD', starting_balance: usd(-1200), starting_date: start, is_demo: D });

    // ---- Clients & projects ----
    const client = (name: string, company: string, contact: string, terms: number, notes = 'Demo client') =>
      db.insert('clients', { name, company, contact, email: `${contact.split(' ')[0].toLowerCase()}@example.com`, phone: '+1 555 0100', payment_terms_days: terms, currency: 'USD', notes, is_demo: D });
    const sunrise = client('Sunrise Roofing Co.', 'Sunrise Roofing Co.', 'Dana Whitfield', 15);
    const bright = client('BrightPath Solar', 'BrightPath Solar LLC', 'Marcus Lee', 15);
    const keystone = client('Keystone Realty Group', 'Keystone Realty Group', 'Alicia Romero', 30);
    const harbor = client('Harbor Restoration', 'Harbor Insurance Restoration', 'Tom Becker', 15);
    const peter = db.insert('clients', { name: 'Peter (friend)', kind: 'person', currency: 'USD', notes: 'Demo — personal loan', is_demo: D });
    const projSun = db.insert('projects', { client_id: sunrise, name: 'Outbound appointment setting', is_demo: D });
    const projBright = db.insert('projects', { client_id: bright, name: 'Inbound customer support line', is_demo: D });

    // ---- Recurring rules (bills, payroll, subscriptions) ----
    const R = (r: any) => saveRecurring(db, { is_demo: D, auto_clear: 1, ...r });
    R({ name: 'Apartment rent', kind: 'expense', owner: 'personal', account_id: pChk, amount: parseMoney('18000'), category_id: cat('Housing', 'expense', 'personal'), payee: 'Landlord', unit: 'month', interval: 1, start_date: makeISO(parseISO(start).y, parseISO(start).m, 1), is_bill: 1 });
    R({ name: 'Agent contractors payroll', kind: 'expense', owner: 'business', account_id: bChk, amount: usd(2300), category_id: cat('Contractors', 'expense', 'business'), payee: 'Contractor payroll', unit: 'week', interval: 2, start_date: addDays(start, 4), tax_deductible: 1 });
    R({ name: 'CRM software', kind: 'expense', owner: 'business', account_id: bCard, amount: usd(150), category_id: cat('Software', 'expense', 'business'), payee: 'CRM Cloud', unit: 'month', interval: 1, start_date: addDays(start, 2), is_subscription: 1, subscription_value: 'essential' });
    R({ name: 'Dialer platform', kind: 'expense', owner: 'business', account_id: bCard, amount: usd(220), category_id: cat('Software', 'expense', 'business'), payee: 'DialerPro', unit: 'month', interval: 1, start_date: addDays(start, 6), is_subscription: 1, subscription_value: 'essential' });
    R({ name: 'Workspace email', kind: 'expense', owner: 'business', account_id: bCard, amount: usd(36), category_id: cat('Software', 'expense', 'business'), payee: 'Workspace Suite', unit: 'month', interval: 1, start_date: addDays(start, 9), is_subscription: 1 });
    R({ name: 'Screen recording tool', kind: 'expense', owner: 'business', account_id: bCard, amount: usd(29), category_id: cat('Software', 'expense', 'business'), payee: 'ClipCast', unit: 'month', interval: 1, start_date: addMonths(start, 5), is_subscription: 1, subscription_value: 'unsure' });
    R({ name: 'Office internet', kind: 'expense', owner: 'business', account_id: bChk, amount: usd(90), category_id: cat('Internet', 'expense', 'business'), payee: 'FiberNet', unit: 'month', interval: 1, start_date: addDays(start, 11), is_bill: 1 });
    R({ name: 'VoIP phone lines', kind: 'expense', owner: 'business', account_id: bChk, amount: usd(65), category_id: cat('Phone', 'expense', 'business'), payee: 'VoIP Lines', unit: 'month', interval: 1, start_date: addDays(start, 14), is_bill: 1 });
    R({ name: 'Video streaming', kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(15.49), category_id: cat('Subscriptions', 'expense', 'personal'), payee: 'StreamFlix', unit: 'month', interval: 1, start_date: addDays(start, 3), is_subscription: 1, subscription_value: 'useful' });
    R({ name: 'Second video service', kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(11.99), category_id: cat('Subscriptions', 'expense', 'personal'), payee: 'ShowBox+', unit: 'month', interval: 1, start_date: addMonths(start, 3), is_subscription: 1 });
    R({ name: 'Music streaming', kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(10.99), category_id: cat('Subscriptions', 'expense', 'personal'), payee: 'TuneStream', unit: 'month', interval: 1, start_date: addDays(start, 8), is_subscription: 1, subscription_value: 'essential' });
    R({ name: 'Fitness app', kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(12.99), category_id: cat('Subscriptions', 'expense', 'personal'), payee: 'FitTrack', unit: 'month', interval: 1, start_date: addDays(start, 12), is_subscription: 1, subscription_value: 'unsure' });
    R({ name: 'Cloud storage', kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(29.99), category_id: cat('Subscriptions', 'expense', 'personal'), payee: 'CloudBox', unit: 'year', interval: 1, start_date: addMonths(start, 2), is_subscription: 1, subscription_value: 'useful' });

    // ---- Debts ----
    const carLoan = db.insert('debts', { name: 'Car loan', creditor: 'Demo Auto Finance', type: 'personal_loan', owner: 'personal', currency: 'USD', original_amount: usd(14000), opening_balance: usd(9800), balance_date: start, interest_rate: '8.5', minimum_payment: usd(310), due_day: 15, start_date: addMonths(start, -20), target_payoff_date: addMonths(ref, 30), priority: 'high', is_demo: D });
    db.insert('debts', { name: 'Personal Visa', creditor: 'Demo Card Co.', type: 'credit_card', owner: 'personal', account_id: pVisa, currency: 'USD', original_amount: 0, interest_rate: '29.9', minimum_payment: usd(35), due_day: 22, priority: 'high', is_demo: D });
    db.insert('debts', { name: 'Azuria Business Card', creditor: 'Demo Card Co.', type: 'credit_card', owner: 'business', account_id: bCard, currency: 'USD', original_amount: 0, interest_rate: '22.9', minimum_payment: usd(50), due_day: 5, priority: 'medium', is_demo: D });
    db.insert('debts', { name: 'Loan from Carlos', creditor: 'Carlos (friend)', type: 'person', owner: 'personal', currency: 'USD', original_amount: usd(1200), opening_balance: usd(1200), balance_date: addMonths(start, 4), start_date: addMonths(start, 4), interest_rate: '0', minimum_payment: 0, due_date: addMonths(ref, 3), priority: 'medium', notes: 'Demo — borrowed for a laptop', is_demo: D });
    db.insert('debts', { name: 'Headset supplier invoice', creditor: 'ProAudio Supply', type: 'vendor', owner: 'business', currency: 'USD', original_amount: usd(640), opening_balance: usd(640), balance_date: addDays(ref, -10), start_date: addDays(ref, -10), interest_rate: '0', minimum_payment: 0, due_date: addDays(ref, 20), priority: 'high', is_demo: D });

    // ---- Month by month activity ----
    let invNo = 1;
    for (let mi = 0; mi < 12; mi++) {
      const m0 = addMonths(start, mi);
      const { y, m } = parseISO(m0);
      const day = (d: number) => makeISO(y, m, d);
      const isCurrent = mi === 11;
      const past = (d: string) => d <= ref;
      const tx = (t: any) => { if (past(t.date)) saveTransaction(db, { status: 'cleared', is_demo: D, ...t }); };

      // Invoices: issued on the 1st, paid around the due date
      const bill = (clientId: number, amount: number, projectId: number | null, payInto: number, lateDays: number, unpaid = false) => {
        if (!past(day(1))) return;
        const terms = db.value<number>('SELECT payment_terms_days FROM clients WHERE id = ?', [clientId]) ?? 15;
        const id = db.insert('invoices', { number: `DEMO-${y}-${String(invNo++).padStart(3, '0')}`, kind: 'invoice', owner: 'business', client_id: clientId, project_id: projectId, amount, currency: 'USD', issue_date: day(1), due_date: addDays(day(1), terms), status: 'sent', is_demo: D });
        const paidOn = addDays(day(1), terms + lateDays);
        if (!unpaid && paidOn <= ref) {
          recordInvoicePayment(db, id, { date: paidOn, amount, account_id: payInto, payment_method: payInto === bPP ? 'PayPal' : 'ACH' });
          db.run('UPDATE transactions SET is_demo = 1 WHERE invoice_id = ?', [id]);
        }
      };
      bill(sunrise, usd(4500), projSun, bChk, Math.round(rnd() * 4) - 2);
      bill(bright, usd(3200 + (mi >= 6 ? 400 : 0)), projBright, bChk, Math.round(rnd() * 3));
      if (mi >= 5) bill(keystone, usd(2400), null, bChk, Math.round(rnd() * 5));
      bill(harbor, usd(1800), null, bPP, mi === 10 ? 0 : Math.round(rnd() * 6), mi === 10);
      if (mi === 8) tx({ date: day(20), kind: 'income', owner: 'business', account_id: bChk, amount: usd(1500), category_id: cat('Consulting', 'income', 'business'), payee: 'Keystone Realty Group', client_id: keystone, description: 'Sales process workshop' });

      // Business variable expenses
      tx({ date: day(7), kind: 'expense', owner: 'business', account_id: bCard, amount: between(300, 900) + (isCurrent ? usd(400) : 0), category_id: cat('Advertising', 'expense', 'business'), payee: 'Ads Network', description: 'Lead-gen ad campaign' });
      tx({ date: day(28), kind: 'expense', owner: 'business', account_id: bChk, amount: usd(15), category_id: cat('Bank fees', 'expense', 'business'), payee: 'Demo Bank', description: 'Monthly service fee' });
      tx({ date: day(18), kind: 'expense', owner: 'business', account_id: bPP, amount: usd(56.5), category_id: cat('Payment processing', 'expense', 'business'), payee: 'PayPal', description: 'Merchant fees' });
      if (mi % 3 === 1) tx({ date: day(10), kind: 'expense', owner: 'business', account_id: bChk, amount: usd(350), category_id: cat('Accounting', 'expense', 'business'), payee: 'Rivera Bookkeeping', description: 'Quarterly bookkeeping' });
      if (mi === 4) tx({ date: day(12), kind: 'expense', owner: 'business', account_id: bCard, amount: usd(1840), category_id: cat('Equipment', 'expense', 'business'), payee: 'Tech Depot', description: '8 agent headsets + 2 monitors' });
      if (mi === 9) tx({ date: day(9), kind: 'expense', owner: 'business', account_id: bChk, amount: usd(600), category_id: cat('Training', 'expense', 'business'), payee: 'Sales Academy', description: 'Agent appointment-setting training' });

      // Owner draw: business USD -> personal HNL
      const draw = usd(2500);
      tx({ date: day(25), kind: 'transfer', transfer_type: 'owner_draw', account_id: bChk, to_account_id: pChk, amount: draw, to_amount: toHNL(draw), description: 'Owner draw' });
      if (mi > 0) tx({ date: day(3), kind: 'transfer', account_id: bPP, to_account_id: bChk, amount: usd(1600), description: 'PayPal sweep to checking' });
      // Pay off last month's business card charges
      if (mi > 0) {
        const bal = db.value<number>("SELECT ifnull(SUM(amount),0) FROM transactions WHERE account_id = ? AND kind = 'expense' AND date BETWEEN ? AND ?", [bCard, addMonths(m0, -1), monthEnd(addMonths(m0, -1))]) ?? 0;
        if (bal) tx({ date: day(5), kind: 'transfer', transfer_type: 'debt_payment', account_id: bChk, to_account_id: bCard, amount: bal, description: 'Business card payment' });
      }

      // Personal spending (HNL)
      for (const w of [3, 10, 17, 24]) {
        tx({ date: day(w), kind: 'expense', owner: 'personal', account_id: pChk, amount: between(1400, 2400), category_id: cat('Groceries', 'expense', 'personal'), payee: w % 2 ? 'SuperMercado Central' : 'La Colonia Market' });
        tx({ date: day(w + 1), kind: 'expense', owner: 'personal', account_id: pChk, amount: between(800, 1150), category_id: cat('Gas', 'expense', 'personal'), payee: 'Gas Station' });
      }
      const meals = isCurrent ? 7 : 4;
      for (let k = 0; k < meals; k++) tx({ date: day(2 + k * 4), kind: 'expense', owner: 'personal', account_id: k % 3 === 0 ? pCash : pChk, amount: between(420, 1150), category_id: cat('Restaurants', 'expense', 'personal'), payee: ['Café Paradiso', 'Asados El Patio', 'Sushi Bar Ken', 'Pizzería Roma'][k % 4] });
      tx({ date: day(12), kind: 'expense', owner: 'personal', account_id: pChk, amount: between(1700, 2700), category_id: cat('Utilities', 'expense', 'personal'), payee: 'Electric company' });
      tx({ date: day(14), kind: 'expense', owner: 'personal', account_id: pChk, amount: parseMoney('1150'), category_id: cat('Utilities', 'expense', 'personal'), payee: 'Home internet' });
      tx({ date: day(19), kind: 'expense', owner: 'personal', account_id: pVisa, amount: between(25, 140), category_id: cat('Shopping', 'expense', 'personal'), payee: 'Amazon', description: 'Online order' });
      if (mi % 4 === 2) tx({ date: day(21), kind: 'expense', owner: 'personal', account_id: pVisa, amount: between(60, 180), category_id: cat('Clothing', 'expense', 'personal'), payee: 'Department store' });
      if (mi === 7) tx({ date: day(8), kind: 'expense', owner: 'personal', account_id: pVisa, amount: usd(420), category_id: cat('Travel', 'expense', 'personal'), payee: 'Airline', description: 'Flight to Roatán' });
      if (mi % 5 === 3) tx({ date: day(16), kind: 'expense', owner: 'personal', account_id: pChk, amount: parseMoney('1800'), category_id: cat('Healthcare', 'expense', 'personal'), payee: 'Clinic', description: 'Doctor visit' });
      tx({ date: day(6), kind: 'transfer', account_id: pChk, to_account_id: pCash, amount: parseMoney('2500'), description: 'ATM withdrawal' });

      // Save $300/month: HNL checking -> USD savings
      tx({ date: day(26), kind: 'transfer', transfer_type: 'savings', account_id: pChk, to_account_id: pSav, amount: toHNL(usd(300)), to_amount: usd(300), description: 'Monthly savings' });
      // Pay the Visa statement in full from HNL checking
      if (mi > 0) {
        const vb = db.value<number>("SELECT ifnull(SUM(amount),0) FROM transactions WHERE account_id = ? AND kind = 'expense' AND date BETWEEN ? AND ?", [pVisa, addMonths(m0, -1), monthEnd(addMonths(m0, -1))]) ?? 0;
        if (vb) tx({ date: day(22), kind: 'transfer', transfer_type: 'debt_payment', account_id: pChk, to_account_id: pVisa, amount: toHNL(vb), to_amount: vb, description: 'Visa statement payment' });
      }
      // Car loan payment: principal + interest split, paid in HNL
      if (past(day(15))) {
        const pay = toHNL(usd(310));
        const interest = toHNL(usd(Math.max(30, 70 - mi * 2)));
        recordDebtPayment(db, carLoan, { date: day(15), amount: pay, interest, from_account_id: pChk });
        db.run('UPDATE transactions SET is_demo = 1 WHERE debt_id = ?', [carLoan]);
        db.run('UPDATE debt_payments SET is_demo = 1 WHERE debt_id = ?', [carLoan]);
      }
      // Tax reserve goal contributions handled below
    }

    // Personal loan to Peter: lent 2 months ago, partly repaid
    const lentOn = addDays(addMonths(ref, -2), -3);
    saveTransaction(db, { date: lentOn, kind: 'transfer', transfer_type: 'loan_given', account_id: pSav, amount: usd(500), description: 'Lent to Peter', client_id: peter, is_demo: D });
    const loanInv = db.insert('invoices', { kind: 'loan', owner: 'personal', client_id: peter, amount: usd(500), currency: 'USD', issue_date: lentOn, due_date: addMonths(ref, 1), status: 'sent', notes: 'Loan to Peter for car repair', is_demo: D });
    db.run('UPDATE transactions SET invoice_id = ? WHERE transfer_type = ? AND client_id = ?', [loanInv, 'loan_given', peter]);
    recordInvoicePayment(db, loanInv, { date: addDays(ref, -12), amount: usd(200), account_id: pSav });
    db.run('UPDATE transactions SET is_demo = 1 WHERE invoice_id = ?', [loanInv]);

    // Expected income next month (not yet invoiced)
    saveTransaction(db, { date: addDays(monthStart(addMonths(ref, 1)), 14), kind: 'income', status: 'expected', owner: 'business', account_id: bChk, amount: usd(2000), category_id: cat('Consulting', 'income', 'business'), payee: 'BrightPath Solar', client_id: bright, description: 'Q4 QA audit & script rewrite', is_demo: D });

    // ---- Savings goals ----
    db.insert('savings_goals', { name: 'Emergency fund', type: 'emergency', owner: 'personal', target_amount: usd(10000), currency: 'USD', account_id: pSav, deadline: addMonths(ref, 18), monthly_target: usd(300), is_demo: D });
    const taxGoal = db.insert('savings_goals', { name: 'Tax reserve', type: 'taxes', owner: 'business', target_amount: usd(6000), currency: 'USD', starting_amount: usd(800), deadline: makeISO(parseISO(ref).y + 1, 4, 15), monthly_target: usd(500), notes: 'Set aside for annual taxes', is_demo: D });
    const vac = db.insert('savings_goals', { name: 'Vacation', type: 'vacation', owner: 'personal', target_amount: usd(2500), currency: 'USD', deadline: addMonths(ref, 8), is_demo: D });
    for (let k = 6; k >= 1; k--) {
      addContribution(db, taxGoal, usd(450), addDays(addMonths(monthStart(ref), -k), 27));
      addContribution(db, vac, usd(150), addDays(addMonths(monthStart(ref), -k), 27));
    }
    db.run('UPDATE goal_contributions SET is_demo = 1 WHERE goal_id IN (?, ?)', [taxGoal, vac]);

    // ---- Budgets (default every month) ----
    const B = (owner: string, name: string | null, amount: number, currency: string) =>
      db.insert('budgets', { owner, category_id: name ? cat(name, 'expense', owner as any) : null, amount, currency, is_demo: D });
    B('personal', 'Groceries', parseMoney('9000'), 'HNL');
    B('personal', 'Restaurants', parseMoney('4000'), 'HNL');
    B('personal', 'Gas', parseMoney('4500'), 'HNL');
    B('personal', 'Shopping', usd(150), 'USD');
    B('business', 'Advertising', usd(900), 'USD');
    B('business', 'Software', usd(500), 'USD');
    B('business', null, usd(10000), 'USD');

    // Tags
    const someTx = db.all<{ id: number }>("SELECT id FROM transactions WHERE is_demo = 1 AND payee = 'Airline'");
    for (const t of someTx) db.run("INSERT OR IGNORE INTO tags(name) VALUES ('trip'), ('vacation')");
    for (const t of someTx) db.run("INSERT INTO transaction_tags SELECT ?, id FROM tags WHERE name IN ('trip','vacation')", [t.id]);
    generateRecurring(db, 45, ref);
  });
}
