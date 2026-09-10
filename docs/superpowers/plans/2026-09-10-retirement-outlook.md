# Retirement outlook implementation plan

**Goal:** Implement the compact white outlook panel approved in conversation, preserving live calculations, metrics, dollar controls and detail navigation.

**Architecture:** A focused RetirementOutlook component consumes the existing adjusted annual series and shortfall summary. A small pure presentation model distinguishes depletion from cash-flow shortfalls. Existing metric components retain their explanatory disclosures. No finance-engine changes or dependencies.

**Visual design:** Compact headline and status at left, purple balance chart at right, four metrics below, restrained review and detail actions. Stack the chart and use two metric columns on phones. Keep the existing title and dollar switch. Use subtle control hover transitions and respect reduced motion.

## Implementation

- [x] Inspect repository and fetch remote refs before edits; preserve existing saving and year-detail changes.
- [x] Add src/ui/outlookModel.js and focused shortfall/depletion, provisional, and boundary coverage in tests/outlook.test.mjs.
- [x] Add src/ui/RetirementOutlook.jsx and scoped CSS; use numeric ages for the curve, reference line, shaded gap and marker.
- [x] Integrate in src/App.jsx. Following the user's update, every workspace uses the same new outlook strip and heading: Dashboard, All settings, Year-by-year, Compare and Risk analysis.
- [x] Run tests, lint and production build: 43 tests pass, lint passes, production build passes (existing Vite plugin deprecations and bundle-size warnings).
- [x] Inspect desktop and narrow layouts, dollar toggle, detail navigation, review navigation, and live updates: 1440px, 768px and 390px visually inspected with no page overflow. Age 90 detail opens 2071; dollar toggle changes retirement value from $2.08M to $1.33M; spending from $60,000 to $90,000 moves headline and marker together from 90 to 74. Couple mode displays primary age context. Review action opens financial history. Original inputs and dollar basis restored; no browser errors. Numeric axes and marker share the same annual data. Native PDF pagination and full assistive-technology testing are outside this visual change's validation.

User approved this design with “please implement”; proceed inline with no additional design gate. Changes remain local; no deployment requested.
