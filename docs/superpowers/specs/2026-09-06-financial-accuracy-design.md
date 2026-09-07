# Financial accuracy remediation design

Status: approved by the user; implementation and validation recorded in `docs/FINANCIAL_ACCURACY_UPDATES.md`. That report explicitly identifies supported models and remaining professional-validation limits.

## Objective and scope

Implement all 20 findings in the September 6 audit of revision `59f9d0e075608e8baa1b01d97c2e48f22ff6dbbd`. Correct the individual and couple engines, add the missing user inputs, preserve saved scenarios through explicit migration, and verify final outputs with independent financial tests. A disclaimer alone does not resolve a finding.

The design separates exact current statutory rules from future projections and unknown household facts. Missing eligibility facts must never silently qualify a household for a subsidy, tax exemption, contribution, or penalty exception. Normal approximate projections remain available, but unresolved material inputs and numerical failures must prevent a definitive funded-plan or success-rate claim.

## Approach

Recommended: staged changes to the existing app, introducing shared financial helpers and a direct automated test entry point as needed. Preserve the current React UI, individual/couple input organization, saved scenarios, cash strategies, and synthetic defaults. Avoid an unrelated UI redesign or wholesale engine rewrite.

Alternative: replace both engines with a new unified engine. This could reduce duplication, but would multiply migration and regression risk before the audited problems are corrected. It is not recommended for this remediation.

Alternative: fix only the stateless arithmetic bugs now. This is smaller, but leaves materially incorrect healthcare, account access, and survivor results and does not satisfy the requested scope.

Implementation stages remain one authorized project. Completion requires every finding below; completing one stage must not be reported as completing the request.

## Architecture and financial contract

- Keep one shared implementation for tax-character calculations, payroll taxes, Roth layers, account-specific RMD obligations, HSA eligibility, and convergence checks. Both annual projection engines call these helpers.
- Retain `simulatePlan` as the projection entry point. Preserve existing row fields used by charts, ledger, exports, and chat; add explicit breakdowns rather than changing a field's meaning invisibly.
- Introduce headless regression tests using Node's built-in test runner against actual engine functions. The test harness must not maintain a separate production-engine copy or depend on fragile source-line slicing.
- Add structured input/model notices and numerical status to projection results. Distinguish incomplete input, unsupported legal configuration, actual cash shortfall, and solver failure. Use that classification consistently in the plan banner, sustainable-spending solver, Monte Carlo, exports, and chat context.
- Record a projection start year in normalized scenarios so a saved plan's ages and dates do not silently move when reopened in a new calendar year. Offer an explicit rebase when appropriate.
- Persist and export every new financially relevant input. Version migrations must distinguish missing information from an affirmative zero or false value.

### Annual sequencing

1. Resolve calendar dates, attained ages, employment, survival, coverage, and legal eligibility for the year.
2. Calculate salary/part-time gross income, lawful contributions, employee payroll taxes, benefit entitlements, and benefits actually payable.
3. Compute required distributions from the proper opening account balances before market growth. Track employer-plan and IRA requirements separately.
4. Establish requested Roth conversions and the current-year contribution/conversion ordering layers available to tax calculations.
5. Solve withdrawals, cash interest, taxes, healthcare costs, eligible HSA reimbursements, and any taxable HSA distribution together. Mandatory distributions fund need before discretionary withdrawals; remaining mandatory income becomes an explicit surplus.
6. Validate cash closure and legal constraints before executing transactions. Commit Roth basis consumption and conversions exactly once.
7. Apply investment growth once. Use the same cash-interest amount in the account ledger, income tax, provisional income, ACA MAGI, and IRMAA MAGI.
8. Store the final income-character breakdown, MAGI histories, account balances, and status for all consumers.

The annual approximation remains documented. Month-dependent eligibility is supported by month/date inputs where it directly affects earnings-test, Medicare/HSA, Roth qualification, or SEPP calculations; unknown dates must be visible rather than guessed as exact legal eligibility.

## Stage 1: statutory arithmetic, cash flow, and numerical reliability

### Finding 1 — Roth conversion and withdrawal in the same year

Include current-year conversion principal in provisional Roth ordering before calculating withdrawal tax. Preserve separate taxable and nontaxable conversion components and FIFO years. Do not double count conversion income or mutate layers during solver evaluations. Commit the final consumed layers once.

