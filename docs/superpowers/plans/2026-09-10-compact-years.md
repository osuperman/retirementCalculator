# Compact year detail implementation plan

**Goal:** Fit annual totals within the available screen width and let users resize or collapse navigation.

**Architecture:** Add a compact annual table alongside the existing full table. A small sidebar hook and accessible separator control the workspace grid. Existing year inspection and financial output remain the source of detail.

**Tech Stack:** React, CSS, Vite.

### Approved design and constraints
- Full detail is the default (updated per user feedback); compact view remains selectable. Place large, high-contrast view controls directly below the title.
- Show year/ages, income, account withdrawals, spending and tax, ending balance and material shortfall warnings. Select a year for all fields.
- Desktop navigation can be dragged between 180 and 360 pixels or collapsed; keyboard arrows resize it. Small screens retain their existing navigation layout.
- Preserve existing uncommitted funding work, calculations and dollar-display behavior.

### Steps
- [x] Add compact annual totals using adjusted rows and exclude included SEPP/employer Roth amounts from withdrawal sums.
- [x] Add compact/full controls and responsive table styling, stacking labeled values on phones.
- [x] Add sidebar resize/collapse controls with pointer capture and keyboard support.
- [x] Run tests, lint and build; inspect desktop/mobile overflow and sidebar interaction in a browser.

### Verification
- 62 tests passed; lint, build and diff whitespace checks passed. Build retains existing dependency deprecation and chunk-size warnings.
- Browser: compact view fits at 1280, 1024, 800 and 390 pixel widths; 800 checked with maximum sidebar width.
- Verified pointer resize from 240 to 180 pixels, keyboard Home/End, collapse/expand, year selection, dollar mode changes and full-detail switching.
- Final production preview confirms full detail selected initially and prominent view controls at desktop and phone widths.
- Full detail retains horizontal scrolling for its complete account columns. No deployment performed.

### Release validation
- Isolated staged release excludes the separate funding-explanation work. Its 52 tests, lint and production build pass.
