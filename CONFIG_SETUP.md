# Configuration And Saved Values

The active app uses in-browser saved scenarios, not file-based config loading. It is
designed to be published as a public, client-only tool: a visitor's data never leaves
their browser (no server storage, no analytics of input values). The only feature that
sends data anywhere is the optional Ask AI tab, and only when the user actively uses it.

## Current Behavior

- The built-in default values live in `DEFAULT_INPUTS` inside `src/App.jsx`.
- Each visitor can keep multiple **named scenarios**, each holding its own input set.
  Save, Save as new…, Rename, and Delete are in the Scenarios card in the sidebar;
  a compact Save button and the active-scenario indicator are in the header.
- Scenarios are persisted under the browser storage key `retirement-planner-store-v1`
  with the shape `{ version, scenarios: [{ id, name, inputs, savedAt }], activeScenarioId }`.
- Persistence uses `localStorage` (via `window.storage` when running inside a Claude
  artifact), so data survives closing and reopening the browser. If storage is blocked
  (private mode), the app still works for the session without persisting.
- On load, the active scenario's inputs are merged with the latest defaults so newly
  added fields still receive defaults.
- "Reset to defaults" reverts only the working inputs to `DEFAULT_INPUTS`; it does not
  delete saved scenarios. Deleting a scenario only affects the current browser.

### Migration from the old single-value format

Earlier builds stored a single input set under `retirement-planner-inputs`. On first
load that legacy blob is automatically migrated into one scenario named "My saved
values", and the legacy key is removed. No data is lost.

This means all saved values are local to the browser/profile where the app is opened.

## Reference Config Files

These files still exist as reference/example data:

- `src/config/defaults.json`
- `src/config/config.local.example.json`
- `src/config/config.local.json`, if you create one locally

The active React app does not currently import those JSON files. If file-based config loading is reintroduced, update this document and keep `src/config/config.local.json` gitignored.

## New Calculation Inputs

Recent model changes added or clarified these inputs:

- `rmdStartAge`: defaults from current age and projection start year; can still be overridden.
- `taxableAnnualTaxDrag`: estimated annual taxable-brokerage drag from dividends and turnover.
- `ssIncome`: interpreted as the annual full-retirement-age Social Security benefit in today's dollars; the app adjusts for early or delayed claim age.
- `householdSize`: used for HSA family/self limits, ACA FPL calculations, and Medicare enrollee count assumptions.

Contribution inputs are capped inside the model using current-law limits, even if the UI value is higher.

## AI Chat Environment

The Ask AI tab uses a backend endpoint so provider keys stay out of browser JavaScript.

Local development uses the Vite dev middleware in `vite.config.js`:

```text
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.4-mini
LLM_PROVIDER=openai
```

Put those values in `.env.local`; do not commit that file.

For GitHub Pages, deploy a separate backend and set `VITE_CHAT_API_URL` at build time so the static app calls that backend instead of `/api/chat`.
