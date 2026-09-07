# Retirement Planning Engine — Rules, Law, and Methodology

**Version:** 2026-07 r3 (current law as of tax year 2026; adds single-filer support, IRMAA two-year lookback, Roth ordering layers, and optional SEPP/72(t) modeling. r3 audit fixes: 2025 FPL base, ACA 400%-FPL boundary, cash interest taxed, conversions stop at Social Security, materiality-gated depletion flag, debt-payoff gain taxed, Monte Carlo draw floor)
**Scope:** United States federal tax law, New York State tax law, Social Security, Medicare, and ACA rules as implemented by the projection engine in `src/App.jsx`.
**Audience:** A developer or reviewer who needs to understand, verify, or reconstruct the calculation engine without reference to the user interface.

> **Standing caveat.** This document describes a *model*. Every rule below is implemented as stated, and every deliberate simplification is flagged with ⚠️. It is not tax, legal, or investment advice; a real plan should be reviewed by a fee-only fiduciary and a CPA.

---

## 1. Account taxonomy — how each account works in retirement

The engine models seven account types. For each: how money goes in, how it grows, how it comes out, what penalties apply, and what happens at death.

### 1.1 Cash / high-yield savings

| Property | Rule |
|---|---|
| Growth | User-set nominal rate (`cashReturn`), applied annually. |
| Taxation | Interest (start-of-year cash balance × `cashReturn`) is taxed as **ordinary income** and counted in provisional income and MAGI (federal + NY). ⚠️ Simplification: interest is computed on the start-of-year balance, so mid-year draws are ignored. |
| Access | Any age, no penalty. |
| At death | Passes to heirs with no income tax. |

### 1.2 Taxable brokerage

| Property | Rule |
|---|---|
| Growth | Market return minus an annual **tax drag** (`taxableAnnualTaxDrag`, default 0.5%/yr) approximating tax on dividends and fund turnover. |
| Cost basis | Tracked explicitly. Initial basis = balance × `taxableBasisPct` (user input, default 70%). Basis does **not** grow with market returns; sales reduce basis proportionally: realized gain = withdrawal × max(0, (value − basis)/value). |
| Taxation on sale | Realized gain is taxed as **long-term capital gain** (§1(h)) at the 0%/15%/20% preferential brackets, stacked on top of ordinary taxable income (see §4.3). ⚠️ All gains are assumed long-term; short-term gains and loss harvesting are not modeled. |
| Provisional income | Realized gains count toward Social Security provisional income (see §5.4) and toward MAGI for NIIT, IRMAA, and ACA. |
| Access | Any age, no penalty. |
| At death | ⚠️ Step-up in basis (IRC §1014) is described in the app's inheritance explainer but not simulated (the projection ends at the plan horizon). |

### 1.3 Employer plans — 401(k) / 403(b) (pre-tax)

