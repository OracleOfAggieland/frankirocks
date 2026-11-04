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

- [x] 3. Clock Guard_Hook
  - Requirements: R2.2–R2.6
  - Depends on: 2
  - Estimate: 1 h · Actual: 0.4 h
  - Witness: `scripts/clock-guard-hook.test.ts` › exit 2 outside allow-list, exit 0 inside, exit 0 without `Date.now(`, exit 2 on bad stdin
  - Write `scripts/clock-guard.mjs` reading the shared allow-list. Create the hook with the `createHook` tool (PreToolUse, matcher for `fs_write|str_replace|fs_append`).
  - **Hook file:** the owner's operator wrote `.kiro/hooks/clock-guard.json` (PreToolUse, matcher `^(fs_write|str_replace|fs_append)$`, command `node scripts/clock-guard.mjs`, timeout 30 s), because agent writes to `.kiro/hooks` are refused in headless runs. The operator confirmed in a scratch repo that it blocks a write adding `Date.now`.
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
  - Witness: `scripts/import-boundaries.test.ts` › one case per forbidden specifier; `tests/setup/setup.test.ts` (moved from `test/` on the owner's request) › "fetch throws", "net.connect throws"
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
  - **Open (R3.4 not confirmed):** `.kiro/hooks/invariants-on-save.json` exists (written by the owner's operator) and `scripts/save-hook-matcher.test.ts` checks it against the generated matcher. On Nov 3, 2026 the operator saved `packages/core/src/index.ts` in the Kiro IDE six times, including after a window reload and with a simpler file pattern. The IDE lists the hook as enabled with trigger File Saved, but no `test:fast` process ran; the process watcher was confirmed to detect a manual run. `test:fast` took about 3 s. The task stays open.
  - Commit: `chore(kiro): invariant save hook`

- [x] 14. Firestore_Store, Admin init, indexes and rules tests
  - Requirements: R7.6–R7.8, R8.1–R8.8, R30.11, R31.9 (KS08; Q03, Q13, Q17, Q18, Q33)
  - Depends on: 10
  - Estimate: 3.5 h · Actual: 0.4 h
  - Done: `config/admin.ts` (explicit `projectId`, injectable SDK for the test); `live.ts` now uses it, so `POST /api/health` needs `FRANKI_FIREBASE_PROJECT_ID`, which `apphosting.yaml` already sets. `store/firestore-store.ts` uses the shared checks and `maxAttempts: 1`, and maps ABORTED and ALREADY_EXISTS to `staleRevision`. `firestore.indexes.json` declares the five indexes, and `store/indexes.test.ts` keeps it equal to the Store_Port's shapes. `scripts/firestore-rules.test.ts` checks R8.1 in `npm test`. The emulator tests are in `tests/firestore/` (the existing `tests/rules/firestore.rules.test.ts` moved there and now covers R8.3–R8.5 and R8.8), `vitest.emulator.config.ts` includes that folder, and `tests/tsconfig.json` lets `npx tsc --noEmit -p tests` typecheck them. CI already set up Java 21 and ran `npm run test:emulator`, so the workflow is unchanged.
  - **Emulator run:** the owner's operator ran `npm run test:emulator` on Nov 3, 2026 with Java 21; 34 tests passed (`tests/firestore/rules.test.ts` and `tests/firestore/store-conformance.test.ts`). Indexes are not deployed (task 34).
  - Witness: `firestore/rules.test.ts` and `firestore/store-conformance.test.ts` (emulator, Java 21; run by `npm run test:emulator` locally and in CI); `packages/server/src/config/admin.test.ts` › "CONFIG when FRANKI_FIREBASE_PROJECT_ID is missing"
  - `config/admin.ts` initializes with the explicit `projectId`; `live.ts` uses it. Write the five indexes to `firestore.indexes.json`. Add Java 21 and `npm run test:emulator` to CI. Do not deploy the indexes (task 34).
  - Commit: `feat(store): firestore store, indexes, rules tests`

## Phase C: server routes for typed turns and memory (F0, F3, F5 floors)

- [x] 15. Route_Guard, idempotency, core documents and route adapter pattern
  - Requirements: R5.4, R5.5, R10.1–R10.13 (KV10)
  - Depends on: 8, 10
  - Estimate: 3.5 h · Actual: 0.5 h
  - Done: `auth/guard.ts` (Bearer token with revocation via `auth/admin-verifier.ts`, exact Origin, 128/256 KiB caps counted in UTF-8 bytes), `routes/errors.ts` (ErrorCode → HTTP, kernel errors mapped at the edge), `ledger/request.ts` + `routes/mutation.ts` (begin in its own transaction, `completeRequest` inside the route's transaction; failures are released and not replayed), `core-docs.ts` (`ensureCoreDocs`, `readCoreDocs`, `ownerClock` rejecting fixture mode per R6.7), `routes/runtime.ts` (`runRoute`, `Schedule`, `RouteDeps`), `routes/live-deps.ts`, `openai/live.ts` (Responses only; Realtime in task 30), `clock/timers.ts` (opsClock deadlines; virtual-time fakes in `testing/fakes.ts`), `core/time.ts` (`civilDay`). Adapter template: `apps/web/src/app/api/_lib/adapter.ts` (`adapt(spec)` backs `schedule` with `after()`; it lives under `app/api/` so the import-boundary check treats it as route code).
  - Witness: `packages/server/src/auth/guard.test.ts` › 401 cases, 403 origin cases, 413 oversize; `ledger/request.test.ts` › replay, 409 `HASH`, in-flight 429 `LIMIT`, 24 h expiry; `core-docs.test.ts` › "two concurrent first requests create one set"
  - Fake token verifier for tests. Define the `schedule(fn)` dependency and the adapter template that wraps `after()`.
  - Commit: `feat(server): route guard, idempotency, core docs`

- [x] 16. Eligibility and spoken grade
  - Requirements: R25.1–R25.7, R28.1, R28.2 (KC06, KC09)
  - Depends on: 7
  - Estimate: 2.5 h · Actual: 0.3 h
  - Done: `core/eligible.ts` (closed `EC`, `DocRef` and `Snapshot` schemas; every implemented clause of the design table; invalid input is `ineligible` and never throws; validation is memoized by object identity so one Snapshot is checked once per Head build), `core/spoken.ts`, test builders `sampleEC`/`sampleSnapshot` in `@franki/core/testing`. Snapshot `refs[i]` describes `rows[i]` (contract question 29). Non-active statuses fail Spoken_Grade with `stale`; S2 with `sensitivity`; T/M with `authority`.
  - Witness: `packages/core/src/eligible.test.ts` › one test per implemented deny reason plus `ok`; `spoken.test.ts`
  - Commit: `feat(core): eligible and spokenGrade`

- [x] 17. **[property]** Head compiler
  - Requirements: R26.1–R26.9, R26.12, R26.13, R28.3
  - Depends on: 16
  - Estimate: 3 h · Actual: 0.4 h
  - Done: `core/head.ts`. Input is `{memories, ec, snapshot, rules, clock, tokenCap?}`: the EC and Snapshot are what `eligible` and Spoken_Grade need, so they count as the "core state" input of R26.1. Returns the Head plus its `lines` (section, text, ref), which the lineage property checks. Memory lines render as `- predicate: value`. Empty sections have no heading and 0 tokens; `rules` shows "No hard rules recorded.". The 128-ref cap uses the same drop order as the token cap. `tokenCap` (contracts §7 `compileHead(..., tokenCap:3500)`, never above 3,500) lets the unit tests exercise the drop order and R26.6, because real enum-valued people and apply lines cannot reach 3,500 tokens. Properties: 200 runs each.
  - Witness: `packages/core/src/head.test.ts` › drop order, ten sections, absolute date; `head.property.test.ts` › "determinism", "every know line traces to an eligible S0/S1 ref"
  - Commit: `feat(core): compileHead with properties`

- [x] 18. Session open, state and close on the server
  - Requirements: R11.1–R11.9, R13.3, R13.6, R14.2–R14.7, R26.10, R26.11 (KV09, KS07; Q13, Q28)
  - Depends on: 15, 17
  - Estimate: 4 h · Actual: 0.7 h
  - Done: `routes/{open,state,close}.ts` with Next adapters under `apps/web/src/app/api/session/*/route.ts`; `sessions.ts` (Session builder, `beginCloseInTx`/`finishCloseInTx`, `afterClosed`); `head-build.ts` (Q28 Memory pages and their Evidence inside the open transaction); `deck.ts`; `worker/hangup.ts` (durable `hangup` Job, backoff 1/2/5/10/60 s, 404 = gone); `worker/tick.ts` (Q13 expiry close ≤100, Q17 hangup jobs then the extract drain, Q18 lease requeue); `worker/extract-jobs.ts` (`ensureExtractJobs`, Q14 Turn paging); `worker/jobs.ts` (lease claim); `worker/drain.ts` (no-op hook until task 22); `openai/realtime-calls.ts` and the live hangup call in `openai/live.ts`.
  - Choices: a Session goes `minting` → `active` on its first state call. A blocked open returns the would-be `sessionId` with `generation:0`, because `OpenResponse.sessionId` is not nullable. The prior Session at open is closed after the commit (hangups capped at 1 s, then marked `closed` whatever the outcome, with a `hangup` Job on failure), per R11.3; a close route failure stays `closing` per R14.3. The close route's hangup budget is 1.2 s of the 1.5 s limit.
  - **Deviation:** the design's once-per-minute tick gate is "a compare-and-set on core/state", but the closed `core/state` schema has no field for it. The gate is held in process per Store_Port and Owner (`takeTickSlot`). A second process may run the same tick in the same minute; that is harmless because every tick step is a compare-and-set on the rows it touches. Proposal for contracts v3: add `core/state.lastTickOpsAt`.
  - Witness: `packages/server/src/routes/open.test.ts` › "one transaction writes bundle and session with post-compile bundleRev", barrier → blocked; `state.test.ts` › "re-issues Deck every call", "tick is scheduled, not awaited"; `close.test.ts` › hangup failure keeps `closing` and writes a `hangup` Job; `worker/hangup.test.ts`
  - Hangups go through Fake_OpenAI. The extract drain is a no-op hook here; task 22 fills it.
  - Commit: `feat(server): session open, state, close`

- [x] 19. **[property]** `/api/turn` typed path and turn serialization
  - Requirements: R18.2, R18.3, R18.7, R18.8, R19.1–R19.11, R20.1, R20.3, R20.5, R20.6, R20.8–R20.10, R22.1 (KV12, KC01, KC02; Q14)
  - Depends on: 18
  - Estimate: 4 h · Actual: 0.5 h
  - Done: `routes/turn.ts` (+ `apps/web/src/app/api/turn/route.ts`), `turns.ts` (Turn and Evidence builders, SafeTurns, classification), `Unrecorded` in `routes/mutation.ts` so `hold` and `stale` leave the requestId free for the retry. A lost compare-and-set reruns the request up to 8 times, then answers STALE. Earlier S0/S1 Turns go in `deck.turns` (at most 4). The Permit is still null here; task 20 adds `devAdmit`. Control and chip turns (`uiControl`, `chip`, `trustedTap`) are PARSE in this slice. New conformance case "turn serialization" (8 concurrent clientSeq compare-and-sets on one Session) runs on both stores. Serialization property: 100 runs over N = 1..50, about 5 s. Emulator: 35 passed.
  - Witness: `packages/server/src/routes/turn.test.ts` › pasted classification, empty/oversize rejected, Turn+Evidence+Extract_Job atomic, missing/failed transcript advances seq with no Evidence; `turn.serialization.property.test.ts` › "1–50 concurrent requests commit gap-free seq"
  - Commit: `feat(server): turn route and clientSeq serialization`

- [x] 20. Admission seam and `devAdmit`
  - Requirements: R17.1, R17.4–R17.10, R18.5 (KV02, KV03)
  - Depends on: 19
  - Estimate: 2 h · Actual: 0.3 h
  - Done: `core/admission.ts` (`devPermitKind`, `admissionPayload`, `payloadHash`, `RECOVERY_LINE`, `turnRef`), `admission/dev-admit.ts`, `admission/seam.ts` (`admit` writes the one `decision` entry in the caller's transaction). `/api/turn` now admits inside the Turn transaction: the Permit hashes `{stamp, head, notes:[], turns: deck.turns, audioIds: item IDs, toolOutput:null, candidates:[], attendees:[]}`. In production `devAdmit` throws CONFIG before any work, the whole Turn transaction rolls back, and no ledger entry or Turn exists. A hold is recorded with status `hold` and `retryAfterMs:0` (a clientSeq hold has `retryAfterMs` ≥ 1). Holds happen only for a `postCommitControl` turn carrying an S1+ note, or a `recoveryOnly` turn with notes or tool output.
  - Witness: `packages/server/src/admission/dev-admit.test.ts` › one case per `devPermitKind` row, "throws CONFIG in production and writes no ledger", "one decision ledger entry per outcome", payload hash matches `core/admission.ts`
  - Commit: `feat(admission): seam and devAdmit`

- [x] 21. Typed reply without a call
  - Requirements: R18.4, R18.6; contract question 24
  - Depends on: 20
  - Estimate: 1.5 h · Actual: 0.3 h
  - Done: `routes/typed-reply.ts`. "No call open" means `Session.callId` is null. The Responses call runs before the Turn transaction, so the note is inside the admitted payload hash and in `permit.noteIds`; it runs only when the request's clientSeq is the Session's next, and never on a replay. A failure, refusal or the 4 s deadline gives no note, and the Turn still commits. For a pasted (T) turn an S1+ note is dropped, because its `postCommitControl` Permit carries no S1+ note.
  - Witness: `packages/server/src/routes/turn.typed-reply.test.ts` › "reply arrives as one W note", "Fake_OpenAI request uses FRANKI_BRAIN_MODEL", "Extract_Job starts only after the response (scheduled)"
  - Commit: `feat(server): typed reply without a call`

- [x] 22. **[property]** Extractor (lineage property goes green)
  - Requirements: R22.2–R22.11, R23.1–R23.12, R24.1, R24.2, R24.7 (KS01, KS06, KC03, KC04, KC05; Q03)
  - Depends on: 11, 19
  - Estimate: 6 h · Actual: 1.0 h
  - Witness: `worker/extract.test.ts` › request parameters, one repair then `retry`, `failed` after 3, span rejections, holds write ledger decisions, single-valued supersede, KS06 mismatch; `extract.authority.property.test.ts` › "T and M never write active or scheduled"; `extract.lineage.property.test.ts` now passes
  - **Green record:** run on 2026-11-03 against the real extractor, with the test changed from `it.fails` to `it`. Runs: 1,000 · Passed: yes, in about 1.3 to 2.7 s, three runs in a row. The first green run was vacuous: 0 Memories were stored, because `commitUserTurnForTest` wrote no core documents and the extractor's KS06 check then failed every job. The fixture now calls `ensureCoreDocs` first, as `/api/turn` does, and the property asserts that more than 50 Memories were stored and checked across the 1,000 runs (about 150 in practice). Mutation check: with the extractor's quote comparison removed, the property fails after 6 tests with `spanQuoteMismatch`. `npm run test:fast` took 7.1 s wall-clock (5.5 s in Vitest, 212 tests) against the 30 s limit (R3.5).
  - Done: `core/extract.ts` (PREFIX and ExtractV1 literals, draft schemas, `ARGS_DRAFTS`, strict output JSON Schema from the validators via `core/schema/json-schema.ts`, packet build, envelope parse, pure `planItem`), `worker/extract.ts` (claim, call + one repair, KS06 check, Memories, Q03 supersede, hold and rejection decisions, usage entry), `worker/drain.ts` (Q17 extract jobs in sequence, 100 ms poll on leased jobs, expired leases requeued). Timers accept an AbortSignal, so finished deadlines leave no pending timer. The authority property (500 runs) also asserts that both U and T/M Memories were planned.
  - Choices: Items are validated one by one inside the envelope, so one bad Item never discards the rest; an Item that fails the closed Item schema (for example a predicate outside the taxonomy) is a rejection with reason `invalidInput`. Holds use reason `unsupported`, `state:"blocked"`; rejections `state:"failed"`. Acts `promise_theirs` and `outcome` write nothing. An empty span `[n, n)` with quote `""` is rejected (R22.5): it quotes no Evidence text, so a Memory built on it would have no lineage. `resolveLineage` reports an empty Span as `spanQuoteMismatch` and an empty root Slice as `sliceHashMismatch`, so the closed `LineageFailureKind` list is unchanged.
  - **Empty-span fix (2026-11-03):** this choice first accepted empty spans. The fix rejects them in `verifySpan`, adds the `emptySpan` case to the lineage property's bad-span generator, and adds witnesses in `extract.test.ts` (› "rejects an Item with an empty range [n, n) quoting ''") and `core/lineage.test.ts`. The generator's `range` helper now always yields non-empty ranges: fast-check's `double` favors values near 0, so most "good" spans had been empty, and with only the rejection added the property stored 0 Memories and failed its more-than-50 check. With the fix, about 140 Memories are stored and checked per 1,000 runs. Mutation check: with the rejection in `verifySpan` removed, the property fails after 24 tests (seed `340016287`, path `23:1:1:1:4:3:4:4:4:3:3:2:2`; counterexample: commit `"a"`, then an Item whose only Span is `emptySpan` at 0), reporting `sliceHashMismatch` and `spanQuoteMismatch`. **Uniform ranges (2026-11-03):** the generator's fractions came from `fc.double`, which favors values near 0, so almost every checked span started near the beginning of the text: one 1,000-run measurement put 155 of 156 checked span starts in the first third of the text and 0 in the last, with 15 spans covering half the text or more. The fractions now come from `fc.noBias(fc.integer({min:0, max:2^16-1}))/2^16`. Three runs after the change: 136–157 Memories stored and checked, span starts per third 89–93 / 50–75 / 42–49, and 60–67 spans covering half the text or more. The property now asserts at least 10 span starts in each third and at least 10 half-length spans, besides the more-than-50-Memories floor. Mutation check repeated: with the quote comparison in `verifySpan` removed, the property fails after 16 tests (seed `-437482137`, path `15:1:0:1:1:1:1:1:2:1:2:2:2:2:2:2`; counterexample: commit `"a"`, then a run whose repair output has one Item with a `badQuote` span), reporting `spanQuoteMismatch`. The roster is empty and `lastTurns` is `[]`. A subject or entity argument other than `self` resolves to a code-derived ID `H("mention", type, normalized name)`, because no entity rows exist in this slice (see contract question 30). A lost lease commits nothing and leaves the job to its new holder, rather than requeueing it, so it cannot undo another worker's claim.
  - Commit: `feat(worker): ExtractV1 extractor`

- [x] 23. Drain, open race and route deadlines
  - Requirements: R14.5, R22.12, R11.2, R13.6
  - Depends on: 18, 22
  - Estimate: 2.5 h · Actual: 0.2 h
  - Done: the mechanism landed with tasks 18 and 22 (open races `drainExtractJobs` against 3,000 ms of opsClock and hands the loser to `schedule`; close's `afterClosed` ensures jobs and schedules a drain; `/api/turn` and `/api/session/state` only schedule). This task adds the witnesses. `deadlines.test.ts`: with a queued Extract_Job and Fake_OpenAI never answering, state returns in under 1.5 s with its tick still pending, and open returns at 3,000 ms (≥ the drain limit, < 5 s) with the job still `leased`; the background drain later leaves it `retry`/`DEPENDENCY` after both 10 s deadlines. `memory-e2e.test.ts` covers R22.12 twice: once with the scheduled extraction run, and once with no scheduled work ever run, where session open's own drain gets the Memory into the next Head.
  - Witness: `packages/server/src/routes/deadlines.test.ts` › "state returns within 1.5 s and open within 5 s when Fake_OpenAI never answers"; `routes/memory-e2e.test.ts` › "commit, extract, close, open: Memory is in the Head" (R22.12)
  - Commit: `feat(worker): job drain and bounded open wait`

- [x] 24. `GET /api/debug/memory`
  - Requirements: R28.4, R28.5, R29.1, R29.2, R29.9, R29.11, R29.12 (KC03, KC09; Q14, Q28, Q33)
  - Depends on: 15, 22
  - Estimate: 2.5 h · Actual: 0.4 h
  - Done: `routes/debug-memory.ts` and `apps/web/src/app/api/debug/memory/route.ts` (GET). The production check is the first thing `run` does, so the only work before it is the guard's token check; no Store_Port call happens. Sections: `evidence`, `memories`, `jobs` page through Q28; `turns` reads the Session's Turns through Q14 in R19.6 order (default Session: `core/epoch.activeSessionId`); `ledger` pages admission and extraction `decision` entries through Q33, newest first; `head` returns `core/bundle`. A cursor is the last item's ID and must be the requesting Owner's record (else SCOPE); a malformed cursor or an unknown query parameter is PARSE. Admission entries report `issuer:"devAdmit"` and the Permit kind from `devPermitKind` on the stored Turn; extraction holds report null for both. Memory items carry `resolveLineage` links and failures. A page with S2 Memory or Evidence content logs `debug.s2reveal` with uid, IDs and ops time only.
  - Witness: `packages/server/src/routes/debug-memory.test.ts` › paging with no repeats, other tenant's ids rejected, S2 reveal logs ids only, refuses in production before any read, lineage mismatch flag
  - Commit: `feat(server): development debug route`

## Phase D: browser for typed turns and the Debug_Panel (F1)

- [ ] 25. Sign-in, browser clock and API client
  - Requirements: R9.1, R9.2, R9.4, R9.6, R9.7, R12.6, R16.7
  - Depends on: 15
  - Estimate: 2.5 h · Actual: 0.6 h
  - Witness: `apps/web/src/client/api.test.ts` › "attaches Bearer token", "no /api call while signed out except /api/health"; `apps/web/src/components/Footer.test.tsx` › "root layout renders 'Built with Kiro' on every page, signed in and signed out"; existing `health.test.ts` still passes (output unchanged); manual check: sign in on `http://localhost:3000`, email shows within 5 s, closing the popup shows the right error, footer visible
  - Needs the Firebase web config values in `apphosting.yaml` (owner action 2). If they are missing, stop and ask.
  - Add a small `Footer` component with the text "Built with Kiro" to the root layout so it shows on every page (R16.7, steering `structure.md` Attribution).
  - Done: `client/firebase-config.ts` (the four `NEXT_PUBLIC_FIREBASE_*` values the operator added to `apphosting.yaml`, each referenced literally so Next inlines it; a missing value is named on screen, never printed), `client/auth.ts` (Google popup only; Firebase's default browser persistence restores the user on reload; `signInFailure` maps error codes to the three R9.6 causes: popup closed, popup blocked, provider error, with unauthorized-domain named as a provider error), `client/api.ts` (Bearer ID token read on every call; while signed out every `/api/` path except `/api/health` returns `signedOut` with no request; `/api/health` gets no token; `timeout`/`network`/`http` results with the ErrorCode), `client/clock.ts` (browser Clock_Port: `performance.timeOrigin + performance.now()` plus a server offset taken at the middle of a round trip; world = ops), `components/{App,AuthPanel,Footer}.tsx`; the root layout renders `Footer` after the page. `firebase` 13.1.0 (already a root dev dependency) is now a dependency of `@franki/web`. Vitest now includes `apps/web/src/**/*.test.{ts,tsx}`. Extra tests: `client/auth.test.ts` (cause mapping, config), `client/clock.test.ts`.
  - Choices: no DOM test library was added. Component tests render with `react-dom/server` and mock `next/font/google`, so they check markup, not clicks; interaction logic lives in plain modules with their own tests. The auth client is created in an effect, never during the server render, and the sign-in control stays disabled while Firebase has not reported (R9.7). R12.6 needs no browser code here: no route returns an OpenAI credential, and the SDP route arrives in task 30. Sign-out closes no Session yet; R9.5 and R9.8 are in task 32.
  - **Not ticked: manual checks still need a person.** Everything else is done and `npm test` is green. Still to do in a browser on `http://localhost:3000` (`npm run dev`): (1) sign in with Google and see the email within 5 s; (2) close the popup and see the "window was closed" message with the button enabled again; (3) reload while signed in and stay signed in without a prompt; (4) see the "Built with Kiro" footer signed in and signed out.
  - Commit: `feat(web): sign-in and API client`

- [x] 26. Typed input and conversation view
  - Requirements: R18.1, R18.6, R18.8–R18.10
  - Depends on: 21, 25
  - Estimate: 2 h · Actual: 0.5 h
  - Witness: `apps/web/src/components/TypedInput.test.tsx` › disabled when empty, one request per press, keeps text on error or 10 s timeout, clientSeq increments by 1
  - Done: `client/typed-turns.ts` (`TypedTurns`, an external store read with `useSyncExternalStore`), `client/ids.ts` (32 random bytes from `crypto.getRandomValues` as a 43-character base64url ID), `components/TypedInput.tsx` (`TypedInput` and `ConversationView`), wired into `App` while signed in; signed out, the box and button show disabled. The first line opens a Session with no SDP (design "One typed turn" step 2) and keeps `ack.stamp`; the open's `deck.issuedAt` aligns the browser Clock_Port. Responses are checked against the closed `OpenResponse` and `TurnResponse` schemas. The 10 s limit is the ApiClient's timer; the timeout test uses the real ApiClient with fake timers. Extra witnesses: reply notes shown as escaped text; a STALE or SCOPE error drops the Stamp so the next press opens a new Session, starting at clientSeq 1; `client/ids.test.ts`.
  - Choices: a failed line keeps its clientSeq. Resending the same text reuses its requestId and turnId, so a request the server did commit replays instead of erroring (R19.3); changed text keeps the clientSeq with new IDs. A `stale` status (Stamp revisions moved; nothing recorded) is retried once with the returned Stamp, and a clientSeq `hold` (retryAfterMs ≥ 1) is retried after its delay, up to 8 times. An admission hold (`retryAfterMs:0`) counts as sent with no reply. Enter sends; Shift+Enter adds a line break so pasted multi-line text can be sent and is classified T by the server.
  - Manual check (optional, not in the witness): in `npm run dev`, a typed line shows in the conversation view. It calls the brain model only when the server has `OPENAI_API_KEY`, so it is a paid call and belongs with task 35.
  - Commit: `feat(web): typed input`

- [x] 27. Debug_Panel
  - Requirements: R21.9, R29.3–R29.8, R29.10
  - Depends on: 24, 25
  - Estimate: 3 h · Actual: 0.6 h
  - Witness: `apps/web/src/components/DebugPanel.test.tsx` › turns in seq order with "none" marker, span highlight and mismatch marker, stale indicator after a failed fetch, stored HTML rendered as text, "no Head compiled" state
  - Done: `client/debug-panel.ts` (`DebugPanelModel` loads all six sections, following `nextCursor` up to 10 pages each and flagging a section with more; every page is checked against the closed `DebugPage` schema; a failed or over-3 s fetch keeps the last good data with `stale` and its opsClock load time; a refresh during a load queues exactly one more load; pure `sortTurns` (R19.6 order), `highlight`, `ledgerTurnId`, `jobSource`), `components/DebugPanel.tsx`, wired into `App` while signed in and hidden while signed out. Sections: Turns (seq, role, clientSeq for user Turns, state, Evidence ID or "none"), Evidence, Memories (list with a lineage-mismatch marker; the selected Memory shows each field with where it came from, `dependsOn`, supporting Refs, and each root Slice highlighted in its Evidence text with a per-link mismatch marker), Extract jobs (ID, Turn through its Evidence, status, attempts, error), decisions (at, purpose, turnId, Permit kind, issuer, reason codes) and the Head (text, ten section token counts, total against 3,500, `headHash`, `selectedRefs`, or "No Head compiled yet."). Extra witnesses: a link whose highlighted text differs from the resolved text is marked; jobs and decision rows; Head details; refresh queueing.
  - Choices: a stored Memory keeps no Spans, only one root Slice per verified Span over the same range, so the panel highlights the root Slices and marks a link as mismatched when the route reports a failure at that index, the resolved text is missing, or the highlighted text differs from it. The panel refreshes on sign-in, right after each acknowledged typed turn (R29.7's 1 s), and every 5 s while a Session is open; in this slice that is the typed Session, until task 32 adds calls. Each refresh makes at least six reads of `/api/debug/memory`.
  - Commit: `feat(web): debug panel`

- [x] 28. Checkpoint: typed memory path end to end, no paid calls
  - Requirements: R22.12, R29.1, R26.4; brief demo goal for typed input
  - Depends on: 23, 26, 27
  - Estimate: 1 h · Actual: 0.3 h
  - Witness: `packages/server/src/routes/typed-e2e.test.ts` › "typed line → extract → debug route shows the Memory with lineage → next open's Head contains it", Fake_OpenAI only
  - Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Fix anything red before voice work starts.
  - Done: the witness goes through the routes only: open, a typed `/api/turn` (reply note and `slowOrdinary` Permit before any extraction), the scheduled extraction, then `GET /api/debug/memory` for every section (each page checked against `DebugPage`): the Turn with its Evidence ID, U Evidence, the job `complete`, the Memory with `lineage.ok` and link text `"Pip"` at `[17, 20)`, and the `devAdmit` decision. The open Session's Head lacks the Memory; after close and open the Deck's Head and the debug route's Head contain it, with `selectedRefs` naming it. Exactly two Fake_OpenAI calls. Extra: `apps/web/src/client/typed-to-server.test.ts` runs the browser `TypedTurns` and `DebugPanelModel` against the real routes through a fetch backed by `runRoute`, so the request bodies the browser builds are the ones the routes accept (test-only relative imports of server test helpers; the import-boundary check skips test files).
  - **Checks (2026-11-03):** `npm test` 56 files, 613 tests passed; `npm run lint` and `npm run typecheck` exit 0; `npm run build` compiled; `npm run test:emulator` (Java 21) 2 files, 35 tests passed. No real OpenAI call ran.
  - Commit: `test: typed memory path end to end`

## Phase E: voice (F1, F5)

- [x] 29. Voice state machine reducer
  - Requirements: R13.4, R13.7–R13.9, R15.1, R15.4, R15.5, R15.7, R15.8, R15.10, R15.11, R16.3, R17.2, R17.3 (KV02, KV04, KV05, KV06, KV13)
  - Depends on: 8, 20
  - Estimate: 4 h · Actual: 0.8 h
  - Done: `core/voice/machine.ts`, a pure `step(state, event, now) → {state, commands}` over the design's nine states. Events are button presses, route results, the Realtime server events the machine reads, timers and `permitChecked`; commands are output mute/unmute, `setMic`, `connect`, `teardown`, Realtime client events (`session.update`, `response.create`, `response.cancel`, `output_audio_buffer.clear`), route posts without `requestId` (the Voice_Client adds and reuses it), receipts, `verifyPermit` and `armTimer`. Core cannot hash, so the Permit's payload hash is a `verifyPermit` command and the Voice_Client answers with the SHA-256 of the canonical payload; the payload is built from the client's own Stamp, Deck Head and turns, notes, audio item IDs in commitSeq order and tool output, exactly as the server's `devAdmit` input. A timer's deadline is kept in state, so an early or stale timer event does nothing. Also exported: `avatarState` (R16.3), `callButton`, `muteVisible`, `permitProblem`, `sessionUpdate`, `replyCreate`. Extra witnesses beyond the list: the happy voice path, barge-in before first audio sends `cancelled`, transcription failure, Permit kind/purpose mismatch, lower Deck ignored, open timeout (R16.6), CONFIGURING ack timeout (R13.9) and the `session.update` shape (R13.1), fastO ack age (KV13), mute touches only the mic, the recall tool round trip and a stale tool result, hang-up order (R14.1), state refresh retries (R13.8), connection-loss reconnects (R15.8).
  - Choices: a voice Turn whose `item.added` never came still gets a commitSeq at post time (next numbers in commit order), because `TurnRequest.items[].commitSeq` is required; its `final` is false. A Turn whose transcripts are all empty posts nothing. A `turnFailed` after the client's own retries leaves the Session's clientSeq unknown, so the machine reconnects (new Session). A Turn held past `t_end + 2.5 s` with no Permit shows RECOVERY for 1.5 s with nothing to play, then listens. A recovery reply's `response.create` uses `tools:[]` and an instruction to say only the neutral line (contracts §6 Tools "recovery tools=[]"). Output is unmuted only in SPEAKING, so the neutral line plays through SPEAKING. Realtime metadata values are strings (`generation:"1"`). A `response.created` for another Turn or generation is cancelled by ID and changes no state.
  - Witness: `packages/core/src/voice/machine.test.ts` › barge-in mutes before anything else; 600 ms → HELD; any item missing a transcript at t_end+1.5 s → RECOVERY with `recoveryOnly`; higher stamp cancels and clears; wrong generation dropped; Permit mismatch plays nothing; CONNECTING timer starts at the open response; expired Deck builds no reply
  - Commit: `feat(core): voice state machine`

- [x] 30. SDP proxy and receipts
  - Requirements: R12.1–R12.10, R21.1–R21.8; contract questions 18, 19
  - Depends on: 18, 20
  - Estimate: 3 h · Actual: 0.6 h
  - Done: `routes/sdp.ts` and `routes/receipt.ts` with adapters `apps/web/src/app/api/session/sdp/route.ts` and `apps/web/src/app/api/receipt/route.ts`. `openai/realtime-calls.ts` gains `callSession` (`{type:"realtime", model, tracing:null, audio.output.voice:"cedar"}`), `createCall` and `callIdFromLocation`; `openai/live.ts` implements `realtime.calls.create` with the installed SDK's multipart `realtime.calls.create({sdp, session})`, returning the SDP body and the `Location` header. SDP: checks (PARSE, SCOPE, STALE, LIMIT 409 at 4 call IDs) run before any OpenAI call; OpenAI gets 3.5 s of the 5 s limit; one transaction stores `callId`, appends to `registeredCallIds`, pushes `expiresAt` and records the request, and only then is the answer returned. A call created after the limit is hung up when its answer arrives. Receipts: the Stamp's Session must be this Owner's (SCOPE) and its five values current (else `accepted:false`, nothing written); a transcript writes the assistant Turn (`H("aturn", sessionId, responseId)`, `seq = nextClientSeq - 1`, `sourceClass:"M"`) and Evidence (`authorship:"unknown"`, `authorId:null`, one class-M Slice) in one transaction with no Extract_Job; a repeat for the same `responseId` writes nothing. Every accepted receipt pushes the live Session's idle expiry. Extra witnesses: SDP replay, PARSE cases, OpenAI error, missing Location, `callIdFromLocation` cases; receipt PARSE/SCOPE cases, playback kinds, idle expiry.
  - **Deviation (R12.4, contract question 32):** when the call ID write fails, the route hangs the call up at once and, if that fails, keeps retrying through `schedule` (1, 2, 5, 10 s, then every 60 s, for up to 10 minutes, then logs `sdp.orphanCall` with the call ID only). It writes no `hangup` Job, because the closed Job schema has no field that can hold a raw Realtime call ID (Job IDs, `sourceIds`, `targets` and `inputRevs` are 43-character IDs) and the existing Session `hangup` Job reads `registeredCallIds`, which by definition lacks this call. The background retry does not survive a process restart.
  - Not verified here: the live `realtime.calls.create` request and its `Location` header against OpenAI. Web access was not permitted in this run, so the shape follows contracts §6 and the installed `openai` 7.45.1 SDK types; task 35's live check is the first real call.
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
