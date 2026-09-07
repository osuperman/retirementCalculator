# Rules and methodology

Version: September 2026 financial-accuracy update. Scope: federal and New York retirement cash-flow planning, using published 2026 parameters and documented future projections.

The current implementation map is [CALCULATION_MODEL.md](CALCULATION_MODEL.md). The [financial accuracy coverage report](docs/FINANCIAL_ACCURACY_UPDATES.md) contains the twenty-finding implementation matrix, concrete expected results, government source links and remaining model limits. Read those limits before using a sustainable-income or plan-success estimate.

## Statutory calculations supported

- Federal ordinary-income and capital-gains brackets, standard deductions, Social Security provisional-income taxation, per-person senior deduction phaseout, and NIIT for modeled investment income.
- NY tax schedules and applicable retirement/beneficiary exclusions, with explicit inherited-income provenance. A surviving owner receives one applicable private-retirement exclusion after the first-death tax transition.
- Separate owner/category RMDs, the supported still-working exception and 5% owner exception, and early-distribution tax treatment for the supported account types.
- Roth IRA contribution/conversion/earnings ordering, annual aggregation, separate conversion recapture clocks and earnings-qualification clock. Designated Roth employer accounts retain their own basis/clock.
- Covered W-2 employee payroll taxes and mandatory Roth catch-up treatment based on prior employer wages, subject to the supported plan type and provided facts.
- HSA self/family contribution limits, owner catch-ups and eligibility proration under the entered coverage schedule. Qualified expense/premium reimbursements are distinct from ordinary taxable distributions after 65.
- Social Security annual earnings-test thresholds and first-year/FRA-year monthly wage inputs, including benefit adjustment for recorded withheld months.
- ACA premium-credit arithmetic using entered eligibility and actual/benchmark premiums; IRMAA using historical or projected MAGI and explicitly approved adjustments.

## Planning conventions and unsupported detail

The engine is not a full tax-return, monthly actuarial, marketplace eligibility, or pension administration system. Annual timing, future indexation, ordinary-dividend assumptions, the supported fixed-amortization SEPP method, externally calculated recapture amounts, spousal own-account inheritance, and provided SSA survivor estimates are material boundaries. Detailed limitations are enumerated in the coverage report. Missing history and inconsistent numerical solutions are estimates, not confirmed statutory results.

The July rules document is retained at [docs/archive/2026-07-RULES_AND_METHODOLOGY.md](docs/archive/2026-07-RULES_AND_METHODOLOGY.md) for historical comparison; its formulas and statements about unsupported features are superseded where the September coverage report describes a change.

Before a real retirement decision, have a qualified financial or tax professional validate account access, benefit estimates, healthcare eligibility, taxes and assumptions specific to the household. Passing software tests cannot guarantee sustainable future withdrawals.
