# Implementation Plan: first-spoken-call

Built from `requirements.md` and `design.md`. Requirement numbers are R*n.m*; contract rows are from contracts §10.

Rules for every task:

- Work on branch `build/first-spoken-call`. Each task ends with its witness tests passing, `npm test` green, and exactly one commit. No push without owner approval (R32.8).
- Every task is required. Property-test tasks are marked **[property]** and are never optional (R32.3).
- No sub-agents. Read the relevant guide in `node_modules/next/dist/docs/` before writing any route, `after()` or other Next.js code.
- No `.env` file is opened. No paid OpenAI call runs before task 35. All tests use the Memory_Store, the fake Clock_Port and Fake_OpenAI.
- When a task is done, fill in **Actual** in hours.

Typed turns, extraction and the Debug_Panel (tasks 1–28) are finished and tested before any voice task (29–32).

---

## Phase A: Kiro setup and guards (F0)

- [x] 1. Steering files
  - Requirements: R1.1–R1.10
  - Depends on: none
  - Estimate: 1.5 h · Actual: 0.3 h
  - Witness: manual check. Steps: confirm `.kiro/steering/` holds exactly `product.md`, `tech.md`, `structure.md`, `memory-rules.md`, each with `inclusion: always`; compare every version string with `architecture-decision.md` and `.nvmrc`; confirm KC03 and KV12 are cited; confirm no secret values.
  - Create the branch `build/first-spoken-call` first.
  - Commit: `chore(kiro): add steering files`

- [x] 2. Clock port, clock allow-list and static clock check
  - Requirements: R2.1, R2.7–R2.9, R6.1, R6.2, R6.5
  - Depends on: 1
  - Estimate: 2 h · Actual: 0.5 h
  - Witness: `scripts/clock-guard.test.ts` › "flags Date.now outside the allow-list", "passes new Date(x)", "repo has zero violations"; `packages/server/src/clock/live-clock.test.ts`; fake clock tests in `packages/core/src/clock.test.ts`
  - Add `ClockPair` type (core), `clock/live-clock.ts` (server), `functions/src/clock.ts`, the fake Clock_Port, and `scripts/clock-allowlist.json` with those files plus `apps/web/src/client/clock.ts` (created in task 25; listed now).
  - Route `packages/server/src/live.ts:16` through `live-clock.ts` and `functions/src/index.ts:50` through `functions/src/clock.ts`. `health.ts:73` stays as is.
  - Commit: `feat(clock): clock port and static wall-clock check`

- [ ] 3. Clock Guard_Hook
  - Requirements: R2.2–R2.6
  - Depends on: 2
  - Estimate: 1 h · Actual: 0.4 h
  - Witness: `scripts/clock-guard-hook.test.ts` › exit 2 outside allow-list, exit 0 inside, exit 0 without `Date.now(`, exit 2 on bad stdin
  - Write `scripts/clock-guard.mjs` reading the shared allow-list. Create the hook with the `createHook` tool (PreToolUse, matcher for `fs_write|str_replace|fs_append`).
  - **Open (R2.5 not met):** `scripts/clock-guard.mjs` and its witness tests are done and pass. The `createHook` call (id `clock-guard`, PreToolUse, matcher `^(fs_write|str_replace|fs_append)$`, command `node scripts/clock-guard.mjs`, timeout 30 s) failed twice with "the permission request failed before it was answered", so `.kiro/hooks/clock-guard.json` does not exist yet. The file was not hand-written, to avoid bypassing the permission check. Rerun `createHook` with those values once the permission prompt works, then tick this task.
  - Commit: `chore(kiro): clock guard hook`

- [x] 4. Model config module and model-ID literal check
  - Requirements: R30.1–R30.3, R30.5, R31.8; contract questions 9, 10
  - Depends on: 2
  - Estimate: 1.5 h · Actual: 0.5 h
  - Witness: `packages/server/src/config/models.test.ts` › "CONFIG names the missing variable without its value"; `scripts/model-literals.test.ts` › "no model ID literals outside config/models.ts"; existing `health.test.ts` still passes
  - Add `config/models.ts` and `config/env.ts`. Move the `/api/health` fallbacks into `config/models.ts`; `/api/health` output is unchanged. Add `FRANKI_TRANSCRIBE_MODEL` and `FRANKI_FIREBASE_PROJECT_ID: frankirocks` as plain entries in `apphosting.yaml`.
  - Commit: `feat(config): model config module and literal check`

