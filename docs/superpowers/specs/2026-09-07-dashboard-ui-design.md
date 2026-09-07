# Retirement planner dashboard and detailed exploration

Status: approved by the user after reviewing the dashboard visual and detail-workspace interactions.

## Outcome

Make the existing planner intuitive for repeated what-if experiments while preserving every calculation, setting, warning, report, and advanced planning workflow. The dashboard must let users change a precise assumption and immediately inspect the resulting graph. Detailed work must remain first-class.

## Evidence from the current application

The local app was reviewed on September 7, 2026 at desktop 1440 x 1000 and phone 390 x 844 sizes. Screenshots and observations are in `output/ui-audit/README.md`. The working tree includes the preceding financial-audit changes; those are the baseline to preserve.

- Changing lifestyle spending from $60,000 to $60,500 updated the projection immediately: the displayed withdrawal rate changed from 5.8% to 5.9% and first shortfall age from 90 to 89. The experiment was restored afterward. This establishes interaction behavior, not independent certification of the financial result.
- At desktop size, metrics, a shortfall banner, unresolved-input warnings, and narrative occupy the first screen before the main graph appears.
- At phone size, the portfolio-chart heading starts approximately 7,749 pixels down the document because all input sections precede results.
- The assistant starts expanded and covers much of the initial narrow view.
- The detailed eligibility form uses two narrow columns inside the desktop sidebar, making long labels hard to scan.
- Quick numerical inputs and several legacy settings have visible labels without corresponding accessible input names.
- Monte Carlo runs and explicitly marks results stale after inputs change. Its diagnosis nevertheless combines the old success percentage with current input values; presentation must keep these aligned.
- Comparison and the year-by-year table are present, but returning directly to a particular output or setting requires scrolling.

## Approaches considered

1. **Recommended: dashboard with quick controls and a full settings workspace.** Keep the existing purple/slate identity and charts. Make results the default view; provide clearly labeled access to all settings, detailed output, comparisons, and risk. This best serves quick experiments and deep dives, with focused layout and navigation changes.
2. **Polish the existing long page.** Reduce spacing and add a few jump links. Lowest structural change, but the long mobile input-first workflow remains difficult and advanced forms stay constrained.
3. **Guided setup wizard.** Useful for first-time setup, but slows repeated small edits and forces experienced users through a sequence. It is not appropriate as the main workflow for this request.

## Proposed experience

### Dashboard

- Use a compact header with current scenario, saved/unsaved state, save, and an accessible menu for duplicate, rename, delete, import, export, and reset actions. Preserve the existing action semantics and confirmation behavior.
- Provide explicit navigation to Dashboard, All settings, Year-by-year, Compare, and Risk. These are views of the same plan state, not new independent plans.
- Keep key metrics concise. Retain explanations through accessible disclosures and preserve dollar-basis labels and current financial qualification warnings.
- Show a concise, visible plan-status summary and unresolved-input count with a direct action to the relevant settings. Do not suppress invalid-result or material-shortfall warnings.
- Place the existing portfolio chart high in the main workspace, next to compact quick-adjustment controls on desktop. Put the chart and compact quick controls before the complete settings form on mobile.
- Keep annual cash flow, retirement phases, detailed narrative, and methodology reachable through direct links and disclosures. Do not remove their content merely to shorten the screen.
- Start the AI assistant collapsed. Its opener must be small, clearly labeled, and avoid covering chart legends, table rows, or editing controls. Preserve conversation and proposal-application behavior when opened.

### Precise scenario adjustments

- Retain sliders and direct numeric entry. Use explicit annual units, percent units, and dollar basis. Label lifestyle spending as excluding healthcare, consistent with the existing model.
- Support small currency changes and 0.1 percentage-point return changes without snapping typed values to coarse slider increments.
- Keep quick controls synchronized with the corresponding full settings. Preserve separate primary and spouse retirement ages and household spending in couple mode.
- Provide a reversible session comparison: capture the current plan as a baseline, show key result differences after edits, and restore that baseline with one explicit action. A baseline includes all nested inputs and does not overwrite a saved scenario.
- Distinguish live deterministic projection updates from explicitly run Monte Carlo results. Keep stale risk results clearly marked and ensure any accompanying diagnosis uses the same input snapshot as those results, or withhold that diagnosis until rerun.
- Avoid changing scroll position when an input updates. Preserve keyboard focus and avoid turning a temporarily empty field into an unexpected plan change while the user is typing.

