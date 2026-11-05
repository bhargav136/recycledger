# RecycLedger — Plastic Factory Management

A React Native + Expo + TypeScript application with Supabase authentication/database, local SQLite queue, Telugu/English UI, and PDF report export.

## Included
- Email/password sign-in through Supabase Auth
- Access restricted by RLS and app membership check to active `owner` / `admin` roles
- Dashboard and modules: purchases, production batches, sales, expenses, workers, inventory, accounts
- SQLite offline queue and retry sync
- Inventory triggers for purchase receipts, production output, scrap, and sale stock deduction
- Duplicate prevention for invoice numbers and production batch codes
- Financial summary separates purchases, COGS, operating expenses, cash paid/received, receivables and payables
- PDF export of the currently displayed records/report
- English and Telugu labels for primary navigation and sign-in

## 1. Requirements
- Node.js 20 LTS or newer
- npm
- Expo Go on Android, or Android Studio emulator
- A Supabase project

## 2. Install
```bash
npm install
```

Copy `.env.example` to `.env` and set:
```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```
Restart Expo after changing `.env`.

## 3. Set up database
1. Open Supabase Dashboard → SQL Editor.
2. Run all of `supabase/schema.sql`.
3. In Authentication → Users, create the owner account (or use the Supabase invite flow).
4. Run the following SQL, replacing values:
```sql
insert into public.factories(name) values ('My Plastic Factory') returning id;
-- Use the returned factory UUID and the owner's Auth user UUID:
insert into public.factory_members(factory_id,user_id,role,active)
values ('FACTORY_UUID','AUTH_USER_UUID','owner',true);
```
5. Create additional admin users in Supabase Auth, then insert them into `factory_members` with role `admin`.

Do not put the Supabase service-role key in the app. Only the anon/publishable key belongs in `.env`.

## 4. Run
```bash
npx expo start
```
Scan the QR code with Expo Go. For Android emulator:
```bash
npx expo start --android
```

## 5. Accounting notes and limitations you must understand
- Money is stored as integer paise; the UI converts rupees to paise.
- Purchases are treated as raw-material inventory acquisition, not operating expenses.
- Production batch costs are supplied by the operator and are summed as the current COGS proxy in the summary. This initial version does **not** implement FIFO/weighted-average inventory valuation or allocate COGS to individual sales. Do not use the summary as audited statutory accounts until a costing policy is implemented and reviewed by an accountant.
- `financial_summary` is a view. Supabase may require granting view access and configuring security-invoker semantics depending on your project's Postgres version/security settings. Verify RLS behavior before production use.
- Current inventory triggers handle inserts. Editing/deleting source rows is not exposed in this starter because inventory reversal logic must be transactional. Do not edit those rows directly in the database without reconciling stock.
- Offline insert queue retries records. A request that failed because of a validation/business-rule error is retained like a network failure; inspect it before retrying. Duplicate invoice/batch constraints help avoid duplicate financial rows.
- This is a functional starter, not a fully audited ERP. It does not yet include payroll attendance, payment voucher ledger, bank reconciliation, multi-warehouse, GST invoices/returns, advanced Excel export, or tested FIFO/weighted-average costing.

## 6. Type check
```bash
npm run typecheck
```

## Security
Never expose a Supabase service-role key in a mobile app. RLS is the security boundary. The client-side role check is for UX only; the database policies enforce authorization.
