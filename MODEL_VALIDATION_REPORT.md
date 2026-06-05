# Model Validation Report

Date: 2026-06-04

Scope: first-pass validation of the public retirement-planner model against
`MODEL_VALIDATION.md`, `CALCULATION_MODEL.md`, and selected current official
sources. This is model review, not financial advice.

## Execution Summary

- `npm run build` passes.
- Browser diagnostics pass: 41/41 self-tests.
- App was exercised at `http://127.0.0.1:5180/retirementCalculator/`.
- No real personal financial data was used.

## Remediation Status

The four concrete findings below were fixed in `src/App.jsx` on 2026-06-04.
After the fixes, `npm run build` passed and browser diagnostics passed at
44/44, including added coverage for RMD ages above 100 and the exact IRMAA
`$750,000` MFJ boundary.

## Findings

### Fixed: Couple ACA subsidy path can overuse HSA withdrawals

- Location: `src/App.jsx:2085`, `src/App.jsx:2140`, `src/App.jsx:2151`
- Functions: `simulateCouple`, `estimateAcaHealthcareCost`
- Issue: couple-mode calculates `hsaWithdrawal` before applying an ACA subsidy.
  If the subsidy lowers healthcare spending, the code reduces `spending` but
  does not recompute HSA withdrawal against the lower healthcare portion before
  recomputing `netNeed`.
- Expected: after subsidy, HSA withdrawals should be capped to remaining
  healthcare cost only.
- Actual: `netNeed = spending - hsaWithdrawal - incomeTotal` can subtract an
  HSA amount computed from pre-subsidy healthcare, allowing HSA dollars to
  indirectly fund non-healthcare spending.
- Minimal reproducer: married-couple mode, at least one retired spouse under
  65, positive HSA balance, `shared.useAcaSubsidyEstimate = true`, low enough
  MAGI to receive a material ACA subsidy.
- Suggested fix: after `spending` is reduced by `acaSubsidy`, recompute the
  healthcare portion and HSA withdrawal allocation, mirroring the individual
  path around `src/App.jsx:1427`.

### Fixed: Couple IRMAA is not iterated to tier stability

- Location: `src/App.jsx:2184`
- Functions: `simulateCouple`, `solveCoupleGrossedUpWithdrawals`,
  `computeIrmaaSurcharge`
- Issue: couple-mode computes IRMAA once from pre-IRMAA MAGI, adds the surcharge
  to spending, and re-solves taxes/withdrawals once. If the extra withdrawal
  increases MAGI enough to move into a higher IRMAA tier, the displayed
  surcharge can be stale.
- Expected: same convergence behavior as individual mode, which loops until the
  surcharge is stable around `src/App.jsx:1355`.
- Actual: a one-pass recompute can understate spending and tax in threshold
  cases.
- Minimal reproducer: married-couple mode with Medicare enrollee(s), MAGI just
  below an IRMAA breakpoint, limited cash/taxable assets so the surcharge is
  funded by taxable tax-deferred withdrawals.
- Suggested fix: wrap the couple IRMAA branch in the same small fixed-point loop
  used by individual mode.

### Fixed: RMD divisor extrapolation is wrong after age 104

- Location: `src/App.jsx:251`
- Function: `rmdDivisor`
- Issue: the hardcoded Uniform Lifetime Table stops at age 100, then linearly
  extrapolates. That happens to match ages 101-103 and is close at 104, but it
  diverges materially after that. The IRS table continues through age 120+.
- Expected examples from the 2022+ Uniform Lifetime Table: age 105 = 4.6,
  age 110 = 3.5, age 112 = 3.3, age 120+ = 2.0.
- Actual examples from current extrapolation: age 105 = 4.4, age 110 = 2.4,
  age 112 = 1.9.
- Impact: users extending `planThroughAge` beyond 100 get overstated RMDs,
  overstated taxes, and understated ending balances.
- Suggested fix: hardcode the complete IRS table through 120+, then return 2.0
  for ages 120 and above.

### Fixed: IRMAA exact-boundary handling at $750,000 MFJ