Acceptance: the audited age-50 example with a $100,000 conversion, $100,000 existing Roth earnings, and $20,000 spending needs approximately $42,255 in distributions and $22,255 in tax, not $63,493 and $43,493. Test both owners in couple mode and distributions on both sides of layer boundaries.

### Finding 2 — contribution compensation and funding

Use the same funding constraints in joint accumulation, individual accumulation, and staggered retirement. Require entered compensation for employee deferrals; employer contributions retain their distinct source and statutory constraints. HSA contributions may use an explicitly identified permissible source; no unexplained asset additions are allowed.

For legacy plans with contributions but unknown salary, require salary/funding completion before presenting a fully validated contribution projection. Do not infer a salary from the requested contribution. Actual zero compensation permits no employee deferral.

Acceptance: $10,000 compensation never creates a $30,000 elective deferral; zero compensation never creates elective contributions. Check catch-ups, employer additions, payroll taxes, and low-pay conservation independently.

### Finding 3 — payroll taxes on part-time employment

Separate taxable gross wages from spendable wages for every owner and every employment path. Aggregate covered W-2 wages per person for Social Security/Medicare and at the filing-unit level for Additional Medicare liability. Employee 401(k) deductions do not reduce covered wages. Payroll HSA deductions reduce them only with an explicitly supported payroll treatment.

Part-time income is labeled as gross covered W-2 wages. Self-employment must not silently be treated as W-2 income; identifying it as such must surface a separate unsupported-input notice until its tax treatment is implemented.

Acceptance: $60,000 covered wages incur $4,590 basic employee FICA. Test combined jobs, wage-base boundaries, filing-status thresholds, and income conservation.

### Finding 4 — account-specific RMD obligations

Calculate and satisfy employer-plan and IRA obligations separately for each owner. Preserve the still-working current-employer restriction. Include explicit employer-plan eligibility and ownership facts where an exception depends on them; do not generalize a current-employer exception to all retirement accounts.

Acceptance: age 75 with $500,000 in each account category distributes approximately $20,325 from each. Excess IRA distributions cannot satisfy an employer-plan requirement. Reserve required amounts before discretionary conversions or draws.

### Finding 5 — senior deduction

Apply the enhanced deduction phaseout per eligible person, then sum. Keep qualification years and expiration distinct from the permanent additional standard deduction.

Acceptance: two qualifying MFJ seniors at $250,000 MAGI receive no enhanced senior deduction. Test one/two seniors, phaseout endpoints, and expiration.

### Finding 6 — cash-interest conservation

Retain the existing withdrawal-before-growth convention. Calculate interest from the final principal eligible to earn it under that convention; include the resulting interest in the coupled tax/cash solve. Never tax opening-balance interest while crediting a different amount after withdrawals or deposits.

Acceptance: $1 million cash, $900,000 spending, 5% return, and the audited tax assumptions ends with $105,000. Also test income surpluses and cash exhausting before other buckets are reached.

### Findings 7–8 — convergence and cash closure

Replace fixed iteration counts as implicit success criteria with bracketed cash-flow solving and explicit residual validation. Split discontinuous ACA eligibility ranges and discrete IRMAA tiers; detect oscillation and infeasible regions. Do not silently change the selected withdrawal policy or invent elective conversions to make an ACA solution exist.

Where no self-consistent solution exists under the selected policy, return a material model notice and an unsubsidized fallback clearly identified as an estimate. A fallback must not become a statutory subsidy claim or a certified sustainable-spending result.

Use dollar cash closure, balance bounds, and valid legal state as completion criteria. Tax rounding is applied at the reporting boundary; harmless cents do not create a failure. Large numerical residuals do not masquerade as portfolio depletion.

Acceptance: the audited $5 million IRA/$200,000 spending case closes near $337,666 gross withdrawal with no artificial shortfall. The $30,000 healthcare oscillation case must either converge consistently or disclose the unresolved regime. Test threshold discontinuities, depletion, restricted cash, and tax gross-up across account switches.

### Findings 9–10 — Monte Carlo assumptions and calendar alignment

Honor explicit zero volatility and use defaults only when values are absent. Generate one return for every actual distribution-phase year, starting at the earlier spouse's calendar retirement date. Missing supplied returns are a detectable error, not a silent deterministic tail.

Acceptance: zero volatility exactly matches deterministic outputs; the audited differing-age couple receives 51 modeled distribution-year returns rather than 41. Test reversed spouse order and already-retired households. Seed test randomness without altering production random behavior.

