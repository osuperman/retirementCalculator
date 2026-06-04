# Model Validation Handoff

A brief for an independent reviewer (human or LLM) tasked with validating the
financial model and application. It is written to be usable directly as a
reviewer's instructions.

## Context you need first

- The entire app and engine live in **`src/App.jsx`** (~7,900 lines).
  `src/retirement_planner.jsx` is dead code — ignore it.
- Read **`CALCULATION_MODEL.md`** (the stated model) and the
  **`README.md` "Default Values And Privacy"** section before judging anything.
- The engine is a set of **pure functions** with clear names. Map them before
  assessing. Key surface:
  - Tax: `getFederalTaxParams`, `projectedFromKnownTable`, `fedOrdinaryTaxMFJ`,
    `fedLtcgTaxMFJ`, `nyStateTaxMFJ`, `taxableSocialSecurity`, `totalTax`
  - Limits/dates: `getContributionLimits`, `rmdDivisor`,
    `rmdStartAgeForBirthYear`, `defaultRmdStartAge`
  - SS/health: `adjustedSocialSecurityBenefit`, `federalPovertyLevel`,
    `estimateAcaHealthcareCost`, `computeIrmaaSurcharge`
  - Drawdown: `doWithdrawalWaterfall`, `computeRealizedGain`,
    `solveGrossedUpWithdrawals`, couple variants
    (`doCoupleWithdrawalWaterfall`, `solveCoupleGrossedUpWithdrawals`)
  - Orchestration: `simulate`, `simulateCouple`, `simulatePlan`,
    `runMonteCarlo`, `simulateWithReturns`, `randomNormal`,
    `diagnoseSuccessRate`, `hasMaterialUnmetCashFlow`
  - Constants to scrutinize: `FEDERAL_TAX_TABLES_MFJ`, `LIMIT_TABLES`,
    `ACA_APPLICABLE_PERCENTAGES_2026`, `IRMAA_2026_MFJ`, `NY_TAX_BASE_YEAR`,
    `PROJECTION_START_YEAR`.

## Ground rules

- **Do not introduce real personal financial data anywhere.** The repo is
  public; defaults in `DEFAULT_INPUTS` and `src/config/*.json` must stay
  generic. Use synthetic scenarios.
- Treat this as **assessment, not redesign.** Propose fixes; don't rewrite the
  engine unbidden.
- Scope is planning/sensitivity analysis, not financial advice. Judge it against
  *its own stated model* and *current US/NY tax law*, not against being a tax
  filing engine.

## Step 1 — Exercise the existing self-tests

- Read **`runSelfTests()`** (around line 494) and its `test(...)`/`it(...)`
  cases. This is the only test layer and it runs **in-browser** via the
  "Run Diagnostics" button — there is no `npm test`.
- Run the app (`npm install && npm run dev`, URL path `/retirementCalculator/`),
  click **Run Diagnostics**, and record pass/fail.
- Critically assess **coverage**: which functions/branches have *no* assertions?
  Build a coverage matrix (function x covered yes/no).

## Step 2 — Verify hardcoded constants against authoritative sources

For each table, confirm the literal values and the projection logic:

- Federal ordinary + LTCG brackets/standard deduction
  (`FEDERAL_TAX_TABLES_MFJ`, base year 2026) vs the IRS revenue procedure.
- NY brackets and the SS / retirement-income exclusions (`nyStateTaxMFJ`,
  `NY_TAX_BASE_YEAR = 2024`).
- Contribution/catch-up/annual-addition + HSA limits (`LIMIT_TABLES`,
  `getContributionLimits`) vs IRS.
- IRMAA tiers (`IRMAA_2026_MFJ`) vs CMS; ACA applicable percentages + FPL
  (`ACA_APPLICABLE_PERCENTAGES_2026`, `federalPovertyLevel`) vs HHS.
- RMD divisors (`rmdDivisor`) vs the 2022+ Uniform Lifetime Table; RMD start age
  vs SECURE 2.0 (73 -> 75).
- Scrutinize **`projectedFromKnownTable`**: how are brackets inflated past the
  last known year? Check for double-counting inflation or drift.

