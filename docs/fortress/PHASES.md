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

Status: PARTIAL. The long-stock path, the listed vanilla tree, assignment-once, and the unknown-input block are in. Short-option margin and a complete imported book are not. Adjusted-return correlation is a separate phase 3 subset.

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

Status: PARTIAL. Historical replay, proxy implied vol, expected shortfall, Monte Carlo, and stressed liquidity are not computed. The deterministic maintenance shortfall stays on the path scorecard and is not a tail probability.

The adjusted-return subset is in. It reads Yahoo chart `indicators.adjclose` only, stores it as provider `yahoo-adjusted` version `yahoo-adjclose-v1`, and does not write those values into `price_points`. A missing adjclose array is a gap. The chart close is not substituted.

Checked against Yahoo on 2026-11-07: AAPL 2020-08-28 chart close 124.81 versus adjclose 120.9557, and an early-January 2015 bar at 27.3325 versus 24.1718. The latest session matched. CL=F and BTC-USD returned an adjclose array equal to the chart close in a five-day sample. Schwab `/pricehistory` closes stay on provider `schwab`.

Before and after correlations use one common date set. A name with fewer than 60 returns is excluded as short history. Matching a shorter candidate drops the baseline dates that do not overlap, and that count is shown. Full, 63-day rolling, and benchmark-down correlations each carry an observation count. Benchmark-down dates are dates when the benchmark adjusted return is negative. The sample covariance is built on that same panel and checked for positive semidefiniteness. Risk contribution is `w_i * (Sigma w)_i / sigma`. Negative weights and negative contributions are kept, and the contributions sum to sigma. A zero variance or a zero denominator stays unknown.

A typed ticker, share count, and price become the scenario. Cash and debt count as recorded only when the person checks that they were entered, including zero. The share-count import remains incomplete. Option correlation uses the underlying as a linear delta proxy and says so. Missing delta, missing adjclose, option margin, and broker rules stay unknown. An unknown adjusted-return panel blocks a pass. It does not erase a maintenance breach.

## Phase 4

Status: NOT BUILT. Sourced factor scores, revenue geography as fact, and fund look-through are not computed. The old weights view can still fall back to a demo geography map. The simulator does not use that map.

## Still not built

Expected shortfall, Monte Carlo, historical path replay, proxy implied vol, factor scores, revenue geography, and fund look-through. `closesFromYahooChartResult` still returns the raw chart close for the existing benchmark cache. That function is not the adjusted series.
