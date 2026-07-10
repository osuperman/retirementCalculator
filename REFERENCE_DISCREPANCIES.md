# Reference Discrepancies & Parity Explanation

**Reference app:** https://osuperman.github.io/retirementCalculator/ — `src/App.jsx` @ `e025363`.
**Parity data:** `REFERENCE_PARITY_OUTPUT.json` (41 rows, tax components verified to reconstruct the engine's total tax with 0 mismatches).

> **Snapshot note (2026-07).** This document and the parity JSON describe the engine **at commit `e025363`**. The `2026-07 r3` audit fixes changed several behaviors since — the 2025 FPL base, the exactly-400%-FPL ACA boundary, taxing cash interest, conversions stopping the year Social Security starts, the materiality-gated `summary.depleted` flag, taxing the time-zero debt-payoff gain, the SS-claim-above-70 clamp, and a −95% Monte Carlo draw floor. Re-generate the parity JSON before using it to validate the current engine. The timing/behaviour items below that are unaffected by r3 (growth order, RMD timing, LTCG stacking, cash-strategy ordering) remain accurate.

This document (a) explains *why* the reference app produces its numbers, and (b) classifies every place a re-implementation is likely to diverge. Because I do not have access to "the simplified engine" you are building, Section B enumerates the reference engine's behaviors that a naive reimplementation most often gets wrong; each is a divergence you can check your engine against. Classification tags: **[CONFIRMED]** implementation fact, **[APPROX]** deliberate approximation, **[BUG]** likely defect in the reference engine, **[TIMING]**, **[ROUNDING]**, **[UNVERIFIABLE]**.

---

## A. Parity explanation (why the reference numbers are what they are)

**A-1. Portfolio at retirement = $2,564,052.** Five accumulation years (ages 50-54) compound the ~$1.74M starting net worth: retirement/taxable accounts at `preReturn` 6% (taxable net of 0.5% drag), cash at 4%, plus $36,000/yr into the 401k ($31,000 employee + $5,000 match, both under the 2026 caps) and $8,550 to the HSA. The 401k alone grows $1,243,793 → $1,933,428. Debt ($4,044) is cleared from cash at time zero. Growth is applied **once per year to the start-of-year balance**, and contributions are added **after** growth — so a contribution earns no return in the year it is made (`b = b*(1+r) + contribution`).

**A-2. Withdrawal split across accounts.** Driven by the `preserveReserve` cash strategy + the standard pre-/post-SS waterfall:
- Healthcare is met **first from the HSA** every year it can be (e.g. age 55 HSA $32,459 = healthcare $28K×inflation).
- Remaining need before Social Security is met from **cash above the $100K (inflating) floor** — ages 55-61 draw almost entirely from cash; the 401k is untouched until cash reaches its floor (~age 62).
- After cash hits the floor, the **401k** becomes the workhorse; taxable and Roth are essentially never tapped here because cash + 401k + part-time + SS + (later) RMDs cover the need. Roth is always last by design.
- Part-time income ($20K→inflated, ages 55-64) and Social Security (age 67+) reduce the portfolio draw directly.

**A-3. Why taxes exceed a naive federal calc.** The `tax` column is federal ordinary + federal LTCG (stacked) + NIIT + **New York State** + any §72(t) penalty, solved with a **gross-up** (withdrawals are grossed up to pay the tax they create). NY adds 5-6%+ on most ordinary income and taxes capital gains as ordinary. Roth **conversions** add $30-45K/yr of ordinary income in the bridge years (ages 55-64), which is the single biggest reason mid-plan tax spikes to ~$47-53K (age 60-64) versus a "spending only" expectation. Social Security is up to 85% taxable via §86.

**A-4. Why early-withdrawal penalties are $0.** Retirement age is exactly **55**, so the **Rule of 55** exempts 401k withdrawals from the 10% penalty from age 55 on. Independently, ages 55-59 are funded from cash/HSA/taxable (not 401k/IRA), and Roth is never tapped early. Both facts hold, so no year carries a penalty. (A retirement age of 54 or lower, or forced Roth/IRA draws pre-59½, would produce penalties.)

**A-5. Why Roth conversions affect tax but aren't spending.** A conversion moves 401k → Roth: it is added to `ordIncome` (taxed this year) and recorded as a Roth vintage, but it is **not** part of `grossWithdrawal` / net-need funding. It shrinks the future taxable-deferred balance (and future RMDs) and builds a tax-free bucket. In the output, `rothConversion` is a separate column from the withdrawal columns.

**A-6. Why portfolio composition shifts.** Conversions steadily move 401k → Roth (total $398,693); cash is drawn down to its floor first (bridge years); the 401k is drawn hardest from ~62 and again at RMD age 75+; HSA is consumed against healthcare. Net effect: cash-heavy → 401k-heavy → increasingly Roth-heavy over time.

**A-7. Why the ending balance ($3.07M) beats a simple projection.** The ~4-5% early withdrawal rate is below the portfolio's ~5.5% post-retirement growth, so the portfolio keeps compounding while funding spending; part-time income and Social Security offload the early draw; and figures are **nominal** — $3.07M at age 90 (year 2066) is far less in today's dollars (÷ 1.03^40 ≈ $0.94M). A simple real-dollar or no-tax projection will not match.

---

## B. Discrepancy checklist (reference behaviors a reimplementation must match)

### Timing
- **B-1 [TIMING][CONFIRMED]** Growth is applied **once per year to the start-of-year balance**. In accumulation years, contributions are added *after* growth (`b = b*(1+r) + contribution`), so they earn no return in their first year. In distribution years, withdrawals come out of **start-of-year (= prior Dec 31)** balances first, then the remainder grows. A reimplementation that grows the contribution in-year, grows first, or grows twice will diverge every year.
- **B-2 [TIMING][CONFIRMED]** Debt is paid at **time zero** (before year 1 growth), cash then taxable.
- **B-3 [TIMING][CONFIRMED]** **IRMAA uses a two-year MAGI lookback** (`magiByYear[year−2]`), not same-year MAGI — except the first ≤2 Medicare years fall back to same-year. In the parity run this is why IRMAA appears at 65-66 (from 63-64 conversions) and nowhere else.
- **B-4 [TIMING][CONFIRMED]** Traditional-IRA RMDs are enforced **during accumulation** (still-working) years; the 401(k) still-working exception is honored.
- **B-5 [TIMING][CONFIRMED]** All "today's dollars" inputs inflate from the **current calendar year**, not the retirement year.

### Tax treatment
- **B-6 [CONFIRMED]** Tax = federal ordinary + federal LTCG (stacked, with unused standard deduction spilling into LTCG) + NIIT + **NY State** + §72(t) penalty, all inside a **gross-up** loop. Omitting NY, the gross-up, or LTCG stacking will diverge.
- **B-7 [CONFIRMED]** **Filing status** selects every table (federal brackets/deduction/LTCG, §86 thresholds $25K/$34K single, NIIT $200K single, IRMAA single tiers, NY single brackets/deduction). The parity scenario is single; MFJ produces materially lower tax on identical inputs.
- **B-8 [CONFIRMED]** Age-65 **senior standard deduction** ($2,050 single, indexed) **plus** the OBBBA **$6,000 senior bonus deduction** (2025-2028 only, phased out 6% above $75K single MAGI) are applied. Easy to miss; they reduce post-65 tax.
- **B-9 [CONFIRMED]** **Social Security taxation** is the §86 provisional-income formula (0/50/85%), with realized capital gains and Roth conversions counted in provisional income.
- **B-10 [CONFIRMED]** **NY exclusions:** taxable SS, NY-exempt public pensions, and up to $20,000/person private retirement income from age 59½ are removed from NY taxable income; NY taxes capital gains as ordinary.
- **B-11 [CONFIRMED]** Future-year federal & NY brackets/deductions are **projected by the user's `inflation`**, not by statutory chained-CPI. NY's 2026/2027 middle-class rate cut is applied.

### Account handling
- **B-12 [CONFIRMED]** Taxable gains use a **tracked cost basis** (initial = balance × `taxableBasisPct`), not a flat 60/40; basis does not grow with returns; sales realize `gain = amount × max(0,(value−basis)/value)`. All gains treated long-term.
- **B-13 [CONFIRMED]** **Roth ordering layers (IRC 408A(d)(4)):** contribution basis (`rothBasis`) first, then conversion vintages FIFO with a per-vintage 5-year clock, then earnings. Only unseasoned principal + earnings are penalized pre-59½.
- **B-14 [CONFIRMED]** **HSA is applied to healthcare first**, before taxable, and never funds non-medical spending.
- **B-15 [CONFIRMED]** RMD = start-of-year (401k + IRA) / 2022+ Uniform Lifetime divisor; conversions carved out so RMDs are never converted; RMD/SEPP surplus beyond need+tax is reinvested to **cash**.

### Withdrawal ordering / cash reserve
- **B-16 [CONFIRMED]** Pre-SS waterfall: cash→taxable→401k→IRA→Roth; post-SS: 401k→IRA→taxable→cash→Roth; Roth always last. The four `cashStrategy` modes modify cash placement and honor an **inflation-adjusted** reserve floor.
- **B-17 [CONFIRMED]** With `allowReserveAsLastResort = false` (parity setting), the reserve floor is **never breached** even if it creates unmet need — verified: min cash ending $124,181 stays above the inflating floor, `reserveUsed = 0`.

### Rounding / detection
- **B-18 [BUG (minor)][ROUNDING] — FIXED in r3 (2026-07).** At `e025363`, `summary.depleted` was `true` in the parity run **despite an ending balance of $3.07M**, because cumulative `unmetCashFlow` was **$21** — the gross-up solver converges to within $1, leaving ~$1 unmet in ~21 years, which tripped the raw `unmetCashFlow > 1` flag, disagreeing with the UI's materiality gate. **The r3 fix applies the materiality threshold (`> max($1,000, 0.5%×year-1 spending)`) to `summary.depleted` itself in both engines**, so the flag now agrees with the banner and with the Ask-AI context. A single year hitting total assets ≤ 0 still flags immediately.
- **B-19 [ROUNDING][CONFIRMED]** Post-65 `spending` carries sub-dollar decimals (e.g. age 65 = `118226.424…`) because the IRMAA surcharge (a float) is added to already-rounded base spending. Match this or round consistently.
- **B-20 [CONFIRMED]** Per-row balances/withdrawals are whole-dollar `Math.round`; tax converges < $1 then rounds.

### Deliberate approximations (match or accept)
- **B-21 [APPROX]** Cash/HYSA interest is modeled as taxable income in the tax base via `interestIncome` on the cash balance (added at the merge), but the parity scenario's cash is small and drawn early; confirm your handling of cash interest.
- **B-22 [APPROX]** IRMAA thresholds/amounts inflated after 2026 (statute freezes the top tier to 2028); ACA MAGI omits non-taxable SS; §86 thresholds unindexed (correct); IRMAA first-two-Medicare-years fallback to same-year MAGI.
- **B-23 [APPROX]** Income tax on early Roth **earnings** withdrawals is not modeled (penalty is); arises only in already-failing plans.
- **B-24 [APPROX]** SEPP models the fixed-amortization method only; busting the schedule (retroactive penalties) is not modeled; the 120%-AFR rate cap is the user's responsibility.
- **B-25 [APPROX]** MFJ/single only (no HoH/MFS); no AMT, itemized deductions, credits, step-up at death, capital-loss netting, or state other than NY; both spouses assumed alive through the horizon in couple mode (no survivor/widow(er) transition).

### Unverifiable
- **B-26 [UNVERIFIABLE]** The visitor's *active* settings live in browser `localStorage`; only `DEFAULT_INPUTS` is knowable from source.
- **B-27 [UNVERIFIABLE]** `PROJECTION_START_YEAR = new Date().getFullYear()` — output shifts by calendar year; the parity JSON was generated with start year = the run date's year. Pin the start year for stable reproduction.
- **B-28 [UNVERIFIABLE]** Chart/table column definitions are UI-layer; this audit covers the calculation engine only.

---

## C. How to reproduce exactly
1. `import { simulate } from './REFERENCE_ENGINE_CODE.js'` (Node ESM).
2. Pass the `scenario` object from `REFERENCE_PARITY_OUTPUT.json`.
3. Pin `PROJECTION_START_YEAR` to 2026 (or match the JSON's `meta.projectionStartYear`) — it defaults to the system year.
4. Compare `simulate(scenario).yearlyData` to `REFERENCE_PARITY_OUTPUT.json.yearly`. The four tax sub-components (`federalTax`, `newYorkTax`, `capitalGainsTax`, `niit`) are not stored on the engine's native rows; they were captured by instrumenting `totalTax` and verified to reconstruct the engine's total `tax` (federal + NY + penalty) in every row.
