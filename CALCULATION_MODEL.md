# Calculation Model

This document summarizes the projection rules implemented in `src/App.jsx`.

## Timing

- Projection starts in the current calendar year from `new Date().getFullYear()`.
- Accumulation years are `age < retirementAge`.
- The retirement year itself is the first distribution year.
- A retirement age at or below the current age is valid: it means the user is
  retiring this year or is already retired, and year 1 of the projection is a
  distribution year. The year-1 withdrawal-rate denominator is today's total
  balance in that case.
- Projection rows run through `planThroughAge`, inclusive.
- Individual mode preserves the original single-person flat input model.
- Married-couple mode projects each spouse by calendar year with independent
  ages, retirement ages, Social Security claim ages, pensions, RMD start ages,
  and account balances. The couple projection ends in the later year implied by
  either spouse reaching their own `planThroughAge`.

## Returns And Inflation

- `preReturn`, `postReturn`, and `cashReturn` are nominal annual rates.
- Both engines apply growth exactly once per projection year. In retirement
  years, withdrawals come out of start-of-year balances and growth applies at
  year end. (Couple mode previously grew balances both before and after
  withdrawals, compounding retirement years at `(1+r)^2`; fixed 2026-06-10.)
- Cash / HYSA uses `cashReturn` in every accumulation and retirement projection year.
- All today's-dollar inputs — base lifestyle spending, healthcare, part-time
  income, Roth conversion targets, Social Security, and pensions — are inflated
  from the **current year** (`PROJECTION_START_YEAR`), on the same clock as the
  real-dollar display toggle. (Pensions grow at `pensionCola` rather than the
  general inflation rate.) The `inflMult` factor in `simulate`/`simulateCouple`
  is therefore `(1 + inflation)^(year − currentYear)`. Spending entered for a
  user who retires N years from now appears at its full inflated nominal value
  in the first retirement year, and at the entered value when the display is
  switched to today's dollars.
- Taxable brokerage applies `taxableAnnualTaxDrag` to annual market return to approximate dividend and turnover tax drag.
- Cost basis does not grow with market return. Taxable sales realize gains based on current embedded gain ratio.

## Contributions

- 401(k) employee deferrals are capped by year and age, including catch-up and age 60-63 super catch-up.
- Employer match is capped so employee plus employer additions do not exceed the modeled annual additions limit.
- HSA contributions are capped by household size and age-55 catch-up eligibility.
- In married-couple mode, 401(k)/403(b) contribution caps are applied per
  spouse. HSA contributions share the family limit plus eligible age-55
  catch-ups, then are allocated to each spouse's HSA.
- The active table includes 2026 limits and projects future limits after the last known year.

## Taxes

- Taxes are computed per filing status. Individual mode uses the selected
  status — single (default) or married filing jointly; couple mode always
  uses married filing jointly. Head-of-household is not modeled;
  qualifying-surviving-spouse years can be modeled as married-joint.
- Federal ordinary-income and long-term-capital-gain calculations use
  official 2026 parameters for both MFJ and single where available
  (2026 single: $16,100 standard deduction; brackets to $12,400 / $50,400 /
  $105,700 / $201,775 / $256,225 / $640,600; LTCG breakpoints $49,450 and
  $545,500).
- Future federal brackets and deductions are projected from the last known table year using the input inflation rate.
- Long-term capital gains use the remaining standard deduction before applying preferential brackets.
- NIIT is modeled at 3.8% above the non-indexed MAGI threshold:
  $250,000 MFJ / $200,000 single.
- The age-65+ additional standard deduction ($1,650 per MFJ spouse /
  $2,050 single in 2026, indexed) and the OBBBA senior deduction ($6,000
  per person 65+ for tax years 2025-2028 only, not indexed, phased out at
  6% of MAGI above $150K MFJ / $75K single) are applied. Single filers
  count one senior; MFJ mirrors the IRMAA enrollee assumption in
  individual mode and uses each spouse's age in couple mode.
- Cash/HYSA interest (start-of-year balance x cash return) is taxed as
  ordinary income and included in Social Security provisional income, MAGI,
  ACA, and IRMAA calculations. Taxable-brokerage dividends remain modeled
  only as the annual return drag.
- NY tax excludes taxable Social Security and applies a simplified public-pension/private-retirement-income treatment.
- NY brackets and standard deductions (MFJ $16,050 / single $8,000, 2024
  base) are projected from their 2024 statutory values by the input
  inflation rate, consistent with how federal brackets are projected
  (previously NY was left unindexed, causing one-sided bracket creep).