- [x] 5. Local env sync from `apphosting.yaml`
  - Requirements: R30.7, R30.10
  - Depends on: 4
  - Estimate: 1 h · Actual: 0.3 h
  - Witness: `scripts/sync-local-env.test.ts` › "copies plain values", "skips secret entries", "prints no values"; manual check: `git check-ignore apps/web/.env.development.local` reports ignored
  - Add `scripts/sync-local-env.mjs` with pure `parsePlainEnv`, add `predev` to `apps/web/package.json`, add the `yaml` dev dependency in the repo. Add a `.gitignore` pattern only if `check-ignore` says the file is not ignored.
  - Commit: `feat(dev): sync plain apphosting values for next dev`

- [x] 6. Import-boundary check and test harness
  - Requirements: R5.1–R5.3, R5.6–R5.8, R31.1, R31.2
  - Depends on: 2
  - Estimate: 1.5 h · Actual: 0.5 h
  - Witness: `scripts/import-boundaries.test.ts` › one case per forbidden specifier; `test/setup.test.ts` › "fetch throws", "net.connect throws"
  - Add the Vitest setup file that blocks network access, and the Fake_OpenAI skeleton (`openai/fake.ts`) that records requests and returns scripted results.
  - Commit: `test: import boundaries and no-network harness`

## Phase B: contracts and store (F0)

- [x] 7. Primitive and record schemas
  - Requirements: R4.1, R4.3–R4.5, R4.8, R4.11 (KC01)
  - Depends on: 6
  - Estimate: 4 h · Actual: 0.3 h
  - Done: validator kit `schema/v.ts`, `schema/primitives.ts`, `schema/predicates.ts` (Args<P>, value kinds, kind map), `schema/records.ts`, sample builders in `testing/samples.ts`. `TS` is the fixed-width RFC3339 UTC string (contract question 28). Ledger `request.response` accepts any object until task 8 installs the closed WireResult union.
  - Witness: `packages/core/src/schema/records.test.ts` › unknown key, each bound, `T?` null vs absent, valid record returns unchanged
  - Closed validators for `sN`, `i`, `Signed`, `ID`, `Hash`, `TS`, `Zone`, Slice, Span, Ref, C fields, Evidence, Memory, Session, Turn, the five core docs, Job and Ledger (C§1). Unit tests only; the round-trip property waits for task 12 (R31.3).
  - Commit: `feat(core): closed record schemas`

- [x] 8. Wire and debug schemas
  - Requirements: R4.2 (KC01)
  - Depends on: 7
  - Estimate: 2.5 h · Actual: 0.2 h
  - Done: `schema/wire.ts` with every type listed below, the closed request and response of open, sdp, state, close, turn, tool and receipt, `RECALL_TOOL` (strict JSON Schema for Realtime), `DebugRequest`/`DebugPage`. A stored ledger `request.response` is now checked against the response type of its `route`, which closes the task 7 gap.
  - Witness: `packages/core/src/schema/wire.test.ts` › one valid and one invalid case per type
  - Head, Deck, SS, Stamp, StateAck, Permit, TurnRequest, TurnResponse, W, SafeTurn, Card, InspectItem, Error, every route body used in this slice, the recall tool, and the `DebugPage` type.
  - Commit: `feat(core): closed wire schemas`

- [x] 9. Text, slices and IDs
  - Requirements: R20.2–R20.4, R24.7 (ranges), C§1 ID
  - Depends on: 7
  - Estimate: 2 h · Actual: 0.2 h
  - Done: hashing is injected through a `Hasher` interface (`id`, `sha256`) defined in `core/ids.ts`; `server/crypto.ts` backs it with `node:crypto`. A Slice root key is `Hasher.id(slice)`. Extra unit tests: `core/slices.test.ts` (typed classification, slice hashing, lexicon floors, canonical JSON).
  - Witness: `packages/core/src/text.test.ts` › CRLF and lone CR to LF, surrogate split rejected; `packages/server/src/crypto.test.ts` › HMAC ID is 43 chars with the fixed fake key
  - `text.ts`, `slices.ts`, `lexicon.ts`, `ids.ts` (core) and `crypto.ts` (server). Unit tests only; the slice-hash property waits for task 12.
  - Commit: `feat(core): text normalization, slices and ids`

