# Numeric Save Behavior Implementation Plan

**Goal:** Enable scenario saving and show a prominent reminder only when numeric settings differ from the loaded or successfully saved settings, as approved by the user.

**Architecture:** Keep a separate save baseline, independent of the chart comparison baseline. Compare numeric leaves in normalized settings, including nested couple settings and numeric history records. Advance the save baseline only after successful storage; initial defaults, loading, and resetting start clean.

**Tech Stack:** React, CSS, Node test runner, Vite.

## Constraints

Preserve existing local year-detail edits and all financial calculations. Non-numeric changes alone do not enable Save. Saving still stores the complete settings. Save as new follows the same numeric-change gate. Reverting all numeric edits clears the reminder. The reminder must remain visible on mobile and use text in addition to color.

## Execution

- [x] Add `src/ui/saveState.js` with `hasNumericChanges(current, baseline)`, recursively comparing numeric leaves across the union of object keys, treating equivalent numeric strings as equal and null as distinct from zero.
- [x] Add regression tests in `tests/save-state.test.mjs` for defaults, normalized legacy data, nested edits, zero/null, numeric history addition/removal, non-numeric changes, and reverting.
- [x] Update `src/App.jsx`: retain the save baseline; guard Save, Save as new, and dialog submission; update saved state only after successful persistence; show an accessible reminder with a Save action.
- [x] Add narrowly scoped reminder styling to `src/index.css`, preserving local edits. Remove the unconditional save suggestion from `src/ui/PlannerWorkspace.jsx`.
- [x] Run the test suite, lint, build, and browser checks for clean/edit/revert/save/reload/failure and mobile visibility.

Validation: 39 tests passed, including production diagnostics; lint, build and diff checks passed. Isolated browser checks verified initial and reverted disabled Save, display-only changes, numeric edits, successful save and reload, failed storage retaining the reminder and old saved values, and mobile/scrolled reminder visibility. Build reports existing Vite deprecation and bundle-size warnings.