| Property | Rule | Source |
|---|---|---|
| Employee deferral limit (2026) | **$24,500**; age 50+ catch-up **+$8,000**; age 60–63 "super" catch-up **+$11,250** (replaces, not stacks with, the 50+ catch-up). | IRS Notice, 2026 retirement plan limits; SECURE 2.0 §109 |
| Total annual additions (2026) | Employee + employer ≤ **$72,000** (+ applicable catch-up). Employer match input is capped so the sum never exceeds this. | IRC §415(c) |
| Growth | Tax-deferred; no drag. |
| Withdrawals | 100% ordinary income in the year taken. |
| Early-access penalty | 10% additional tax before age 59½ (§72(t)), **except** the Rule of 55: if separation from service occurs in or after the year the participant turns 55, withdrawals from *that employer's plan* are penalty-free from age 55. The model applies Rule of 55 whenever `retirementAge ≥ 55` and current age ≥ 55; retiring before 55 forfeits it permanently. | IRC §72(t)(2)(A)(v) |
| RMDs | Required from the start age in §6. ⚠️ Still-working exception (RMDs deferred on the *current* employer's plan while employed, unless a 5% owner) is honored during accumulation years but not in the couple engine's mixed retired/working years — see §6.4. | IRC §401(a)(9) |
| Catch-up must be Roth for high earners | ⚠️ Not modeled. From 2026, participants with prior-year FICA wages above the indexed $145K threshold must make catch-ups as Roth (SECURE 2.0 §603). The model treats all deferrals as pre-tax. |
| At death | Ordinary income to heirs; spouse may roll over; non-spouse heirs subject to the 10-year rule (SECURE Act). ⚠️ Described, not simulated. |

### 1.4 Traditional IRA

| Property | Rule |
|---|---|
| Contributions | ⚠️ Not modeled as an input (the accumulation phase only adds to 401k and HSA); an existing balance grows tax-deferred. |
| Withdrawals | 100% ordinary income (assumes no nondeductible basis; ⚠️ Form 8606 basis not modeled). |
| Early-access penalty | 10% before 59½ — **the Rule of 55 never applies to IRAs**. IRA draws before 59½ are penalized unless covered by the optional SEPP/72(t) program (§7). |
| RMDs | Required from the start age in §6 **regardless of work status** (the still-working exception is a 401(k)-only rule). The model enforces IRA RMDs even during working years. |

### 1.5 Roth IRA

| Property | Rule |
|---|---|
| Growth / qualified withdrawals | Tax-free. Qualified = age 59½+ and 5+ years since first Roth funding. |
| RMDs | None during the owner's life (IRC §408A(c)(5)); the model never forces Roth distributions. |
| Withdrawal ordering (real law) | Contributions first (always tax/penalty-free), conversions next (penalty-free after 5 years each, FIFO), earnings last (taxable + 10% penalty if non-qualified). |
| Model treatment | The engine **tracks the ordering layers**: user-entered lifetime contribution basis (`rothBasis`, never taxed or penalized), then every conversion vintage the model creates (each penalty-free once 5 tax years old, FIFO), then earnings. Before 59½ only unseasoned conversion principal and earnings incur the 10% penalty — so **Roth conversion ladders price correctly**. ⚠️ Remaining simplification: income *tax* on early earnings withdrawals is not modeled (they occur only when a plan is already collapsing, and earnings are consumed last). |
| Priority | The waterfall preserves Roth as the last-tapped account in every strategy, because tax-free compounding and inheritance value make it the most valuable dollar. |

### 1.6 Health Savings Account (HSA)

| Property | Rule | Source |
|---|---|---|
| Contribution limits (2026) | Self-only **$4,400**, family **$8,750**, age-55 catch-up **+$1,000** per spouse (each spouse's catch-up must go to their own HSA — the couple engine allocates accordingly). Requires HDHP coverage (⚠️ assumed, not verified). | IRS Rev. Proc. 2025-19 |
| Growth | Tax-free. |
| Qualified withdrawals | Tax-free for qualified medical expenses at any age. From 65, Medicare Part B/D premiums and IRMAA surcharges are qualified expenses. |
| Model use | HSA dollars are applied **first** against each year's healthcare portion of spending (including IRMAA post-65), before any taxable withdrawal. HSA is never used for non-medical spending. |
| Non-qualified withdrawals | Before 65: ordinary income + 20% penalty; after 65: ordinary income only. ⚠️ Never occurs in the model by construction. |
| At death | Spouse inherits as HSA; non-spouse heirs are taxed on full value — described in-app, not simulated. |

### 1.7 Defined-benefit pension

| Property | Rule |
|---|---|
| Benefit | User-entered annual amount from a start age, growing at a user COLA (`pensionCola`, default 2%) from the current year. |
| Federal tax | 100% ordinary income. |
| NY tax | If flagged as a NY public pension (NYS/local government, teachers, federal, military), **fully exempt** from NY tax (NY Tax Law §612(c)(3)). Otherwise it is private retirement income eligible for the $20,000 exclusion (§10.3). |

### 1.8 Inherited BCO accounts (403(b)/TSA, IRA, and annuity)

The individual-mode inherited bucket represents an account kept in beneficiary
form under a Beneficiary Continuation Option (BCO). It is not automatically an
inherited IRA. The user selects the plan type so a 403(b)/TSA is treated as a
qualified employer-plan account, while a nonqualified annuity uses
earnings-first taxation followed by return of entered cost basis.

Federal beneficiary rules and contract terms are modeled as separate layers:

- `lifeExpectancy` continues annual required beneficiary distributions under
  the selected relationship and owner RMD-status assumptions.
- `tenYear` uses the statutory death-year-plus-10 deadline. If a contract
  deadline is also configured, the earlier of the federal and contract dates
  controls; the contract date can never extend the federal deadline.
- `ownerAge` derives the contract final distribution year as
  `inheritedDeceasedBirthYear + inheritedContractFinalDistributionAge`.
  Therefore an owner born in 1971 reaches age 72 in 2043, while an owner born
  in 1970 reaches age 72 in 2042. This is a contract-specific setting, not a
  universal inherited-account rule.
- In the effective final year, the entire remaining balance is forced out as a
  required distribution (not required spending), and the BCO is marked
  terminated after the balance is emptied. In retirement, after-tax excess is
  sent to Cash/HYSA through the existing `surplusToCash` flow.
- The partial-withdrawal minimum is surfaced as an execution warning only; it
  does not alter federal distribution math. Withdrawal charges are not
  estimated from a generic schedule. The no-charge result is used only when
  the user selects an actual BCO endorsement that waives charges; standard and
  unknown schedules remain unmodeled and require contract verification.

---

## 2. The age timeline that drives everything

The engine's decisions branch on these statutory ages:

| Age | Event | Authority |
|---|---|---|
| 50 | 401(k) catch-up contributions begin (+$8,000 in 2026) | IRC §414(v) |
| 55 | Rule of 55 (401k penalty-free if separated in/after that year); HSA catch-up (+$1,000) | §72(t)(2)(A)(v); §223(b)(3) |
| 59½ | 10% early-withdrawal penalty ends for all retirement accounts; NY $20K pension/annuity exclusion begins | §72(t); NY §612(c)(3-a) |
| 60–63 | 401(k) "super" catch-up ($11,250 in 2026) | SECURE 2.0 §109 |
| 62 | Earliest Social Security claim (model clamps any lower input to 62) | 42 U.S.C. §402 |
| 65 | Medicare begins (healthcare input switches from pre-65 to post-65 cost); IRMAA exposure begins; ACA modeling ends | SSA/CMS |
| 67 | Social Security full retirement age (birth years 1960+; ⚠️ model uses 67 for everyone) | SSA |
| 70 | Delayed retirement credits stop; model clamps claim age to ≤70 for benefit math | SSA |
| 73 / 75 | RMDs begin: born 1951–1959 → 73; born 1960+ → 75 (see §6) | SECURE 2.0 §107 |

Because the model steps in whole years, "59½" is implemented as `age < 59.5` with integer ages — i.e., the age-59 year is penalized, the age-60 year is not.

---

## 3. Projection mechanics

1. **Time step:** annual, from the current calendar year through the year the user reaches `planThroughAge` (couple mode: the later of the two spouses' horizons).
2. **Phase split:** ages below `retirementAge` are accumulation years; the retirement-age year is the first distribution year.
3. **Order of operations in a distribution year:** compute income and spending → solve withdrawals + taxes (iteratively, §11) → subtract withdrawals from start-of-year balances → apply growth once at year end. Start-of-year balances therefore equal prior-December-31 balances, which is what RMD law requires.
4. **Accumulation years:** contributions are capped at statutory limits (§1.3, §1.6), added with growth; Traditional IRA RMDs are still enforced if past the start age (gross amount moves to the taxable account, raising basis; ⚠️ the income tax on it is not modeled because salary-year taxes are out of scope).
5. **Inflation anchoring:** all today's-dollar inputs (spending, healthcare, part-time income, conversion targets, SS benefit, cash reserve floor) inflate from the **current year**: multiplier = (1 + inflation)^(year − currentYear). The "Today's $" display divides every nominal figure by the same multiplier.
6. **Debt:** credit-card debt is paid off at time zero from cash, then taxable (realizing gains against basis; the gain is taxed in the first distribution year, §15.15); any residual counts as unmet cash flow.
7. **Depletion / failure:** a year fails when spending + tax cannot be covered by available withdrawals (`unmetCashFlow`) or total assets ≤ 0. The engine's own `summary.depleted` flag (not just the UI banner) applies the materiality threshold — cumulative unmet cash flow must exceed max($1,000, 0.5% of year-one spending) — so sub-dollar solver rounding never marks a funded plan depleted, and the flag the Ask-AI context receives agrees with the banner. A single year whose total assets hit ≤ 0 still flags immediately.

---

## 4. Federal income tax (filing-status aware)

The engine supports two filing statuses: **single** and **married filing jointly (MFJ)**. Individual mode defaults to single-filer parameters (a married user modeling only their own accounts can switch to MFJ); couple mode always files jointly. Filing status drives the federal brackets, standard deduction, LTCG breakpoints, Social Security taxation thresholds, NIIT threshold, IRMAA tiers, and NY parameters. On the default plan the difference is material: the same inputs produce roughly $342K more lifetime tax as a single filer than as MFJ.

### 4.1 2026 parameters (post-OBBBA, IRS Rev. Proc. 2025-32 inflation adjustments)

| Parameter | MFJ | Single |
|---|---|---|
| Standard deduction | $32,200 | $16,100 |
| 10% bracket to | $24,800 | $12,400 |
| 12% bracket to | $100,800 | $50,400 |
| 22% bracket to | $211,400 | $105,700 |
| 24% bracket to | $403,550 | $201,775 |
| 32% bracket to | $512,450 | $256,225 |
| 35% bracket to | $768,700 | $640,600 |
| LTCG 0% to | $98,900 | $49,450 |
| LTCG 15% to | $613,700 | $545,500 |

(2024 statutory tables are also carried for pre-2026 base years: MFJ $29,200 deduction etc.; single $14,600 deduction, brackets $11,600/$47,150/$100,525/$191,950/$243,725/$609,350, LTCG $47,025/$518,900.)

### 4.2 Projection of future years

Brackets, the standard deduction, and LTCG breakpoints for years after the last known table year (2026) are inflated by the **user's inflation assumption** (real law indexes by chained CPI). Years before 2026 use the 2024 statutory table.

### 4.3 Computing a year's federal tax

1. `taxableOrdinary` = max(0, ordinary income − standard deduction). Ordinary income = part-time wages + taxable Social Security + pensions + 401k/IRA withdrawals + Roth conversions.
2. Unused standard deduction (when ordinary income < deduction) reduces taxable LTCG.
3. Ordinary tax: marginal brackets over `taxableOrdinary`.
4. **LTCG stacking:** capital gains fill brackets *starting on top of* `taxableOrdinary` — gains below the 0% breakpoint are untaxed, then 15%, then 20%.
5. **NIIT (§1411):** 3.8% × min(net investment income, MAGI − threshold) above the statutorily unindexed threshold: $250,000 MFJ / $200,000 single. ⚠️ Net investment income is approximated as realized LTCG only.
6. ⚠️ Not modeled: AMT, itemized deductions, tax credits, capital-loss netting, qualified dividends as a separate flow, the senior deduction, and filing-status changes.

---

## 5. Social Security

### 5.1 Benefit input
`ssIncome` is the annual benefit at full retirement age (FRA) in today's dollars — the number from the user's ssa.gov statement. FRA is modeled as **67** (correct for birth years 1960+; ⚠️ earlier cohorts have FRA 66–66 10/12).

### 5.2 Claim-age adjustment (SSA reduction/credit formulas)
- Claim age is clamped to the legal window **62–70**.
- **Early:** reduction = 5/9 of 1% per month for the first 36 months before FRA + 5/12 of 1% per month beyond 36. (Claiming at 62 with FRA 67 → 70% of PIA.)
- **Delayed:** +8%/year (2/3 of 1% per month), up to 36 months (age 70 → 124% of PIA).

### 5.3 COLA
Benefits are inflated from the current year at the user's inflation rate (a proxy for CPI-W COLA).

### 5.4 Taxation of benefits (IRC §86)
Provisional income = all other AGI income (including realized capital gains and Roth conversions) + 50% of gross SS. Thresholds are **statutorily unindexed** and filing-status dependent: $32,000/$44,000 MFJ, $25,000/$34,000 single.
- ≤ lower threshold → 0% taxable.
- Between thresholds → taxable = min(50% of SS, 50% of excess over the lower threshold).
- Above the upper threshold → taxable = 85% of the excess + min(half the threshold gap [$6,000 MFJ / $4,500 single], 50% of SS), capped at **85% of gross benefits**.

### 5.5 Not modeled ⚠️
The earnings test (claiming before FRA while earning above ~$23K withholds benefits), spousal benefits, survivor benefits, and the WEP/GPO repeal nuances. Couple mode sums each spouse's own benefit only.

---

## 6. Required Minimum Distributions

### 6.1 Start age (SECURE 2.0 §107)
| Birth year | RMD start age |
|---|---|
| ≤ 1950 | 72 (already in pay status) |
| 1951–1959 | 73 |
| 1960+ | 75 |

The engine derives birth year from current age and lets the user override.

### 6.2 Amount
RMD = **prior December 31 balance ÷ Uniform Lifetime Table divisor** (Treas. Reg. §1.401(a)(9)-9, 2022+ table). The full table is hardcoded: age 72 → 27.4, 73 → 26.5, 74 → 25.5, 75 → 24.6, 76 → 23.7, 77 → 22.9, 78 → 22.0, 79 → 21.1, 80 → 20.2, 81 → 19.4, 82 → 18.5, 83 → 17.7, 84 → 16.8, 85 → 16.0, 86 → 15.2, 87 → 14.4, 88 → 13.7, 89 → 12.9, 90 → 12.2, 91 → 11.5, 92 → 10.8, 93 → 10.1, 94 → 9.5, 95 → 8.9, 96 → 8.4, 97 → 7.8, 98 → 7.3, 99 → 6.8, 100 → 6.4, 101 → 6.0, 102 → 5.6, 103 → 5.2, 104 → 4.9, 105 → 4.6, 106 → 4.3, 107 → 4.1, 108 → 3.9, 109 → 3.7, 110 → 3.5, 111 → 3.4, 112 → 3.3, 113 → 3.1, 114 → 3.0, 115 → 2.9, 116 → 2.8, 117 → 2.7, 118 → 2.5, 119 → 2.3, 120+ → 2.0.

### 6.3 Enforcement
- RMDs are computed on the combined 401k + Traditional IRA balance and forced **inside** the tax solve, so the tax on a forced distribution is itself funded. ⚠️ Real law computes 401(k) RMDs per plan and IRA RMDs aggregated across IRAs; with one bucket of each, combining is equivalent except for the still-working case.
- RMD dollars beyond what spending + taxes need are reinvested into the cash account (after tax has been assessed on the full distribution).
- Roth conversions may not satisfy an RMD: the RMD amount is carved out of the 401k *before* the conversion cap is applied, so the RMD is always distributed, never converted (Treas. Reg. §1.402(c)-2 ordering).
- Couple mode computes and enforces each spouse's RMD independently, then taxes them jointly.
- No RMDs on Roth IRA (ever) or on the model's Roth balances.

---

## 7. Early-withdrawal penalty (IRC §72(t))

- **10% additional federal tax** on distributions from tax-deferred accounts before age 59½, added to the year's tax inside the gross-up solve (so withdrawals also cover the penalty).
- **401(k):** exempt only under the Rule of 55 (§1.3); the exemption never applies if the user retires before 55, even after they turn 55.
- **Traditional IRA:** always penalized before 59½.
- **Roth:** penalized only on unseasoned conversion principal and earnings, per the ordering layers in §1.5. Contribution basis and 5-year-seasoned conversions are penalty-free.
- **Roth conversions:** never penalized at conversion time (they are not distributions to the taxpayer).
- **RMD interaction:** impossible by construction (RMD ages ≥ 72 > 59½).
- **SEPP / substantially equal periodic payments (§72(t)(2)(A)(iv)):** modeled as an opt-in program (individual mode). The fixed-amortization method (Notice 2022-6) sets a level annual payment from the tax-deferred balance at the first retirement year, amortized over Single Life Table expectancy at a user-chosen rate (legal cap of 120% of the federal mid-term rate is the user's responsibility; the UI carries the warning). Payments are forced every year from retirement until the **later of 5 years or age 59½** and are penalty-exempt; draws beyond the payment are still penalized. ⚠️ Busting the schedule (retroactive penalties) is not modeled — the engine always takes at least the payment.
- ⚠️ Other statutory exceptions **not** modeled: disability, medical expenses > 7.5% AGI, QDRO, first home, birth/adoption, terminal illness, disaster distributions.

---

## 8. Roth conversions

- Mechanics: a user-set annual amount (in today's dollars, inflation-adjusted) moves 401k → Roth in three age windows: retirement–59, 60–64, and 65+. Conversions stop the year Social Security starts, in **every** window (by design, since SS + conversions stack income) — so an early claim at 62 ends conversions at 62, before the 60–64 or 65+ targets would otherwise apply. The engine and couple engine both enforce this per person.
- Conversions are **ordinary income** in the conversion year, increase provisional income for SS taxation, MAGI for NIIT/IRMAA/ACA, and NY taxable income (eligible for the NY $20K exclusion, §10.3).
- Conversions are capped at the available 401k balance after the year's RMD (see §6.3) and planned withdrawals.
- The strategic rationale (documented for users): fill low tax brackets in the years between retirement and SS/RMDs, shrinking future RMDs and building tax-free assets; the trade-offs are current-year tax, ACA subsidy loss before 65, and IRMAA two years later.
- ⚠️ The 5-year conversion clock is not tracked (see §1.5); conversion taxes are paid from the same withdrawal pool rather than earmarked.

---

## 9. Healthcare costs: ACA and Medicare/IRMAA

### 9.1 Before 65 — ACA premium tax credit (optional estimate)
- Under **current 2026 law** the enhanced credits expired: no credit **above** 400% of the Federal Poverty Level (the "subsidy cliff" is back). Income **at or below** 400% FPL is eligible (§36B: household income that "does not exceed" 400%), so the top band is inclusive at exactly 400%. Below/at 400% FPL, the household's expected premium contribution is MAGI × applicable percentage, interpolated within these 2026 brackets (Rev. Proc. 2025-25): ≤133% FPL → 2.10%; 133–150% → 3.14→4.19%; 150–200% → 4.19→6.60%; 200–250% → 6.60→8.44%; 250–300% → 8.44→9.96%; 300–400% → 9.96% flat.
- FPL: **2025** guidelines ($15,650 + $5,500 per additional household member, lower-48 — the guideline set that governs 2026 ACA eligibility) projected forward by user inflation (⚠️ approximation of annual HHS updates).
- The model treats the user's pre-65 healthcare input as the sticker cost, reserves a non-premium out-of-pocket floor (~$2,000/yr in 2025 dollars, inflated on the FPL clock), and pays min(premium, expected contribution).
- ⚠️ MAGI for ACA should add back **non-taxable** Social Security; the model uses taxable SS only (only matters when claiming SS before 65). Benchmark-plan (SLCSP) mechanics, state variations, and cost-sharing reductions are not modeled.

### 9.2 At 65+ — Medicare and IRMAA
- Healthcare input switches to the user's post-65 estimate (Medicare premiums + supplemental).
- **IRMAA** (income-related monthly adjustment): 2026 tiers, *monthly per-person surcharges* (Part B + Part D). Surcharge amounts are identical across statuses; thresholds differ:

| MAGI (MFJ) | MAGI (single) | Part B | Part D |
|---|---|---|---|
| ≤ $218,000 | ≤ $109,000 | $0 | $0 |
| ≤ $274,000 | ≤ $137,000 | $81.20 | $14.50 |
| ≤ $342,000 | ≤ $171,000 | $202.90 | $37.50 |
| ≤ $410,000 | ≤ $205,000 | $324.60 | $60.40 |
| < $750,000 | < $500,000 | $446.30 | $83.30 |
| ≥ $750,000 | ≥ $500,000 | $487.00 | $91.00 |

- **Two-year lookback:** the surcharge for year Y is computed from the *modeled MAGI of year Y−2*, matching how Medicare actually sets premiums — so a large Roth conversion at 63 correctly raises premiums at 65. Because the lookback MAGI is already settled, no iteration is needed. ⚠️ Only the first Medicare years, whose lookback falls before modeled retirement income begins (working-year MAGI is out of scope), fall back to the same-year iterative approximation.
- Surcharges are annualized (×12 × enrollees) and added to spending, with one re-solve to fund them. Thresholds and amounts inflate after 2026 by user inflation. ⚠️ The top threshold is frozen in law until 2028; the model inflates it.

---

## 10. New York State income tax

1. **Brackets (MFJ, 2024 statutory base):** 4% to $17,150; 4.5% to $23,600; 5.25% to $27,900; 5.5% to $161,550; 6% to $323,200; 6.85% to $2,155,350; 9.65% to $5M; 10.3% to $25M; 10.9% above. **Middle-class tax cut (Ch. 59, Laws of 2025):** the bottom five rates fall 0.1 pp in tax year 2026 and 0.2 pp total from 2027 (4%→3.8%, …, 6%→5.8%). Standard deduction $16,050 MFJ. ⚠️ NY does not index brackets; the model inflates them (and the deduction) by user inflation to avoid artificial multi-decade bracket creep — a deliberate modeling choice, flagged.
2. **Social Security:** fully exempt from NY tax (subtracted from federal AGI).
3. **Pension & retirement income:** NY public pensions (state/local government, teachers, federal, military) are fully exempt. Private retirement income — 401k/IRA withdrawals, Roth conversions, private pensions — qualifies for the **$20,000 per-person annual exclusion** from age 59½ (NY Tax Law §612(c)(3-a)); couple mode applies it per spouse.
4. **Capital gains:** taxed as ordinary income (no preferential rate).
5. ⚠️ NYC/Yonkers local tax, other states, and residency changes are not modeled; NY residency is assumed for the full projection.

---

## 11. Withdrawal sequencing and the tax gross-up solve

### 11.1 The circular problem
Withdrawals from tax-deferred accounts create taxable income, which creates tax, which requires more withdrawals. The engine solves this by fixed-point iteration (≤10 rounds, converges when the tax estimate moves < $1):

```
tax = 0
repeat:
    grossNeed   = netSpendingNeed + tax
    withdrawals = waterfall(grossNeed, balances, strategy)
    force RMD into withdrawals if underdrawn
    realizedGain = taxable withdrawal × embedded-gain ratio
    taxableSS    = §86 formula(grossSS, other income incl. gains + conversions)
    tax = federal ordinary + LTCG stack + NIIT + §72(t) penalty + NY tax
until |Δtax| < $1
```
An outer loop (≤4 rounds) wraps this for IRMAA (§9.2) and, pre-65, one re-solve applies the ACA subsidy estimate.

### 11.2 Default withdrawal order (waterfall)
- **Before Social Security starts:** cash → taxable → 401k → Traditional IRA → Roth.
- **After Social Security starts:** 401k → IRA → taxable → cash → Roth (drawing down tax-deferred ahead of RMD age while SS covers the base).
- Roth is always last (§1.5). RMDs are forced first regardless of order.

### 11.3 User-selectable cash strategy
The reserve floor is entered in today's dollars and inflates with the plan.
1. **Use cash first** (default/legacy): order above; reserve floor ignored.
2. **Preserve cash reserve:** cash first, but never below the floor.
3. **Proportional:** each year's need is split across cash-above-floor, taxable, 401k, and IRA *pro-rata by balance*; Roth last.
4. **Cash only if required:** taxable and tax-deferred first; cash-above-floor before Roth only.
- The protected floor is spendable only when every other account (including Roth) is empty **and** the user enabled "allow reserve as last resort"; otherwise the plan records a shortfall with cash still in the bank. Reserve dips are reported per-year (`reserveUsed`).

---

## 12. Couple (MFJ household) modeling

- Each spouse has independent ages, retirement dates, employer-plan/IRA/Roth/HSA balances, contributions (capped per person), Social Security benefit and claim age, pension, RMD schedule, and Roth conversion targets.
- Shared: cash, taxable brokerage (and basis), lifestyle spending, returns, inflation, cash strategy, ACA/IRMAA settings.
- Taxes are computed once on household totals with MFJ parameters; the NY $20K exclusion and Rule-of-55/§72(t) tests apply per spouse; HSA family limit + per-spouse catch-ups per §1.6.
- ⚠️ Both spouses are assumed alive through the horizon: no survivor benefits, no widow(er) filing status (single brackets + compressed IRMAA tiers after first death are a real risk this model does not show), and no couple-mode inherited-account transitions. Individual mode has a separate inherited BCO model.

---

## 13. Monte Carlo risk analysis

- 500 simulations; each feeds randomized **retirement-year** returns into the *same full engine* (taxes, RMDs, IRMAA, penalties, cash strategy all recompute per path). Accumulation years use the deterministic pre-retirement return.
- Returns are i.i.d. draws from Normal(μ = post-retirement return, σ = `portfolioVolatility`, default 9%), each floored at −95%. ⚠️ No serial correlation, regime switching, or fat tails; prolonged bear markets are only approximately represented. ⚠️ Because draws are symmetric around the deterministic mean, the Monte Carlo **median** path sits slightly below the single deterministic projection (volatility drag ≈ σ²/2 ≈ 0.4%/yr at the default 9%).
- **Success criterion:** a path fails if ending assets ≤ 0, any year's total ≤ 0, or cumulative unmet cash flow exceeds the materiality threshold (§3.7). Sub-dollar rounding never fails a path.
- **Flexible spending** (optional): if the portfolio's year-end total fell more than 15% versus the prior year end, the next year's spending is cut 10% — a documented retiree behavior that materially improves survival.
- Outputs: success rate, percentile fans (10/25/50/75/90), median/worst/best ending balances, average depletion age.

---

## 14. Decision-support computations

1. **Horizon-aware safe-withdrawal guideline:** 4.0% for retirements ≤ 30 years, 3.5% for 31–40, 3.25% beyond 40. Rationale: the 4% rule (Bengen 1994; Trinity study 1998) is calibrated to 30-year retirements; longer horizons empirically require lower initial rates. Used consistently by the headline metric, the warning banner, and the Monte Carlo diagnosis.
2. **Maximum sustainable spending:** bisection (to the nearest $500) on base lifestyle spending over the full engine, holding all other inputs constant, finding the largest value that avoids material depletion. Surfaced as "spending headroom" (healthy plans) or "required cut" (failing plans).
3. **Shortfall detection:** first year where spending + taxes exceed available withdrawals or assets hit zero, with materiality per §3.7.

---

## 15. Consolidated list of simplifications and exclusions ⚠️

Anyone reconstructing or auditing this engine should know these are *deliberate*:

1. Filing status is limited to single and MFJ (no head-of-household, no married-filing-separately, no status changes mid-plan).
2. §72(t) exceptions beyond Rule of 55 and the optional SEPP program (disability, medical, QDRO, etc.) are not modeled; SEPP busting is not modeled.
3. Roth ordering layers are tracked, but income tax on early *earnings* withdrawals is not modeled, and pre-existing conversion basis from before the plan start must be folded into `rothBasis` by the user.
4. SS earnings test, spousal/survivor/divorced benefits not modeled; FRA fixed at 67.
5. IRMAA lookback uses modeled MAGI only — the first Medicare years fall back to same-year MAGI because working-year income is out of scope; ACA MAGI omits non-taxable SS.
6. Cash interest **is** taxed (ordinary income on the start-of-year balance); all brokerage gains long-term; no loss harvesting; no step-up simulation; NIIT investment income is approximated as realized LTCG only (cash interest excluded from the NIIT base).
7. No AMT, itemized deductions, credits, trust/estate tax, or gift planning.
8. Federal/NY brackets projected by user inflation, not statutory indexing (chained CPI / NY non-indexation).
9. Survivor scenarios and couple-mode inherited-account transitions, long-term care, and annuitization are not modeled. Individual-mode inherited BCO accounts are modeled only from the explicit plan type, payout rule, and contract terms entered by the user.
10. Contribution limits beyond 2026 projected by inflation with statutory rounding increments.
11. IRA contributions during accumulation not modeled (401k + HSA only).
12. SECURE 2.0 Roth catch-up mandate for high earners not modeled.
13. Single tax-deferred bucket per person (RMD aggregation nuance in §6.3).
14. HSA offsets the healthcare portion of spending at any age, including pre-65 ACA premiums — which are generally **not** §223(d)-qualified before 65 (COBRA/unemployment/LTC excepted). This slightly overstates HSA usefulness for early retirees.
15. Debt paid at time zero from taxable assets realizes a capital gain that is taxed in the **first distribution year** (folded into that year's solve). For a user still working in year 1 this defers the tax to the first retirement year — a minor timing approximation; salary-year taxes are otherwise out of scope.
16. Monte Carlo return draws are floored at −95% so an unbounded Normal sample below −100% cannot drive an account negative at very high volatility.

---

## 16. Authoritative sources

**Federal tax parameters (2026):**
- IRS, *Tax inflation adjustments for tax year 2026* (incl. OBBBA amendments): standard deduction, brackets, LTCG breakpoints — https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
- IRS, *401(k) limit increases to $24,500 for 2026* (all retirement plan limits) — https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
- IRS Rev. Proc. 2025-19 (2026 HSA limits) — https://www.irs.gov/irb/2025-21_IRB
- IRC §1(h) (capital gains), §1411 (NIIT), §415(c) (annual additions), §414(v) (catch-ups).

**Retirement distributions:**
- IRC §72(t) (early-distribution tax and exceptions, incl. §72(t)(2)(A)(v) Rule of 55 and §72(t)(2)(A)(iv) SEPP).
- IRS Notice 2022-6 (SEPP calculation methods, interest-rate cap at 120% of the federal mid-term rate, permitted life-expectancy tables).
- IRC §401(a)(9) and Treas. Reg. §1.401(a)(9)-9 (RMDs; 2022+ Uniform Lifetime Table, T.D. 9930) — https://www.irs.gov/irb/2022-05_IRB
- SECURE 2.0 Act of 2022 (Div. T, Pub. L. 117-328): §107 (RMD ages 73/75), §109 (60–63 catch-up), §603 (Roth catch-up mandate).
- IRC §408A (Roth IRA), §223 (HSA).

**Social Security:**
- SSA, retirement benefit reduction/delayed-credit formulas — https://www.ssa.gov/oact/quickcalc/early_late.html
- IRC §86 (taxation of benefits; $32K/$44K MFJ thresholds).

**Medicare / IRMAA:**
- CMS, *2026 Medicare Parts A & B premiums and deductibles / Part D IRMAA* fact sheet — https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles

**ACA:**
- IRC §36B; Rev. Proc. 2025-25 (2026 applicable percentage table; expiration of ARPA/IRA enhanced credits).
- HHS/ASPE poverty guidelines — https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines

**New York State:**
- NY Tax Law §601 (rates), §612(c)(3) (public pension & SS exemption), §612(c)(3-a) ($20,000 pension/annuity exclusion at 59½).
- NYS FY2026 Budget, Ch. 59, Laws of 2025, Part A (middle-class rate cuts phased 2026–2027) — https://www.tax.ny.gov/data/stats/ter/fiscal-year27/personal-income-tax.htm
- NYS Dept. of Taxation & Finance, 2026 withholding tables NYS-50-T-NYS (1/26).

**Withdrawal-rate research:**
- Bengen, W. (1994), *Determining Withdrawal Rates Using Historical Data*, Journal of Financial Planning.
- Cooley, Hubbard & Walz (1998), *Retirement Savings: Choosing a Withdrawal Rate That Is Sustainable* (the "Trinity study").

---

## 17. Verification

The engine ships with a **107-case self-test suite** (run via the in-app "Run Diagnostics" button or by extracting the engine into Node). It pins: exact bracket math for 2024/2026/2027 (incl. NY rate cuts), LTCG stacking and the standard-deduction spillover, §86 SS taxation at all three tiers, SSA claim-age clamps, the full RMD divisor table and prior-year-end timing, §72(t) penalties with and without Rule of 55, IRMAA boundary behavior at exactly $750K, ACA subsidy tiers (including the exactly-400%-FPL boundary and the inflated out-of-pocket floor), the 2025 FPL base, cost-basis gain realization, the gross-up solver's convergence, cash-strategy ordering for all four modes (including the acceptance case: $300K cash with a $100K floor uses at most $200K), the inflation-adjusted reserve floor, couple-mode growth timing and per-spouse RMDs, HSA family-cap allocation, the max-spend solver round-trip, the horizon-aware guideline tiers, single-filer brackets/SS thresholds/IRMAA tiers/NY tables, the single-vs-MFJ lifetime-tax gap, Roth ordering-layer penalties (basis, seasoned and unseasoned conversions, earnings), the SEPP amortized stream, the IRMAA two-year lookback, conversions halting the year Social Security starts, the claim-age-above-70 clamp, the materiality-gated depletion flag, and the debt-payoff gain being taxed.

`CALCULATION_MODEL.md` in this repository maps each of these rules to its implementation in `src/App.jsx`; the two documents plus the test suite are intended to be sufficient to reconstruct the engine and validate the reconstruction.
