# Dashboard UI Implementation Plan

**Goal:** Implement the approved dashboard visual and the same-scenario detailed workspaces without changing the financial engine.

**Architecture:** Keep the existing inputs and normalized simulation as the single source of truth. Add presentation components for navigation, settings indexing, baseline comparison, scenario naming, and selected-year inspection. Retain existing report blocks and mount them for printing even when another workspace is selected.

**Tech stack:** React 18, Recharts, existing Tailwind, plain CSS, Node test runner. Execute inline in the current task.

## Global constraints

- Preserve all existing settings, conditional inputs, reports, scenario storage, import/export, diagnostics, and AI actions.
- Do not alter financial-engine semantics or deploy.
- Preserve unknown eligibility facts and all calculation warnings.
- Reference: approved visual and `docs/superpowers/specs/2026-09-07-dashboard-ui-design.md`.
- Visual thesis: a restrained indigo/slate planning workspace with the portfolio chart as the dominant visual.
- Content: compact header and metrics; chart beside live controls; direct links to full details; secondary explanations below.
- Interaction: stable chart edits, subtle focus/hover transitions, accessible disclosures; reduced-motion support.

## 1. Baseline and UI primitives

- [x] Record current individual/couple projections and run regression tests before changes.
- [x] Create `src/ui/planComparison.js`: `captureBaseline(inputs)` returns a deep input copy; `baselineSeries(baseline,currentRows,real)` aligns the baseline by calendar year; `compareBaseline` reports spending, ending portfolio, and shortfall changes. Test nested input independence and year alignment in `tests/ui-comparison.test.mjs`.
- [x] Create `src/ui/PlannerWorkspace.jsx` for accessible navigation, modal naming, settings index, baseline bar, details links, and selected-year breakdown.
- [x] Associate existing numeric/text/select labels using `useId`; preserve empty drafts until valid input; add keyboard term help and Escape/focus restoration for import.

## 2. Layout and scenarios

- [x] Replace the header/navigation and oversized metrics with a compact shared shell. Map navigation to `plan`, `settings`, `years`, `compare`, `risk`; retain one input state across all views.
- [x] Move existing full input form to the indexed settings view. Keep the quick-control component alongside the portfolio chart; group financial-history fields within their existing scopes.
- [x] Capture baseline inputs on first load/scenario switch. Expose capture and restore actions and an actual baseline graph line, without writing baseline experiments to named scenarios.
- [x] Replace native naming prompts with a keyboard-accessible dialog; preserve save/rename/delete/reset and import/export behavior. Report persistence failures.
- [x] Start assistant collapsed as a small action, retain its mounted conversation, and ensure opening it does not cover the dashboard permanently.

## 3. Detailed workspaces

- [x] Give Year-by-year the full-width existing table. Add year selection and a breakdown from that same simulation row, with owner detail for couples; retain all columns and print expansion.
- [x] Route Explore details rows to years, financial history, and risk respectively. Opening financial history expands the applicable disclosures and focuses the destination.
- [x] Keep Monte Carlo result explanations on the exact input/results snapshot used for the run. Preserve running/stale indicators and manual rerun.
- [x] Keep the full report available for print regardless of active workspace; expose every existing narrative and methodology section in the dashboard's detailed explanation area.

## 4. Verification

- [x] Compare post-change individual/couple projection output with recorded baseline; run `npm test`, `npm run lint`, `npm run build`.
- [x] In the in-app browser, edit spending by $500 and return by 0.1 percentage point; confirm the chart, metrics, baseline delta and full settings agree.
- [x] Verify all three Explore rows, year selection, owner detail, named scenario save/switch/rename, import/export, baseline restore, and stale Monte Carlo.
- [x] Check desktop, intermediate and phone layouts plus keyboard focus/labels and print content. Save before/after screenshots and take a final UI pass. Print action and content reviewed; native PDF pagination remains unverified in the in-app browser.
- [x] Record verification outcomes and any limits. Implementation left in the working tree for review; no commit, push, or deployment.

Verification details and screenshots: `output/ui-implementation/README.md`. All 34 tests, 172 browser diagnostics, lint, build, and diff checks passed. Full individual/couple engine outputs match the recorded pre-change snapshots.