- [x] 10. Store_Port, Memory_Store and conformance suite
  - Requirements: R4.6, R4.7, R4.9, R4.10, R4.12, R4.13, R7.1–R7.5, R7.9, R7.10, R24.3 (KC01, KC02, W-LINEAGE write check)
  - Depends on: 7, 9
  - Estimate: 4 h · Actual: 0.4 h
  - Done: `store/port.ts` (buffered transactions; the store sets `rev`; `update` needs a read in the transaction or an expected rev), `store/memory-store.ts`, shared commit checks in `store/checks.ts`, declared query shapes in `store/indexes.ts` (Q03, Q13, Q14, Q17, Q18, Q28, Q33; any other shape is rejected), Evidence revisions in `store/evidence.ts`, `core/evidence.ts`. Neither store retries a transaction; a concurrent change is `staleRevision` and callers retry (R19.11). Memory immutability also covers `predicate`, `subjectId`, `scopeId` and `key`, because a Memory ID is one assertion. Sample builders are exported as `@franki/core/testing`.
  - Witness: `packages/server/src/store/conformance.ts` run by `memory-store.test.ts` › CAS abort writes nothing, rev+1, oversize, tenant mismatch, Evidence immutable, Memory value immutable, lineage write rejections, Q14/Q28 cursor order
  - Commit: `feat(store): store port, memory store, conformance suite`

- [x] 11. **[property]** Lineage property, written first and run red
  - Requirements: R24.4–R24.6, R31.3 (KC03, W-LINEAGE)
  - Depends on: 6, 9, 10
  - Estimate: 2.5 h · Actual: 0.4 h
  - Witness: `packages/server/src/worker/extract.lineage.property.test.ts` › "every stored memory resolves to evidence spans" (1,000 runs)
  - Write `core/lineage.ts` (pure resolver, unit-tested) and the property over 1–50 ops (commits, job runs, retries, Fake_OpenAI results with bad quotes, ranges and eids). `runExtractJob` exists only as a stub that writes Memories without verification, so the property fails.
  - **Red record:** run on 2026-11-03 against the stub in `worker/extract.ts`. Result: "Property failed after 32 tests", shrunk 15 times; replaying the seed and path reproduces it. Seed: `-1410336256`, path `31:1:0:1:1:1:2:4:3:3:3:3:3:3:3:3` · Counterexample: `[{"kind":"commit","text":"a"},{"kind":"retry","outputs":[{"kind":"items","items":[{"act":"statement","target":"new","spans":[{"kind":"badQuote","a":0,"b":0}]}]},{"kind":"refusal"}]},{"kind":"retry","outputs":[{"kind":"items","items":[]},{"kind":"items","items":[]}]}]`. The stub stored a Memory from an Item whose Span `[0,0)` quoted `"!"`; the root Slice hash is correct for the empty range, so the store's W-LINEAGE check passed, and `resolveLineage` reported `spanQuoteMismatch` on span 0. An earlier run of the first draft (before `retry` was changed to mean "run the last job again") failed the same way: seed `-538046718`.
  - The test is committed as `it.fails`, so `npm test` passes while the stub exists and would fail if the stub ever satisfied the property. Task 22 must change it to `it` and record the green run.
  - Done: the property checks each stored Memory against the Spans of the Item that produced it, found through the design's Memory ID `H("mem", jobId, itemIndex)`. A Memory with any other ID fails as having no known producer. Fixtures in `server/testing/extract-fixtures.ts`; normalized Responses result type in `openai/responses.ts`; `FakeOpenAI.drain`.
  - Commit: `test(lineage): lineage property (red)`

