# Reference Engine Specification

**Application:** https://osuperman.github.io/retirementCalculator/
**Source of truth:** `src/App.jsx` at commit `e025363` (this repository). Extracted, runnable copy: `REFERENCE_ENGINE_CODE.js`.
**Method:** documented from the actual implementation, not screenshots. Every rule below is verified against the code; worked examples use the parity scenario in `REFERENCE_PARITY_OUTPUT.json`. Anything not verifiable from source is labeled **[UNVERIFIED]**.
**Companion docs:** `RULES_AND_METHODOLOGY.md` (law + sources, exhaustive) and `CALCULATION_MODEL.md` (implementation map). This spec is the ordered, reproduction-focused view.

> All dollar figures produced by the engine are **NOMINAL (future dollars)** unless a "today's dollars" display toggle is applied in the UI (the engine itself always computes nominal). Inputs entered "in today's dollars" are inflated to nominal inside the engine as noted per field.

---

## 1. Current configuration (built-in defaults)

The **active** settings are whatever the visitor has entered; they live only in browser `localStorage` and **cannot be read from source**. What *can* be verified are the built-in defaults in `DEFAULT_INPUTS` (individual) — the values a fresh visitor sees:

| Field | Default | Notes |
|---|---|---|
| mode | `single` | individual (not couple) |
| filingStatus | `single` | drives all tax tables |
| currentAge | 45 | |
| retirementAge | 60 | |
| planThroughAge | 95 | |
| householdSize | 1 | |
| balanceCash | 50000 | |
| balanceTaxable | 200000 | |
| taxableBasisPct | 0.70 | cost basis = balance × this |
| balance401k | 500000 | |
| balanceTradIra | 50000 | |
| balanceRoth | 75000 | |
| rothBasis | 0 | Roth contribution basis (penalty-free layer) |
| balanceHsa | 25000 | |
| creditCardDebt | 0 | |
| baseExpenses | 60000 | today's dollars |
| healthcarePre65 | 18000 | today's dollars |
| healthcarePost65 | 8000 | today's dollars |
| partTimeIncome | 0 | today's dollars |
| partTimeYears | 0 | |
| ssIncome | 24000 | FRA benefit, today's dollars |
| ssAge | 67 | |
| pensionIncome | 0 | |
| pensionStartAge | 60 | |
| pensionCola | 0.02 | |
| pensionNyExempt | true | |
| preReturn | 0.06 | nominal |
| postReturn | 0.055 | nominal |
| cashReturn | 0.04 | nominal |
| inflation | 0.03 | |
| contrib401k | 23500 | capped to legal limit per year |
| contribMatch | 5000 | capped so total additions ≤ limit |
| contribHsa | 4300 | capped to legal limit |
| conversionBridge / conversionMid / conversionFinal | 0 / 0 / 0 | Roth conversion targets, today's dollars |
| rmdStartAge | derived (73/75) | from birth year |
| cashStrategy | `cashFirst` | |
| cashReserveFloor | 0 | today's dollars |
| allowReserveAsLastResort | false | |
| useSepp / seppRate | false / 0.05 | 72(t) program |
| useAcaSubsidyEstimate | false | |
| flexibleSpending | true | |
| portfolioVolatility | 0.09 | Monte Carlo only |
| taxableAnnualTaxDrag | 0.005 | |

Couple mode (`DEFAULT_COUPLE_INPUTS`) splits these into `primary`, `spouse`, and `shared` groups and always files MFJ.

---

## 2. Ordered calculation engine

`simulate(inputs)` iterates one calendar year at a time from `PROJECTION_START_YEAR = new Date().getFullYear()` (the reproduction below assumes **2026**) through `currentYear + (planThroughAge − currentAge)`. Each year is either an **accumulation** year (`age < retirementAge`) or a **distribution** year.

