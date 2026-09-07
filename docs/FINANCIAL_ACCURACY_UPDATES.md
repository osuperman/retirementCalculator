# Financial accuracy updates — 2026-09-06

Starting revision: `59f9d0e075608e8baa1b01d97c2e48f22ff6dbbd`, branch `audit-critical-fixes`. Remote branch heads were subsequently checked and matched the local starting revision. No deployment is part of this change.

The application now imports its production calculations from `src/finance/engine.js`; tests import the same functions. Eligibility rules are in `policy.js`, and immutable conversion previews and tax closure are in `numerics.js`.

## Audit coverage

| Finding | Implemented behavior | Regression evidence |
|---|---|---|
| 1 | Current-year conversions are included before Roth earnings; same-year taxable principal is aggregated; committed layers are consumed once. | $100,000 conversion / $20,000 spending fixture; immutable conversion-history test. |
| 2 | Both accumulation engines require salary funding; contributions reserve payroll taxes and respect compensation. | $10,000 compensation case; zero salary diagnostics; conservation cases. |
| 3 | Part-time W-2 income incurs employee payroll taxes. Taxable wages and spendable wages remain distinct. | $60,000 wages incurs $4,590 basic FICA in either engine. |
| 4 | Separate IRA and employer-plan RMDs; mandatory draws precede discretionary draws. Still-working restrictions include current-plan and 5% owner facts. | $500,000 in each category at 75; working-owner asset conservation; existing staggered tests. |
| 5 | Enhanced senior deduction phases out per person. | MFJ, two seniors, $250,000 income: $50,479.05 total tax. |
| 6 | Cash interest is calculated on the same post-cash-flow balance that receives growth and participates in tax closure. | $1 million cash / $900,000 spending / 5% return ends at $105,000. |
| 7 | ACA fixed-point failure returns an unsubsidized estimate and invalid status; sustainable-spending output is withheld. IRMAA tier failures are also exposed. | $30,000 healthcare oscillation: no claimed credit; $1,781.21 fallback tax. |
| 8 | Bracketed tax closure replaces truncated tax iterations and untaxed residue withdrawals. | $5 million IRA / $200,000 spending closes near $337,666 gross. |
| 9 | Explicit zero volatility is retained. | Deterministic ending percentiles of $950,000. |
| 10 | Return arrays cover the actual distribution calendar, including differing ages and already-retired people. Missing supplied years throw a detectable error. | 51-year couple horizon; missing 10-year tail rejected. |
| 11 | Nonqualified annuity earnings enter NIIT; NY exclusion requires provenance confirmation. | Public pension / privately purchased annuity case: $76,794 tax. |
| 12 | HSA coverage, eligible months, payroll treatment, premium qualification and per-owner catch-ups are explicit. | Medicare midyear proration, family-pool proration, younger-owner Medicare restriction. |
| 13 | A fixed-amortization SEPP account is separately allocated and unavailable for discretionary draws/conversions. Existing payment and modification tax inputs are explicit. | $60,312 scheduled payment cannot fund a $120,000 budget by taking extra money from that account. |
| 14 | Social Security earnings test, first-year monthly wage overrides, FRA-year limits and withheld-month benefit adjustment are modeled. | $100,000 wages at 62 pays no benefit; $24,480 threshold ±$1. |
| 15 | Mandatory Roth catch-ups depend on prior employer wages and plan availability; designated Roth assets have separate basis and qualification history. | $32,500 contribution at age 55 splits $24,500 pre-tax / $8,000 Roth; taxable wages $175,500. |
| 16 | Existing Roth opening dates and conversion histories are entered independently of contribution basis. | Young Roth $20,000 earnings: $4,887.75 additional federal/NY tax in the fixture. |
| 17 | ACA uses entered actual and benchmark premiums and eligibility. Explicit ordinary brokerage yield enters tax/MAGI and reinvested basis; legacy drag is disabled when it is used. | Ineligible coverage receives no credit; 5% yield on $100,000 adds $5,000 MAGI and basis without duplicate growth. |
| 18 | Optional first-death scenarios stop/prorate owner income, apply pension and SS survivor inputs, change filing status and transfer assets under an explicit spousal own-account election. | Both spouse orders; death-year MFJ then single; $200,000 transfer conservation. |
| 19 | Entered historical and approved-adjustment MAGI overrides same-year IRMAA estimates. | $150,000 2024 MAGI produces $2,884.80 surcharge in 2026. |
| 20 | HSA balances can fund nonmedical spending after 65 with ordinary tax and no 20% additional tax. | $10,000 spending requires about $10,081 gross in the single fixture. |

## Verification