### All settings and financial detail

- Give the complete settings editor adequate width, with a section index and clear return to the dashboard. Reuse existing controls and state-update functions.
- Organize the existing sections by Timing and household; Balances and accounts; Income and contributions; Spending and healthcare; Returns and risk; Withdrawal and Roth strategies; Tax eligibility and history; and Advanced rules.
- In couple mode, distinguish Household, Primary, and Spouse scopes consistently. Preserve every conditional field for pensions, inherited BCO contracts, survivor elections, SEPP, Roth history, Social Security monthly earnings, ACA, IRMAA, and HSA qualification.
- Split the large eligibility/history form into named subgroups. Use one column when the actual container is narrow; use multiple columns only when labels and controls have enough space.
- Link unresolved financial-input notices to the applicable section. Opening a section must not fill unknown eligibility facts or infer confirmation.
- Preserve settings text serialization, import migration, scenario storage, and all existing detailed explanations.

### Detailed outputs

- Offer a direct Year-by-year destination that gives the table the full available width. Keep every existing column, account split, conditional field, badge, and explanation.
- Keep row identity visible during horizontal scrolling, and give the scroll region an accessible name and keyboard access.
- Preserve charts, tooltips, dollar-basis controls, retirement phases, cash-strategy analysis, diagnostics, and print/PDF output. Printing must include the full intended report even if sections are collapsed on screen.
- Retain the existing retirement-age/spending comparison matrix and chart. Label its scope clearly so it is not confused with a comparison of saved named scenarios.

## Implementation boundaries

The financial engine and its audited semantics remain the source of truth. Use the current normalized `inputs`, simulation outputs, scenario store, and existing update callbacks. New UI navigation and baseline state belong in the presentation layer. Extract focused UI components where needed without unrelated engine refactoring.

Expected UI files: `src/App.jsx`, `src/FinancialDetails.jsx`, `src/index.css`, and small new presentation components/helpers as warranted. Preserve all pre-existing worktree changes. Do not regenerate published `docs/assets` or deploy as part of this task.

## Accessibility and error handling

- Associate labels and descriptions with all edited inputs; make term help keyboard accessible.
- Expose selection and expansion state for tabs, toggles, and disclosures. Use visible focus treatment and readable touch targets.
- Announce completed updates succinctly without reading the full chart on each keystroke.
- Preserve distinctions between blank/unknown, explicit zero, and invalid input. Do not silently add eligibility assumptions.
- Keep save failures, invalid imported settings, calculation validity, and stale simulation status visible and actionable.

## Verification before delivery

1. Record current regression-suite status before implementation; retain representative individual and couple projection outputs for comparison afterward.
2. Confirm small spending, retirement age, Social Security, and return edits update graphs and metrics without a separate Run action or unwanted page movement.
3. Confirm baseline capture/restore round-trips every input, including nested spouse settings and financial histories, without mutating named scenarios.
4. Check individual and couple navigation, every settings group, conditional controls, import/export, scenario save/switch, cash strategy, diagnostics, and full year-by-year access.
5. Run Monte Carlo and verify running, completed, and stale states. Keep stochastic results separate from live deterministic results.
6. Verify narrow phone, intermediate, and desktop layouts; keyboard access; labels; chart and table scrolling; and no assistant obstruction.
7. Inspect print/PDF output to ensure disclosures or view navigation do not omit detailed content.
8. Run appropriate regression tests, lint, and build. Report any pre-existing failures separately from new failures.
9. Capture final screenshots and take a second critical pass through the exact edit-to-graph-to-detail workflow before delivery.

## Review

This proposal intentionally preserves the full planner and promotes frequently used controls. Approval is requested for approach 1 and the behavior above. No approval is requested for deployment or any external publication.