- [x] 12. **[property]** Schema round-trip and slice-hash properties
  - Requirements: R31.4 (round trip), R20.7, R31.5
  - Depends on: 11
  - Estimate: 1.5 h · Actual: 0.4 h
  - Done: round trip over 29 types (the 11 record types and 18 wire types), 100 runs each, using arbitraries derived from the schemas (`core/testing/arbitrary.ts`; schemas now carry a `meta` description). The property found that `-0` passes validation but becomes `0` after JSON. Fix: number and integer validators reject `-0`, with a unit test. Slice hash: four properties (hash equals an independent SHA-256 of the LF-normalized range; CR variants hash the same; surrogate splits are rejected; a changed character no longer matches). The CR-variant property first failed on its own model (a lone CR break followed by an LF break is one CRLF), so its generated lines are non-empty and break-free; the normalizer was right.
  - Witness: `packages/core/src/schema/roundtrip.property.test.ts`; `packages/core/src/slices.property.test.ts`
  - Commit: `test(core): round-trip and slice-hash properties`

- [ ] 13. Invariant save hook
  - Requirements: R3.1–R3.7
  - Depends on: 11, 12
  - Estimate: 0.5 h · Actual: —
  - Witness: manual check. Steps: time `npm run test:fast` (under 30 s); save a file under `packages/` and confirm the hook runs once. `npm test` includes the same files.
  - Add `test:fast` to the root `package.json`. Create the hook with `createHook` (PostFileSave, matcher for `packages/` and `apps/web/src` `.ts`/`.tsx`, excluding `node_modules`, `.next`, `dist`).
  - **Open (R3.4 not met):** `test:fast` is in the root `package.json` (lineage property, closed schemas and round trip, slices, Store_Port on the Memory_Store) and took 3.1 s wall-clock on this machine. That run stops early because the lineage property is red; the 30 s limit for 1,000 full runs (R3.5) can only be measured after task 22. The file-path matcher is generated by `scripts/save-hook-matcher.mjs` without lookaround and tested in `scripts/save-hook-matcher.test.ts`. Writing `.kiro/hooks/invariants-on-save.json` directly (as instructed; `createHook` cannot run headless) failed twice with "the permission request failed before it was answered", the same failure as task 3, so the file does not exist and the hook has not fired. To finish: write that file as `{version:"v1", hooks:[{name:"Invariants on save", description, trigger:"PostFileSave", matcher: <output of saveHookMatcher()>, action:{type:"command", command:"npm run test:fast", timeout:60}}]}`. The skipped test in `scripts/save-hook-matcher.test.ts` then checks it. Then do the manual check (save a file under `packages/`, confirm one run) and tick this task.
  - Commit: `chore(kiro): invariant save hook`

- [ ] 14. Firestore_Store, Admin init, indexes and rules tests
  - Requirements: R7.6–R7.8, R8.1–R8.8, R30.11, R31.9 (KS08; Q03, Q13, Q17, Q18, Q33)
  - Depends on: 10
  - Estimate: 3.5 h · Actual: —
  - Witness: `firestore/rules.test.ts` and `firestore/store-conformance.test.ts` (emulator; run in CI because Java is not installed locally); `packages/server/src/config/admin.test.ts` › "CONFIG when FRANKI_FIREBASE_PROJECT_ID is missing"
  - `config/admin.ts` initializes with the explicit `projectId`; `live.ts` uses it. Write the five indexes to `firestore.indexes.json`. Add Java 21 and `npm run test:emulator` to CI. Do not deploy the indexes (task 34).
  - Commit: `feat(store): firestore store, indexes, rules tests`

## Phase C: server routes for typed turns and memory (F0, F3, F5 floors)

- [ ] 15. Route_Guard, idempotency, core documents and route adapter pattern
  - Requirements: R5.4, R5.5, R10.1–R10.13 (KV10)
  - Depends on: 8, 10
  - Estimate: 3.5 h · Actual: —
  - Witness: `packages/server/src/auth/guard.test.ts` › 401 cases, 403 origin cases, 413 oversize; `ledger/request.test.ts` › replay, 409 `HASH`, in-flight 429 `LIMIT`, 24 h expiry; `core-docs.test.ts` › "two concurrent first requests create one set"
  - Fake token verifier for tests. Define the `schedule(fn)` dependency and the adapter template that wraps `after()`.
  - Commit: `feat(server): route guard, idempotency, core docs`