### Finding 11 — inherited nonqualified-annuity income character

Carry taxable nonqualified-annuity earnings into net investment income. Determine NY retirement exclusion eligibility from account provenance, not only age. Collect whether the contract was privately purchased or derived from qualifying employment; unknown provenance cannot automatically claim an exclusion.

Acceptance: the audited $200,000 public pension plus $100,000 privately purchased nonqualified-annuity earnings case produces approximately $76,794 total tax. Test basis recovery, zero earnings, NIIT thresholds, and qualified-account contrasts. Revalidate allowed beneficiary payout rules for each supported plan type instead of assuming IRA rules apply to nonqualified contracts.

## Stage 2: eligibility, benefits, and healthcare inputs

### Findings 12 and 20 — HSA contributions and distributions

Separate healthcare premiums, HSA-qualified expenses, and other out-of-pocket costs. Collect HDHP/other-coverage eligibility, Medicare enrollment month, payroll contribution treatment, and qualified premium exceptions. Apply self/family and owner-specific catch-up limits with eligibility/proration.

Use tax-free reimbursements only for qualified expenses. Preserve per-owner restrictions in mixed-age couples. Permit taxable nonmedical distributions after age 65 and include them in ordinary income, MAGI, and withdrawal gross-up. Do not apply the 20% additional tax after age 65.

Legacy aggregate healthcare costs remain total costs, but do not automatically become tax-free HSA expenses; prompt users to classify them. No double payment or double reimbursement is allowed.

Acceptance: ordinary marketplace premiums do not automatically consume HSA funds tax-free; Medicare enrollment ends contributions; the age-70 HSA-only household can fund $10,000 lifestyle spending through a grossed-up taxable distribution. Test COBRA, Medigap, mixed-age spouses, contribution coverage months, and family catch-ups.

### Finding 13 — SEPP execution

Require an explicit SEPP account allocation, start date, method, interest rate, and historical status when already in progress. Exclude the scheduled account from ordinary discretionary withdrawals and conversions during the restriction period. Preserve the permitted fixed-amortization stream and legal end date.

If the user models a modification, calculate current-year additional tax and historical recapture/interest from entered history, or mark the result incomplete when history is missing. Do not retain a partial SEPP exemption on an impermissibly modified stream.

Acceptance: the audited $60,312 scheduled payment cannot retain its exemption when the same account distributes approximately $136,417. Test withdrawal excesses, conversions, start dates, five-year endpoints, and statutory depletion exceptions.

### Finding 14 — Social Security earnings test

Track entitlement before withholding, actual benefits paid, and future adjustments separately. Use gross covered earnings rather than income-tax wages. Support claim/start month and the FRA-year distinction; account for the first-year monthly rule where applicable. Later benefit adjustment must reflect withholding rather than permanently discarding the held-back benefits.

Acceptance: the age-62/$100,000 wages/$40,000 FRA benefit example pays no benefits in the audited full-year working scenario. Test one dollar below/at/above thresholds, FRA transition, stopping work during a year, and spouses independently.

### Finding 15 — mandatory Roth catch-ups

Collect prior-year wages from the relevant employer and plan Roth catch-up availability. Split elective contributions into pre-tax and designated Roth portions, preserving the correct current wage deduction and future account tax character. Do not mix designated Roth-plan assets with Roth IRA basis without a modeled rollover.

Acceptance: the audited age-55/$200,000-wage/$32,500 contribution example has $175,500 taxable wages, not $167,500, when the mandate applies. Test the prior-year wage threshold and super catch-up ages.

### Finding 16 — existing Roth history

Collect the first Roth IRA contribution tax year and starting conversion vintages with taxable/nontaxable amounts. Preserve regular contributions separately. Compute earnings qualification using both the age/event requirement and the Roth qualification clock; compute conversion recapture using each vintage's separate clock.

Unknown opening dates or conversion histories remain visible as incomplete eligibility inputs. Do not migrate conversion principal into regular contribution basis.

Acceptance: the audited age-60, two-year-old Roth with $20,000 withdrawn earnings includes those earnings in taxable income. Test four/five tax years, same-year contributions, earlier vintages, and separate owners.

### Finding 17 — ACA eligibility, premiums, and investment income

Collect enrollment premiums, applicable benchmark premiums, covered members/months, and access to disqualifying employer/public coverage. Keep non-premium spending separate. Do not estimate benchmark premiums by subtracting a fabricated out-of-pocket floor.

