# Year detail implementation plan

**Goal:** Implement the approved four-column reference while preserving financial data and controls.

**Architecture:** Keep YearInspector props, field definitions, formatting and children unchanged. Add local zero-visibility state and presentation grouping; scope CSS to the inspector.

**Tech stack:** React and existing CSS; no dependencies.

Approved follow-up: replace the shared frame with separate panels, short descriptions, and a purple portfolio panel. Add a summary of spending, income taxes and penalties, account withdrawals, MAGI, and ending portfolio; show positive unfunded need separately. Keep metrics independent rather than implying a cash-flow equation. Withdrawals sum only the seven non-overlapping account fields and exclude conversion, included employer Roth, and included SEPP values. All summary amounts use the existing dollar-mode factor. No financial engine edits.

- [x] Update PlannerWorkspace.jsx: checked-by-default Show zero values checkbox; accessible previous/select/next controls; income/outflow/shortfall groups; indented included values; emphasized portfolio total. Filter only exact numeric zeros, preserving totals and shortfall.
- [x] Update index.css: column dividers, readable muted zeros, neutral spending, red positive shortfall, responsive four/two/one columns, visible focus and print styling.
- [x] Run tests, lint, build and diff check. Inspect browser at desktop and mobile widths; exercise filtering and navigation. Keep financial engine files unchanged.

Validation: 34 tests passed. Browser checks covered filtering, restoration, previous/next, direct selection, first/last disabled states, and dollar modes. Desktop 1440px and mobile 390px screenshots inspected; 1024px two-column layout checked in DOM. No page overflow at mobile/tablet widths. Native print output and couple-mode interaction were not separately exercised. Git fetch returned a worktree-metadata cleanup permission error; HEAD and origin/main match. Changes are local and uncommitted.