- [ ] 16. Eligibility and spoken grade
  - Requirements: R25.1–R25.7, R28.1, R28.2 (KC06, KC09)
  - Depends on: 7
  - Estimate: 2.5 h · Actual: —
  - Witness: `packages/core/src/eligible.test.ts` › one test per implemented deny reason plus `ok`; `spoken.test.ts`
  - Commit: `feat(core): eligible and spokenGrade`

- [ ] 17. **[property]** Head compiler
  - Requirements: R26.1–R26.9, R26.12, R26.13, R28.3
  - Depends on: 16
  - Estimate: 3 h · Actual: —
  - Witness: `packages/core/src/head.test.ts` › drop order, ten sections, absolute date; `head.property.test.ts` › "determinism", "every know line traces to an eligible S0/S1 ref"
  - Commit: `feat(core): compileHead with properties`

- [ ] 18. Session open, state and close on the server
  - Requirements: R11.1–R11.9, R13.3, R13.6, R14.2–R14.7, R26.10, R26.11 (KV09, KS07; Q13, Q28)
  - Depends on: 15, 17
  - Estimate: 4 h · Actual: —
  - Witness: `packages/server/src/routes/open.test.ts` › "one transaction writes bundle and session with post-compile bundleRev", barrier → blocked; `state.test.ts` › "re-issues Deck every call", "tick is scheduled, not awaited"; `close.test.ts` › hangup failure keeps `closing` and writes a `hangup` Job; `worker/hangup.test.ts`
  - Hangups go through Fake_OpenAI. The extract drain is a no-op hook here; task 22 fills it.
  - Commit: `feat(server): session open, state, close`

- [ ] 19. **[property]** `/api/turn` typed path and turn serialization
  - Requirements: R18.2, R18.3, R18.7, R18.8, R19.1–R19.11, R20.1, R20.3, R20.5, R20.6, R20.8–R20.10, R22.1 (KV12, KC01, KC02; Q14)
  - Depends on: 18
  - Estimate: 4 h · Actual: —
  - Witness: `packages/server/src/routes/turn.test.ts` › pasted classification, empty/oversize rejected, Turn+Evidence+Extract_Job atomic, missing/failed transcript advances seq with no Evidence; `turn.serialization.property.test.ts` › "1–50 concurrent requests commit gap-free seq"
  - Commit: `feat(server): turn route and clientSeq serialization`

- [ ] 20. Admission seam and `devAdmit`
  - Requirements: R17.1, R17.4–R17.10, R18.5 (KV02, KV03)
  - Depends on: 19
  - Estimate: 2 h · Actual: —
  - Witness: `packages/server/src/admission/dev-admit.test.ts` › one case per `devPermitKind` row, "throws CONFIG in production and writes no ledger", "one decision ledger entry per outcome", payload hash matches `core/admission.ts`
  - Commit: `feat(admission): seam and devAdmit`

- [ ] 21. Typed reply without a call
  - Requirements: R18.4, R18.6; contract question 24
  - Depends on: 20
  - Estimate: 1.5 h · Actual: —
  - Witness: `packages/server/src/routes/turn.typed-reply.test.ts` › "reply arrives as one W note", "Fake_OpenAI request uses FRANKI_BRAIN_MODEL", "Extract_Job starts only after the response (scheduled)"
  - Commit: `feat(server): typed reply without a call`

- [ ] 22. **[property]** Extractor (lineage property goes green)
  - Requirements: R22.2–R22.11, R23.1–R23.12, R24.1, R24.2, R24.7 (KS01, KS06, KC03, KC04, KC05; Q03)
  - Depends on: 11, 19
  - Estimate: 6 h · Actual: —
  - Witness: `worker/extract.test.ts` › request parameters, one repair then `retry`, `failed` after 3, span rejections, holds write ledger decisions, single-valued supersede, KS06 mismatch; `extract.authority.property.test.ts` › "T and M never write active or scheduled"; `extract.lineage.property.test.ts` now passes
  - **Green record:** run the lineage property and write the result here. Runs: — · Passed: —
  - Commit: `feat(worker): ExtractV1 extractor`

