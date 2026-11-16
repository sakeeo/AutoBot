# SDD ledger — plan: /home/muhammadlim/Documents/Kerabat koding - Software House/wa-otomation/docs/superpowers/plans/2026-11-16-ui-rubick-design.md
Pre-flight: T1 tokens -> T2 shell.css (shell uses only var(--*) from tokens; test reads shell.css) ; T2/T3 AuthContext+Api already exist; T3 ui components -> T4/T5 consumers (signatures in plan Interfaces). No conflicts.
Task 1: Ruling: derived values (DERIVED comments in tokens.css): text-muted #5F6B7E (guide secondary is 3.6:1), soft/text badge colours, sidebar active/hover/text, full dark palette — guide §10 demands AA and the app keeps Terang/Gelap/Otomatis — cost: values are mine, not the designer's
Task 1: Ruling: Inter bundled via @fontsource/inter (400/500/600/700, all subsets bundled by Vite) — no CDN under CSP — cost: ~+1 MB of font files in the package
Task 1: complete (commits b9f71ab..7aa6c2b, tests: npx vitest run tests/renderer/tokens.test.ts →    Duration  336ms (transform 43%, import 28%, tests 18%, worker 10%))
Task 2: complete (commits 7aa6c2b..8d4e00d, tests: npx vitest run tests/renderer/shell.test.tsx →    Duration  2.17s (environment 49%, tests 30%, import 16%, transform 4%))
Task 3: complete (commits 8d4e00d..2e39cae, tests: npx vitest run tests/renderer/ui.test.tsx tests/renderer/dashboard.test.tsx →    Duration  2.03s (environment 59%, tests 23%, import 15%, transform 2%))
Task 4: complete (commits 2e39cae..105a608, tests: npx vitest run tests/renderer →              at least ~674ms faster with isolate: false — reuses workers across files instead of one per file)
Task 5: complete (commits 105a608..e66a1f8, tests: npx vitest run tests/renderer →              at least ~637ms faster with isolate: false — reuses workers across files instead of one per file)
Task 6: complete (commits e66a1f8..4301780, tests: npm test →              at least ~5.35s faster with isolate: false — reuses workers across files instead of one per file)
Final: fixed #1 confirm overflow in narrow cells (popover anchored to trigger, trigger footprint kept) — "ConfirmButton layout" tests RED→GREEN, suite 472/472; checked visually
Final: fixed #2 invisible checkboxes/switches (DERIVED --color-control-border ≥3:1, light and dark) — tokens test RED→GREEN
Final: fixed #3 Bootstrap blue/low-contrast focus rings replaced by token outline; focused inputs keep surface colour — tokens test RED→GREEN
Final: fixed #4 TagInput remove button invisible (icon button inheriting chip text colour, 20 px target) — "TagInput remove button" test RED→GREEN
Final: fixed #5 drawer now a modal dialog (role=dialog, aria-modal, focus moves in, Tab trapped, page behind inert, focus back to menu button) — shell test RED→GREEN
Final: fixed #6 heading skip (Card title is an h3) — Card test RED→GREEN
Final: Ruling: control-border token applied only to checkboxes/switches; text inputs keep the guide's #E7EBF1 border (guide §8) — text inputs have white fill on grey page and are still ~1.2:1 against a white card — cost: WCAG 1.4.11 not met for input boundaries
Final: minor (deferred): profile menu keyboard (role=menu without arrow keys, focus not moved, Escape from item drops focus)
Final: minor (deferred): ApplyBar restore with empty select would call restoreBrandVersion(0); PresetPicker alertdialog without focus move/Escape
Final: minor (deferred): duplicate getDashboard polling (TopBar + DashboardPage); stale numbers on refresh error
Final: minor (deferred): leftover inline styles, raw div.card in AiSettings/PreviewPanel, fs-5 on lock screen (no heading), alert-secondary unmapped, icons without aria-hidden, TopBar badge not using StatusBadge
Final: minor (deferred): Bootstrap colours still showing (.form-range thumb, .is-invalid red); label 13px vs guide 10–12px; sidebar brand 17px; empty-state icon 28px; disabled outline buttons 0.65 opacity
Final: minor (deferred): locked cold start shows light theme (index.html data-bs-theme="auto"); long folder paths at 860 px; duplicate CSS declarations; confirm wording "Yakin?" vs spec "Yakin hapus?"
Final: Ruling: Inter ~1 MB bundled, tab widgets without arrow keys, chart/map/calendar sections of the guide not built — spec excludes them — cost: none for behaviour