- The NY middle-class rate cut (Ch. 59, Laws of 2025) is applied: the bottom
  five rates drop 0.1pp in tax year 2026 and 0.2pp total from 2027 onward.
- The NY $20,000 pension/annuity exclusion is gated at age 59½ (the annual
  model evaluates integer ages, so it takes effect in the age-60 year).
- IRC §72(t) 10% early-distribution penalty is modeled inside the tax
  gross-up solve for withdrawals before age 59½: traditional IRA draws are
  always penalized; 401(k)/403(b) draws are exempt only under the Rule of 55
  (retirement age 55+, and only from age 55); early Roth draws are penalized
  per the §408A(d)(4) ordering layers (contribution basis and 5-year seasoned
  conversions penalty-free, only unseasoned conversion principal and earnings
  penalized — see "Roth Ordering Layers And SEPP" below). Roth conversions
  themselves are never penalized. The penalty appears in each row's
  `earlyPenalty` field and is included in `tax`.
- Tax is solved iteratively so withdrawals cover both spending needs and tax created by those withdrawals.
- Married-couple mode uses the same tax engine with the MFJ parameter set. It
  sums household ordinary income, LTCG, taxable Social Security, MAGI,
  pensions, RMDs, Roth conversions, and withdrawals before calculating
  federal and NY tax. Filing-status changes after a spouse's death are not
  modeled inside couple mode; a survivor can continue planning in Individual
  mode with the Single filing status.

## Social Security

- `ssIncome` is treated as the annual full-retirement-age benefit in today's dollars.
- Claim age is clamped to the legal window 62–70 for the benefit **start**,
  not just the benefit factor: an entry below 62 starts at 62, and an entry
  above 70 starts at 70 (delayed credits stop accruing at 70, so a later start
  would only forfeit benefits). FRA is modeled as 67 (exact only for those
  born 1960+).
- Claiming before FRA reduces the benefit using SSA-style monthly reduction factors.
- Claiming after FRA increases the benefit by 8% per year up to 36 delayed months.
- Taxable Social Security uses provisional-income thresholds by filing
  status ($32,000/$44,000 MFJ; $25,000/$34,000 single), not
  inflation-indexed. The second-tier add-on caps at half the threshold
  span ($6,000 MFJ / $4,500 single).
- In married-couple mode, each spouse has their own FRA benefit and claim age.
  The model sums gross household Social Security and applies MFJ taxable
  Social Security rules to the combined benefit. Spousal, survivor, divorced,
  and earnings-test rules are not modeled.

## Roth Conversions

- Conversion targets vary by age phase: bridge, mid, and Medicare/pre-SS years.
- Conversions stop the year Social Security starts, in every age window (an
  early claim at 62 ends conversions at 62). Enforced in both engines.
- Conversions are taxable ordinary income.
- In RMD years, required distributions are reserved before conversion so RMD amounts are not implicitly converted.
- In married-couple mode, conversion targets and caps are calculated per spouse
  against that spouse's 401(k)/403(b) balance, age, Social Security timeline,
  and RMD requirement.

## Roth Ordering Layers And SEPP

- Roth withdrawals follow IRC 408A(d)(4) ordering: user-entered contribution
  basis (`rothBasis`), then conversion vintages FIFO (each penalty-free five
  tax years after conversion), then earnings. Only unseasoned conversion
  principal and earnings incur the 10% penalty before 59.5, so Roth conversion
  ladders price correctly. Income tax on early earnings withdrawals is not
  modeled (they arise only in already-failing plans; earnings are consumed
  last).
- Optional SEPP/72(t) program (individual mode, `useSepp` + `seppRate`):
  fixed-amortization payment (Notice 2022-6, Single Life Table) from the first
  retirement year's tax-deferred balance, forced yearly through the RMD
  channel until the later of 5 years or 59.5, penalty-exempt up to the payment
  amount. Busting the schedule (retroactive penalties) is not modeled.

## RMDs

- RMD start age defaults from inferred birth year and current projection year.
- The user can override RMD start age in Advanced Tax Model.
- RMD amounts use the 2022+ Uniform Lifetime Table.
- RMDs are calculated from start-of-year balances, representing the prior year-end balance.
- Forced RMD surplus beyond spending plus tax is reinvested into cash.
- Traditional IRA RMDs are also enforced in accumulation (still-working)
  years, since the still-working exception covers only the current employer's
  401(k)/403(b). The gross amount moves to the taxable account (raising its
  basis); income tax on it is not modeled in accumulation years, consistent
  with salary taxes being out of scope.
