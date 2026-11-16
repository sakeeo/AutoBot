# SDD ledger — plan: /home/muhammadlim/Documents/Kerabat koding - Software House/wa-otomation/docs/superpowers/plans/2026-11-16-broadcast-aman.md
Pre-flight: T1 store (BContact, suppress API) -> T3 gate (BContact, isSuppressed injected) -> T6 engine (store+gate+limits+lint+breaker+feed+conv); T4 handler consumes store.suppress/recordInbound; T5 import consumes store+gateway.onWhatsApp; T7 IPC consumes engine+store+import; T8/T9 consume Api.bc*. Interfaces consistent. Known gap: plan T6 calls store methods (createCampaign, enqueue, ...) added in T6 itself.
Task 1: complete (commits 627feeb..76043fe, tests: npx vitest run tests/broadcast →    Duration  445ms (tests 34%, import 33%, transform 26%, worker 7%))
Task 2: complete (commits 76043fe..19fcbf6, tests: npx vitest run tests/broadcast →    Duration  549ms (tests 38%, import 35%, transform 15%, worker 12%, environment 1%))
Task 3: complete (commits 19fcbf6..ba04e9a, tests: npx vitest run tests/broadcast →    Duration  643ms (tests 39%, import 35%, transform 15%, worker 11%))
Task 3: Ruling: breaker failure-rate rule needs ≥10 outcomes in the last 20 (the 3-in-a-row rule covers smaller samples) — a ratio over 2–3 sends would trip on one failure — cost: a bad start with 4–9 sends is caught only by the consecutive rule
Task 4: Ruling: stop/start are matched as the WHOLE normalised message against a short phrase list (not 'starts with') — the plan's own cases 'berhenti di jalan?' and 'start up saya' must NOT match, which 'starts with' would break — cost: variants like 'tolong berhenti kirim promo dong' are not recognised (the user can still add phrases)
Task 4: complete (commits ba04e9a..ed12e68, tests: npx vitest run tests/broadcast tests/reply-pipeline.test.ts →    Duration  1.68s (import 45%, tests 35%, transform 15%, worker 5%))
Task 5: complete (commits ed12e68..a221ecc, tests: npx vitest run tests/broadcast/import.test.ts →    Duration  882ms (import 62%, tests 29%, transform 8%, worker 1%))
Task 6: Ruling: engine gets a `connected(): boolean` dependency and `preview(id)` lives on the engine (needs tier/settings) — plan listed them on EngineDeps/store without it — cost: none
Task 6: Ruling: opt-out/complaint signals are persisted in a new broadcast_events table (migration) so the breaker keeps its memory across a restart+resume; replies from imported contacts are derived from broadcast_contacts/sends (no events) — cost: one extra small table
Task 6: IN PROGRESS (WIP commit): store campaign/queue methods, syncChatContacts, localDay helpers and broadcast_events migration are written; tests/broadcast/engine.test.ts and audience.test.ts exist; src/main/broadcast/engine.ts NOT written yet, so typecheck fails on the engine test import until it is.
Task 6: complete (commits a221ecc..79b39a7, tests: npx vitest run tests/broadcast →              at least ~312ms faster with isolate: false — reuses workers across files instead of one per file)
Task 7: Ruling: stop-all is allowed while locked through an ALWAYS_ALLOWED channel list in the guarded handle() (not a raw ipcMain.handle) — keeps one gate for every channel — cost: none
Task 7: Ruling: broadcast starts disabled and "undeclared": loadSafety forces enabled=false until the number age is declared; admins and the bot's own number are auto-suppressed (admin) at boot and on connect — cost: admins added later are protected only after the next boot/connect
Task 7: Ruling: pipeline.busy() (chains or in-flight sends) is the engine's isBusy — cost: coarse, the engine yields whenever any chat is being processed
Task 7: complete (commits 79b39a7..181edca, tests: npx vitest run tests/broadcast tests/reply-pipeline.test.ts →              at least ~439ms faster with isolate: false — reuses workers across files instead of one per file)
Task 8: complete (commits 181edca..ced339f, tests: npx vitest run tests/renderer →              at least ~2.02s faster with isolate: false — reuses workers across files instead of one per file)
Task 9: complete (commits ced339f..01cc944, tests: npx vitest run tests/renderer →              at least ~2.46s faster with isolate: false — reuses workers across files instead of one per file)
Task 10: complete (commits 01cc944..2345d11, tests: npm test →              at least ~8.35s faster with isolate: false — reuses workers across files instead of one per file)
Final: fixed C1 opt-out received while offline (handler runs before the stale check; only the auto-reply is skipped when old) — handler + pipeline tests RED→GREEN
Final: fixed C2 echo of a broadcast treated as human takeover (pipeline.sendBroadcast registers the send as in flight, no cooldown; engine uses it) — pipeline + engine tests RED→GREEN
Final: fixed C3 STOP from an @lid chat (IncomingMessage.altJid from remoteJidAlt/senderPn; handler keys by the phone number too) — normalize + handler tests RED→GREEN
Final: fixed I1 XLSX/CSV numeric phone cells (exact integers, exponent text and precision-lost values rejected; 812… without the 0 read as 62812…) — import + identity tests
Final: fixed I2 suppression reasons never weakened; unsuppress(key,'berhenti') lifts only an opt-out — store + handler tests
Final: fixed I3 breaker resume: only signs after the last resume count, breaker also checked before each send — engine tests
Final: fixed I4 no-reply breaker counts replies among the same sends (Outcome.replied), not for all time — breaker + store tests
Final: fixed I5 erasing a contact anonymises sends (contact_id 0) so limits cannot be reset by erasing — store test
Final: fixed I6 a send is marked in flight before sendText and bookkeeping errors never cause a resend; after a restart in-flight rows count as sent ('tidak_pasti') — engine + store tests
Final: fixed I7 resume only from 'dijeda' (draft needs the KIRIM path); audience frozen when a campaign is confirmed even if queued — ipc + engine tests
Final: fixed I8 wizard no longer leaves orphan drafts (bcDiscardDraft on back/continue and on cancel) — wizard + ipc + store tests
Final: fixed I9 stop/pause cannot revive a stopped campaign; campaign status re-read right before sending — engine test
Final: fixed I10 20 s minimum gap enforced by the gate and the batch pause persisted across restarts — gate + engine tests
Final: fixed I11 erase also removes turns, handoffs, contacts, events, cooldowns — store test
Final: fixed I12 rolling 24 h backstop in the gate, send window limited to 06:00–22:00, time zone must be real — gate + ipc tests
Final: fixed I13 confirmation campaigns only reach people still waiting who were never messaged; pending contacts expire after 7 days (expirePending, run every 10 min) — gate + store tests
Final: fixed I14 a complaint from a recipient is escalated (onComplaint → existing escalate notification) — handler test
Final: Ruling: the rolling 24 h backstop means a day's cap only fully reopens 24 h after the previous day's sends (e.g. 10 sent at noon → on the next morning only 2 more) — stricter than the calendar-day cap; chosen because the time zone can otherwise be used to double the cap — cost: slower ramp-up in the first days
Final: Ruling: values that end in 6+ zeros with 11+ digits are rejected as precision-lost — cost: a genuine number ending in 000000 would need re-entering
Final: minor (deferred): changeNumber lets the age be re-declared (warm-up restarts anyway); bcSendConfirmations has no KIRIM at any size; "Hentikan semua" only on the Keamanan tab (spec wants it visible while running)
Final: minor (deferred): admins added later protected only after the next connect/boot; returned jid from onWhatsApp not re-checked against suppression; ~800 onWhatsApp lookups for a 20k import is itself a signal
Final: minor (deferred): Uint8Array import has no size cap and rows are counted after a full parse; invalid timezone in stored settings falls back to UTC silently
Final: minor (deferred): counters() reads every send twice per step (up to 50 steps per tick); salt in the same database so the tombstone hash is pseudonymous; tidak_terdaftar is permanent; bare "langganan" re-subscribes an opted-out person
Final: minor (deferred): a stop during the 2–5 s typing delay still lets that one message out; engine does not skip chats a human is handling