### 2.0 Pre-loop (once)
1. **Cost basis init:** `bTaxableBasis = balanceTaxable × taxableBasisPct`.
2. **Roth layers init:** `rothLayers = { contribBasis: min(rothBasis, balanceRoth), vintages: [] }`.
3. **SEPP setup:** if `useSepp && retirementAge < 59.5`, `seppLockEndAge = max(retirementAge + 5, 59.5)`; the payment is fixed later, in the first distribution year.
4. **Debt payoff (time zero):** `creditCardDebt` is paid from cash first, then from taxable (realizing gains against basis). Any residual becomes `unmetCashFlow` and the plan is marked depleted.
   - *Field:* `creditCardDebt`. *Nominal.* *Source:* n/a (modeling choice).

### 2.1 Accumulation year (age < retirementAge)
Order of operations:
1. **Contribution caps** (`getContributionLimits(age, year)`): 2026 base employee deferral **$24,500**, +**$8,000** age 50-59, +**$11,250** age 60-63 (replaces the 50+ catch-up); annual-additions cap **$72,000**; HSA **$4,400** self / **$8,750** family, +**$1,000** age 55. Future years projected by `inflation` with statutory rounding. *Source: IRS 2026 limits; IRC §415(c), §414(v); Rev. Proc. 2025-19; SECURE 2.0 §109.*
2. **Traditional-IRA RMD while working** (if `age ≥ rmdStartAge`): forced from the IRA, moved gross into taxable (raising basis). *Income tax on it is NOT modeled in accumulation years.* *Source: IRC §401(a)(9) — still-working exception is 401(k)-only.*
3. **Growth (end of year), applied once:**
   - `b401k = b401k × (1 + preReturn) + appliedEmployee + appliedMatch`
   - `bTaxable = bTaxable × (1 + preReturn − taxableAnnualTaxDrag)`
   - `bTradIra, bRoth, bHsa` grow at `preReturn` (HSA also + contribution)
   - `bCash = bCash × (1 + cashReturn)`
   - *`preReturn`/`cashReturn` nominal.* Growth is applied **after** contributions.

### 2.2 Distribution year (age ≥ retirementAge) — exact order

**(a) Spending (nominal).** `inflMult = (1 + inflation)^(year − currentYear)`.
- `lifestyleSpending = round(baseExpenses × inflMult)`
- `healthcareSticker = age < 65 ? healthcarePre65 : healthcarePost65`
- `spendingBase = round((baseExpenses + healthcareSticker) × inflMult)`
- **Flexible spending** (if enabled): if the portfolio's prior year-end total fell > 15% vs the year before, cut this year's spending 10%. (Off in the parity scenario.)
- *All spending inputs are today's dollars, inflated from the current year.*

**(b) Income (nominal).**
- `partTime = age < retirementAge + partTimeYears ? round(partTimeIncome × inflMult) : 0`
- `ssGross = age ≥ max(62, ssAge) ? round(adjustedBenefit × (1+inflation)^(year−currentYear)) : 0` where `adjustedBenefit = ssIncome × claimFactor`. Claim factor (SSA): −5/9%/mo first 36 mo early, −5/12%/mo beyond; +2/3%/mo delayed to age 70; claim age clamped to [62, 70]. *Source: 42 U.S.C. §402; SSA reduction/credit tables.*
- `pensionGross = age ≥ pensionStartAge ? round(pensionIncome × (1+pensionCola)^(year−currentYear)) : 0`.

**(c) Roth conversion target (nominal).** By age band, capped at available 401k after any RMD carve-out:
- `age < 60`: `min(round(conversionBridge × inflMult), b401k)`
- `60 ≤ age < 65`: `conversionMid`
- `65 ≤ age < ssClaimAge`: `conversionFinal`
- `age ≥ ssClaimAge`: 0 (conversions stop once SS starts)
- *Taxable ordinary income in the conversion year; not a spending withdrawal.* *Source: IRC §408A.*