- In married-couple mode, RMDs are calculated independently for each spouse's
  tax-deferred accounts and then included in the household tax solve.

## Healthcare, ACA, HSA, And IRMAA

- HSA withdrawals are applied against healthcare spending before taxable account withdrawals.
- ACA subsidy estimation is optional and approximate.
- Under current 2026 law, the model restores the 400% FPL subsidy cliff after
  the enhanced-credit period. Income above 400% FPL pays full sticker; income
  at or below 400% (inclusive) is subsidized. The non-premium out-of-pocket
  floor (~$2,000 in 2025 dollars) inflates on the FPL clock.
- IRMAA uses 2026 Part B and Part D surcharge tiers for the plan's filing
  status (MFJ thresholds $218K-$750K; single thresholds $109K-$500K) and
  applies an inflation projection after 2026. Single filers are charged
  for one Medicare enrollee.
- IRMAA uses the projected MAGI from two years earlier (the real lookback)
  whenever the projection has one — i.e., from the third retirement year on.
  The first two retirement years fall back to same-year MAGI because
  working-year (salary) MAGI is out of scope.
- The Federal Poverty Level is household-size aware: $15,650 for the first
  person plus $5,500 per additional person (2025 HHS base — the guidelines
  that govern 2026 ACA eligibility — inflation projected).
- In married-couple mode, lifestyle spending is shared, but healthcare costs
  are spouse-specific because Medicare/ACA eligibility depends on each spouse's
  age. ACA subsidy and IRMAA estimates remain household-level approximations
  based on combined MAGI.

## Married-Couple Scope

- Couple mode is a living-household model: both spouses are assumed alive
  through the configured horizon.
- Shared financial elements are cash, taxable brokerage, cost basis, debt,
  base lifestyle spending, returns, inflation, taxes, ACA/IRMAA assumptions,
  and Monte Carlo risk assumptions. Household size floors at 2 in couple
  mode (drives the family HSA limit, FPL, and Medicare enrollee counts).
- While one spouse still works, that spouse's salary is assumed to cover
  only their own contributions; the full shared lifestyle budget is drawn
  from savings once the first spouse retires. This is disclosed in the UI
  and is conservative for staggered retirements.
- Individual financial elements are retirement accounts, HSA balances,
  contributions, pensions, Social Security, RMD timing, Roth conversion
  targets, healthcare costs, and retirement dates.
- Couple-mode reporting keeps portfolio and cash-flow charts at the household
  level, then exposes owner-specific detail in the year-by-year table for
  pensions, Social Security, RMDs, retirement-account withdrawals, HSA use, and
  Roth transfers. Employer-plan labels are display labels only; the model still
  treats them as tax-deferred employer-plan balances.
- Cash-flow reporting distinguishes spendable cash from transfers. Pension,
  Social Security, part-time income, HSA healthcare use, and account withdrawals
  can fund spending. Roth conversions are taxable account-to-account transfers
  and do not create spending cash.
- Not modeled in v1: survivor benefits, first-death expense changes, widow(er)
  filing status, inherited-account rules, estate outcomes, or account titling
  beyond spouse-specific retirement/HSA buckets.

## Cash Withdrawal Strategy

- The user selects how cash participates in the withdrawal order:
  - `cashFirst` (default, legacy): cash is spent before other accounts and the
    reserve floor is not applied.
  - `preserveReserve`: cash is spent first, but never below the minimum cash
    reserve.
  - `proportional`: each year's draw is split across cash-above-reserve,
    taxable, and tax-deferred accounts in proportion to balances; Roth stays
    last.
  - `cashLast`: taxable and tax-deferred accounts are tapped first; cash
    (above the reserve) is the final buffer before Roth.
- The minimum cash reserve is entered in today's dollars and inflates on the
  same clock as spending, so the floor keeps its purchasing power.
- The protected reserve is spendable only when "allow reserve as last resort"
  is enabled and every other account is empty; such draws are reported in the
  `reserveUsed` row field and flagged RESERVE in the year table. With the
  toggle off, the plan records unmet cash flow (a shortfall) instead of
  touching the reserve, and the shortfall banner notes the protected amount.
- Required minimum distributions are forced regardless of cash strategy.
- In married-couple mode, cash is a shared bucket, so the strategy, reserve
  floor, and last-resort toggle are shared household settings.

## Depletion And Success

