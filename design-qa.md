# Year-by-Year Detail design QA

final result: passed

Scope: existing production table styling and composition tooltip, preserving simulation data and optional columns.

Source: C:/Users/steph/AppData/Local/Temp/codex-clipboard-14cfe258-5df2-48d5-8dd0-98c27284b5b7.png (2274 x 1150 raster; supplied standalone table reference).

Implementation: C:/Users/steph/.codex/visualizations/2026/09/10/01a08b50-82a2-7f80-9d67-dc343b880441/year-table-desktop.png. Desktop viewport 2048 x 1036 CSS pixels. Existing app content width is 1744 CSS pixels; the reference fills its image. Compared together in the same tool input, accounting for the app shell and narrower content frame, without claiming pixel equality. Both show nominal dollars, including overlapping ages 72-78. The live table retains all retirement years; the reference begins at age 72. Account composition uses actual model balances, not the illustrated segment proportions.

Focused evidence: C:/Users/steph/.codex/visualizations/2026/09/10/01a08b50-82a2-7f80-9d67-dc343b880441/year-composition-tooltip.png. Hover over age 72 shows four balances totaling $1,751,139. Today's dollars shows $788,344 with unchanged percentages. Values agree with the existing selected-year inspector.

Typography: retained app font and compact numeric type, tabular figures, bold totals, uppercase spaced group headings. Spacing: rounded frame, padded header, wider bars and rows, five-year dividers. Colors: pale income/withdrawal/transfer/end-balance groups and purple/pink/green/amber account segments match the reference direction. Assets: no raster assets or new icons needed for this data table. Copy: preserved model-specific transfer descriptions and badge explanations; help is now collapsible. Kept optional legend accounts so actual model assets remain represented.

Comparison history: initial desktop comparison found the End of Year group label left-aligned. Scoped the left alignment to the Composition subheader; recaptured and compared with the source. No remaining actionable P0/P1/P2 findings for this scoped adaptation.

Verified interactions: actual pointer hover, click, keyboard Enter, Escape dismissal, badge help expansion/collapse, nominal/today's dollar switching, age-link inspector navigation, horizontal table scrolling. At 390 x 844, document width was 375 pixels (no page overflow); the 320-pixel tooltip stayed within the viewport. Default viewport restored. Browser console error log was empty.

Validation: 43 tests passed, including existing production diagnostics. Lint, production build and diff check passed; existing Vite deprecation/chunk warnings remain. No finance engine files changed. Couple-mode and optional pension/BCO rendering retained by code inspection but not separately exercised in the browser; native print not verified. Pre-existing unrelated local edits preserved. Changes are local and uncommitted.
