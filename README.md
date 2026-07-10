# Retirement Planner

A Vite + React retirement projection tool focused on tax-aware drawdowns, Roth conversion planning, RMDs, healthcare costs, and sequence-of-returns risk.

The active app is `src/App.jsx`. The older `src/retirement_planner.jsx` file is not mounted by `src/main.jsx`.

## Documentation

- **[RULES_AND_METHODOLOGY.md](RULES_AND_METHODOLOGY.md)** — the standalone
  specification: every financial rule, law, and formula the engine uses
  (account access rules, taxes, Social Security, RMDs, penalties, ACA/IRMAA,
  NY tax), each with its authoritative source and every simplification
  flagged. Sufficient to reconstruct the calculation engine without the UI.
- **[CALCULATION_MODEL.md](CALCULATION_MODEL.md)** — the implementation map:
  how those rules are wired into `src/App.jsx`.

## Run Locally

```bash
npm install
npm run dev
```

The Vite base path is `/retirementCalculator/`, so the local URL is usually:

```text
http://127.0.0.1:5173/retirementCalculator/
```

## Ask AI Chat

The app includes an Ask AI tab that can answer questions about the active inputs, summary metrics, and year-by-year projection. It can also propose input changes, which are displayed for review before you apply them.

For local development:

1. Copy `.env.example` to `.env.local`.
2. Set `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL`; the default is `gpt-5.4-mini`.
4. Run `npm run dev`.

The local Vite dev server handles `POST /api/chat` and keeps `OPENAI_API_KEY` server-side.

For GitHub Pages or any other static host, do not put an API key in the browser bundle. Deploy a small backend that exposes a compatible chat endpoint and set:

```text
VITE_CHAT_API_URL=https://your-backend.example.com/api/chat
```

Provider-specific server code lives in `server/llmProviders/` so Anthropic/Claude or another provider can be added later without rewriting the chat UI.

## Verify Changes

```bash
npm run lint
npm run build
```

`npm run build` may print Vite/plugin deprecation and chunk-size warnings. Those are build-tool warnings, not calculation failures.

There is no external test runner; calculation self-tests run in-browser via the **Run Diagnostics** button (`runSelfTests()` in `src/App.jsx`). For an independent review of the financial model, see `MODEL_VALIDATION.md`.

## Calculation Model

The projection engine models:

- Individual and married-couple plan modes. Individual mode preserves the
  original flat input model; married-couple mode adds separate spouse ages,
  retirement dates, retirement accounts, contribution strategies, pensions,
  healthcare costs, Roth conversion targets, RMD timing, and Social Security
  claim ages while keeping cash, taxable brokerage, debt, lifestyle spending,
  taxes, and risk assumptions at the household level.
- Federal ordinary-income and long-term-capital-gain tax brackets with official 2026 MFJ values, then projected after the last known table year.
- NY state income tax, including Social Security exclusion and a simplified retirement-income exclusion.
- Taxable Social Security using provisional-income rules.
- Roth conversions and tax gross-up through an iterative solver.
- RMDs using the 2022+ Uniform Lifetime Table and an RMD start age derived from current age/start year unless overridden.
- 401(k) employee, catch-up, annual-addition, and HSA contribution caps.
- Medicare IRMAA using 2026 Part B and Part D surcharge tiers.
- ACA premium subsidy estimates with the 2026 return of the 400% FPL cliff under current law.
- HSA withdrawals against healthcare spending.
- Explicit unmet cash-flow tracking so a plan can fail even if restricted assets remain.
- Monte Carlo runs using the same deterministic tax/RMD/conversion engine with randomized returns.

## Married-Couple Mode

Use the Plan Type control in the sidebar to switch between Individual and
Married Couple. Couple mode assumes both spouses remain alive through the plan
horizon and uses Married Filing Jointly tax treatment. It does not model
survivor benefits, widow/widower filing-status changes, first-death expense
changes, inherited-account rules, or estate outcomes.

In couple mode, cash, taxable brokerage, taxable cost basis, debt, lifestyle
spending, returns, inflation, ACA settings, IRMAA/MAGI thresholds, and Monte
Carlo risk assumptions are shared household values. 401(k)/403(b), Traditional
IRA, Roth IRA, HSA, contributions, part-time income, pensions, Social Security,
RMDs, Roth conversions, and healthcare costs are spouse-specific.

Couple reports show household totals first. The year-by-year table adds an
owner-detail breakdown for spouse-specific pension, Social Security, RMDs,
retirement-account withdrawals, HSA use, and Roth transfers. Employer-plan
labels are configurable in each spouse section, defaulting to 401k for the
primary person and 403b for the spouse.

Married-couple cash-flow reports also include a spendable-cash ledger. Pension,
Social Security, part-time income, and account withdrawals are cash sources
available for spending. Roth conversions are displayed separately as
account-to-account transfers, not spending cash.

More detail is in `CALCULATION_MODEL.md`.

## Default Values And Privacy

This repository is **public**, and the production site is built directly from
source on every push (see [Deployment](#deployment)). That means the built-in
defaults are not private:

- `DEFAULT_INPUTS` (and the `src/config/*.json` examples) ship in the public
  bundle, are what every first-time visitor sees, and are exactly what the
  **Reset to defaults** button loads.
- **Keep these values generic and illustrative — never commit real personal
  balances, incomes, or account details.** The current defaults are round
  placeholder figures meant only to make the charts render something on first
  load.

Your own real numbers stay private a different way: the app saves them only in
**your browser's** storage via the Save button, and those saved values are
merged over `DEFAULT_INPUTS` when the app loads. Nothing you enter is uploaded
or committed; localStorage is per-browser and not visible to other visitors.

The files in `src/config/` are reference/example data only at the moment. They
are not loaded by the active React app unless a config loader is reintroduced,
but they are still public — keep them generic too.

## Deployment

`.github/workflows/deploy.yml` deploys to GitHub Pages on every push to `main`.
The workflow runs `npm run build` and publishes the freshly built `dist/`
output — it does **not** serve the committed `docs/` folder. Because the bundle
is rebuilt from source, whatever lives in `DEFAULT_INPUTS` at build time becomes
the public default for all visitors. Do not hand-edit the minified bundle;
change `src/` and let the build regenerate it.

## Not Financial Advice

This tool is for planning and sensitivity analysis. It simplifies tax law, investment returns, healthcare costs, household details, and account rules. Verify material decisions with a CPA, CFP, or other qualified fiduciary.
