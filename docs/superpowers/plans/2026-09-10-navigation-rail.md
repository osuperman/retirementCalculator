# Navigation Rail Implementation Plan

**Goal:** Implement NAV-REFACTOR-BRIEF.md as a presentation-only change while preserving all planning workflows.

**Architecture:** Move navigation and existing controls into one rail. Portal the existing settings index into a slot below Your information, retaining its section state and reveal handler. Keep the header non-sticky and measure only actual sticky obstructions.

**Tech Stack:** React 18, ReactDOM portals, existing CSS, Vite, Node tests.

## Constraints and decisions
- Preserve navigation keys, history requests, financial calculations, inputs, and persisted scenarios.
- Retain controls on Overview, Compare, and Risk; hide controls on Settings and Years.
- Omit optional Assumptions destination; existing section links expose the real sections.
- Render rail before content for keyboard and mobile order.
- The brief's wider Year-by-year acceptance criterion conflicts with adding a 288px rail to today's full-width Years view. Keep its table internally scrollable and implement the specified rail.
- Preserve print content and full-width print layout; verify browser print styling without claiming native PDF equivalence.

## Implementation
- [x] Update WorkspaceNav labels, groups, assistant action, badge, and settings slot in src/ui/PlannerWorkspace.jsx.
- [x] Portal the existing SettingsWorkspace section index into that slot; retain revealSection and current-section tracking.
- [x] Mount rail before content in src/App.jsx; pass the existing modelNotices length and wrap existing live controls.
- [x] Remove horizontal navigation and revise offsets, responsive columns, mobile chips, and print selectors in src/styles.
- [x] Run npm run lint, npm test (52 passing), npm run build, and git diff --check.
- [x] Verify all destinations, review and section anchors, live controls, assistant, desktop/mobile overflow, and keyboard disclosure activation in a browser.

## Verification evidence and limits
- At 1280px all result views have no page overflow; Years table is 880px wide with 1500px internally scrolling content.
- Desktop review heading lands at 24px without the reminder, 90px with a 66px reminder. Returns section lands at approximately 91px with the reminder.
- Mobile 390px Years view has wrapped navigation chips, a static rail, one selected destination, and no horizontal page overflow.
- Couple section list updates to Household, Primary, and Spouse; Spouse anchor lands at approximately 26px.
- Changing annual spending from 60000 to 61000 changes the projected first shortfall from 2071 to 2070; restoring baseline restores test inputs.
- User-requested disclosure beside Your information collapses and expands the nested list by mouse and keyboard while keeping settings visible.
- Clicking Your information also toggles the list while already in Settings; from other workspaces it opens Settings. Browser verification confirmed open, collapse, and reopen.
- Browser console recorded no errors. Assistant opens from the rail; no assistant request was sent.
- Print selectors preserve hidden navigation and full-width report content. Native PDF pagination and exact before/after print layout equivalence were not verified.