- A plan is marked depleted if total modeled assets fall to zero in any year,
  or if cumulative unmet cash flow clears the materiality threshold
  (max($1,000, 0.5% of year-1 spending)). `summary.depleted` applies this gate
  itself — not just the UI banner — so sub-dollar solver rounding never marks a
  funded plan depleted, and the flag sent to the Ask-AI context agrees with the
  banner.
- `totalUnmetCashFlow` accumulates uncovered spending/tax needs.
- HSA balances remain part of total assets, but healthcare withdrawals now make them spendable for qualifying healthcare expenses.

## Decision Support

- The always-visible plan banner, narrative, and withdrawal-rate metric use a
  horizon-aware safe-withdrawal guideline: 4% for retirements up to 30 years,
  3.5% for 31-40 years, 3.25% beyond 40 years.
- `solveMaxSustainableSpending` bisects base lifestyle spending (to the
  nearest $500) over the full projection engine to find the largest value that
  avoids depletion, holding all other inputs constant. It feeds the
  "spending headroom" narrative line and the required-cut line in the red
  shortfall banner.
- Monte Carlo results are tied to the exact inputs they were computed from;
  any input change marks them stale in the Risk tab and removes the success
  rate from the narrative until re-run.
- Early-withdrawal penalties are surfaced per year (PENALTY badge), in the
  cash-flow tooltip, and as a lifetime total in the narrative when material.
- Plans retiring before 59 1/2 get an "Accessing Money Before 59 1/2" panel:
  per-person Rule of 55 eligibility (with the current-employer-plan-only
  caveat), per-account penalty treatment, bridge-year funding totals drawn
  from the same projection rows as the charts, the recommended withdrawal
  order, tax implications, and alternatives (work to 55, SEPP/72(t), Roth
  contribution basis, part-time income, spending cuts).
- Scenario-comparison retirement ages always derive from the user's own
  retirement age in both modes.
- For plans retiring before 59 1/2, the full projection is re-run under all
  four cash-withdrawal orders. The Cash Strategy selector then states
  definitively what the chosen order does with the user's actual inputs —
  exact penalized dollars, penalty total, and affected ages — and either
  recommends the order that eliminates/minimizes penalties (rejecting
  alternatives that create a new funding shortfall) or states that no order
  avoids the penalty because penalty-free assets cannot cover the bridge.
  The same comparison feeds an "alternatives" line in the early-access panel.

## Monte Carlo

- Monte Carlo runs feed randomized annual retirement returns into the same deterministic engine used by the main projection.
- This keeps taxes, Roth conversions, RMDs, ACA, IRMAA, HSA withdrawals, and unmet cash-flow logic consistent with the main plan.
- Volatility is controlled by `portfolioVolatility`. Each annual return draw is
  floored at -95% so an unbounded Normal sample cannot drive an account
  negative. Because draws are symmetric, the MC median path sits slightly below
  the deterministic projection (volatility drag ~0.4%/yr at the default 9%).
- Flexible spending, if enabled, reduces spending 10% in years after the
  portfolio's year-end total fell more than 15% versus the prior year end.
  (The guard previously compared a year-end total to itself and never fired;
  fixed 2026-06-10 in both engines.)
- Depletion detection keys off distribution-phase rows (not the primary's
  age), so couple plans where the spouse retires first are scored correctly.

## Ask AI Context

The Ask AI tab sends the current `inputs`, projection `summary`, and normalized year-by-year rows to the configured chat endpoint.

The assistant is instructed to:

- Use only the supplied plan data and conversation history.
- Explain current projection behavior, including withdrawal sequencing and tax tradeoffs.
- Propose small, reviewable input changes when appropriate.
- Return proposed changes separately from narrative text so the UI can show an Apply button.
- Avoid treating the output as tax, legal, investment, or fiduciary advice.

## Current-Law Source Anchors

- IRS 2026 tax inflation adjustments.
- IRS 2026 retirement-plan and IRA contribution limits.
- IRS RMD guidance and the 2022+ Uniform Lifetime Table.
- CMS 2026 Medicare Part B, Part D, and IRMAA amounts.
- NY retired-person tax guidance and the FY2026 NY budget rate schedule
  (bottom-five-bracket cuts of 0.1pp in 2026, 0.2pp from 2027).
- SSA claiming rules (earliest claim 62, delayed credits through 70).
- IRC §72(t) early-distribution rules and the Rule of 55.

Update `src/App.jsx` and this document together when current-law tables change.