**(d) RMD (nominal).** If `age ≥ rmdStartAge`: `rmd = (b401k + bTradIra) / divisor(age)` where divisor is the 2022+ Uniform Lifetime Table (age 75 → 24.6, …, 120+ → 2.0). Computed on **start-of-year** balances (= prior Dec 31). Conversions are carved out so an RMD is never converted. *Source: Treas. Reg. §1.401(a)(9)-9; SECURE 2.0 §107.*

**(e) SEPP payment fix.** In the first distribution year, if enabled: `seppPayment = amortize(b401k + bTradIra, seppRate, age)` over Single Life Expectancy (Notice 2022-6). Active until `seppLockEndAge`.

**(f) IRMAA lookback (age ≥ 65).** Surcharge is set from **modeled MAGI two years prior** (`magiByYear[year − 2]`) when available — no iteration. Only the first ≤2 Medicare years, whose lookback predates modeled retirement income, fall back to same-year MAGI solved iteratively. 2026 single tiers by MAGI: ≤$109K → $0; ≤$137K; ≤$171K; ≤$205K; <$500K; ≥$500K, each adding (PartB+PartD) × 12 monthly amounts ($81.20+$14.50 … $487+$91), inflated after 2026. *Source: CMS 2026 IRMAA.*

**(g) HSA offset.** `healthcarePortion = effectiveSpending − lifestyleSpending` (includes IRMAA post-65); `hsaWithdrawal = min(bHsa, healthcarePortion)`. HSA is applied to healthcare **before** any taxable withdrawal; never used for non-medical spending.

**(h) Net need & gross-up solve.** `netNeed = max(0, effectiveSpending − hsaWithdrawal − partTime − ssGross − pensionGross)`. Then `solveGrossedUpWithdrawals` iterates (≤10 rounds, converges when |Δtax| < $1):
```
tax = 0
repeat:
  grossNeed   = netNeed + tax
  withdrawals = waterfall(grossNeed, balances, cashStrategy)   // (i)
  force RMD (and SEPP payment) into tax-deferred draw if under
  realizedGain = wTaxable × max(0, (value − basis)/value)       // cost-basis method
  taxableSs    = §86(ssGross, otherIncome incl. realizedGain + conversion, filingStatus)
  ordIncome    = partTime + taxableSs + pension + w401k + wIra + conversion
  earlyPenalty = 0.10 × (penalizedTaxDeferred + penalizedRoth)  // (j)
  tax = totalTax(ordIncome, realizedGain, year, …, filingStatus) + earlyPenalty
until converged
```
An outer loop (≤4) re-solves for IRMAA (post-65) and, if enabled, one ACA re-solve pre-65.

**(i) Withdrawal waterfall.** Pre-SS default order: cash-above-reserve → taxable → 401k → IRA → Roth. Post-SS: 401k → IRA → taxable → cash → Roth. Cash strategy modifies this:
- `cashFirst` (default): reserve floor ignored.
- `preserveReserve`: as above but cash never drawn below `cashReserveFloor × inflMult`.
- `proportional`: split across cash-above-floor/taxable/401k/IRA pro-rata; Roth last.
- `cashLast`: cash after taxable + tax-deferred, before Roth.
- Reserve is spent only if `allowReserveAsLastResort` and everything else is empty; else the gap becomes `unmetCashFlow`. RMD/SEPP forced draws always happen first.