- [ ] 23. Drain, open race and route deadlines
  - Requirements: R14.5, R22.12, R11.2, R13.6
  - Depends on: 18, 22
  - Estimate: 2.5 h · Actual: —
  - Witness: `packages/server/src/routes/deadlines.test.ts` › "state returns within 1.5 s and open within 5 s when Fake_OpenAI never answers"; `routes/memory-e2e.test.ts` › "commit, extract, close, open: Memory is in the Head" (R22.12)
  - Commit: `feat(worker): job drain and bounded open wait`

- [ ] 24. `GET /api/debug/memory`
  - Requirements: R28.4, R28.5, R29.1, R29.2, R29.9, R29.11, R29.12 (KC03, KC09; Q14, Q28, Q33)
  - Depends on: 15, 22
  - Estimate: 2.5 h · Actual: —
  - Witness: `packages/server/src/routes/debug-memory.test.ts` › paging with no repeats, other tenant's ids rejected, S2 reveal logs ids only, refuses in production before any read, lineage mismatch flag
  - Commit: `feat(server): development debug route`

## Phase D: browser for typed turns and the Debug_Panel (F1)

- [ ] 25. Sign-in, browser clock and API client
  - Requirements: R9.1, R9.2, R9.4, R9.6, R9.7, R12.6
  - Depends on: 15
  - Estimate: 2.5 h · Actual: —
  - Witness: `apps/web/src/client/api.test.ts` › "attaches Bearer token", "no /api call while signed out except /api/health"; manual check: sign in on `http://localhost:3000`, email shows within 5 s, closing the popup shows the right error
  - Needs the Firebase web config values in `apphosting.yaml` (owner action 2). If they are missing, stop and ask.
  - Commit: `feat(web): sign-in and API client`

- [ ] 26. Typed input and conversation view
  - Requirements: R18.1, R18.6, R18.8–R18.10
  - Depends on: 21, 25
  - Estimate: 2 h · Actual: —
  - Witness: `apps/web/src/components/TypedInput.test.tsx` › disabled when empty, one request per press, keeps text on error or 10 s timeout, clientSeq increments by 1
  - Commit: `feat(web): typed input`

- [ ] 27. Debug_Panel
  - Requirements: R21.9, R29.3–R29.8, R29.10
  - Depends on: 24, 25
  - Estimate: 3 h · Actual: —
  - Witness: `apps/web/src/components/DebugPanel.test.tsx` › turns in seq order with "none" marker, span highlight and mismatch marker, stale indicator after a failed fetch, stored HTML rendered as text, "no Head compiled" state
  - Commit: `feat(web): debug panel`

- [ ] 28. Checkpoint: typed memory path end to end, no paid calls
  - Requirements: R22.12, R29.1, R26.4; brief demo goal for typed input
  - Depends on: 23, 26, 27
  - Estimate: 1 h · Actual: —
  - Witness: `packages/server/src/routes/typed-e2e.test.ts` › "typed line → extract → debug route shows the Memory with lineage → next open's Head contains it", Fake_OpenAI only
  - Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Fix anything red before voice work starts.
  - Commit: `test: typed memory path end to end`

## Phase E: voice (F1, F5)

- [ ] 29. Voice state machine reducer
  - Requirements: R13.4, R13.7–R13.9, R15.1, R15.4, R15.5, R15.7, R15.8, R15.10, R15.11, R16.3, R17.2, R17.3 (KV02, KV04, KV05, KV06, KV13)
  - Depends on: 8, 20
  - Estimate: 4 h · Actual: —
  - Witness: `packages/core/src/voice/machine.test.ts` › barge-in mutes before anything else; 600 ms → HELD; any item missing a transcript at t_end+1.5 s → RECOVERY with `recoveryOnly`; higher stamp cancels and clears; wrong generation dropped; Permit mismatch plays nothing; CONNECTING timer starts at the open response; expired Deck builds no reply
  - Commit: `feat(core): voice state machine`

- [ ] 30. SDP proxy and receipts
  - Requirements: R12.1–R12.10, R21.1–R21.8; contract questions 18, 19
  - Depends on: 18, 20
  - Estimate: 3 h · Actual: —
  - Witness: `packages/server/src/routes/sdp.test.ts` › "call ID persisted before answer", "write failure hangs up and returns DEPENDENCY", 4 call IDs → `LIMIT`; `routes/receipt.test.ts` › assistant Turn seq and ordering, repeat transcript is idempotent, stale stamp → `accepted:false`, no Extract_Job for assistant Turns
  - Commit: `feat(server): sdp proxy and receipts`

