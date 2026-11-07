# Fortress simulator phases

Evaluation runs in the browser from the posted snapshot and change list. It does not write snapshots, accounts, or orders. `/api/exposure` is unchanged and is used only when someone explicitly copies share counts.

Phase 2 is partial. Long-stock maintenance is implemented. Short-option margin is not, and a book that contains any option does not receive the long-stock number. A share-count import is blocked.

## Supported contracts

Equity and ETF positions with a signed share count. Single-name American or European calls and puts with an explicit multiplier, deliverable share count, and physical or cash settlement. A continuous dividend yield is used only when the book says dividends are an explicit zero or the yield is the only dividend. A cash dividend and a yield on the same name block the run.

Blocked, and kept on the book: exotic contracts, adjusted contracts without deliverable metadata, a missing multiplier, style, or settlement, a missing or stale quote vintage, and a pre-expiry option with no quoted vol. The engine does not fill those with the default vol.

Not built: broker portfolio margin, short-option margin, assignment probability, historical replay, and factor or geography scores.

## Phase 1 — ledger

Status: COMPLETE for the change forms below.

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

Status: PARTIAL. The long-stock path, the listed vanilla tree, assignment-once, and the unknown-input block are in. Short-option margin, a correlation panel, and a complete imported book are not.

Accepted for the part that is built:

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

## Phase 3

Status: NOT BUILT. Historical replay, proxy implied vol, expected shortfall, Monte Carlo, and stressed liquidity are not computed.

## Phase 4

Status: NOT BUILT. Sourced factor scores, revenue geography as fact, and fund look-through are not computed. The old weights view can still fall back to a demo geography map. The simulator does not use that map.

## Next slice, not in this branch

Adjusted-return correlation can use data the hub already fetches. No new paid feed.

Yahoo chart responses already include an adjusted close next to the raw close. `closesFromYahooChartResult` keeps only `indicators.quote.close`. The next slice should store that adjusted series under its own provider key, such as `yahoo-adjusted`, and leave Schwab `price_points` rows labeled as raw `/pricehistory` closes.

A correlation panel then needs one shared date set, a coverage count, and the names that were left out. A name without an adjusted series stays out of the matrix. The covariance has to be positive semidefinite on that common panel. A benchmark-down day is a date when the benchmark's adjusted return is negative. That work is phase 3.
