# Calculation Model

This document summarizes the projection rules implemented in `src/App.jsx`.

## Timing

- Projection starts in the current calendar year from `new Date().getFullYear()`.
- Accumulation years are `age < retirementAge`.
- The retirement year itself is the first distribution year.
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

- Federal ordinary-income and long-term-capital-gain calculations use official 2026 MFJ parameters where available.
- Future federal brackets and deductions are projected from the last known table year using the input inflation rate.
- Long-term capital gains use the remaining standard deduction before applying preferential brackets.
- NIIT is modeled at 3.8% above the non-indexed $250,000 MFJ MAGI threshold.
- NY tax excludes taxable Social Security and applies a simplified public-pension/private-retirement-income treatment.
- NY brackets and the MFJ standard deduction are projected from their 2024 statutory values by the input inflation rate, consistent with how federal brackets are projected (previously NY was left unindexed, causing one-sided bracket creep).
- The NY middle-class rate cut (Ch. 59, Laws of 2025) is applied: the bottom
  five rates drop 0.1pp in tax year 2026 and 0.2pp total from 2027 onward.
- The NY $20,000 pension/annuity exclusion is gated at age 59½ (the annual
  model evaluates integer ages, so it takes effect in the age-60 year).
- IRC §72(t) 10% early-distribution penalty is modeled inside the tax
  gross-up solve for withdrawals before age 59½: traditional IRA draws are
  always penalized; 401(k)/403(b) draws are exempt only under the Rule of 55
  (retirement age 55+, and only from age 55); early Roth draws are penalized
  in full as a conservative approximation since contribution/conversion basis
  layers are not tracked. Roth conversions themselves are never penalized.
  The penalty appears in each row's `earlyPenalty` field and is included in
  `tax`.
- Tax is solved iteratively so withdrawals cover both spending needs and tax created by those withdrawals.
- Married-couple mode uses the same MFJ tax engine as individual mode. It sums
  household ordinary income, LTCG, taxable Social Security, MAGI, pensions,
  RMDs, Roth conversions, and withdrawals before calculating federal and NY
  tax. Filing-status changes after a spouse's death are not modeled.

## Social Security

- `ssIncome` is treated as the annual full-retirement-age benefit in today's dollars.
- Claim age is clamped to the legal window: benefits cannot start before 62,
  and delayed retirement credits stop accruing at 70. FRA is modeled as 67
  (exact only for those born 1960+).
- Claiming before FRA reduces the benefit using SSA-style monthly reduction factors.
- Claiming after FRA increases the benefit by 8% per year up to 36 delayed months.
- Taxable Social Security uses MFJ provisional-income thresholds of $32,000 and $44,000, which are not inflation-indexed.
- In married-couple mode, each spouse has their own FRA benefit and claim age.
  The model sums gross household Social Security and applies MFJ taxable
  Social Security rules to the combined benefit. Spousal, survivor, divorced,
  and earnings-test rules are not modeled.

## Roth Conversions

- Conversion targets vary by age phase: bridge, mid, and Medicare/pre-SS years.
- Conversions are taxable ordinary income.
- In RMD years, required distributions are reserved before conversion so RMD amounts are not implicitly converted.
- In married-couple mode, conversion targets and caps are calculated per spouse
  against that spouse's 401(k)/403(b) balance, age, Social Security timeline,
  and RMD requirement.

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
- Under current 2026 law, the model restores the 400% FPL subsidy cliff after the enhanced-credit period.
- IRMAA uses 2026 MFJ Part B and Part D surcharge tiers and applies an inflation projection after 2026.
- Real IRMAA uses a two-year MAGI lookback; the model uses same-year MAGI as an approximation.
- In married-couple mode, lifestyle spending is shared, but healthcare costs
  are spouse-specific because Medicare/ACA eligibility depends on each spouse's
  age. ACA subsidy and IRMAA estimates remain household-level approximations
  based on combined MAGI.

## Married-Couple Scope

- Couple mode is a living-household model: both spouses are assumed alive
  through the configured horizon.
- Shared financial elements are cash, taxable brokerage, cost basis, debt,
  base lifestyle spending, returns, inflation, taxes, ACA/IRMAA assumptions,
  and Monte Carlo risk assumptions.
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

- A plan is marked depleted if total modeled assets fall to zero or if spending plus taxes cannot be covered by modeled withdrawals.
- `totalUnmetCashFlow` accumulates uncovered spending/tax needs.
- HSA balances remain part of total assets, but healthcare withdrawals now make them spendable for qualifying healthcare expenses.

## Monte Carlo

- Monte Carlo runs feed randomized annual retirement returns into the same deterministic engine used by the main projection.
- This keeps taxes, Roth conversions, RMDs, ACA, IRMAA, HSA withdrawals, and unmet cash-flow logic consistent with the main plan.
- Volatility is controlled by `portfolioVolatility`.
- Flexible spending, if enabled, reduces spending 10% in years after the
  portfolio's year-end total fell more than 15% versus the prior year end.
  (The guard previously compared a year-end total to itself and never fired;
  fixed 2026-06-10 in both engines.)

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