- Location: `src/App.jsx:72`, `src/App.jsx:481`
- Function: `computeIrmaaSurcharge`
- Issue: `top: 750000` with `magi <= threshold` places exactly $750,000 MFJ in
  the lower tier, but CMS defines the top tier as greater than or equal to
  $750,000 for joint filers.
- Expected: exactly $750,000 should use the highest Part B and Part D IRMAA
  amounts.
- Actual: exactly $750,000 uses the prior tier.
- Suggested fix: represent tiers with explicit lower/upper bounds or make the
  $750,000 threshold exclusive.

## Constants Audit

| Area | Code | Source Check | Verdict |
| --- | --- | --- | --- |
| 2026 MFJ standard deduction | `$32,200` | IRS 2026 inflation adjustments list MFJ standard deduction as `$32,200`. | Pass |
| 2026 MFJ ordinary brackets | 10% to `$24,800`, 12% to `$100,800`, 22% to `$211,400`, 24% to `$403,550`, 32% to `$512,450`, 35% to `$768,700`, 37% above | IRS 2026 inflation adjustments match these MFJ thresholds. | Pass |
| 2026 401(k)/403(b)/457/TSP employee deferral | `$24,500` | IRS 2026 retirement limit release matches. | Pass |
| 2026 401(k) catch-up age 50+ | `$8,000` | IRS release matches. | Pass |
| 2026 401(k) super catch-up age 60-63 | `$11,250` | IRS release matches. | Pass |
| 2026 HSA self/family | `$4,400` / `$8,750` | IRS Rev. Proc. 2025-19 matches. | Pass |
| 2026 IRMAA Part B/D surcharges | Code amounts match CMS monthly surcharge amounts and handles exact `$750,000` MFJ as top tier. | CMS 2026 fact sheet matches amounts and thresholds. | Pass |
| RMD divisors | Code now includes ages 72-120 and returns the 120+ divisor for later ages. | IRS 2022+ table continues through 120+. | Pass |
| FPL | Code projects 2024 FPL by user inflation. | HHS 2026 FPL for household of 2 is `$21,640`; code at 3% gives about `$21,685`. | Approximation, not exact current law |

Sources used:

- IRS 2026 inflation adjustments:
  https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
- IRS 2026 retirement-plan limits:
  https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
- IRS Rev. Proc. 2025-19 for 2026 HSA limits:
  https://www.irs.gov/irb/2025-21_IRB
- CMS 2026 Medicare Part B/D IRMAA amounts:
  https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles
- IRS 2022+ RMD table guidance:
  https://www.irs.gov/irb/2022-05_IRB
- HHS/ASPE poverty guidelines:
  https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines

## Test Coverage Gaps

Current diagnostics are useful but mostly example/invariant checks. Missing or
thin areas:

- Exact current-law constants tests for every federal, NY, HSA, IRMAA, ACA/FPL,
  and RMD table value.
- Gross-up non-convergence and oscillation tests.
- Couple IRMAA threshold feedback tests.
- Couple ACA subsidy plus HSA interaction tests.
- Seeded Monte Carlo tests. `randomNormal` is standard Box-Muller, but
  `Math.random()` makes runs non-reproducible.
- Injectable projection start year. `PROJECTION_START_YEAR = new Date().getFullYear()`
  makes snapshots drift by calendar year.
- Invalid input sweeps for NaN/Infinity leakage.

Recommendation: extract the pure calculation engine from `src/App.jsx` into a
separate module and port `runSelfTests()` into Vitest. Keep the in-browser
diagnostics as a user-facing smoke test if useful.

## Accepted Model Simplifications To Document

- MFJ tax treatment is used even in individual mode.
- No survivor benefits, first-death expense changes, widow(er) filing status, or
  inherited-account rules.
- IRMAA uses same-year MAGI rather than the real two-year lookback.
- ACA subsidy estimation is approximate and uses projected FPL rather than
  exact annual HHS tables.
- NY tax is simplified and assumes current residency/treatment throughout the
  projection.
- No AMT, NIIT beyond LTCG/investment-income approximation, itemized deductions,
  tax credits, or detailed capital-loss/netting mechanics.
