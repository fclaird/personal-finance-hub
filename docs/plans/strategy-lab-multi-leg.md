# Plan: Strategy Lab on a general multi-leg engine

**Status:** Plan only. No feature code in this change.  
**App:** `apps/finance-hub` (Next.js, local SQLite).  
**Chinese wall:** Information only. This work does not place orders, preview orders, or set `FINANCE_HUB_ALLOW_BROKER_ORDERS`. Margin figures below are sizing proxies for the chart, not a Schwab margin call.

**Do not merge implementation to `main`.** Land the work as draft PRs stacked on the branch named below. This plan PR is a draft for review and is not a feature merge.

---

## Goal

Strategy Lab can buy and sell puts as well as calls, and can build straddles, strangles, condors, butterflies, synthetics, collars, calendars, and diagonals. Every structure is a list of legs. Charts, greeks, leverage, and sizing run on that list.

The pricing surface stays the one already used by the call-debit optimizer: Black–Scholes–Merton, rate **4%**, dividend yield **0**, and **one** average IV for the whole underlying. Quoted mids stay the entry price. The shared IV is for greeks, pre-expiry curves, and probability.

---

## Where to branch

`main` is `800aeb8` (PR #181, Strategy Lab phase 2). Puts already exist in the kernel there. The chart, leverage, and optimizer work that this plan must keep is **not** on `main`. It is the stack below. Tips were read on 2026-10-12.

| PR | Branch | Base | What it adds |
| --- | --- | --- | --- |
| #183 | `cursor/strategy-lab-one-chart-cb18` | `main` | Viewport-capped charts, opt-in zoom, shared `StrategyPlot`, position-delta chart, `matchExpensive` sizing, target board |
| #184 | `cursor/call-debit-optimizer-cb18` | #183 | Call debit spread optimizer. `modelAssumptions.ts`: 4%, no dividends, average ATM IV. Tile metrics: leverage now (omega), peak leverage, max profit multiple, return on debit |
| #185 | `cursor/full-width-pages-cb18` | #184 | Full window width. No lab math |
| #186 | `cursor/profit-crossover-zoom-cb18` | #185 | Default P&L and delta windows open on the profit-side crossovers |

**Rebase target:** `cursor/profit-crossover-zoom-cb18` (tip `529a860` when this plan was written). That commit already contains #183, the spread optimizer, full-width layout, and profit-side zoom. Branch the first implementation PR from that tip. Keep later PRs stacked on it. If #186 merges before this work starts, rebase onto the `main` commit that contains it and drop the stack note.

**Do not branch from `main`.** A multi-leg engine written there will miss `packageOutlay`, `targetMetrics.ts`, `deltaCurves.ts`, `chartView.ts`, and `modelAssumptions.ts`, and will collide with all four PRs.

**Do not branch from #188.** #188 (`cursor/events-iv-spread-notify-cb18`) stacks on #187 (`cursor/events-watchlist-alerts-cb18`), which stacks on `main`. It does not touch `src/lib/strategyLab`. It shows an ATM straddle (call mid + put mid) and an IV move from **feed** IV on the events page, and it groups live positions by expiry for a profit alert. Those are cousins of this work. Leave them on their own stack. The lab average IV is solved from mids at 4% and zero dividends (`underlyingModelIv`). The events IV move uses the chain's feed IV. Keep the two formulas separate.

### Phase 3 sits beside the chart stack

PR #182 (`cursor/strategy-lab-phase3-cb18`, off `main`) adds position import, `strategy_lab_snapshots`, a future-date vol shift, and a **sidecar** `StockLeg` (`{ shares, averagePrice }`) next to option legs. It is not an ancestor of #186.

These files differ from `main` on **both** #182 and the #186 tip, so a naive rebase of #182 onto #186 conflicts:

- `src/lib/strategyLab/lab.ts`
- `src/lib/strategyLab/internal/pricing.ts`
- `src/lib/strategyLab/scenarioStore.ts`
- `src/app/components/strategyLab/StrategyLabPage.tsx`
- `src/app/components/strategyLab/StructureCard.tsx`
- `src/app/components/strategyLab/ScenarioBar.tsx`

**Do not merge #182 first and do not rebase this work onto #182.** Fold the import, the snapshot table, and the vol shift onto the leg model in the last phase (Phase G). The sidecar stock field goes away in that fold; shares become a leg.

---

## What is true on the #186 tip

`src/lib/options/blackScholes.ts` is the only pricer. `bsmPrice`, `bsmGreeks`, and `impliedVol` already take `right: "C" | "P"`. Put delta is `e^{-qT}(N(d1) − 1)`. A parity test with a dividend yield already exists. **Do not add a second put formula.**

`priceLegs`, `expiryValue`, `packageGreeks`, and `packageShareDelta` already pass `right` through. `strikeDelta.ts` already solves call and put deltas. The chain grid can append a put onto a custom structure.

The product is still call-shaped:

- `TEMPLATE_CATALOG` is call debit, ZEBRA, long call, synthetic long, short strangle, custom.
- The add-structure form's "Custom" choice submits two **calls** (`StrategyLabPage.addStructure`).
- The strike board for every template except the short strangle's put wing is the **call** board.
- `callSpreadOptimizer.ts` hardcodes `right: "C"` via `CALL_LEGS` and `greeksInput`.
- `shortCallStrike` in `targetMetrics.ts` is the default target. A put spread has no short call, so the target read is empty.
- `expiryRisk` treats only `slopeAbove < 0` as unbounded loss. A naked short put has a flat upside and a −100 downside slope, so today it is stored as a finite loss-at-zero.

---

## Part 1 — Unified leg model

### Files and modules

| Path | Change |
| --- | --- |
| `src/lib/strategyLab/legs.ts` | **New.** Leg type, side/quantity helpers, v1 → v2 migration |
| `src/lib/strategyLab/legs.test.ts` | **New.** Migration and sign rules |
| `src/lib/strategyLab/lab.ts` | `StructureSpec.legs` becomes `Leg[]`. Drop the single `expiry` as the only date. Edits: `addLeg`, `setSide`, `setQuantity`, `setExpiry`, `setInstrument`, `setEntry` |
| `src/lib/strategyLab/internal/pricing.ts` | Price each option leg on its own expiry. Stock is a leg, not a sidecar |
| `src/lib/strategyLab/modelAssumptions.ts` | Already on the tip. `evaluateLab` reads `underlyingModelIv`, `MODEL_RATE` (0.04), `MODEL_DIVIDEND_YIELD` (0) |
| `src/lib/strategyLab/scenarioStore.ts` | Parser v2. Read v1 and the #182 sidecar |
| `src/lib/options/blackScholes.ts` | No new math. Add put-delta and same-IV synthetic tests in `blackScholes.test.ts` |
| `src/lib/strategyLab/internal/templates.ts` | Emits `Leg[]`. Old template ids still parse (Part 3) |

### Data model

```ts
type Instrument = "call" | "put" | "stock";
type Side = "long" | "short";

type Leg = {
  id: string;
  instrument: Instrument;
  side: Side;
  /** Contracts, or shares. Always positive. */
  quantity: number;
  /** Null for stock. */
  strike: number | null;
  /** Null for stock. Each option leg has its own expiry. */
  expiry: IsoDate | null;
  entry: { kind: "mid" | "natural" | "limit"; price: number | null };
  /** Null means "use the underlying's one model IV". Ignored for stock. */
  ivOverride: number | null;
};
```

Signed size is `side === "long" ? quantity : -quantity`. Option dollars use multiplier 100 (`optionContractMultiplier`). Stock dollars use multiplier 1.

A structure is `{ id, label, slot, legs, origin, capitalOverride, resolveError }`. `LAB_LIMITS` stays at 4 structures. Raise `legs` from 6 to **8** so an iron condor (4) plus a stock hedge still fits. Phase 3's contract cap of 100 stays for imports; the builder may type a smaller quantity. Reject a zero quantity and a non-positive strike on an option.

**One IV.** At evaluate time, every option leg with `ivOverride == null` gets `underlyingModelIv(chain)`: the average of solved at-the-money call and put mids across loaded expiries, rate 0.04, dividend 0. The optimizer already stamps that number onto both legs of a loaded call spread (`setIvOverride`). Keep that stamp so a loaded scan row does not drift when the chain refreshes. Templates do not stamp; they follow the live average. Per-leg solved mid IV remains a **display** field (`quoteIv`) so skew stays visible. Curves, greeks, probability, and peak leverage use the model IV only.

**Entry vs model.** The debit or credit is the quoted fill: mid, natural (ask if buying, bid if selling), or a typed limit, summed across legs. Model price is `bsmPrice` at the shared IV. A synthetic's chart tracks the stock when the **model** marks share one IV. The quoted debit can sit off parity; show that gap, and do not silently replace the quote with the model price.

**Rate and dividend.** Freeze model marks at 0.04 and 0, matching `modelAssumptions.ts`. The page can keep showing those two numbers. Editing them must not create a second surface. Remove the live effect of `assumptions.dividendYield` and a free-typed rate on greeks, or clamp the controls to the constants. Quote IV for display still solves at those same constants.

**Per-leg expiry.** `markAt` today takes one structure expiry. Change it to price leg `i` with `calendarDaysBetween(horizonDate, leg.expiry) / 365`. On a horizon past that expiry, the leg is intrinsic. A calendar's near short settles while the far long is still a model price. The horizon ladder runs to the **latest** option expiry. Draw a tick at each earlier expiry. `quartersToAnchor` uses that latest date as the anchor. `ownHalfway` uses the latest date as well.

### Migration

Browser key today: `fh.strategyLab.scenarios.v1` storing `{ v: 1, scenarios }`. Write `fh.strategyLab.scenarios.v2` and `{ v: 2, scenarios }`. On read of v1 (and of a v1 snapshot JSON):

| v1 | v2 |
| --- | --- |
| `right: "C" \| "P"`, `ratio` signed integer, structure `expiry` | `instrument` call or put, `side` from the sign, `quantity = abs(ratio)`, `expiry` copied onto the leg |
| structure `entry` mid / natural / limit net | same `entry.kind` on every option leg; a limit net stays a **structure-level** `entryNet` because v1 stored one package price, not a price per leg |
| `ivOverride` | kept |
| #182 `stock: { shares, averagePrice } \| null` | one stock leg, side from the sign of `shares`, quantity `abs(shares)`, entry limit at `averagePrice` |
| missing `stock` | no stock leg |

If the v1 parser would have rejected the row, drop that scenario and keep the others. Leave the v1 key in place until a successful v2 write, then leave it as a fallback read. Do not delete v1 on a failed parse.

#182 snapshots (`strategy_lab_snapshots.scenario_json`) use the same function on load. Do not rewrite SQLite rows in place.

### API

No new route. `GET /api/strategy-lab/chain` stays read-only. Math stays in the client and in `src/lib/strategyLab`. Snapshot routes are Phase G and stay local SQLite, off the MCP allowlist, as #182 already specified.

### UI

No new controls in this part beyond the assumption label already returned by `modelAssumptionLabel`. Structure cards list legs as "long 1 call" / "short 1 put" / "long 100 shares" once the type exists. Full editor is Part 4.

### Tests

- v1 call debit, ZEBRA, synthetic, short strangle, and custom round-trip into v2 legs.
- A #182-shaped structure with `stock` becomes a stock leg and the sidecar field is absent.
- Put-call parity at rate 0.04, dividend 0, one vol: `call − put = spot − strike * e^{-rT}` within `1e-8`.
- Same inputs, package delta of long call plus short put is within 0.05 shares of 100 at three spots.
- A two-expiry structure: before the near expiry both legs are model prices; after it, the near leg is intrinsic and the far leg is still model.
- Existing quote-IV acceptance numbers (the 55.2 / 53.8 style pins in `acceptance.test.ts`) stay on `quoteIv`. Re-baseline any assertion that reads **model** greeks, and say so in the test name.

### Risks

- One IV moves model greeks off the per-leg mids the phase 0–2 tests locked. Quoted debits stay on the mids.
- v1 limit orders are a package net. Spreading that net across legs would invent prices. Keep `entryNet` for those rows.
- American short puts can be exercised early. The kernel is European. Say that on the card when a short put is open. Do not switch models.
- Raising the leg cap changes `scenarioStore` validation. Old rows with 1–6 legs still load.

### Rough size

About 700 lines across `legs.ts`, `pricing.ts`, `lab.ts`, `scenarioStore.ts`, and tests. `blackScholes.ts` itself stays put.

---

## Part 2 — Synthetic template

### Audit (it builds the right legs and the wrong position)

`resolveTemplate` for `syntheticLong` already returns long 1 call and short 1 put, and it refuses the add when the call snap and the put snap land on different strikes (`internal/templates.ts`). `phase2.test.ts` locks that shape: `["C", 140, 1]` and `["P", 140, -1]`.

Three behaviors still come out wrong. The fixture chain is spot 140, call 140 bid/ask 19/21, put 140 bid/ask 14/16, rate 0.04, dividend 0, expiry 2027-01-15, trade date 2026-10-08.

1. **Two vols.** Each leg solves IV from its own mid. Call IV and put IV differ, so `N(d1)` does not cancel. With one shared vol and dividend 0, call delta minus put delta is exactly `e^{-qT} = 1` per share at every spot. Split IVs break that, so the delta chart does not sit on 100 shares.
2. **Quoted debit is not the financing debit.** The test locks debit **$500** (mids 20 and 15). Parity at these dates is about **$1.51 per share** (`spot − strike * e^{-rT}`), about $151 a package. Expiry P&L is then `(S_T − 140) * 100 − 500`, which is not 100 shares minus financing.
3. **Sizing uses ruin at spot 0.** `expiryRisk` reports max loss **$14,500** (the short put at spot 0, plus the $500 debit). Equal-capital sizing on $10,000 therefore buys **0 packages**. The card copy says the blank risk number "uses the loss at spot 0" and that there is "no margin formula." On the #186 tip, `matchExpensive` uses `packageOutlay`, which prefers a positive debit, so this one template would size on $500 under that basis only. `equalCapital` still uses max loss. Part 5 makes every basis share one package-cost rule. A synthetic long's package cost is its debit. Loss-at-zero stays a statistic on the card.

The add form also picks the strike from the **call** board only. A put list that does not contain that strike fails the whole add.

### The identity the test locks

One package, same strike `K`, same expiry, one vol, rate `r`, dividend 0, entry equal to the parity debit `(S0 − K e^{-rT}) * 100`:

- Model delta is 100 shares at spot, at `0.8 * spot`, and at `1.2 * spot` (tolerance 0.5 shares).
- Expiry slope is +$100 per $1 of spot.
- Expiry P&L minus the P&L of 100 shares bought at `S0` equals `−K * 100 * (1 − e^{-rT})` at three spots (tolerance $1). That constant is the financing on the strike.

Also assert the template still emits long call + short put at one strike, and that two different snapped strikes return the existing error instead of a risk reversal.

### Files

`internal/templates.ts` (keep the leg shape, stop depending on two independent snaps when the user picked one strike), `internal/pricing.ts` (shared IV from Part 1), `phase2.test.ts` (replace the "0 packages" and "$500 debit" assertions with the identity above), new `src/lib/strategyLab/synthetic.test.ts`.

### API, UI, migration

No route change. The synthetic row in a v1 scenario migrates as two legs in Part 1. The card shows delta near 100 and the financing gap `(quoted debit − parity debit)`.

### Risks

Rewriting `phase2.test.ts` without the shared IV will re-lock the bug. The identity uses the **parity** entry; a second assertion can show the quoted $500 debit shifting the level and leaving the slope at +100.

### Rough size

About 150 lines. Depends on Part 1.

---

## Part 3 — Template library

Templates only prefill legs. The builder (Part 4) can edit any leg afterward. `origin.tracking` stays: while tracking is on, changing the target strike or delta retargets the template; the first manual leg edit sets tracking off (`retarget` already exists).

### Catalog

Strikes resolve with the existing `nearestStrike` / `nearestDeltaStrike`. Delta targets are absolute values; put resolution uses the put board (negative model delta) and call resolution uses the call board.

| Id | Prefill | Notes |
| --- | --- | --- |
| `longCall` | long 1 call | Exists |
| `longPut` | long 1 put | |
| `callDebit` | long call `K1`, short call `K2`, `K1 < K2` | Rename of `callDebitSpread`. Old id parses as this |
| `putDebit` | long put `K2`, short put `K1`, `K1 < K2` | Long the higher strike |
| `callCredit` | short call `K1`, long call `K2`, `K1 < K2` | |
| `putCredit` | short put `K2`, long put `K1` | |
| `longStraddle` | long call + long put, one ATM strike | |
| `shortStraddle` | short call + short put, one ATM strike | Undefined both sides |
| `longStrangle` | long put below, long call above | |
| `shortStrangle` | short put below, short call above | Exists. Default targets **15 delta** each side (income book). Typed strikes override |
| `ironCondor` | put credit + call credit, `K1 < K2 < K3 < K4` | Short the body |
| `ironButterfly` | short call and short put at one body strike, long put `K_low`, long call `K_high` | Body is ATM |
| `callButterfly` | long 1, short 2, long 1 calls, equal width | |
| `putButterfly` | same with puts | |
| `syntheticLong` | long call + short put, one strike | Part 2 |
| `syntheticShort` | short call + long put, one strike | |
| `riskReversal` | short put below, long call above | Bullish. Same-strike call+put is the synthetic, not this |
| `collar` | long 100 shares, long put below, short call above | |
| `coveredCall` | long 100 shares, short 1 call | Do not label a naked short call as covered. Covered requires the stock leg |
| `cashSecuredPut` | short 1 put | Package cost is `strike * 100` (Part 5) |
| `calendar` | short front expiry, long back expiry, **same strike**, call or put chosen on the form | Part 1 per-leg expiry |
| `diagonal` | short front, long back, **different strikes** | Front strike further OTM than the back strike in the direction of the right |
| `zebra` | long 2 calls, short 1 call, same expiry, long strike below short | Exists. Stays same-expiry. A different-expiry zebra is a diagonal the user edits |
| `custom` | one empty structure, or the legs the user already typed | The form must not invent two calls |

Old ids `callDebitSpread`, `syntheticLong`, `shortStrangle`, `zebra`, `longCall`, `custom` remain in the v1 parser and map to the rows above.

Width inputs accept a list such as `10, 25` the way the call optimizer's `parseWidths` does. Blank width means the next listed strike.

### Files

`internal/templates.ts`, `scenarioStore.ts` (`parseTemplate`), `StrategyLabPage.tsx` (catalog dropdown only; the editor is Part 4), `phase2.test.ts`, new `templates.test.ts`.

### API, migration, UI

No route. Saved v1 template names migrate through `parseTemplate`. The dropdown lists the catalog in the order above, grouped by label (debit, credit, volatility, stock-combined, calendar). Dark mode uses `labControl` / `labLabel` from `palette.ts`. Native selects keep `color-scheme: dark`.

### Tests

One assertion per template: instruments, sides, strike order, and expiry count. Iron condor has four strikes in order. Calendar has one strike and two expiries. Collar and covered call include a stock leg of 100. A naked short call does not receive the covered-call label. Short strangle defaults resolve near 15 delta on a chain that has that delta. ZEBRA stays 2 and −1 calls, same expiry.

### Risks

- Butterfly width that cannot fit three listed strikes returns a resolve error, same as today's collapsed call spread.
- Iron butterfly and iron condor are easy to swap. The test locks the body: condor shorts two different strikes; butterfly shorts one strike twice (call and put).
- Calendar with a missing far expiry snaps with `snappedFrom`, which the page already explains.

### Rough size

About 500 lines in `templates.ts` and tests.

---

## Part 4 — Free-form builder

### UI

Replace the two strike boxes with a leg table on the structure card and on the add form.

Each row:

- Instrument: call, put, stock
- Side: buy, sell (stored as long, short)
- Quantity
- Expiry (options only; listed expiries for that underlying)
- Strike picker (options only)
- Entry: mid, natural, or a limit price per leg

**Add leg** appends a row, default long call at the strike nearest spot, quantity 1, mid. **Remove** drops that row. Removing the last leg removes the structure (the #182 rule).

The strike picker lists strikes for the **selected right** and shows that right's model delta. Calls are positive, puts are negative. Keep the 50 and 75 chips. Add a 15 chip for short premium. `StrikeSelect.tsx` and `strikeDelta.ts` already render a board per right; the add form currently passes only the call board except for the strangle put wing (`StrategyLabPage`, `longBoard`).

Choosing a template calls the same `addStructure` path with prefilled legs and `tracking: true`.

Chain grid bid/ask clicks keep adding a leg to an open custom structure on that expiry (`addChainLeg`). A click on a put asks for a put row. A click when no custom structure is open still creates one.

Dark mode: solid `dark:bg-zinc-900` fields, `border-zinc-400`, labels `text-zinc-300` on `zinc-950`. No `white/10` borders. New series colors come from `LAB_PALETTE.series` only.

### Files

`StrategyLabPage.tsx`, `StructureCard.tsx`, `StrikeSelect.tsx`, `ChainGrid.tsx`, new `LegEditor.tsx`, `lab.ts` edits from Part 1.

### API, data model

No route. Edits are the Part 1 `LabEdit` variants. A template retarget rewrites legs and clears per-leg limit prices back to mid.

### Tests

Component tests are thin in this app. Cover the edit reducer: add put, add stock, change side, change expiry, cap at 8, drop the last leg, template prefill then a manual edit clears `tracking`. A chain-grid put click produces `instrument: "put"`.

### Risks

Four structures times eight leg rows is a dense card. Keep the row to one line at the `sm` breakpoint and wrap below that. Verify at 1280 and 390 px wide, dark scheme, after Part 6 so the charts below the fold still fit the viewport.

### Rough size

About 600 lines, mostly UI.

---

## Part 5 — Undefined risk, margin proxy, both breakevens

### Rules

Classify from terminal slopes in dollars per $1 of spot, not from the template name.

| Shape | Upside slope | Downside slope | Package cost |
| --- | --- | --- | --- |
| Debit (long call, long put, debit spread, long straddle/strangle, synthetic long, long butterfly) | ≥ 0 | ≥ 0, or a finite floor | The debit. Synthetic long included |
| Credit spread, short butterfly, iron condor, iron butterfly | 0 at the wing | 0 at the wing | Defined max loss: width × 100 × quantity minus the credit |
| Cash-secured put, naked short put | 0 | −100 × contracts | `strike × 100 × contracts`. Label: cash-secured proxy. This is `optionMarginSecuredDollars` in `src/lib/options/optionMarginRoi.ts`. Do not call Schwab |
| Naked short call, short straddle, short strangle, synthetic short, uncovered risk reversal | negative | short straddle/strangle also negative on the downside | Put side: cash-secured proxy. Call side: a typed dollars-at-risk number, required. Short strangle shows both and sums them once the call side is typed |
| Covered call | 0 above the strike if shares cover the short calls | stock downside | Debit of the shares minus the call credit. Not undefined |
| Collar | capped | floored by the long put | Net debit of shares plus put minus call |

`expiryRisk` today sets `maxLoss` from `slopeAbove` only. Extend it:

- `maxLossUp`: `"unbounded"` when upside slope &lt; 0, else the worst loss on the upside piece
- `maxLossDown`: the loss at spot 0 when downside slope &lt; 0 (the stock floor), and the label "to zero"
- `breakevens`: both roots. The knot walk already collects every sign change; add a fixture that a short strangle and a short straddle return two, and a short put returns one
- A short put is **not** given a finite `maxLoss` that equal-capital treats as optional. It uses the cash-secured package cost even though spot 0 is a floor

`packageOutlay` on the #186 tip is the single function every basis must call (`matchExpensive`, `equalCapital`, `perPackage`). Replace the split where `equalCapital` still sizes off raw `maxLoss`.

Typed `capitalOverride` still wins. The card copy for a naked call is "Required. Undefined risk. No broker margin." The card copy for a short put is the cash-secured dollars, editable.

Match-the-most-expensive (default basis on the tip) takes the max of those package costs. A credit must not price as a zero-cost package and then dominate the comparison. Idle cash stays out of omega (Part 6).

Flag undefined risk in the existing issue channel (`needs-capital`) and on the card. Do not write an alert row and do not open an order ticket.

### Files

`internal/pricing.ts` (`expiryRisk`), `lab.ts` (`packageOutlay`, `sizeOf`, `matchedBasis`), `StructureCard.tsx` (the dollars-at-risk block that currently special-cases template names), `src/lib/options/optionMarginRoi.ts` (reuse, do not fork), tests in `phase2.test.ts` and new `riskBudget.test.ts`.

### API, migration

No route. v1 `capitalOverride` remains the typed risk budget.

### Tests

- Short strangle: two breakevens, upside unbounded, downside to zero, sizing waits until the call-side number is set, put side contributes `putStrike * 100`.
- Short put: package cost `strike * 100`, one breakeven, not 0 packages solely because loss-at-zero exceeds capital.
- Synthetic long: package cost equals the debit, loss-at-zero is reported and is not the cost.
- Call credit spread: package cost equals width × 100 minus credit.
- Covered call with 100 shares and one short call: not undefined. A short call with no stock leg: undefined.
- `matchExpensive` picks the structure with the larger package cost.

### Risks

The cash-secured proxy is larger than portfolio margin and smaller than a gap through a short call. The label has to say proxy. Do not invent a Reg-T formula in this pass.

### Rough size

About 350 lines.

---

## Part 6 — Charts and metrics on legs

Everything in this list already exists on the #186 tip. Re-point it at `Leg[]`. Do not add a second chart stack.

| Metric | Where | Leg rule |
| --- | --- | --- |
| P&L vs spot, several dates | `LabCharts.tsx`, `markAt` | Sum of leg marks. Each option uses its expiry and the model IV. Stock mark is `shares × spot` with sign |
| Delta vs underlying | `deltaCurves.ts` | Put delta negative. Stock delta is the signed share count. Expired option legs use the intrinsic slope |
| Leverage now (omega) | `positionLeverage` in `targetMetrics.ts` | `(share delta × spot) / debit`. Blank when the debit is not positive (credits). Idle cash stays out. A synthetic long will show a high omega because delta is ~100 and the debit is the small parity debit. That is the definition already shipped |
| Peak leverage | `peakOmega` | Highest omega on **today's** curve, with time left. Not the expiry share count |
| Max profit multiple | `tileMetrics` | Max profit at expiry / debit. Uncapped when upside slope &gt; 0 (long call, synthetic long). Credits use profit / package cost from Part 5, labeled return on risk, not omega |
| Return on debit at target | `readTarget` | P&L at the target spot and date / debit. Credits use the Part 5 package cost as the denominator |
| Target spot | `shortCallStrike` | Generalize to `targetStrike`: short strike of a vertical (call or put). A straddle or strangle has no single short strike; leave the typed target, and let the default zoom come from crossovers |
| Profit-side default zoom | `profitCrossoverView` in `chartView.ts` | Keep it as the default for P&L and delta. See the two-wing note below |
| Most expensive package | `matchExpensive` | Part 5 package cost |
| Viewport cap, opt-in zoom | `StrategyPlot.tsx`, `chartDisplay.ts` | Height `clamp(420px, 70vh, 900px)`. Width 100% with `min-width: 0` and a ResizeObserver. Wheel scrolls the page until Interact or a click. Session-only; not written to `fh.strategyLab.chart.v1` |
| Dark canvas | `palette.ts` | Lines ~3px from `LAB_PALETTE`. Stock is the light gray dashed series. Axis and zero line stay `zinc-200` or lighter. No new hex |

**Two-wing payoffs.** `profitCrossoverView` spans the first crossover to the last. For a short strangle the profit sits **between** the breakevens, so that span is the profit side. For a long strangle the profit sits **outside** the two breakevens, so that span is the loss trough. When more than one profit region exists, fit the union of the regions that contain positive P&L, and if that union is almost the whole axis, fit the region that contains spot. `positiveCrossovers` in `chartDisplay.ts` is the input. Add a fixture for both shapes.

**Stock line.** Today the stock series is a percent move on the match capital. Also offer the 100-share line used by the synthetic test, so a synthetic and the stock can be read on the same scale. Default remains the capital-scaled line from the tip. The 100-share line is a toggle, session-only.

**Optimizer.** Leave `scanCallSpreads` as a call-debit scan. Build its loaded structure through `callDebit` legs plus the IV stamp it already applies. Do not generalize the heatmap in this plan. A put scan can be a later plan. `spreadShareDelta` should call `packageShareDelta` so there is one greek path; it may keep passing two calls.

### Files

`internal/pricing.ts`, `deltaCurves.ts`, `targetMetrics.ts`, `chartDisplay.ts`, `chartView.ts`, `LabCharts.tsx`, `StrategyPlot.tsx`, `TargetBoard.tsx`, `ExpirySummary.tsx`, `callSpreadOptimizer.ts`. Tests: `targetMetrics.test.ts`, `deltaCurves.test.ts`, `chartView.test.ts`, `chartDisplay.test.ts`, `callSpreadOptimizer.test.ts`.

### API

No route.

### Tests

- Long put and put debit produce a delta curve below zero in the body and a finite debit.
- Synthetic delta curve is flat near 100 before expiry (Part 2).
- Credit spread omega is blank; return on risk equals profit / (width × 100 − credit).
- Calendar curve kinks on the near expiry date: the near leg's theta drops out and the far leg remains.
- Long-strangle default window includes a wing. Short-strangle default window sits between the breakevens.
- Chart height class or the fit helper still caps at 70vh. Zoom helper tests stay green without a gesture.

### Risks

- `LabCharts.tsx` on the tip is large. Edit the data fed into `StrategyPlot`, not the pointer math.
- Profit-region fitting can clip a second wing. The fixture above is the guard.
- Peak leverage scans every axis point. Eight legs is fine; do not add a second IV scenario to that loop.

### Rough size

About 500 lines of edits and tests on top of the tip. High conflict rate if #186 moves.

---

## Part 7 — Fold Phase 3 imports onto the legs

Do this after Parts 1–6, by replaying #182's behavior onto the leg model. Do not merge #182 onto the branch.

### Bring across

| #182 piece | On the leg model |
| --- | --- |
| `positionsImport.ts`, `HeldPositions.tsx` | Group `GET /api/positions` by underlying and expiry as today. A checked book becomes legs (`instrument` from `C`/`P`, side from the quantity sign, entry limit at average cost). A share lot becomes a stock leg. Let the user check two expiries and get **one** structure (a held calendar). #182 cannot, because it groups one expiry per book |
| Copy to compare | Second structure, same legs, label `alt 2` |
| Privacy mask | Keep. Dollars on the card use the existing mask |
| `strategy_lab_snapshots` | Same table as #182's `schema.sql`: `id`, `created_at`, `symbol`, `scenario_json`, `quotes_json`, `provenance_json`, `summary`. `scenario_json` stores a v2 scenario. Loader runs the Part 1 migrator so a row saved by an old #182 build still opens |
| Routes | `GET` / `POST` / `DELETE /api/strategy-lab/snapshots`. Local SQLite only. Update `docs/icarus/HUB_API_MAP.md` and `scripts/check-api-routes.mjs`. Not on the MCP allowlist |
| Vol shift | One lab-level shift, vol points or percent of the **model** IV, future horizons only. Entry debit does not move. Badge and reset as in #182. Expiry zones stay intrinsic |
| xlsx export | Still out |

Import reads positions. It does not add a broker route. Legs above 100 contracts stay out, with the same oversized count.

### Files

From #182, adapted: `positionsImport.ts`, `phase3.test.ts`, `snapshotStore.ts`, `snapshots.ts`, `HeldPositions.tsx`, `src/app/api/strategy-lab/snapshots/route.ts`, `src/db/schema.sql`, `ScenarioBar.tsx`, `HUB_API_MAP.md`.

### Tests

#182's phase3 tests, rewritten so the held covered call is a stock leg plus a short call, the average-cost debit matches, and a two-expiry selection is one structure. Vol shift moves a pre-expiry put mark and leaves the entry debit fixed. Snapshot parse rejects a bad id and a non-object scenario.

### Risks

`schema.sql` on `main` has no `strategy_lab_snapshots` yet. Adding it in this phase is the migration. If someone merged #182 in the meantime, do not `CREATE` a second shape; the columns above match #182.

### Rough size

About 600 lines, mostly a port. Largest risk is the six-file overlap listed at the top.

---

## Recommended sequence

Each phase is a draft PR stacked on the previous one, parented on `cursor/profit-crossover-zoom-cb18`. None merge to `main`.

| Phase | Contents | Depends on | Size |
| --- | --- | --- | --- |
| A | Part 1. Leg type, shared IV wired through `evaluateLab`, v1 parser, per-leg expiry in `markAt`. Old templates still emit the new legs. Call debit tiles still render | #186 tip | Large |
| B | Part 2. Synthetic identity test and the single-strike snap. Fix the phase 2 assertions that lock $500 and 0 packages | A | Small |
| C | Part 5 package-cost rules and both breakevens, before the new templates ship their cards | A | Medium |
| D | Part 3 catalog, including calendar and diagonal prefills | A, B, C | Medium |
| E | Part 4 leg editor and strike boards for both rights | D | Medium |
| F | Part 6. Charts, omega, profit-side zoom, 100-share stock toggle. Call optimizer loads `callDebit` legs | A, C | Large |
| G | Part 7. Position import, snapshots, vol shift | A–F | Medium |

B and C can share a PR if the synthetic package cost and the identity test land together. E and F should stay split: the editor is easy to review, and the chart files are not.

### Verification, when implementation starts

```bash
cd apps/finance-hub
npx tsx --test src/lib/strategyLab/*.test.ts src/lib/options/blackScholes.test.ts src/lib/optionChain/optionChain.test.ts
npx tsc --noEmit
node scripts/check-api-routes.mjs
```

Then, dark scheme, desktop and a 390 px width: load a chain, add a synthetic and confirm delta near 100, add a short strangle and confirm two breakevens and a required call-side risk number, add a put debit and confirm the delta chart is negative in the body, and confirm the wheel scrolls the page until the plot is clicked. Nothing in that pass submits an order.

### Out of scope

- A put-spread optimizer heatmap (the call scan stays).
- Broker margin, order tickets, paper trading through Schwab order endpoints.
- American early-exercise pricing.
- xlsx export.
- Merging #188's feed-IV expected move into the lab surface.
- Merging any of these phases to `main`.
