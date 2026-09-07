# Calculation model

Updated 2026-09-06. Production calculations live in `src/finance/engine.js`, with eligibility/account helpers in `policy.js` and tax closure in `numerics.js`. `src/App.jsx` imports these functions; tests execute these same production functions.

## Year sequence

1. Use January 1 balances and the configured projection start year (current year by default). Determine ages, retirement phase, owner status and applicable filing status.
2. Allocate an explicitly configured SEPP account and determine its scheduled distribution. Apply the selected spousal own-account transfer at the year boundary after death.
3. Fund working-year contributions from covered salary, with applicable contribution limits, payroll taxes, HSA eligibility and Roth catch-up character. Employer contributions have an employer source and compensation/annual-additions limits.
4. Determine gross wages, paid Social Security after the earnings test, pension and survivor payments. Keep employee payroll tax separate from taxable wages and report spendable employment income.
5. Determine lifestyle and healthcare expenses, flexible-spending adjustment and HSA-qualified reimbursements.
6. Reserve conversions and each owner's separate IRA/employer-plan RMD. Solve discretionary withdrawals, tax, actual cash interest and taxable brokerage income together. Mandatory distributions precede discretionary draws.
7. Reconcile ACA and IRMAA with the resulting income. An inconsistent subsidy returns an unsubsidized estimate and an explicit invalid status; numerical tax/tier failures are reported.
8. Commit withdrawals, basis changes and Roth conversion layers once. Save excess cash flow to cash in retirement, or passive-income surplus to taxable assets in accumulation.
9. Apply total investment return to remaining balances. Credit year-end contributions. Reinvested ordinary brokerage income increases cost basis; it is already part of total return and is not added to market value twice.
10. Record complete MAGI history for subsequent IRMAA years and report cash-flow shortfalls separately from model validity.

Accumulation still excludes ordinary working-household living costs and salary's baseline income tax from portfolio accounting. Salary supports contributions and sets the marginal tax stack; only incremental tax on projected portfolio/benefit income is charged to assets. Retirement-mode salary and W-2 part-time income participate in household spending and full income/payroll tax accounting.

## Accounts and outputs

Cash, taxable brokerage, traditional employer plans, traditional IRAs, Roth IRAs, designated Roth employer plans, HSAs, isolated SEPP accounts and individual inherited accounts retain their tax character. Designated Roth values are grouped in the Roth chart but are tracked separately internally. An isolated SEPP balance appears with traditional IRA assets and has separate income/balance fields.

`summary.modelNotices` lists missing material facts or unsupported elections. `summary.calculationValid` prevents a sustainable-spending recommendation for an incomplete scenario. `row.calculationValid` identifies numerical failures. Monte Carlo does not certify a success rate if a simulated path has a numerical failure. All numerical probabilities remain conditional on model assumptions.

Scenario version 2 adds nullable eligibility facts and nested Roth/MAGI/monthly-wage histories. Existing scenarios retain their account values. Missing facts do not silently become eligibility. Complete text exports include a versioned scenario payload for faithful import of both individual and couple data.

## Verification and limits

Run `npm test`, `npm run lint`, and `npm run build`. The [coverage report](docs/FINANCIAL_ACCURACY_UPDATES.md) maps all twenty audit findings to implementation and numerical regressions, and lists remaining approximations and professional-validation requirements.

The old July description is preserved as [historical documentation](docs/archive/2026-07-CALCULATION_MODEL.md); it does not describe the current engine.