**(j) Federal + NY tax (`totalTax`).** Filing-status tables (single shown; MFJ in couple mode):
- **Standard deduction (2026 single):** $16,100, + age-65 extra $2,050/person (indexed), + OBBBA senior bonus $6,000/person for 2025-2028 (phased out 6% above $75K single MAGI).
- **Ordinary brackets (2026 single):** 10% ≤$12,400; 12% ≤$50,400; 22% ≤$105,700; 24% ≤$201,775; 32% ≤$256,225; 35% ≤$640,600; 37% above. Future years indexed by `inflation`.
- **LTCG (2026 single):** 0% to $49,450 taxable, 15% to $545,500, 20% above — stacked on top of ordinary taxable income; unused standard deduction spills into LTCG.
- **NIIT:** 3.8% × min(LTCG, MAGI − $200,000 single) when MAGI > threshold (unindexed).
- **NY:** 2024 single brackets (4%…10.9%), $8,000 standard deduction, both indexed by `inflation`; bottom-five rates cut 0.1pp in 2026 / 0.2pp from 2027. NY excludes taxable Social Security, NY-exempt public pensions, and up to $20,000/person private retirement income from age 59½. Capital gains taxed as ordinary in NY.
- *Sources: IRS Rev. Proc. 2025-32; IRC §1(h), §1411, §86; NY Tax Law §601/§612; Ch. 59 Laws of 2025.*
- **Early penalty (IRC §72(t)):** 10% before 59½. 401k exempt under Rule of 55 (`retirementAge ≥ 55`, from age 55). IRA always penalized. Roth per ordering layers: contribution basis + 5-year-seasoned conversions free, unseasoned principal + earnings penalized. SEPP payment amount is exempt. RMD ages never coincide with < 59½.

**(k) Execute & grow.** Subtract withdrawals from start-of-year balances; consume Roth layers FIFO; add this year's conversion as a new Roth vintage; reinvest any RMD/SEPP surplus (draw beyond net need + tax) into cash. Then grow every balance **once** at `postReturn` (taxable at `postReturn − drag`, cash at `cashReturn`). Record `magiByYear[year] = ordIncome + realizedGain`.

**(l) Failure/shortfall.** A year contributes to `unmetCashFlow` when gross withdrawals cannot cover `netNeed + tax`. `summary.depleted = true` if any year has `total ≤ 0` **or** `unmetCashFlow > 1`. A separate materiality test (`hasMaterialUnmetCashFlow`: cumulative unmet > max($1,000, 0.5% of year-1 spending)) governs the UI banner — see `REFERENCE_DISCREPANCIES.md` item D-1 for why these can disagree.

**(m) Rounding.** Balances, withdrawals, and per-row outputs are `Math.round`ed to whole dollars. Tax converges to < $1 then rounds. IRMAA surcharge is a float added to already-rounded spending (produces sub-dollar decimals in `spending` post-65 — see D-4).

### 2.3 Monte Carlo
`runMonteCarlo` runs 500 paths, drawing each retirement year's return i.i.d. from Normal(`postReturn`, `portfolioVolatility`) and feeding it through the **same full engine** (taxes, RMDs, IRMAA, penalties, cash strategy). Success = not depleted under the materiality standard. Deterministic; not part of the parity scenario.

---

## 3. Worked reproduction (parity scenario)

Full 41-year output is in `REFERENCE_PARITY_OUTPUT.json`. Anchor values (nominal, 2026 start):

| Metric | Value |
|---|---|
| Portfolio at retirement (age 55) | **$2,564,052** |
| Portfolio at end (age 90) | **$3,065,774** |
| Lifetime taxes | $963,206 |
| Total Roth converted | $398,693 |
| `summary.depleted` | `true` (immaterial — see D-1; cumulative unmet = **$21**) |

Selected years:
- **Age 55:** spending $107,812; funded by part-time $23,185 + HSA $32,459 (healthcare) + cash $60,346; **no 401k draw, $0 penalty** (Rule of 55 + cash-first-above-floor). Roth conversion $34,778 (taxable, not spending).
- **Age 62:** cash exhausted to its inflating floor; 401k becomes the primary source ($152,240).
- **Age 65:** spending drops (healthcare $28K→$8K cliff); **IRMAA $4,494** appears — set by the two-year lookback to age-63 MAGI (which was elevated by conversions). IRMAA at 66 = $4,629; none after (conversions had stopped).
- **Age 75:** RMD $56,451 begins; actual 401k draw $113,441 (spending need exceeds the RMD floor).
- **Penalties:** $0 in every year. **Reserve:** cash never falls below its floor; `reserveUsed = 0` throughout.
