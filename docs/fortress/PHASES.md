# Fortress simulator phases

Evaluation runs in the browser from the posted snapshot and change list. It does not write snapshots, accounts, or orders. `/api/exposure` is unchanged and is used only when someone explicitly copies share counts.

## Phase 1 — ledger

Accepted when these hold:

- A change set does not mutate the baseline snapshot.
- Repeating an operation id does not apply it twice.
- Borrowing raises settled cash and debt by the same amount, so NAV is unchanged before fees.
- A deposit is external capital. It is not realized profit.
- An internal transfer does not change external capital or NAV.
- Opening a short option records the premium as a receivable and the contract as a negative asset. NAV moves by the fee, not by the premium.
- A trim larger than the long quantity is rejected and does not open a short.
- Equity proceeds stay in a receivable until T+1. Settled cash does not include them on the trade date.
- A roll is a separate close fill and open fill, with realized P&L on the close.

## Phase 2 — one shared deterministic path

Accepted when these hold:

- Baseline and changed books see the same spot factors.
- Listed equity options are repriced on a Cox–Ross–Rubinstein tree. American nodes may exercise. European nodes are only a check against the closed form.
- An adjusted contract without complete deliverable metadata blocks the verdict. It is not omitted.
- A missing delta stays unknown. It is not stored as zero.
- Long-stock maintenance uses equity = value − debit and requirement = m × value. For value 100,000, debit 40,000, and m = 0.30, the critical decline is 42.857%. For m = 0.50 it is 20%.
- The first maintenance breach remains after a later recovery.
- A house hike is an assumption on the path, not new cash.
- A short put assigned at expiry adds shares and a strike payable. A longer long put is not exercised because of that assignment.
- Unitized drawdown ignores a deposit as profit. An unrecovered path is labeled "Not recovered by horizon." Nonpositive NAV is a survival failure and has no drawdown percent.
- The summary never says safe.

## Not built

Phase 3: historical replay, proxy implied vol, expected shortfall, Monte Carlo, stressed liquidity.

Phase 4: sourced factor scores, revenue geography as fact, fund look-through.

The raw close cache is not an adjusted total-return panel. Revenue geography still falls back to a demo map on the old weights view; the simulator does not use that map.