- [ ] 31. **[property]** Recall tool
  - Requirements: R27.1–R27.11, R28.6 (KC06, KC09, KS01; Q28)
  - Depends on: 17, 20, 22
  - Estimate: 3 h · Actual: —
  - Witness: `packages/server/src/routes/tool.test.ts` › parse wait capped at 1.5 s → `hold`, stale stamp → `stale`, uncited statements dropped, RecallAllV1 failure → empty notes with `unknown`, asked test; `spoken-wire.property.test.ts` › "no failing Memory text in Head, Deck, notes or instructions" (all S×Class combinations)
  - Commit: `feat(server): recall tool`

- [ ] 32. Voice_Client, call controls and Stand_In_Avatar
  - Requirements: R9.5, R9.8, R13.1, R13.2, R13.5, R14.1, R14.8, R15.2, R15.3, R15.6, R15.9, R16.1–R16.6, R27.8
  - Depends on: 26, 29, 30, 31
  - Estimate: 5 h · Actual: —
  - Witness: `apps/web/src/client/voice-client.test.ts` with a fake `RTCPeerConnection` and data channel › one `session.update` with no `model` or `voice`, refresh every 45 s, `response.create` only after a verified Permit, mute only touches the mic track, sign-out closes within 5 s; `StandInAvatar.test.tsx` › six states with distinct non-text styling and accessible labels
  - Commit: `feat(web): voice client, controls and avatar`

## Phase F: finish

- [ ] 33. All checks green and report draft
  - Requirements: R31.6–R31.9, R32.1, R32.2, R32.4, R32.5
  - Depends on: 28, 32
  - Estimate: 1.5 h · Actual: —
  - Witness: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all exit 0; `GET /api/health` returns the same fields as before; CI `verify` and emulator jobs green (needs the owner to approve a push)
  - Write `docs/briefs/001-report.md`: what was built with task IDs, every stub and the feature that replaces it (`devAdmit` → F2, Stand_In_Avatar → Rive, typed-turn source mapping, Memory placeholders → F6, empty `lastTurns` → later pronoun context), estimate vs actual table, and every contract question.
  - Commit: `docs: slice report draft`

- [ ] 34. STOP: Firestore index deploy approval
  - Requirements: R7.8, R30.6; design owner action 3 (KS08)
  - Depends on: 14, 33
  - Estimate: 0.25 h · Actual: —
  - Witness: manual check. Steps: tell the owner that job draining (Q17, Q18), supersede lookups (Q03), expiry close (Q13) and the debug ledger view (Q33) need the five indexes; give the command `firebase deploy --only firestore:indexes`; wait. The owner runs it, or approves it in writing. Then confirm the indexes show as enabled in the Firebase console before the next task.
  - Never run the deploy yourself. No commit unless the report changes.

- [ ] 35. STOP: paid live check after notice
  - Requirements: R31.10, R32.6
  - Depends on: 34
  - Estimate: 1 h · Actual: —
  - Witness: manual check. First tell the owner that a paid check is about to run and that it calls `FRANKI_VOICE_MODEL`, `FRANKI_TRANSCRIBE_MODEL`, `FRANKI_BRAIN_MODEL` and `FRANKI_BG_MODEL`; wait for the go-ahead. If `OPENAI_API_KEY` or `FRANKI_ID_HMAC_KEY` is missing, stop and ask, without opening `.env.local`. Steps on `http://localhost:3000`:
    1. Sign in. Press call. Say one fact about your life ("My dog is called Pip").
    2. Watch the Debug_Panel: the user Turn, its Evidence, the Extract_Job reaching `complete`, and the Memory with highlighted spans.
    3. Hang up. Call again within 10 seconds.
    4. Ask "What's my dog called?" and hear Franki say Pip. Confirm the new Head lists the Memory.
    5. Interrupt Franki once to check barge-in; mute and unmute once.
  - Record the result in `docs/briefs/001-report.md`, then give the final message: local run commands from a fresh clone, owner actions, and which real OpenAI calls were made.
  - Commit: `docs: live check result`

---

Estimate total: 86.75 h · Actual total: —
