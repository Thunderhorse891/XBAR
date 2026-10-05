# Received-payment semantics recovery and verification

## Baseline

This branch preserves original PR #304 history, its recovered integration commit `9e998d4c` (tree `3b446067`), and current main `356084b`. The recovery merge resolved only the package test-list union. No customer records, payment provider actions, credentials or production schema were changed.

## Contract

- A Won lead establishes an agreed sale, not a payment.
- Applied sale receipts, unpaid sale balances, held deposits and other unapplied receipts remain separate.
- Only fully paid, priced and costed sales contribute to banked profit.
- Invalid/future receipt dates are rejected at all restore/import boundaries, not merely ignored until the calendar advances. Over-sale amounts cannot be capped into fully paid status.
- Explicit receipt totals include paid deposits; zero or smaller totals cannot silently erase a separately paid deposit. Explicit coordinated corrections remain available.
- Paid in full records the current local day as the latest receipt date.

## Independent-review cash-conservation correction

Two controlled cases failed before the correction:

1. A paid Won lead ($25,000 received including a $5,000 paid deposit) moved back to Offer through the actual store. No payment record changed, yet total recorded cash fell to $5,000.
2. A Won lead with an unknown agreed price and a known $5,000 paid deposit reported no recorded cash.

Receipts not applied to the selected priced Won sale are now separated into held deposits and other unapplied receipts. The first case remains $25,000 total cash ($5,000 deposit + $20,000 other unapplied receipts), with zero banked profit. The second preserves $5,000 of held cash without inventing a sale price. Valid cumulative receipts also survive a missing-price gap. A stage change is not treated as a refund.

The same totals flow into Money, Dashboard, Reports, CSV and PDF. Receipt status remains based on recorded evidence, not bank verification. The model does not fabricate transaction history, refunds or a bank balance.

## Evidence

Existing settlement and actual-store suites cover date validation, partial payments, deposit inclusion, corrections, contradictory values and import/hydration. New behavioral cases in `tests/saleSettlement.test.ts` and `tests/api/saleSettlementStore.test.mjs` preserve cash across actual reopening and unknown-price cases. A rendered-PDF regression checks unapplied receipts and total cash remain visible.

The local environment refuses the tsx CLI IPC socket; the complete registered test list is also executed using tsx's supported Node loader. Local Chromium cannot launch because its process-singleton socket is refused. Browser fixtures are retained for CI and must not be described as local passes.
