# Wallet / Credit Ledger — Production-Ready B2B Credit System

## Business Meaning
This wallet is a controlled B2B credit ledger, not a simple editable balance field.
For every retailer, Admin must know:
- Credit limit, total used, paid back, outstanding, available, overdue
- Payment history, adjustment history
- Who approved/changed limit, date and reason for every transaction

Every ledger transaction has:
- id, retailer_id, type, amount in paise (integer), signed debit/credit direction
- reference type/id (order, payment, adjustment, reversal)
- description, reason, created_by, created_at, notes, idempotency_key, metadata
- is_reversed, reversed_by/at, reversal_of

Transaction types: ORDER_DEBIT, PAYMENT_CREDIT, REFUND_CREDIT, MANUAL_CREDIT, MANUAL_DEBIT, CREDIT_LIMIT_CHANGE, ORDER_REVERSAL, ADJUSTMENT

## Architecture
Proper ledger, not simple editable field. Reuses existing retailer IDs and orders.

### Tables
- `retailer_credit_accounts` (id, retailer_id unique, credit_limit_paise bigint, allow_overdue bool, overdue_limit_paise bigint, created_at/updated_at, created_by/updated_by, notes, migrated_from_rupees)
- `retailer_wallet_ledger` (immutable, paise bigint, direction debit/credit, transaction_type enum, reference_type/id, description/reason, created_by/at, idempotency_key unique, metadata jsonb, is_reversed/reversed_by/at, reversal_of)

### Indexes
- idx_wallet_ledger_retailer (retailer_id, created_at desc)
- idx_wallet_ledger_retailer_type (retailer_id, transaction_type)
- idx_wallet_ledger_reference (reference_type, reference_id)
- idx_wallet_ledger_idempotency (idempotency_key)

### RPCs (server-authoritative, integer paise)
- `get_retailer_outstanding_paise(p_retailer_id uuid) -> bigint`
  Outstanding = legacy retailers.outstanding_balance*100 + sum(debits) - sum(credits) excluding CREDIT_LIMIT_CHANGE and reversed.
- `get_retailer_credit_limit_paise(p_retailer_id uuid) -> bigint`
  Reads retailer_credit_accounts, fallback to legacy retailers.credit_limit.
- `get_retailer_available_credit_paise(p_retailer_id uuid) -> bigint`
  limit - outstanding.
- `check_and_debit_retailer_wallet(p_retailer_id, p_order_id, p_amount_paise, p_idempotency_key, p_created_by, p_description) -> uuid`
  SELECT FOR UPDATE on credit account to prevent race, checks allow_overdue + overdue_limit_paise, returns existing id on idempotency hit, prevents duplicate order debit.

### Triggers
- `trg_retailer_credit_accounts_updated_at` — auto update updated_at
- `trg_sync_outstanding_on_ledger` — after insert/update/delete on ledger, sync legacy retailers.outstanding_balance (rupees) for backward compat
- `trg_audit_credit_limit` — after update on credit accounts, insert CREDIT_LIMIT_CHANGE ledger entry + sync legacy retailers.credit_limit

### RLS
- `retailer_credit_accounts`: retailer read own, staff read all, admin write
- `retailer_wallet_ledger`: retailer read own only (select), staff read all, admin insert/update only, no delete policy (immutable). Retailer cannot insert/update/delete.
- All mutations via server actions that check `requirePermission('retailers.edit' | 'retailers.manage_wallet')`

## Libs
- `lib/retailer/wallet.ts`: paiseToRupees, rupeesToPaise, formatPaise, getCreditAccount, getOutstandingPaise (RPC), getLimitPaise (RPC), getWalletSummary, getLedger, getLedgerPaginated (25/page)
- `lib/admin/wallet-actions.ts`: setCreditLimitAction, recordPaymentAction, recordAdjustmentAction, reverseTransactionAction — zod validation, idempotency, admin permission checks, revalidatePath
- `lib/orders/wallet-reversal.ts`: reverseOrderWalletDebit — finds original ORDER_DEBIT, creates ORDER_REVERSAL credit, marks original is_reversed
- `lib/orders/create-order.ts`: after order_items insert, calls RPC check_and_debit_retailer_wallet with atomic credit check, idempotency `order:{id}`, cancels order on insufficient credit
- `lib/admin/orders-actions.ts` + `lib/retailer/order-actions.ts`: on cancel, call reversal, revalidate wallet paths

## Admin UI
- `app/admin/wallets/page.tsx`: list retailers with credit account join, ledger aggregation for outstanding, paise calc, Manage link. Search.
- `app/admin/wallets/[id]/page.tsx`: detail with balance cards, limit/payment/adjustment forms, ledger table (100 rows), linked orders (20)
- Components: wallet-balance-cards, wallet-ledger-table (with reverse + reason prompt), wallet-payment-form (cash/bank_transfer/upi/cheque/other, paymentDate, reference, notes, idempotency), wallet-adjustment-form (credit/debit, type, reason required), wallet-limit-form (limit, overdue flag, overdueLimit, reason required)

## Retailer UI
- `app/retailer/account/ledger/page.tsx`: rewritten to use new wallet lib
  - Mobile-first 320/360/390/412, no horizontal overflow, safe-area insets pb-[calc(6rem+env(safe-area-inset-bottom))]
  - Clear balance cards: Credit Limit, Outstanding, Available Credit (green/red), overdue flag
  - Transaction list: mobile list + desktop table, debit/credit visually distinguishable (ArrowUpCircle red, ArrowDownCircle green), date/type/amount/reference readable
  - Shows only own data, hides internal details: no cost, no SKU, no other customers' balances, no admin notes, no internal audit details
  - Real data only: no fake rows, loading/empty states, over-limit warning
  - Payment instructions, credit position explainer, link to orders
- Checkout: `app/retailer/checkout/page.tsx` shows wallet summary (limit/outstanding/available) from RPC, over-limit warning, server-authoritative note, link to ledger

## Safety / Rules
- No data dropped, no existing column dropped, no RLS weakened
- All amounts integer paise, no float errors
- Outstanding = debits - credits, Available = limit - outstanding
- Ledger immutable — no delete, corrections via reversal/adjustment with audit reason
- Every balance-changing action requires amount, reason, confirmation, server-side authorization, Admin cannot delete transactions
- Only authorized Admin/staff may change limits; retailers cannot change own
- Server-authoritative credit calculations, prevent duplicate debit/credit via idempotency_key unique
- Race protection via SELECT FOR UPDATE
- Checkout integration atomic debit
- Payment recording with method/date/reference/notes
- Credit limit rules with allow_overdue + overdue_limit_paise
- Mobile wallet UI safe-area, no horizontal scroll
- Supabase only, no fake data, preserve auth/RLS/pricing/cart/checkout/GST/invoices/orders/Capacitor

## Testing
- Manual: place order -> ledger ORDER_DEBIT created, outstanding increases, available decreases
- Cancel order -> ORDER_REVERSAL credit created, original marked is_reversed, outstanding decreases
- Record payment -> PAYMENT_CREDIT reduces outstanding, increases available
- Set limit below outstanding without allow_overdue -> UI confirms, over-limit warning shows, checkout rejects new orders
- Duplicate idempotency key -> returns existing ledger id (order debit) or error (payment)
- RLS: retailer user can only select own ledger, cannot insert/update/delete

## Future
- Due dates, aging, statements PDF
- Payment reconciliation with bank feeds
- Credit scoring, auto limit adjustments
