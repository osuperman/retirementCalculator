# Year table composition implementation plan

Goal: Apply the supplied Year-by-Year Detail reference to the existing table without changing simulation behavior.

Architecture: Retain row calculations, optional columns, owner details, badges, navigation and dollar-mode state. Scope styling to the table. Extract the composition bar into a React component with a portaled, keyboard-accessible tooltip. Share one maximum adjusted retirement-row total across bars; use adjusted row amounts throughout the tooltip.

- [x] Add account legend and composition component with dollar balances, percentages, total, year and dollar mode. Include cash, taxable, inherited, employer plans, traditional IRA, Roth and HSA when applicable. Handle empty balances.
- [x] Match tinted groups, larger row spacing, five-year separators, header controls and collapsible badge help using scoped CSS. Preserve optional pension/BCO columns and couple details.
- [x] Run tests, lint, build and diff check. Verify rendered table, hover/focus, dollar modes, navigation and narrow-screen scrolling. Keep financial engine unchanged and preserve pre-existing edits.
