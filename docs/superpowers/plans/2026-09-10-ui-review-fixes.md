# UI review fixes implementation plan

> Execute the approved review task by task; styling is delegated independently, and presentation behavior is implemented and integrated in this session.

**Goal:** Make planner outcomes, assumptions, and review actions clear while preserving all financial calculations and existing local work.

**Architecture:** Keep finance modules unchanged. Add small presentation models for account identities, field review routing, and baseline changes. Retain all existing planner surfaces, collapse the outlook outside Dashboard, and preserve full printed reports.

**Tech Stack:** React 18, Recharts, Tailwind v4, Vite, Node tests.

## Constraints
- User approved the preceding review; no additional design approval is needed.
- Preserve uncommitted work, input semantics, numerical outputs, print disclosures, and reduced motion.
- Cash and HSA remain separate; do not implement the deferred Other grouping.
- Remove unsupported historical percentages rather than implying they are a personalized backtest.
- No commit, push, or deployment is requested.

## Tasks
- [x] Capture current source and run baseline tests; fetch remote before edits.
- [x] Add shared account metadata and use it in portfolio, cash-flow, composition, and legends.
- [x] Add presentation-only notice mapping with owner scope, affected fields, fallback explanation, and direct review actions. Test individual, shared, spouse, duplicate-name, and unmapped notices.
- [x] Implement actual in-view settings navigation and focus the appropriate input after opening disclosures.
- [x] Show compact plan status on non-dashboard workspaces, preserving the full outlook in print.
- [x] Preserve numerical zero distinctions and show explicit dollar basis on metrics and charts.
- [x] Explain changed baseline assumptions and matched-horizon effects. Test nested fields, zero/null, different horizons, and restoration.
- [x] Correct percentile and historical reference wording; move methodology into a disclosure, keep assumptions and provisional/stale context beside results.
- [x] Consolidate semantic tokens, readable text and focus treatment, split styles by surface, and keep print rules last.
- [x] Run all tests, lint, production build, finance-source comparison, and diff check.
- [x] Verify desktop/mobile navigation, review links, number editing, baseline comparison, stale simulation, tooltip/disclosure bounds, zoom, and print where available.

## Behavioral checks
Use `node --test tests/*.test.mjs`. New tests exercise routing and comparison rather than duplicating CSS. Existing `audit-regressions`, `ui-comparison`, `outlook`, and `save-state` tests remain required. Browser checks use a local default plan and do not save user scenarios.

## Design rationale
Use the existing violet and neutral visual language. The dashboard owns the full outlook; task workspaces get a compact status line. Keep numbers and controls prominent, make supporting text readable, and use disclosures for explanations without hiding result qualifications. Retain current motion and honor reduced-motion settings.

## Validation limits
Desktop and narrow viewport reflow were verified. Actual browser zoom and native PDF pagination were not available through the browser controls; print styles were reviewed and consolidated, but native print layout remains a manual check. See ../../ui-review-verification.md for results.