Provide explicit taxable-brokerage dividend/interest income assumptions when ACA/IRMAA calculations depend on them; track taxable income and reinvested basis consistently. Keep legacy annual tax drag only as an identified approximation and do not double tax explicitly modeled yields.

Acceptance: the $60,000 MAGI/$30,000 healthcare example receives no PTC when affordable minimum-value employer coverage disqualifies it. Test distinct benchmark versus actual premiums, mixed Medicare/marketplace households, investment income, and FPL boundaries.

### Finding 19 — IRMAA history

Accept actual MAGI for the two years preceding projection start. Apply projected history afterward. Allow a separately identified approved adjustment; do not automatically assume retirement obtains a lower assessment. Missing lookback values produce a visibly estimated result, not a confirmed zero surcharge.

Acceptance: the audited single Medicare enrollee with $150,000 historical MAGI receives $2,884.80 annual surcharge in 2026 absent adjustment. Test missing history, falling/rising income, filing status, and two enrollees.

## Stage 3: survivor scenario and integrated validation

### Finding 18 — first-death scenario

Add an optional explicit death year/month for either spouse; the default base case continues to assume both live through the horizon and says so. This is scenario analysis, not a mortality prediction.

After the event, stop the deceased person's wages, contributions, benefit payments, and healthcare at the appropriate time. Calculate the survivor's Social Security entitlement without adding two full benefits. Collect the pension's survivor election and payable survivor amount, and a survivor lifestyle budget in today's dollars.

Determine tax filing status for the death year and subsequent years from eligibility. Do not automatically grant qualifying-surviving-spouse status for two years without dependent/household eligibility. Recalculate deductions, thresholds, ACA household membership, IRMAA, and payroll rules using the applicable status.

Track account ownership and the selected spousal inheritance treatment. Collect beneficiary/transfer choices needed to distinguish a spousal rollover from keeping a beneficiary account, retain Roth history, and handle HSA ownership. Do not simply add deceased retirement assets to unrestricted cash. Unknown inheritance or pension elections make that survivor scenario incomplete.

Acceptance: a $40,000/$20,000 Social Security household does not continue receiving $60,000 after the applicable first-death transition. Test either spouse dying first, a younger survivor, pension continuation/no continuation, death-year filing, later single filing, and estate/account conservation.

### User-facing integration

Place new fields within existing Employment, Accounts, Healthcare, Tax, and Couple sections. Reveal detailed inputs when the related account, coverage, or scenario is enabled. Show current assumptions near affected results. Maintain one coherent mobile/desktop input model.

Saved scenarios, text import/export, comparison, Monte Carlo, sustainable-spending results, and chat context must all use the same normalized inputs. Never leave an existing output path using an older financial formula after the projection is corrected.

## Verification and completion criteria

- Each audit reproduction becomes an automated regression against the actual production helpers/engines before its correction is accepted.
- Retain the 172 current diagnostics and the independently verified financial fixtures; update an old assertion only when the prior expected result is demonstrably wrong, with its authoritative basis recorded.
- Test zero, exact threshold, one dollar below/above, large values, differing ages, and year boundaries relevant to each change.
- Assert aggregate cash conservation, per-account distribution compliance, basis conservation, and no repeated conversion-layer consumption across solver evaluations.
- Reconcile federal ordinary tax, capital gains, NIIT, NY tax, employee FICA, penalties, ACA credits, and IRMAA as distinct components before totals.
- Verify the sustainable-spending answer by re-running that spending value; numerical or material input failures must not be classified as a funded answer. Verify zero-volatility Monte Carlo equivalence and all-year return coverage.
- Run automated regressions, all internal diagnostics, lint, and build. Exercise actual UI entry, saved-scenario migration, import/export, and result refresh for each new input group.
- Update `CALCULATION_MODEL.md`, `RULES_AND_METHODOLOGY.md`, and README to match final implemented behavior, current source dates, and remaining explicit approximations.
- Deliver a finding-by-finding completion matrix with evidence. Do not describe the planner as certified or guarantee future investment results.
- Implementation and local verification are in scope. Deployment or publishing is a separate action.

## Design self-review

All audit findings 1–20 are mapped to concrete behavior and acceptance examples above. The stages preserve exact money and tax-character tracking, avoid automatic eligibility assumptions, and retain the current app structure. The largest additions are eligibility inputs and first-death account transitions; they are implemented and tested as separate stages rather than hidden inside arithmetic fixes.