- `npm test`: 31 top-level tests pass, including all 172 production diagnostics and 40 zero-return conservation scenarios.
- Invalid imported financial history is rejected before simulation; prior-employer plans conservatively retain early-distribution penalties when separation history is unknown. SEPP and qualified HSA draws are included in reported gross withdrawals.
- Individual MFJ and equivalent couple cases agree at ages 50, 60 and 75.
- Complete scenario text import round-trips nested conversion, coverage, historical MAGI and survivor facts.
- Lint and production build are run separately from financial tests.
- Browser checks cover individual/couple form availability, live Roth-history recalculation, missing-fact notices and a 390-pixel mobile form layout. The in-app browser did not expose the existing native scenario-name prompt, so the save-button flow was not verified end-to-end there. Scenario serialization/import is covered by production-function tests.

Some old diagnostic fixtures were corrected: formerly “funded” examples received explicit adequate assets instead of relying on unfunded contributions; HSA examples now state coverage/payroll eligibility; SEPP states its actual allocated account and dates; the flexible-spending return sequence now starts at the projection's first distribution year. Their assertions remain active.

## Remaining modeling limits — do not treat these as exact statutory calculations

- This remains a calendar-year planning model. Retirement and investment growth are annual conventions. Social Security, HSA eligibility and death income have month inputs, but it is not a complete monthly tax-return or actuarial engine.
- SEPP supports the existing fixed-amortization method. It preserves the restriction through its final calendar year, which can be conservative after the exact end date. Historical recapture tax/interest must be calculated externally and entered; missing amounts make that scenario incomplete. Validate the chosen account valuation, permissible interest rate, payment schedule and history professionally.
- Survivor own-account transfers occur at the following year boundary. Keeping retirement assets as beneficiary accounts is not implemented by this new couple transition. Pre-retirement deaths, survivor pension eligibility, and the default higher-SS fallback require review; entered SSA survivor estimates are preferable.
- HSA eligible-month counts assume eligibility at the beginning of the year through the specified end/enrollment month. More complex coverage changes, retroactive Medicare coverage and the last-month testing rule need separate validation. Expenses are entered classifications, not an automatic determination of deductibility.
- ACA inputs must represent the actual eligible covered members and premiums. The model does not obtain marketplace quotes, determine employer affordability, or calculate every reconciliation/Medicaid/immigration exception. Future premium changes and changing covered membership need scenario updates. A nonconvergent subsidy is never reported as a confirmed credit.
- Explicit brokerage yield currently represents ordinary taxable distributions. Qualified dividends, municipal interest, tax-loss harvesting, short-term gains and fund-specific distributions are not reconstructed from holdings. With zero explicit yield, legacy tax drag remains a labeled approximation.
- Future inflation-linked limits are projections, not published future law. Federal standard-deduction assumptions, NY limitations, the ordinary Uniform Lifetime RMD table and lack of itemized deductions/AMT/local taxes remain relevant. A sole-beneficiary spouse over ten years younger may require a different RMD table.
- Sustainable spending is a deterministic feasible estimate under a selected policy, not a guarantee or proof of the global optimum across discontinuous subsidy regimes. Monte Carlo uses the modeled return distribution and cannot establish a real-world probability of success.

These changes materially improve financial integrity, but the application is not independently certified for retirement decisions. Confirm all material assumptions and results with a qualified financial or tax professional.

## Government references checked

- [IRS Schedule 1-A](https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf): per-person senior deduction.
- [IRS Publication 590-B](https://www.irs.gov/publications/p590b): Roth ordering, five-year rules, RMD tables.
- [IRS RMD FAQs](https://www.irs.gov/retirement-plans/retirement-plan-and-ira-required-minimum-distributions-faqs): separate obligations and still-working rules.
- [IRS Publication 15](https://www.irs.gov/publications/p15): employee payroll taxes.
- [IRS Publication 969](https://www.irs.gov/publications/p969): HSA coverage, premiums, distributions.
- [IRS catch-up contributions](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-catch-up-contributions): 2026 limits and mandatory Roth treatment.
- [IRS SEPP guidance](https://www.irs.gov/retirement-plans/substantially-equal-periodic-payments): account restrictions and modification consequences.
- [IRS premium tax credit questions](https://www.irs.gov/affordable-care-act/individuals-and-families/questions-and-answers-on-the-premium-tax-credit): eligibility and benchmark/enrollment premiums.
- [IRS NIIT](https://www.irs.gov/individuals/net-investment-income-tax): nonqualified annuity investment income.
- [SSA working while receiving benefits](https://www.ssa.gov/benefits/retirement/planner/whileworking.html): earnings test, monthly rule and benefit adjustment.
- [CMS 2026 Medicare premiums](https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles): IRMAA tiers.
- [New York IT-201 instructions](https://www.tax.ny.gov/forms/current-forms/it/it201i.htm): pension/annuity exclusion and NY income tax rules.
