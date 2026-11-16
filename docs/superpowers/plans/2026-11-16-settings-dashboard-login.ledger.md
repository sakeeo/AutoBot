# SDD ledger — plan: /home/muhammadlim/Documents/Kerabat koding - Software House/wa-otomation/docs/superpowers/plans/2026-11-16-settings-dashboard-login.md
Pre-flight: T1 AuthStore -> T2 auth-ipc (consumes AuthStore methods as specified; no conflict). T3 stats -> T6 dashboard (DashboardData shape shared via shared/ipc.ts; no conflict). T4 nav.tsx -> T5/T6 (SecurityPage placeholder in T4, replaced in T5; DashboardPage added to nav in T6).
Task 1: complete (commits 0a3cf1a..b2873f5, tests: npx vitest run tests/auth-store.test.ts →    Duration  2.89s (tests 88%, import 11%, transform 1%))
Task 2: complete (commits b2873f5..e968ce4, tests: npx vitest run tests/auth-ipc.test.ts tests/ipc-schema.test.ts →    Duration  1.82s (tests 63%, import 31%, transform 5%, worker 1%))
Task 3: complete (commits e968ce4..b87f21d, tests: npx vitest run tests/stats.test.ts →    Duration  382ms (tests 36%, import 31%, transform 25%, worker 8%))
Task 4: Ruling: exported TOP_ITEMS (Dashboard, Uji Jawaban, Log) instead of plan's TOP_ITEMS_BEFORE name, and added placeholder DashboardPage (real one in T6) — plan name was inconsistent with its own description — cost: none; theme+autostart GeneralSection placed in SecurityPage now so settings stay reachable
Task 4: complete (commits b87f21d..af498f8, tests: npx vitest run tests/renderer →    Duration  7.70s (tests 59%, environment 29%, import 11%, transform 2%))
Task 5: complete (commits af498f8..03057e7, tests: npx vitest run tests/renderer →    Duration  7.89s (tests 53%, environment 34%, import 12%, transform 1%))
Task 6: complete (commits 03057e7..e55282d, tests: npx vitest run tests/renderer →    Duration  8.48s (tests 45%, environment 40%, import 13%, transform 1%))
Task 1: Ruling: corrupt/incomplete auth.json = login disabled (now with a logged warning) — avoids permanent owner lockout; plan said so — cost if wrong: login silently off after hand-damaged file
Final: fixed #1 lock not reaching UI (evt:auth-locked + focus refresh) — "lock pushed by the main process" tests RED→GREEN, suite 401/401
Final: fixed #2 non-atomic auth.json writes / memory-before-disk — "AuthStore durability" tests RED→GREEN
Final: fixed #3 events and notifications leaking while locked (lockAwareSend, redactWhenLocked, devTools off + no menu when packaged) — "lock notifications and event gating" tests RED→GREEN; devTools/menu lines are untested config
Final: fixed #4 window created after close stays unlocked (lock on createWindow) — no unit test (Electron-only); in manual list
Final: minor (deferred): Pengaturan group not auto-open for active page (groupOf unused); Shell remount after unlock returns to Dashboard
Final: minor (deferred): theme not applied on lock screen
Final: minor (deferred): change-password/disable return 'bad' instead of LOCKED when locked behind the UI
Final: minor (deferred): login submit with empty password spends an attempt
Final: minor (deferred): username not NFKC-normalized
Final: minor (deferred): auth.json with missing salt loads as enabled then throws on login
Final: minor (deferred): dashboard shows "Memuat…" forever if getDashboard throws; no index on message_log(created_at)
Final: minor (deferred): throttle counter in memory only
Final: Ruling: out_of_context:escalate counted as "Ditolak" — spec maps out_of_context:* to refused — cost: escalations not in "Diserahkan"
Final: Ruling: minimize does not lock; username visible on lock screen; all-whitespace 8-char password accepted — spec silent/test asserts — cost: weaker lock on minimize
