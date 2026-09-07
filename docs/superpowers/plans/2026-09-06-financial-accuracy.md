# Financial Accuracy Implementation Plan

> Execute inline, task by task, against the user-approved design. The optional superpowers execution helpers are not installed; use the available editing and test tools without another approval checkpoint.

**Goal:** Resolve audit findings 1–20 with production regressions and consistent UI, migration, and reports.

**Architecture:** Extract existing pure calculations into `src/finance/engine.js` without changing their behavior first. Introduce focused policy helpers alongside that engine, then connect new inputs and result notices to the existing application.

**Tech Stack:** React, JavaScript ES modules, Node built-in tests, Vite, ESLint.

## Global constraints

- Preserve existing saved scenarios with explicit migration.
- Do not infer eligibility from missing household facts.
- Use production functions in tests, not an independent implementation copy.
- No deployment is included.
- Every finding must have a completed regression and UI/persistence integration where applicable.

## Task 1 — Direct engine tests

Files: create `src/finance/engine.js`, `tests/finance.test.mjs`; modify `src/App.jsx`, `package.json`.

- [ ] Move pure top-level declarations from App into the engine and import only the names the UI uses.
- [ ] Export the existing projection, tax, normalization, diagnostics, and solver functions.
- [ ] Add `"test": "node --test tests/*.test.mjs"`.
- [ ] Preserve the baseline with `assert.equal(runSelfTests().failed, 0)` and lint/build.

## Task 2 — Arithmetic and account obligations (1–6, 8–11)

Files: `src/finance/engine.js`, `tests/finance.test.mjs`.

- [ ] Add failing regressions from the approved audit fixtures for current-year Roth ordering, compensation, part-time FICA, separate RMDs, senior phaseout, cash interest, convergence, Monte Carlo and annuity tax character.
- [ ] Apply `seniors * Math.max(0, 6000 - phaseOut)` and include nonqualified taxable earnings in NII.
- [ ] Create immutable provisional Roth layers, commit only after solving, and enforce separate employer/IRA RMD minimums.
- [ ] Share contribution funding and per-person wage tax calculation across both engines.
- [ ] Replace silent iteration truncation with numerical status and residual closure; align credited interest with taxed interest.
- [ ] Generate return arrays from actual calendar projection years; use `volatility ?? 0.09`.
- [ ] Run `npm test`, `npm run lint`, `npm run build`.

## Task 3 — Eligibility and benefits (7, 12–17, 19–20)

Files: engine and policy helpers under `src/finance/`, tests, existing input sections in `src/App.jsx`.

- [ ] Implement coverage/expense-specific HSA contributions, reimbursement, and taxable after-65 distributions.
- [ ] Implement prior-wage Roth catch-ups with separate designated Roth balances.
- [ ] Add initial Roth qualification year and taxable/nontaxable conversion histories.
- [ ] Add SEPP account isolation, exact schedule eligibility, and modification status/history.
- [ ] Add Social Security paid-versus-entitled benefits and earnings-test calendar rules.
- [ ] Add benchmark/actual ACA premiums and coverage eligibility; solve subsidy regimes with explicit nonconvergence handling.
- [ ] Add historical IRMAA MAGI and adjustment inputs.
- [ ] Test the numerical acceptance examples and eligibility boundaries in the approved spec.

## Task 4 — Survivor scenarios (18)

Files: finance helpers, engine, couple input components, tests.

- [ ] Add optional death timing, pension survivor election, survivor spending, filing eligibility, and account-transfer elections.
- [ ] Stop deceased-owner cash flows, apply actual survivor entitlements, and retain account character and basis.
- [ ] Test both owner orders, death-year tax status, mixed ages, and account conservation.

## Task 5 — Persistence, output integration, and final verification

Files: `src/App.jsx`, engine normalization, tests, README, `CALCULATION_MODEL.md`, `RULES_AND_METHODOLOGY.md`.

- [ ] Version scenario migration and persist/import/export all new financial inputs.
- [ ] Surface material missing facts and numerical failures consistently across plan, Monte Carlo, max spending, comparisons, and chat.
- [ ] Test input round trips and existing scenarios; exercise actual UI on desktop and mobile.
- [ ] Re-run regressions, diagnostics, lint/build and independently inspect the final diff.
- [ ] Produce a completion matrix for all 20 findings with test evidence and remaining legal/model limits.

## Execution record

Production fixes, new inputs and regression evidence are documented in [the coverage report](../../FINANCIAL_ACCURACY_UPDATES.md). The checklists above preserve the full approved design; supported behavior and remaining detailed statutory-model limits must be assessed from the report, not inferred from a blanket completion checkbox. No deployment was performed.