## Step 3 — Independent recomputation

Pick 3-4 deterministic scenarios (e.g., single age 45 -> 65; couple with one
pension; an RMD-age retiree). Compute by hand or in a separate scratch model the
federal tax, LTCG stacking, taxable SS, NY tax, and first-year RMD; compare to
the engine's year-by-year output. Document any divergence with the exact inputs.

## Step 4 — Probe the logic-heavy areas (most likely bug sites)

- **Tax stacking order** in `totalTax`/`fedLtcgTaxMFJ`: LTCG must stack on top of
  ordinary income; verify bracket thresholds use the right base.
- **Provisional income** in `taxableSocialSecurity`: thresholds are *not*
  inflation-indexed in law — confirm the code matches (or flag if it indexes).
- **Grossed-up withdrawal solver** (`solveGrossedUpWithdrawals`, couple variant):
  check convergence, iteration cap, and behavior when it does not converge —
  any chance of infinite loop, oscillation, or silent under-withdrawal? Verify
  the gross-up accounts for LTCG/IRMAA feedback.
- **Withdrawal waterfall** + **basis tracking** (`doWithdrawalWaterfall`,
  `computeRealizedGain`, `taxableBasisPct`): confirm cost basis depletes
  correctly and realized gains aren't double-taxed or lost.
- **Roth conversion targeting** (`personConversionTarget`) and its interaction
  with RMDs (you can't convert RMDs).
- **IRMAA / ACA MAGI feedback**: is the 2-year IRMAA MAGI lookback modeled or
  simplified? Is the ACA 400% FPL cliff applied at the right MAGI? Flag
  simplifications.
- **Single vs couple parity**: diff `simulate` vs `simulateCouple` — do shared
  vs per-spouse fields (HSA family limit via `getCoupleHsaLimit`, SS, RMDs,
  conversions) behave consistently? Note the model uses **MFJ tax treatment even
  in single mode** — confirm that's intended and documented.
- **Unmet cash flow** (`hasMaterialUnmetCashFlow`, `diagnoseSuccessRate`):
  confirm a plan can correctly "fail" even when restricted (pre-59.5 /
  Roth-basis-locked) assets remain.

## Step 5 — Monte Carlo & numerical soundness

- `randomNormal` — verify it's a correct normal draw (e.g., Box-Muller) and that
  `simulateWithReturns` applies sequence-of-returns properly.
- **Reproducibility gaps to flag**: MC uses **unseeded** randomness, and
  `PROJECTION_START_YEAR` is derived from `new Date()` — so results drift
  year-to-year and aren't reproducible. Recommend a seedable RNG and an
  injectable "current year."
- Check the **flexible-spending rule** (10% cut after a >15% portfolio drop):
  confirm threshold/magnitude match the docs and can't compound pathologically.
- **Real vs nominal consistency**: confirm inflation is applied once and
  consistently across spending, brackets, SS COLA, pension COLA, and
  ending-balance display.

## Step 6 — Edge cases & input validation

Test: retirement age < current age; plan-through < retirement; zero/negative
balances; claim age outside 62-70; very high inflation; `householdSize` mismatch
with mode (default is 2); pension with NY exemption on/off. Confirm graceful
handling, not `NaN`/`Infinity` leaking into the UI.

## Deliverables

1. **Findings report**, each item with: severity (Critical/High/Medium/Low),
   the function + line, a minimal reproducing input set, expected vs actual, and
   a suggested fix.
2. **Constants audit table** (value in code vs authoritative source vs verdict).
3. **Test-coverage gap list**, plus a concrete recommendation to extract the
   engine into a testable module and add a real runner (e.g., **Vitest**) with a
   `test` script, porting `runSelfTests()` into it.
4. A short **"model simplifications" section** documenting accepted limitations
   (survivor benefits, state moves, NIIT, AMT, etc.) so they're explicit rather
   than silent.

## Highest-value targets first

Based on a structural read, the two places where a subtle error would quietly
distort every projection:

1. The `solveGrossedUpWithdrawals` convergence / tax-feedback loop.
2. The constants and inflation projection in `projectedFromKnownTable`.

Start there.
