# Requirements Document

## Introduction

This spec covers Brief 001, the first spoken call (`docs/briefs/001-first-spoken-call.md`). The owner signs in on localhost, presses one button, talks to Franki out loud, says something about their life, hangs up, calls again, and hears Franki use what was said. A plain debug panel shows exactly what was stored and where it came from.

Scope is build-plan tasks F0 (contracts, ports, Kiro setup) and F1 (auth, voice client, stand-in avatar), plus just enough of F3 (voice writes) and F5 (recall and readout) to test memory (`docs/design/memory-spec-v3.md` §14). This is a real foundation, not a throwaway demo. Behavior comes from `docs/design/memory-spec-v3.md`. Records, prompts, wire types and routes come from `docs/design/memory-contracts-v2.md`, cited below as "contracts §N". Contract row IDs (KC, KV, KS, KJ in contracts §10) and query IDs (Q01–Q35 in contracts §9) are cited on each requirement where they apply.

### In scope

1. Kiro setup: steering, a `Date.now()` guard hook, and a save hook for in-memory invariants.
2. Typed records and closed schemas for `evidence`, `memories`, `sessions`, `turns`, `core`, plus `Head`, `Deck`, `Stamp`, `StateAck`, `TurnRequest` and `TurnResponse`.
3. A clock port and a store port, with an in-memory store and a Firestore store, the indexes this slice needs, and deny-all client rules.
4. Sign-in and Firebase ID token checks on every route, with every record scoped to the signed-in user.
5. Voice over WebRTC to the configured Realtime model through the server SDP proxy, with session open, SDP, state and close routes, barge-in, mute and a stand-in avatar.
6. Typed input through the same `/api/turn` path.
7. Memory writes: serialized transcripts, whole-turn evidence, and `ExtractV1` memories with span lineage under Authority and Policy.
8. Memory reads: a Head compiled by pure code at session open, and a single-read `recall` tool.
9. A debug panel backed by the development-only route `GET /api/debug/memory`. The contract's `GET /api/memory` views are not built in this slice.

### Out of scope

The judge and slow gate (F2), corrections and bitemporal repair beyond what the schema needs (F3), forget (F4), time and moments (F6), food and the hero (F7), seed and reset (F8), the Gate and whispers (F11), Rive, Gmail, Calendar and Plaid. Records and fields that only those features use are not built here, except where a schema in scope requires the field to exist.

### Never stubbed

The clock port, a source on every field, lineage from each memory back to its evidence, and transcript order. These cannot be retrofitted.

## Glossary

- **Franki**: The whole product: browser client, server and background work, as one system.
- **Web_App**: The Next.js 16 application in `apps/web`, including its route handlers.
- **Browser_Client**: The code that runs in the owner's browser: sign-in, call button, voice client, typed input, stand-in avatar and debug panel.
- **Voice_Client**: The part of the Browser_Client that owns the `RTCPeerConnection`, the `oai-events` data channel, the microphone track and the output `audioElement` (contracts §6 Realtime).
- **Stand_In_Avatar**: A simple visual placeholder for Franki that shows call state. Not Rive.
- **Core_Library**: The pure TypeScript package `packages/core`. Holds types, schemas, validators and pure functions, with no I/O.
- **Server_Library**: The server-only package `packages/server`. Holds Firestore, OpenAI and route logic independent of the web framework.
- **Route_Guard**: The server code that authenticates and authorizes every API request before route logic runs.
- **Owner**: The signed-in Firebase user. Each Owner is one tenant, identified by `uid`.
- **Tenant_Root**: The Firestore path `users/{uid}` under which all of one Owner's records live (contracts §9).
- **Clock_Port**: The injected interface that supplies `ClockPair` (`worldClock` and `opsClock`, contracts §1 Clocks). The only code allowed to read wall-clock time.
- **Store_Port**: The injected interface for reading and writing records, with transactions and compare-and-set.
- **Memory_Store**: The in-memory implementation of the Store_Port, used by tests.
- **Firestore_Store**: The Firestore Admin SDK implementation of the Store_Port, used at runtime.
- **Record**: A stored row of one of the in-scope types: Evidence, Memory, Session, Turn, Core document, Job or Ledger entry, as defined in contracts §1.
- **Common_Fields**: The `C` field set every tenant record carries (contracts §1): `v`, `uid`, `rev`, `createdAt`, `updatedAt`, `epoch`, `policyRev`, `rootKeys`, `rootSlices`, `contextIds`, `packetEids`, `dependsOn`, `dirty`, `dependenciesComplete`.
- **Evidence**: An immutable source record (`evidence/{eid}`, contracts §1). In this slice, one whole user turn or one assistant transcript.
- **Memory**: One belief record (`memories/{mid}`, contracts §1) that points back at Evidence spans.
- **Span**: `{eid, fieldPath, start, end, quote}` with LF-normalized UTF-16 offsets, `[start, end)` (contracts §1).
- **Slice**: `{eid, fieldPath, start, end, contentHash, class, sens}` describing one classified field range of Evidence (contracts §1).
- **Source_Class**: The per-field authority class U, C, O, T or M (contracts §2).
- **Sensitivity**: The level S0, S1 or S2 (contracts §2).
- **Lineage**: The chain from a Memory through its `rootSlices`, `rootKeys`, `dependsOn` and Spans to Evidence fields whose quoted text matches (KC03, W-LINEAGE).
- **Session**: A call record (`sessions/{sessionId}`, contracts §1) with its registered Realtime call IDs.
- **Turn**: A record in `sessions/{sessionId}/turns/{turnId}` for one user or assistant utterance, ordered by `seq`.
- **Client_Seq**: The positive integer the Browser_Client assigns to each user turn request; the server serializes turns by it (KV12).
- **SDP_Proxy**: The `/api/session/sdp` route that forwards the browser's SDP offer to OpenAI `/v1/realtime/calls` and stores the call ID before returning the answer (contracts §6 Realtime).
- **Realtime_Model**: The OpenAI Realtime model whose ID comes from the `FRANKI_VOICE_MODEL` config variable (currently `gpt-realtime-2.1`).
- **Model_Config**: The environment variables that name OpenAI model IDs (`FRANKI_VOICE_MODEL`, `FRANKI_BRAIN_MODEL`, `FRANKI_ESCALATE_MODEL`, `FRANKI_BG_MODEL`, `FRANKI_EMBED_MODEL`) as listed in `apps/web/apphosting.yaml`, plus a transcription model variable added by this spec.
- **Head**: The compiled instructions for a reply (contracts §6 `Head`), with ten named sections and a token cap of 3500.
- **Head_Compiler**: The pure function `compileHead` in the Core_Library (contracts §7).
- **Deck**: What the browser holds to build a reply (contracts §6 `Deck`).
- **Stamp**: The session stamp `SS` plus `turnId` (contracts §6).
- **StateAck**: A server-issued acknowledgment of the current four revisions with an ops-clock expiry (contracts §6).
- **TurnRequest** / **TurnResponse**: The closed wire types for `/api/turn` (contracts §6).
- **Permit**: The record that lets audio play, bound to one Stamp, generation and payload hash (contracts §6 `Permit`).
- **Admission_Seam**: The single server function through which every reply obtains a Permit.
- **Dev_Admit**: The explicit development implementation of the Admission_Seam, named `devAdmit`, that F2 replaces.
- **Extractor**: The background worker that runs the `ExtractV1` contract (contracts §5) on one user turn and commits Memories.
- **Extract_Job**: A `jobs/{jobId}` record of task `extract` (contracts §1 jobs).
- **Fake_OpenAI**: A test double that returns scripted Responses and Realtime results without network calls or cost.
- **Recall_Tool**: The `recall` tool exposed to the Realtime_Model, answered by one tool-less `RecallAllV1` read (contracts §5, §6 Tools; F5 floor).
- **Spoken_Grade**: The pure test of whether a row may cross to the browser (contracts §4 `spokenGrade`, §2; memory-spec §3).
- **Debug_Panel**: The plain Browser_Client view backed by `GET /api/debug/memory` that shows turns, evidence, memories, lineage, extract jobs, admission entries and the compiled Head.
- **Debug_Route**: The development-only route `GET /api/debug/memory`, authenticated like every other route, which refuses every request while `NODE_ENV` is `production`. It is separate from the contract's `GET /api/memory`, whose views this slice does not build.
- **Parse committed**: In this slice, the moment the transaction that writes a user Turn and its Evidence has committed. `TurnIntents` is out of scope, so no other parse exists yet.
- **Kiro_Workspace**: The `.kiro/` directory: steering, hooks and specs.
- **Guard_Hook**: A Kiro hook that blocks writes adding `Date.now()` outside the Clock_Port.
- **Save_Hook**: A Kiro hook that runs the fast in-memory invariant tests when a source file is saved.
- **Test_Suite**: The Vitest 5 and fast-check tests run by `npm test`.
- **CI**: The GitHub Actions workflow in `.github/workflows/ci.yml`.

## Requirements

### Requirement 1: Kiro steering

**User Story:** As the owner, I want steering documents generated from the repo, so that every Kiro session builds Franki with the same product, stack, layout and memory rules.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain exactly four steering files in `.kiro/steering/`, named `product.md`, `tech.md`, `structure.md` and `memory-rules.md`, each with front matter that sets `inclusion: always` so that Kiro loads all four into every session.
2. THE product steering file SHALL state Franki's purpose as a voice-first life assistant with a memory system, list each of the five jobs by the name used in `docs/design/memory-spec-v3.md` §1, and state the demo goal from `docs/briefs/001-first-spoken-call.md` (sign in, call, say something about your life, hang up, call again, hear Franki use it, see the stored records in the Debug_Panel), citing both files by path.
3. THE tech steering file SHALL state the pinned stack using the exact version strings from `docs/design/architecture-decision.md` and `.nvmrc`: Next.js 16.4.3 (fallback 15.5.28, never 15.2.x), Node 24, TypeScript 6.0.3, Vitest 5 with fast-check, ESLint 10, and npm workspaces with Turborepo.
4. THE tech steering file SHALL state that Server Actions, `use cache`, `next/og` and ISR are banned, and SHALL repeat the instruction in `apps/web/AGENTS.md` to read the guide in `node_modules/next/dist/docs/` before writing any route or other Next.js code.
5. THE structure steering file SHALL state the package boundaries: pure code with no I/O and no wall-clock reads in `packages/core`, server I/O (Firestore, OpenAI, route logic) in `packages/server`, thin route adapters in `apps/web`, and background jobs in `functions`, and SHALL state that `packages/core` must not import from `packages/server`, `apps/web` or `functions`.
6. THE memory rules steering file SHALL state the never-stub list (Clock_Port, a source on every field, Lineage, transcript order), the rule that models never set dates, trust levels or permissions, the Admission_Seam rule that every reply obtains its Permit through one function and that Dev_Admit refuses to run when `NODE_ENV` is `production`, and the rule that model IDs come from Model_Config and never from code.
7. THE memory rules steering file SHALL state that `docs/design/` is read-only for build work and that any conflict between contracts goes under a "Contract questions" heading in the spec's design document, with a proposed resolution.
8. THE steering files SHALL cite contract row IDs (for example KC03 for Lineage and KV12 for Client_Seq ordering) wherever a rule restates a row from contracts §10, so that a reader can trace each rule to its source.
9. THE steering files SHALL contain no secret values, API keys, tokens or contents of any `.env` file, and SHALL refer to secrets only by variable name (for example `OPENAI_API_KEY`).
10. IF a version, ban or rule stated in a steering file differs from the corresponding statement in the cited source file, THEN THE Kiro_Workspace SHALL be treated as failing this requirement until the steering file is corrected to match the source.

### Requirement 2: Clock guard hook

**User Story:** As the owner, I want a hook that blocks direct wall-clock reads, so that every time-dependent path stays testable through the Clock_Port.

#### Acceptance Criteria

1. THE Guard_Hook and the static check in criterion 7 SHALL read one shared allow-list of Clock_Port implementation files, and that allow-list SHALL contain at least one file and at most 5 files.
2. WHEN an agent file write (file create, full overwrite, string-replace edit or append) contains the text `Date.now(` in the new content it supplies, and the target path is not in the Clock_Port allow-list, THE Guard_Hook SHALL block the write by exiting with code 2 and SHALL report the target file path and the allow-listed Clock_Port file paths.
3. WHEN an agent file write contains `Date.now(` in its new content and the target path is in the Clock_Port allow-list, THE Guard_Hook SHALL allow the write by exiting with code 0.
4. WHEN an agent file write contains no `Date.now(` text in its new content, THE Guard_Hook SHALL allow the write by exiting with code 0. The hook decides from the tool input alone and does not open the target file or any `.env` or secret file.
5. THE Guard_Hook SHALL be stored as a JSON hook file in `.kiro/hooks/` with a PreToolUse trigger whose matcher regex matches the agent's file-write tool names.
6. IF the Guard_Hook cannot parse its stdin JSON or cannot find a target file path in the tool input, THEN THE Guard_Hook SHALL block the write by exiting with code 2 and SHALL report that the write could not be checked.
7. THE Test_Suite SHALL include a static check that scans every `.ts`, `.tsx`, `.js`, `.mjs` and `.cjs` file under `packages/core`, `packages/server`, `apps/web/src` and `functions/src`, including test files. It SHALL skip `node_modules`, `dist`, `.next` and the Clock_Port allow-list. The check SHALL fail when any scanned file contains `Date.now(` or `new Date()` with no arguments, including inside comments and strings.
8. IF the static check finds one or more violations, THEN THE Test_Suite SHALL report each violation's file path and line number and SHALL exit with a failing status.
9. WHEN the static check finds zero violations, THE Test_Suite SHALL record the check as passed.

### Requirement 3: Invariant save hook

**User Story:** As the owner, I want fast invariants to run on every save, so that a broken lineage or schema rule shows up while I'm still editing.

#### Acceptance Criteria

1. WHEN a file ending in `.ts` or `.tsx` under `packages/` or `apps/web/src` is saved, and its path is not inside a `node_modules`, `.next` or `dist` directory, THE Save_Hook SHALL run the fast in-memory invariant test command once, in single-run mode with no watch.
2. THE fast in-memory invariant tests SHALL include at least the Lineage property (KC03, W-LINEAGE) and the closed-schema checks (KC01, KC02).
3. THE fast in-memory invariant tests SHALL run against the Memory_Store and Fake_OpenAI only, with no network access, and SHALL NOT read any `.env` file or secret.
4. THE Save_Hook SHALL be stored as a JSON hook file in `.kiro/hooks/` that uses a PostFileSave trigger with a file-path matcher covering the paths in criterion 1, and a command action that runs a script defined in the root `package.json`.
5. THE fast in-memory invariant test command SHALL finish, measured as wall-clock time from start to process exit, within 30 seconds on the owner's machine while running 1,000 fast-check runs per lineage property.
6. IF any fast in-memory invariant test fails, THEN THE Save_Hook SHALL show the failing test name and, for property tests, the fast-check counterexample in the hook output, SHALL exit with a non-zero status, and SHALL leave all source files unchanged.
7. THE Test_Suite run by `npm test` SHALL include every fast in-memory invariant test, so that CI runs the same checks as the Save_Hook.

### Requirement 4: Closed record schemas (KC01, KC02)

**User Story:** As a developer, I want typed records and closed schemas for everything this slice stores, so that no record can carry an unknown field or exceed its bounds.

#### Acceptance Criteria

1. THE Core_Library SHALL define TypeScript types and runtime validators for Evidence, Memory, Session, Turn, the `core/epoch`, `core/state`, `core/counters`, `core/rules` and `core/bundle` documents, Job and Ledger entries, with the fields, unions and bounds given in contracts §1, and every tenant Record type SHALL include the Common_Fields (KC01).
2. THE Core_Library SHALL define TypeScript types and runtime validators for Head, Deck, Stamp, SS, StateAck, Permit, TurnRequest, TurnResponse, W, SafeTurn, Card, InspectItem and the request and response bodies of every route used in this slice, with the fields, unions and bounds given in contracts §6 (KC01).
3. IF a validator receives an object containing a key not named in its schema, at the top level or in any nested object, THEN THE validator SHALL return a failure result with error `invalidInput` and the path of the unknown key, without throwing and without modifying the input.
4. IF a validator receives a string longer than its `sN` bound in UTF-16 code units, an array with fewer elements than its lower bound or more than its `A<T,n>` or `[a..b]` upper bound, a number that is NaN or ±Infinity, a value of `i` that is negative or above 9,007,199,254,740,991, a value of `Signed` outside -9,007,199,254,740,991 to 9,007,199,254,740,991, a value of `int[a,b]` outside `a` to `b` inclusive, a union or enum value not listed in the contract, or a value of the wrong type, THEN THE validator SHALL return a failure result with error `invalidInput` and the path of the first offending field.
5. IF a validator receives an object in which a key typed `T?` is absent or set to `undefined`, or a non-nullable key is absent or set to `null`, THEN THE validator SHALL return a failure result with error `invalidInput` and the path of that key (contracts §1 "T?=T|null required").
6. WHEN a write is submitted to either the Memory_Store or the Firestore_Store, THE Store_Port SHALL validate every Record in the write against its schema before the write commits, and IF any Record fails validation, THEN THE Store_Port SHALL abort the whole transaction with error `invalidInput` and leave every Record in the store unchanged.
7. IF a serialized Record exceeds 524,288 bytes (512 KiB), THEN THE Store_Port SHALL reject the write with error `oversize` and leave every Record in the store unchanged, even when every field is within its own bound, while a Record of exactly 524,288 bytes or less that passes validation SHALL be accepted (contracts §1 Cap512KiB).
8. THE Core_Library SHALL represent every Record field that the in-scope features do not yet use with its contract type, holding `null` for `T?` fields and an empty array for `A<T,n>` fields, so that the validators accept Records written by this slice without a schema migration when later features start using those fields.
9. WHEN Evidence content changes, THE Store_Port SHALL write a new Evidence record with the same `logicalId`, a new `eid` derived from `logicalId` and the new version (contracts §1 "Evidence ID=H(logicalId,version)"), and `revisionOf` set to the prior `eid`, and every field of the prior Evidence SHALL read back unchanged afterwards (KC02).
10. WHEN a Memory value or args change, THE Server_Library SHALL write a new Memory record carrying the new value or args, and SHALL limit the in-place update of the prior Memory to `status`, `validTo`, `updatedAt` and `rev`, with `rev` increased by exactly 1 (contracts §1 "Value/args immutable,status/validTo/rev mutable").
11. WHEN a validator receives an object that satisfies every field, union and bound of its schema, THE validator SHALL return a success result containing the typed object with no keys added, removed or altered.
12. IF a write would change, in place, any content field of an existing Evidence record (`body`, `bodyOwn`, `bodyQuoted`, `subject`, `title`, `description`, `text`, `sender`, `recipient`, `observation` or `fieldSlices`), THEN THE Store_Port SHALL reject the write with error `invalidInput` and leave the existing Evidence unchanged (KC02).
13. IF a write would change, in place, the `value` or `args` of an existing Memory record, THEN THE Store_Port SHALL reject the write with error `invalidInput` and leave the existing Memory unchanged.

### Requirement 5: Package boundaries

**User Story:** As a developer, I want pure logic separated from I/O, so that properties can run fast in memory and the brain can later move hosts without a rewrite.

#### Acceptance Criteria

1. THE Core_Library SHALL contain only types, schemas, validators and pure functions. No Core_Library source file SHALL import any of the following, written either as a bare name or with the `node:` prefix: `firebase`, `firebase-admin` or any of their subpaths, `@google-cloud/*`, `openai`, `@openai/*`, `next` or any `next/*` subpath, the Server_Library, the Web_App, or the Node modules `fs`, `fs/promises`, `net`, `http`, `https`, `http2`, `tls`, `dns`, `dgram`, `child_process`, `cluster`, `worker_threads`, `process` and `os`.
2. THE Core_Library SHALL obtain time only from a `ClockPair` value passed in by the caller, and SHALL contain no calls to `Date.now()`, `new Date()` without arguments, or `performance.now()`.
3. THE Server_Library SHALL contain all Firestore, OpenAI and route logic. No Server_Library source file SHALL import `next`, any `next/*` subpath, or the Web_App.
4. WHEN a Web_App route handler receives a request, THE Web_App route handler SHALL parse the request, call the Route_Guard, call exactly one Server_Library function, and return that function's result. The route handler SHALL import nothing from `firebase-admin`, `openai` or `@openai/*` directly.
5. IF the Route_Guard rejects a request, THEN THE Web_App route handler SHALL return the Route_Guard's rejection without calling any Server_Library route function.
6. THE Browser_Client SHALL NOT import the Server_Library, `firebase-admin` or `openai` in any module that is bundled for the browser.
7. THE Test_Suite SHALL include an import-boundary check that reads every non-test `.ts` and `.tsx` source file in the Core_Library, the Server_Library and the Browser_Client. The check SHALL inspect static `import` statements, `export ... from` statements, dynamic `import()` calls and `require()` calls.
8. IF the import-boundary check finds a specifier that criterion 1, 3 or 6 forbids, or a call that criterion 2 forbids, THEN THE Test_Suite SHALL fail and report the file path and the offending specifier or call. Because `npm test` runs in CI, the same failure SHALL also fail the CI run.

### Requirement 6: Clock port (never stubbed)

**User Story:** As a developer, I want all time to come from one injected port, so that tests control time and world time can later jump without touching ops deadlines.

#### Acceptance Criteria

1. THE Clock_Port SHALL supply a `ClockPair` with `worldClock {now, zone}` and `opsClock {now}` (contracts §1 Clocks), where `now` is an instant at millisecond precision that serializes to an RFC3339 UTC timestamp on the wire (contracts §6) and `zone` is the IANA zone name held in `core/state.currentZone`.
2. WHILE `core/state.clockMode` is `live`, THE Clock_Port SHALL derive `worldClock.now` and `opsClock.now` from one wall-clock read, so that both fields of every returned `ClockPair` hold the identical millisecond instant (contracts §1 Clocks: live world=ops).
3. WHEN the Server_Library handles a request or runs a job step, THE Server_Library SHALL take every timestamp it writes or compares from a `ClockPair` obtained from the Clock_Port passed to it, so that a test using the fake Clock_Port held at instant T observes T in every timestamp field written by that step.
4. THE Server_Library SHALL take `opsClock.now` for every field on the opsClock allowlist in contracts §1 that this slice writes or compares: Common_Fields `createdAt` and `updatedAt`, the direct timestamp fields of Session, Turn and Job, Evidence `receivedAt` and `transcriptDeadline`, `core/bundle` `compiledAt` and `expiresAt`, ledger `at`, `core/state.lastInteractionAt`, and Permit, Deck and StateAck expiry and wait deadlines.
5. THE Test_Suite SHALL provide a fake Clock_Port that starts at a world instant, an ops instant and a zone given by the test, returns the same values on every read until the test changes them, advances `opsClock.now` only through an explicit advance call with a non-negative millisecond amount, and lets the test set `worldClock.now` separately from `opsClock.now`.
6. THE Server_Library SHALL take `worldClock.now` and `worldClock.zone` for all semantic, source and assertion dates, including Evidence `occurredAt` and `assertedAt`, Memory validity fields and nested `Time` values, and a nested field SHALL keep the clock domain of this rule (contracts §1 Clocks: nesting never changes domain).
7. IF `core/state.clockMode` holds any value other than `live` when the Server_Library obtains a `ClockPair`, THEN THE Server_Library SHALL reject the operation with a KernelError `unsupported` indicating that fixture clock mode is not available in this slice (fixture mode belongs to F6/F8), and SHALL write no Records for that operation.

### Requirement 7: Store port and implementations

**User Story:** As a developer, I want one store interface with an in-memory and a Firestore implementation, so that properties run in memory and production runs on Firestore with the same semantics.

#### Acceptance Criteria

1. THE Store_Port SHALL provide reads, queries and transactions that each take one Owner `uid` and touch only Records under that Owner's Tenant_Root, with compare-and-set on each Record's `rev`.
2. THE Memory_Store and the Firestore_Store SHALL implement the same Store_Port interface, so that the conformance suite in criterion 3 compiles against either one without changes.
3. THE Test_Suite SHALL run one shared Store_Port conformance suite against the Memory_Store on every `npm test` run, and CI SHALL run the same suite against the Firestore_Store on the Firestore emulator. A local run that has no emulator skips only the Firestore_Store run.
4. IF a transaction's compare-and-set expectation does not match the stored `rev` of any Record it reads or writes, THEN THE Store_Port SHALL abort the whole transaction with KernelError `staleRevision` and write nothing, so that every Record in the transaction keeps its prior `rev` and contents.
5. WHEN a transaction commits, THE Store_Port SHALL apply all of its writes atomically and SHALL set each written Record's `rev` to exactly its prior `rev` plus 1.
6. THE Firestore_Store SHALL store each Owner's records under the Tenant_Root `users/{uid}` using the collection names in contracts §1.
7. THE Firestore_Store SHALL use the Firebase Admin SDK.
8. THE repository `firestore.indexes.json` SHALL declare exactly the composite indexes that this slice's queries need, each labeled in the design with its contracts §9 query ID. This includes Q03 (memories: `key` ASC, `status` ASC, `validFromKey` DESC). It SHALL declare no composite index for Q14 (turns by `seq` ASC, single-field) or Q28 (paged tenant reads by `__name__` ASC, built-in), and no index that the slice does not use (KS08).
9. THE Memory_Store SHALL return, for the same query shape and data, the same rows in the same order as the Firestore_Store. This covers equality and range filters, sort direction, exclusive cursors (Q14 `seq > cursor`, Q28 `__name__ > cursor`) and the contracts §9 page limits (Q03 at most 32 rows; Q14 and Q28 at most 100 rows).
10. IF a read, query or transaction names a Record path outside the Tenant_Root of the `uid` it was called with, THEN THE Store_Port SHALL reject the call with an error indicating a tenant mismatch, return no rows and write nothing.

### Requirement 8: Firestore client rules stay deny-all

**User Story:** As the owner, I want browsers to have no direct database access, so that every read and write passes the server's checks.

#### Acceptance Criteria

1. THE repository `firestore.rules` SHALL contain exactly one allow statement, matching the recursive path `/{document=**}` with the condition `if false` for both read and write, and SHALL contain no other allow statements.
2. WHEN the Firestore rules tests run, THE Firestore rules tests SHALL load the repository `firestore.rules` file itself into the Firestore emulator, not an inline or copied rule set.
3. WHEN the Firestore rules tests run, THE Firestore rules tests SHALL assert that a client authenticated as Owner `uid` A is denied each of get, list, create, update and delete on a document under its own Tenant_Root `users/A` in each in-scope collection (`evidence`, `memories`, `sessions`, `sessions/{sessionId}/turns`, `core`, `jobs`, `ledger`) and on the Tenant_Root document itself.
4. WHEN the Firestore rules tests run, THE Firestore rules tests SHALL assert that a client authenticated as Owner `uid` A is denied each of get, list, create, update and delete on the same paths under another Owner's Tenant_Root `users/B`.
5. WHEN the Firestore rules tests run, THE Firestore rules tests SHALL assert that an unauthenticated client is denied each of get, list, create, update and delete on a document under a Tenant_Root and on a document at a top-level path outside any Tenant_Root.
6. WHEN a commit is pushed to `main` or a pull request is opened or updated, THE CI SHALL run the Firestore rules tests through `npm run test:emulator` against the Firestore emulator with the `demo-franki` project ID, and THE CI run SHALL fail if any rules test fails or the emulator does not start.
7. WHEN `npm test` runs on a machine without Java installed, THE Test_Suite SHALL exclude the emulator-backed rules tests and SHALL exit with code 0 provided every non-emulator test passes.
8. IF a Firestore rules test finds that any client read or write is allowed, THEN THE Firestore rules tests SHALL fail and report the operation, the path and the authentication state (unauthenticated, own `uid`, other `uid`) that was allowed.

### Requirement 9: Sign-in

**User Story:** As the owner, I want the simplest sign-in that works on localhost and on the deployed app, so that I can test with my own account in both places.

#### Acceptance Criteria

1. THE Browser_Client SHALL offer exactly one Firebase Authentication sign-in method, Google sign-in, which is enabled on the `frankirocks` project (checked by the owner on Nov 3, 2026), and SHALL offer no sign-in method that requires enabling another provider. `localhost` is an authorized domain on that project (added Nov 3, 2026).
2. WHEN the Owner completes Google sign-in on `http://localhost:3000` or on `https://franki-web--frankirocks.us-central1.hosted.app`, THE Browser_Client SHALL show the signed-in Owner's email address and enable the call button, typed input and Debug_Panel within 5 seconds of the provider returning.
3. WHERE the sign-in flow needs a Firebase or Google Cloud setting changed on either origin, THE design SHALL list each change as an owner action with the console location, the setting name and the exact value. The one remaining change is adding `franki-web--frankirocks.us-central1.hosted.app` to the Firebase Authentication authorized domains, needed only to test the deployed app (where `devAdmit` refuses replies until F2). The build SHALL make none of these changes itself.
4. WHILE no Owner is signed in, THE Browser_Client SHALL show the sign-in control, SHALL disable the call button and typed input, SHALL hide the Debug_Panel, and SHALL send no request to any `/api/` route except `/api/health`.
5. WHEN the Owner signs out, THE Browser_Client SHALL send `/api/session/close` for any open Session and wait up to 5 seconds for the response before it clears the Firebase user and returns to the signed-out state in criterion 4.
6. IF the sign-in popup is closed by the Owner, is blocked by the browser, or the provider returns an error (including an unauthorized-domain error), THEN THE Browser_Client SHALL stay in the signed-out state, show an error message naming which of those three causes occurred, and keep the sign-in control enabled for another attempt.
7. WHEN the Browser_Client page is reloaded while a Firebase user session persists in the browser, THE Browser_Client SHALL restore the signed-in state without a new sign-in prompt, and SHALL show the sign-in control and the disabled controls of criterion 4 until Firebase reports whether a user exists.
8. IF `/api/session/close` fails or does not respond within 5 seconds during sign-out, THEN THE Browser_Client SHALL stop the microphone track and the `RTCPeerConnection` locally, clear the Firebase user, and complete sign-out without blocking the Owner.

### Requirement 10: Route authentication, tenancy and idempotency (KV10)

**User Story:** As the owner, I want every route to check who I am and to touch only my data, so that no request can read or write another user's records.

#### Acceptance Criteria

1. WHEN any `/api/session/*`, `/api/turn`, `/api/receipt`, `/api/tool` or `/api/debug/memory` request arrives, THE Route_Guard SHALL verify the Firebase ID token from the `Authorization: Bearer` header with the Admin SDK, including a revocation check, before any route logic or Store_Port read or write runs (KV10).
2. IF the `Authorization` header is absent, does not use the `Bearer` scheme, or carries an ID token that is invalid, expired or revoked, THEN THE Route_Guard SHALL return HTTP 401 with the contracts §6 Error body `{error:"AUTH", retryAfterMs:0}`, run no route logic, and leave every Record unchanged.
3. WHEN a request with any HTTP method other than GET arrives at a route listed in criterion 1, THE Route_Guard SHALL check that the `Origin` header is present and exactly matches one of the configured allowed origins, and that the CSRF check passes, before route logic runs (architecture decision, API surface).
4. IF the `Origin` header is absent, the `Origin` header matches no configured allowed origin, or the CSRF check fails on a request covered by criterion 3, THEN THE Route_Guard SHALL return HTTP 403 with `{error:"AUTH", retryAfterMs:0}`, run no route logic, and leave every Record unchanged.
5. THE Route_Guard SHALL pass only the verified token's `uid` to the Server_Library as the tenant, and THE Server_Library SHALL ignore any `uid` field supplied in a request body, query string or header other than the ID token.
6. THE Server_Library SHALL read and write only paths under the Tenant_Root `users/{uid}` of the authenticated `uid`, so that a request authenticated as Owner A returns no Record stored under Owner B's Tenant_Root and changes no Record there.
7. IF a request body exceeds 131,072 bytes (128 KiB), or a `/api/session/sdp` request body exceeds 262,144 bytes (256 KiB), THEN THE Route_Guard SHALL return `{error:"LIMIT", retryAfterMs:0}`, run no route logic, and leave every Record unchanged (contracts §6 Routes).
8. WHEN a mutation request (any non-GET request to a route in criterion 1 except `/api/session/state`, which keeps no request ledger) arrives with a `requestId` already recorded within the last 24 hours for the same `(uid, route, requestId)` and the same request hash, THE Server_Library SHALL return the recorded response and SHALL create, change or delete no Record and make no OpenAI call (contracts §6 Routes, ledger `request`).
9. IF a mutation request arrives with a `(uid, route, requestId)` recorded within the last 24 hours and a request hash different from the recorded one, THEN THE Server_Library SHALL return HTTP 409 with an Error body, create, change or delete no Record, and leave the recorded response unchanged.
10. THE `/api/health` route SHALL keep its current behavior and authentication (`SMOKE_TOKEN` for POST).
11. IF a mutation request arrives with the same `(uid, route, requestId)` and request hash as a request whose 15-second processing lease is still held, THEN THE Server_Library SHALL return an Error body with `retryAfterMs` between 1 and 5000, create, change or delete no Record, and make no OpenAI call (contracts §6 Routes, lease 15 s).
12. IF a mutation request arrives with a `(uid, route, requestId)` whose recorded entry is more than 24 hours old, THEN THE Server_Library SHALL process the request as new and record its response under that key (contracts §6 Routes, TTL 24 h).
13. WHEN the first authenticated route for an Owner runs (any route in criterion 1 other than the read-only `GET /api/debug/memory`), THE Server_Library SHALL create `core/epoch`, `core/state`, `core/counters`, `core/rules` and `core/bundle` under that Owner's Tenant_Root in one transaction, before any other route logic, with the safe initial values listed in the design and `core/state.clockMode:"live"`. The creation SHALL be idempotent: IF `core/epoch` already exists, THEN THE Server_Library SHALL write nothing, and two concurrent first requests SHALL leave exactly one set of core documents.

### Requirement 11: Session open (KV09)

**User Story:** As the owner, I want one button to start a call, so that Franki is ready to listen with what it already knows.

#### Acceptance Criteria

1. WHEN the Owner presses the call button, THE Browser_Client SHALL send exactly one `POST /api/session/open` with the `{requestId, initiator:"user", previousSessionId, clientZone, visitId}` body from contracts §6. In that body, `requestId` is a new ID for each press, `previousSessionId` is the ID of the Owner's most recent Session or null if there is none, `clientZone` is the browser's IANA time zone, and `visitId` is null. The Browser_Client SHALL keep the call button disabled until the response arrives or 5 seconds pass.
2. WHEN `/api/session/open` succeeds, THE Server_Library SHALL create a Session under the Owner's Tenant_Root in status `minting` with `generation` 1, and SHALL set `core/epoch.activeSessionId` to the new `sessionId` in the same transaction. It SHALL return `{sessionId, generation:1, deck, state:"connecting", ack}` with non-null `deck` and `ack` within 5 seconds of receiving the request, measured on `opsClock` (contracts §6 Routes).
3. WHEN a Session opens while another Session of the same Owner is `minting`, `active` or `closing`, THE Server_Library SHALL request a hangup for every registered call ID of the prior Session and mark that Session `closed` before returning the new Session. If a hangup request fails, the Server_Library SHALL record it for durable retry and still mark the prior Session `closed` (KV09; contracts §6 close durable hangup retry).
4. WHEN a Session opens, THE Server_Library SHALL compile the Head with the Head_Compiler from the Owner's Memories that pass eligibility and Spoken_Grade at the open's `worldClock` and `opsClock`. It SHALL return that Head inside the Deck, with all ten named sections present and a total of at most 3500 tokens. If no Memory is eligible, the Head SHALL still contain all ten sections and SHALL contain no Memory content.
5. THE Server_Library SHALL compile the Head, write `core/bundle` with its incremented `bundleRev` (Requirement 26 criterion 10), close the prior Session and create the new Session in one transaction. THE Deck, the StateAck and `Session.stateAck` returned or stored by `/api/session/open` SHALL carry `epoch`, `policyRev` and `rulesRev` equal to the stored core values and the post-compile `bundleRev` written by that transaction, and `generation` equal to the new Session's `generation`. Its `issuedAt` SHALL be read from `opsClock`, and its `expiresAt` SHALL equal `issuedAt` plus exactly 60 seconds (contracts §6 Ack/deck timing).
6. IF `core/epoch.barrier` is non-null, THEN THE Server_Library SHALL return `state:"blocked"` with no `deck` and no `ack`. It SHALL create no Session, leave `core/epoch.activeSessionId` unchanged, and leave any prior Session's status unchanged.
7. IF a `/api/session/open` request has a missing or invalid Firebase ID token, or fails the origin/CSRF check, THEN THE Route_Guard SHALL reject it with error `AUTH` before route logic runs, and THE Server_Library SHALL write no Record.
8. IF a `/api/session/open` body fails any of these checks, THEN THE Server_Library SHALL reject it with error `PARSE`, create no Session, and leave `core/epoch` unchanged: (a) it contains a field outside the closed contracts §6 schema; (b) it is missing `requestId`, `initiator` or `clientZone`; (c) its `clientZone` is not a valid IANA time zone; (d) it exceeds 128 KiB.
9. WHEN `/api/session/open` receives a `requestId` that the same Owner already used within the past 24 hours, with an identical body hash, THE Server_Library SHALL return the original response and create no second Session. IF the body hash differs, THEN THE Server_Library SHALL reject the request with a conflict error and change no Record (contracts §6 Routes mutation key).

### Requirement 12: SDP proxy and call registry

**User Story:** As the owner, I want the server to broker the call setup while audio flows directly, so that the server always knows which calls exist and can hang them up.

#### Acceptance Criteria

1. WHEN the Browser_Client has created an SDP offer for a Session whose `sessionId` and `generation` it received from `POST /api/session/open`, THE Browser_Client SHALL send `POST /api/session/sdp` with `{requestId, sessionId, generation, offerSdp}` to the SDP_Proxy and SHALL send the offer to no other endpoint.
2. WHEN `/api/session/sdp` receives an offer that passes the checks in criteria 5, 8 and 9, THE SDP_Proxy SHALL post a multipart request to OpenAI `/v1/realtime/calls` with session `{type:"realtime", model:<FRANKI_VOICE_MODEL>, tracing:null, audio.output.voice:"cedar"}` using the server-held OpenAI API key, where the model value is read from Model_Config and not hard-coded (contracts §6 Realtime).
3. WHEN OpenAI returns an SDP answer and a call ID in the `Location` header, THE SDP_Proxy SHALL, in a single Store_Port write, set `Session.callId` to that call ID and append it to `Session.registeredCallIds`, and SHALL return `{answerSdp, sessionId, generation}` only after that write has committed (contracts §6 Routes "persist call first").
4. IF the call ID write in criterion 3 fails, THEN THE SDP_Proxy SHALL request a hangup of that call at OpenAI, record a `hangup` Job for that call ID that retries until OpenAI confirms the hangup if the immediate request fails, leave `Session.callId` and `Session.registeredCallIds` unchanged, and return error `DEPENDENCY` with no `answerSdp`.
5. IF `sessionId` does not belong to the Owner, the Session `status` is not `minting` or `active`, or `generation` does not equal `Session.generation`, THEN THE SDP_Proxy SHALL return error `STALE`, call no OpenAI endpoint and leave the Session record unchanged.
6. THE Browser_Client SHALL never receive the OpenAI API key or any OpenAI credential valid for longer than one call, in any response body or header from any Web_App route.
7. THE SDP_Proxy SHALL send its response, success or error, within 5 seconds of receiving the request.
8. IF `offerSdp` is empty, is longer than 65536 characters, or the request body has fields missing or extra beyond `{requestId, sessionId, generation, offerSdp}`, THEN THE SDP_Proxy SHALL return error `PARSE`, call no OpenAI endpoint and leave the Session record unchanged.
9. IF the Session already holds 4 entries in `Session.registeredCallIds`, THEN THE SDP_Proxy SHALL return error `LIMIT`, call no OpenAI endpoint and leave the Session record unchanged.
10. IF OpenAI does not return a response in time for the SDP_Proxy to meet the 5-second limit in criterion 7, returns a non-success response, or returns an SDP answer without a call ID in the `Location` header, THEN THE SDP_Proxy SHALL return error `DEPENDENCY` with a `retryAfterMs` between 1 and 5000, return no `answerSdp`, leave `Session.callId` and `Session.registeredCallIds` unchanged, and request a hangup at OpenAI for any call ID it did receive.

### Requirement 13: Session configuration and state acknowledgment (KV05, KV13)

**User Story:** As the owner, I want the call configured with Franki's current instructions and kept in sync, so that replies never use stale context.

#### Acceptance Criteria

1. WHEN the Realtime `oai-events` data channel opens, THE Voice_Client SHALL send exactly one `session.update` event matching contracts §6 Realtime, with `type` `realtime`, `instructions` set to `Head.text` of the Deck returned by `POST /api/session/open`, `tools` set to the Recall_Tool definition, `tracing` null, the transcription model from Model_Config, `turn_detection` `{type:"server_vad", silence_duration_ms:300, create_response:false, interrupt_response:false}`, and no `model` or `voice` field.
2. WHILE a Session is in any state from LISTENING until close (contracts §6 browser states), THE Voice_Client SHALL call `POST /api/session/state` with `seen` set to the `epoch`, `policyRev`, `bundleRev` and `rulesRev` of the Deck it holds, no later than 45 seconds after the previous successful `/api/session/state` response.
3. WHEN `POST /api/session/state` receives an authenticated request for the Owner's Session, THE Server_Library SHALL return the current `SS` stamp, a `StateAck` whose `stamp` carries the current four revisions and whose `expiresOpsAt` is no more than 2.5 seconds after `issuedOpsAt`, and a re-issued Deck on every successful response, with a new `issuedAt` from `opsClock` and `expiresAt` exactly 60 seconds later, built from the stored `core/bundle` Head and the current four revisions. The re-issue SHALL ignore `core/bundle.expiresAt` in this slice. THE Server_Library SHALL schedule any `tickUser` work for this route to run after the response and SHALL NOT await it, so that background work never delays the response.
4. WHEN the Voice_Client receives a stamp, Deck or StateAck in which any of `epoch`, `policyRev`, `bundleRev`, `rulesRev` or `generation` is greater than the value in the Deck it holds, THE Voice_Client SHALL discard the older Deck, cancel every in-progress reply built from the older Deck by its named response ID, clear the output audio buffer, and play no further audio from those replies (KV05).
5. WHEN `/api/session/state` returns a Deck whose `Head.text` differs from the instructions last sent, THE Voice_Client SHALL send one `session.update` with `instructions` set to the new `Head.text`, keeping the same `tools`, `tracing` and `turn_detection` values as criterion 1, and omitting `model` and `voice`.
6. THE `/api/session/state` route SHALL return its response within 1.5 seconds of receiving the request, as measured on the server.
7. WHEN the Voice_Client admits audio under a `fastO` Permit, THE Voice_Client SHALL require a StateAck that matches all four revisions of the Deck in use and whose age measured on the opsClock (server offset plus round-trip time, contracts §6 Ack timing) is under 2.5 seconds (KV13). This slice issues no `fastO` Permits, so this check SHALL apply to no other Permit kind. FOR every Permit kind, IF the Deck's `expiresAt` has passed, THEN THE Voice_Client SHALL build no reply from that Deck until a refresh under criterion 2 returns an unexpired Deck.
8. IF a `POST /api/session/state` call fails, returns an error, or gives no response within 1.5 seconds, THEN THE Voice_Client SHALL keep its existing StateAck without extending its expiry, keep its current Deck, and retry the call after 1, 2 and 5 seconds, showing an explicit retry control if no call succeeds within 30 seconds (contracts §6 RECOVERY).
9. IF no StateAck is received within 1.5 seconds after the criterion 1 `session.update` is sent, THEN THE Voice_Client SHALL close the call through `POST /api/session/close` with reason `error` and enter the RECOVERY state without playing any audio (contracts §6 CONFIGURING).

### Requirement 14: Session close and hangup (KS07)

**User Story:** As the owner, I want hanging up to end the call on OpenAI's side too, so that no call keeps listening after I'm done.

#### Acceptance Criteria

1. WHEN the Owner presses hang up, THE Browser_Client SHALL stop the microphone track, close the `oai-events` data channel and the peer connection, and send `POST /api/session/close` with `{requestId, sessionId, generation, reason:"user"}`, in that order, before showing the ended call state on the Stand_In_Avatar.
2. WHEN `/api/session/close` arrives for a Session in the Owner's Tenant_Root whose `generation` matches the request, THE Server_Library SHALL set the Session to `closing`, request hangup at OpenAI for every call ID in `registeredCallIds` (0 to 4 IDs), set the Session to `closed` with `closedAt` taken from the Clock_Port once every hangup succeeds, and respond with `state:"closed"` within 1.5 seconds by `opsClock`.
3. IF any hangup request fails, or its outcome is unknown when the 1.5 second route budget ends, THEN THE Server_Library SHALL keep the Session `closing` with `closedAt` unset, write one `hangup` Job targeting that Session, and respond with `state:"closing"`; the `hangup` Job SHALL stay in `retry` with `attempts` incremented on each failed attempt and SHALL never be marked `complete` until every registered call ID has been hung up, after which the Session SHALL be set to `closed` with `closedAt` (KS07).
4. WHEN any route for an Owner runs and a Session of that Owner has status `minting`, `active`, `quarantined` or `closing` with `expiresAt` at or before `opsClock` now, THE Server_Library SHALL close that Session with `reason:"expired"` through the same hangup path as criteria 2 and 3, handling at most 100 such Sessions per run and at most one run per ops minute per Owner (contracts §9 Q13, `tickUser`).
5. WHEN a Session reaches `closed`, THE Server_Library SHALL ensure exactly one Extract_Job exists for each committed user Turn of that Session, creating a job only for Turns that lack one, so that repeated closes never create duplicate Extract_Jobs.
6. IF `/api/session/close` arrives for a Session already `closed`, THEN THE Server_Library SHALL respond with `state:"closed"` without sending any hangup request to OpenAI and without changing `closedAt`.
7. IF `/api/session/close` names a `sessionId` not under the Owner's Tenant_Root, or a `generation` that does not match the Session's current `generation`, THEN THE Server_Library SHALL reject the request with an error indicating the session or generation is invalid, and SHALL leave the Session's status, `closedAt` and `registeredCallIds` unchanged.
8. IF the `POST /api/session/close` request from the Browser_Client fails or gets no response within 1.5 seconds, THEN THE Browser_Client SHALL keep the microphone stopped and the peer connection closed, show the ended call state, and leave the server Session to be closed by the expiry path in criterion 4.

### Requirement 15: Voice client behavior: mute, barge-in and cancellation (KV02, KV04)

**User Story:** As the owner, I want to talk naturally, interrupt Franki, and mute myself, so that the call feels like talking to a person.

#### Acceptance Criteria

1. WHILE the Voice_Client holds no unexpired Permit whose Stamp matches the current Session, Turn and generation, THE Voice_Client SHALL keep the output `audioElement` muted, dispatch no tool calls, and send no delivery receipt (KV02).
2. WHEN the Realtime server reports `input_audio_buffer.committed` followed by a `conversation.item.added` whose item ID equals the committed item ID, THE Voice_Client SHALL record that item ID with a commit sequence number one greater than the previous committed item in the Session. WHEN every recorded item of the Turn has a final transcript, THE Voice_Client SHALL request admission for that Turn through one `POST /api/turn` with `source:"asr"`, `judge:"timeout"`, `transcriptState:"final"`, the joined transcript, and the recorded items in commit order. Until F2 adds the judge, ASR admits the voice Turn (the fallback for a missing verdict in memory-spec §3 and the contracts §6 HELD state), so a reply starts about 1.1 to 1.6 seconds after speech ends.
3. WHEN the Voice_Client holds an unexpired Permit for the current Turn and generation, THE Voice_Client SHALL send exactly one `response.create` with `conversation:"none"`, `instructions` set to the permitted Head text, `input` set to the Deck's safe turns (0 to 4) followed by item references to the current Turn's committed audio items in commit order (1 to 8), and metadata `{purpose:"speech", turnId, generation}`, and SHALL unmute the output `audioElement` only after re-checking that the Permit's Stamp still matches the current Session, Turn and generation.
4. WHEN the Realtime server reports `input_audio_buffer.speech_started` while Franki's audio is playing or a speech response is in flight, THE Voice_Client SHALL mute the output `audioElement` before handling the next Realtime event, send a cancel for every in-flight response ID it has recorded, send `output_audio_buffer.clear` after those cancels, and return to the LISTENING state (barge-in) (KV04).
5. WHEN a new reply starts, THE Voice_Client SHALL cancel every older in-flight response by its ID, cancel any response created after that cancel that carries an older Turn or generation, and discard any Permit bound to an older Turn, an older generation, or with `expiresAt` in the past (Permit TTL 10 seconds) (KV04).
6. WHEN the Owner presses the mute control while the microphone is live, THE Voice_Client SHALL disable the outgoing microphone track so that no input audio reaches the Realtime server, show a muted indicator on the call screen, and leave the output `audioElement` state unchanged.
7. THE Voice_Client SHALL drop, without playing audio, dispatching tools or updating state, any Realtime event whose metadata generation differs from the Voice_Client's current local generation.
8. IF the `RTCPeerConnection` reaches the `failed` state, or the `oai-events` data channel closes without an Owner hang-up, or connection setup does not reach CONFIGURING within 5 seconds of the `POST /api/session/open` response arriving (a limit that covers SDP and the data channel only; the open response has its own limit in Requirement 16 criterion 6), THEN THE Voice_Client SHALL mute the output `audioElement`, stop dispatching tool calls and response requests, show a recovery state, retry the connection automatically after 1, 2 and 5 seconds, and show an explicit retry button if the call is not back in LISTENING within 30 seconds, without resuming any response created before the failure.
9. WHEN the Owner presses the mute control while the microphone is muted, THE Voice_Client SHALL re-enable the outgoing microphone track and remove the muted indicator.
10. IF `input_audio_buffer.committed` is not followed by a matching `conversation.item.added` within 600 milliseconds, THEN THE Voice_Client SHALL move the Turn to the HELD state, keep the output `audioElement` muted, and send no `response.create` for that Turn until a Permit arrives. The admission request of criterion 2 still waits for the final transcript, and criterion 11 still applies.
11. IF the matching `conversation.item.added`, or the final transcript of any recorded item of the Turn, has not arrived by end of speech (the Voice_Client's opsClock time at the last `input_audio_buffer.committed`) plus 1.5 seconds, or a transcription failure event arrives for one of its items, THEN THE Voice_Client SHALL post the TurnRequest with `transcriptState:"missing"` or `"failed"` and an empty transcript, enter the RECOVERY state, and play only the fixed neutral line ("Sorry, say that again?") under a `recoveryOnly` Permit from the Admission_Seam. THE Voice_Client SHALL never play audio for an unadmitted Turn, and SHALL drop any transcript for that Turn that arrives later.

### Requirement 16: Stand-in avatar and call controls

**User Story:** As the owner, I want a simple visual of Franki and one obvious call button, so that I can see call state without reading text.

#### Acceptance Criteria

1. THE Browser_Client SHALL show a Stand_In_Avatar built from plain HTML and CSS, with no Rive dependency and no image, video or canvas asset, on the same screen as the call button.
2. THE Stand_In_Avatar SHALL show exactly six states (closed, connecting, listening, thinking, speaking and recovery), where each state differs from every other state in at least one non-text visual property (shape, size, colour or animation), and SHALL expose the current state name as its accessible label.
3. THE Stand_In_Avatar SHALL take its state from call state as follows: closed while no Session is open; connecting from the call button press until the `oai-events` data channel opens; listening while the call is connected and no reply is pending or playing; thinking from a user Turn commit (spoken or typed) until Franki's output audio starts; speaking while Franki's output audio plays; and recovery while the failure state of Requirement 15 criterion 8 is shown. WHEN the call state changes, THE Stand_In_Avatar SHALL show the new state within 500 milliseconds.
4. THE Browser_Client SHALL show exactly one call button whose press starts a call while the Stand_In_Avatar is closed and hangs up while the Stand_In_Avatar is in any other state, with a non-text visual difference between its start and hang-up forms, and SHALL show the mute toggle only while the Stand_In_Avatar is listening, thinking or speaking, with the mute toggle showing whether the microphone is muted.
5. WHEN the Owner presses the call button to hang up, THE Browser_Client SHALL send `POST /api/session/close` for the current Session, stop the microphone track, close the peer connection, hide the mute toggle, and show the closed state within 2 seconds; WHILE that hang-up is in progress, THE Browser_Client SHALL ignore further call button presses, so no second Session opens.
6. IF `POST /api/session/open` or `POST /api/session/close` fails or returns no response within 5 seconds, THEN THE Browser_Client SHALL release the microphone and peer connection, show the closed state with an error message indicating which step failed, and leave the call button in its start form so the Owner can retry.

### Requirement 17: Admission seam and devAdmit

**User Story:** As the owner, I want every reply to pass one admission function now, so that F2 can replace the development rule with the real judge without rewiring anything.

#### Acceptance Criteria

1. THE Server_Library SHALL route every reply admission, for voice Turns and typed Turns, through exactly one Admission_Seam function, and THE Admission_Seam SHALL return exactly one of a Permit or a hold decision for each call, with no other code path in the Server_Library or Web_App able to create a Permit.
2. WHEN the Voice_Client receives reply audio, THE Voice_Client SHALL play it only if it holds a Permit issued by the Admission_Seam whose `stamp` equals the current Stamp, whose generation equals the current generation, whose `approvedPayloadHash` equals the hash of the reply payload (contracts §6 Permit, Hash), and whose `expiresAt` is later than the current `opsClock` time.
3. IF the Voice_Client has no Permit for a reply, or the Permit's Stamp, generation or `approvedPayloadHash` does not match, or the Permit's `expiresAt` is at or before the current `opsClock` time, THEN THE Voice_Client SHALL play no audio for that reply and SHALL cancel the pending Realtime response.
4. THE Admission_Seam SHALL be implemented in this slice by a function named `devAdmit`, and THE Admission_Seam SHALL write, for every Permit `devAdmit` issues, a record keyed by that Permit's `permitId` that names `devAdmit` as the issuer; because the closed `Permit` type (contracts §6) has no issuer field, THE design SHALL record under "Contract questions" which field carries the issuer.
5. IF `devAdmit` is invoked while `NODE_ENV` equals `production`, THEN `devAdmit` SHALL throw a configuration error before computing any Permit, THE Admission_Seam SHALL issue no Permit and write no admission ledger entry, THE route SHALL return error `CONFIG` with no `permit` field, and THE Voice_Client SHALL play no audio for that reply.
6. IF `devAdmit` refusing in production blocks a deployed test, THEN the build SHALL stop and ask the owner, and SHALL NOT remove or relax the `NODE_ENV` check, add a bypass flag or environment variable, or deploy with `NODE_ENV` set to a value other than `production`.
7. WHEN `devAdmit` issues a Permit for a typed Turn, THE Permit SHALL have kind `slowOrdinary`, scope `reply`, `expiresAt` equal to the issuing `opsClock` time plus exactly 10,000 milliseconds, an empty `momentIds` list, and an `approvedPayloadHash` computed as defined in contracts §6 Hash (contracts §6 PermitTTL).
8. WHEN `devAdmit` issues a Permit for a voice Turn with `transcriptState:"final"`, THE Permit SHALL have kind `slowOrdinary`, scope `reply`, and `expiresAt` equal to the issuing `opsClock` time plus exactly 10,000 milliseconds. WHEN the voice Turn's transcript is `missing` or `failed`, THE Permit SHALL have kind `recoveryOnly` and cover only the fixed neutral line. THE design SHALL record the deviation: `slowOrdinary` audio normally also requires judge `O` (contracts §6 Admission), and F2 restores that.
9. IF the Admission_Seam returns a hold decision, THEN THE route SHALL return a TurnResponse with status `hold` and no `permit` field, and THE Voice_Client SHALL play no audio for that reply.
10. WHEN the Admission_Seam returns a Permit or a hold decision, THE Admission_Seam SHALL write exactly one `ledger` entry of kind `delivery` or `decision` under the Tenant_Root before returning to the caller, recording the outcome, the issuer `devAdmit` and, for a Permit, its `permitId` and Permit kind, and THE Debug_Panel SHALL show that entry for the reply; IF the closed `delivery` and `decision` payloads (contracts §1 ledger) cannot hold these values, THEN THE design SHALL record the conflict and a proposal under "Contract questions".

### Requirement 18: Typed input

**User Story:** As the owner, I want to type a line instead of speaking, so that I can test memory without a microphone.

#### Acceptance Criteria

1. WHEN the Owner presses the send button or presses Enter in the text box with text of 1 to 8192 UTF-16 code units that is not only whitespace, THE Browser_Client SHALL submit one TurnRequest to `POST /api/turn` with `source:"typed"`, `items:[]`, `judge:"typed"`, `transcriptState:"final"`, the entered text as `transcript`, and a Client_Seq exactly 1 greater than the last Client_Seq this Browser_Client assigned in the session (KV12).
2. IF the submitted transcript is longer than 280 UTF-16 code units, or contains a line feed or carriage return, or contains `From:` or `Subject:` in any letter case, or contains `http://`, `https://` or `www.` in any letter case, THEN THE Server_Library SHALL store the Turn and its Evidence with `source:"pasted"` and Source_Class T (contracts §6 "Typed/chip").
3. WHEN a submitted typed transcript is at most 280 UTF-16 code units, contains no line feed or carriage return, and contains none of the strings listed in criterion 2, THE Server_Library SHALL store the Turn with `source:"typed"`, store its Evidence with the Source value for ordinary typed turns chosen in the design (see contract question 12), and assign Source_Class U (contracts §6 "Typed/chip").
4. WHEN a typed turn is admitted, THE Server_Library SHALL return the TurnResponse before the Extractor starts the Extract_Job for that turn, which is written in the Turn's transaction (Requirement 22 criterion 1) and started after the response returns, and SHALL leave the Session status unchanged so an open call stays open (contracts §5 ExtractV1 "Typed/chip: reply then extract, call up").
5. WHILE a call is open, THE Voice_Client SHALL play the reply to an admitted typed turn only after the Admission_Seam issues a Permit bound to that turn's Stamp, the same as for voice replies, with Permit kind `slowOrdinary` for Source_Class U and kind `postCommitControl` with scope `reply` and no S1 or S2 note for Source_Class T (contracts §6 Permit table).
6. WHILE no call is open, THE Browser_Client SHALL show the reply to an admitted typed turn as text in the conversation view and SHALL play no audio.
7. IF a typed turn has Source_Class T, THEN THE Extractor SHALL write zero Memory records from that turn in this slice, because `ClaimsV1` is out of scope, and THE Server_Library SHALL still store that turn's Turn and Evidence records.
8. IF the text box is empty or contains only whitespace, THEN THE Browser_Client SHALL disable the send button and send no request; IF a received transcript is empty or longer than 8192 UTF-16 code units, THEN THE Server_Library SHALL reject the request with an error indicating invalid input and store no Turn, Evidence or Extract_Job.
9. WHILE a typed TurnRequest is awaiting its TurnResponse, THE Browser_Client SHALL disable the send button so that one press sends at most one TurnRequest.
10. IF `POST /api/turn` returns an error or no response arrives within 10 seconds, THEN THE Browser_Client SHALL keep the typed text in the text box, show an error indication that the line was not sent, show no reply, and re-enable the send button.

### Requirement 19: Turn serialization by clientSeq (KV12)

**User Story:** As the owner, I want transcripts saved in the order I said them, so that memory never reorders what happened.

#### Acceptance Criteria

1. WHEN `/api/turn` receives an authenticated TurnRequest whose `clientSeq` equals `Session.nextClientSeq`, THE Server_Library SHALL commit the user Turn, the request's idempotency record and the update of `Session.nextClientSeq` to `clientSeq` plus 1 in one transaction that compare-and-sets `Session.nextClientSeq` against the value read at the start of that transaction (KV12, contracts §6 `/api/turn`).
2. IF the request's `clientSeq` is greater than `Session.nextClientSeq`, THEN THE Server_Library SHALL return a TurnResponse with `status:"hold"` and an integer `retryAfterMs` from 1 to 5000 inclusive, and SHALL write no Turn, Evidence or Session change for that request until a later attempt finds `clientSeq` equal to `Session.nextClientSeq`.
3. IF the request's `clientSeq` is lower than `Session.nextClientSeq`, the request's `requestId` matches a recorded request for the same `uid` and Session, and the request's hash equals the recorded hash, THEN THE Server_Library SHALL return the recorded TurnResponse unchanged (replay) and SHALL write no new Turn, Evidence or Session change.
4. THE Server_Library SHALL set each user Turn's `seq` equal to the `clientSeq` of the TurnRequest that committed it.
5. WHEN an assistant transcript is committed, THE Server_Library SHALL set the assistant Turn's `seq` to `Session.nextClientSeq` minus 1 as read in the committing transaction (0 if no user Turn has committed yet), and SHALL leave `Session.nextClientSeq` unchanged.
6. THE Server_Library SHALL order Turns of one Session by `seq` ascending; for Turns with equal `seq`, user Turns before assistant Turns; and for Turns with equal `seq` and equal role, `committedAt` ascending (contracts §6 `/api/turn`).
7. FOR ALL interleavings of 1 to 50 concurrent TurnRequests for one Session, with `clientSeq` values forming a permutation of 1 to N, THE committed user Turns SHALL have strictly increasing, gap-free `seq` values starting at 1, each equal to its `clientSeq`, with exactly one committed user Turn per `clientSeq`, verified on the Memory_Store in `npm test` (property); THE Firestore_Store SHALL be covered by the shared Store_Port conformance suite that CI runs on the Firestore emulator (Requirement 7.3).
8. WHEN a voice TurnRequest's `items` lists 2 to 8 audio items, THE Server_Library SHALL store their `itemId` values in `Turn.itemIds` in ascending `commitSeq` order, regardless of their order in the request.
9. THE Server_Library SHALL read a Session's Turns with query Q14 (`seq` greater than a cursor, `seq` ascending, at most 100 Turns per read), and SHALL start the next read from the last returned `seq` until a read returns fewer than 100 Turns.
10. IF the request's `clientSeq` is lower than `Session.nextClientSeq` and either no recorded request exists for its `requestId` or the request's hash differs from the recorded hash, THEN THE Server_Library SHALL return an error response and SHALL write no Turn, Evidence or Session change.
11. IF the compare-and-set in criterion 1 fails because another transaction changed `Session.nextClientSeq` first, THEN THE Server_Library SHALL commit nothing for that attempt and SHALL handle the request again under criteria 1, 2, 3 and 10 against the newly committed `Session.nextClientSeq`.

### Requirement 20: User turns kept whole as evidence

**User Story:** As the owner, I want each thing I say kept whole with its origin, so that every memory can point back to my exact words.

#### Acceptance Criteria

1. WHEN a user Turn commits with a final transcript, THE Server_Library SHALL write exactly one Evidence record in the same transaction as the Turn, under the Owner's Tenant_Root, with `kind:"turn"`, `source:"voice"` for voice turns, `source:"pasted"` for pasted turns, and the Source value for ordinary typed turns chosen in the design (see contract question 12), `text` holding the whole LF-normalized transcript of 1 to 8192 UTF-16 code units with no truncation, `sessionId` and `turnId` equal to the committing Turn's IDs, and `itemIds` holding the Turn's 0 to 16 Realtime item IDs (empty for typed and pasted turns).
2. THE Server_Library SHALL convert every CRLF pair and every lone CR in Evidence text to a single LF before computing UTF-16 `[start, end)` offsets and any `contentHash`, so that the stored `text` contains no CR characters.
3. WHEN the Server_Library writes a turn Evidence record, THE Server_Library SHALL include at least one `fieldSlices` entry with `fieldPath:"text"`, `start` 0 and `end` equal to the UTF-16 length of the stored `text`, with Source_Class U for owner speech or ordinary typed text and Source_Class T for pasted text (contracts §2 Class table).
4. THE Server_Library SHALL set the Source_Class and Sensitivity of every non-empty content field of an Evidence record through 1 to 128 `fieldSlices` entries assigned by code, so that every character of every stored content field falls inside at least one Slice (KC01).
5. THE Server_Library SHALL write no user Turn before its TurnRequest arrives, because the Voice_Client posts a voice TurnRequest only once the transcript is final, missing or failed (Requirement 15 criteria 2 and 11). No pending Turn exists in this slice.
6. IF any code attempts to update an Evidence record's `text`, `fieldSlices` or `contentHash` after creation, THEN THE Server_Library SHALL reject the write with an error indicating the record is immutable and leave the stored record unchanged (KC02).
7. FOR ALL committed Evidence, the `contentHash` of each Slice SHALL equal the SHA-256 of the LF-normalized UTF-16 range `[start, end)` of the Slice's field (property).
8. WHEN a voice TurnRequest arrives with `transcriptState` `"missing"` or `"failed"`, THE Server_Library SHALL commit the Turn with state `transcriptMissing` or `failed`, advance `Session.nextClientSeq` as in Requirement 19 criterion 1, and write no Evidence record and no Extract_Job for that Turn.
9. IF the Turn-and-Evidence transaction fails, or the Evidence record fails closed-schema validation (including a transcript longer than 8192 UTF-16 code units), THEN THE Server_Library SHALL commit neither the Turn nor the Evidence, return an error to the caller indicating the turn was not saved, and leave all previously stored Records unchanged (KC01).
10. WHEN a TurnRequest is received again with a `requestId` that has already committed a Turn, THE Server_Library SHALL return the original outcome and SHALL NOT create a second Evidence record for that Turn (KV12).

### Requirement 21: Assistant transcripts and receipts

**User Story:** As the owner, I want what Franki actually said recorded, so that the debug panel shows both sides of the call.

#### Acceptance Criteria

1. WHEN the Voice_Client receives the final assistant transcript for a `responseId` from the Realtime_Model, THE Voice_Client SHALL send one `POST /api/receipt` with a new `requestId`, `kind:"transcript"`, that `responseId`, the Stamp the reply was admitted under, and the transcript text of 1 to 4096 characters (contracts §6 Routes).
2. WHEN the first audio of a reply that holds a Permit from the Admission_Seam starts playing, or that audio stops for any reason including barge-in, THE Voice_Client SHALL send `POST /api/receipt` with `kind:"playbackStarted"` or `kind:"playbackEnded"` respectively, carrying the reply's `responseId`, its Stamp, and the Permit's `permitKind`, `momentIds` and `noteIds`.
3. WHEN `/api/receipt` receives a `kind:"transcript"` receipt whose Stamp `sessionId`, `epoch`, `policyRev`, `bundleRev`, `rulesRev` and `generation` all equal the server's current values, THE Server_Library SHALL, in one Store_Port transaction, write an assistant Turn (`role:"assistant"`, `seq` set as in Requirement 19 criterion 5 to `Session.nextClientSeq` minus 1 and ordered after the user Turn of equal `seq` per Requirement 19 criterion 6, `state:"transcribed"`, `text` equal to the receipt text) and an Evidence record of `kind:"turn"` with `authorship` set to mark Franki as author and the Turn's `evidenceId` pointing to it, then return `accepted:true`; a repeated transcript receipt for the same `responseId` SHALL return `accepted:true` and write no second Turn or Evidence.
4. THE Extractor SHALL write no Memory whose Lineage roots in an assistant Turn or its Evidence, and THE Server_Library SHALL enqueue no Extract_Job for an assistant Turn (memory-spec §4, "Franki's own words" are not stored as belief).
5. IF `/api/receipt` arrives with a Stamp whose `generation`, `epoch`, `policyRev`, `bundleRev` or `rulesRev` differs from the server's current value for that Session, THEN THE Server_Library SHALL return `accepted:false` and write no Turn, Evidence or Extract_Job.
6. THE `/api/receipt` route SHALL return its response within 1.5 seconds of receiving the request, measured on the server.
7. IF a `/api/receipt` request gets no response within 1.5 seconds, fails at the network level, or returns an error carrying `retryAfterMs`, THEN THE Voice_Client SHALL resend the identical body with the same `requestId`, waiting `retryAfterMs` (at most 5000 ms) when given and otherwise 1, 2, then 5 seconds between attempts, stop retrying 60 seconds after the first send, and not retry any response that returned `accepted:false`.
8. IF a `/api/receipt` body fails the closed schema (unknown field, `kind` outside the contract list, missing `responseId`, or `kind:"transcript"` with missing, empty or over-4096-character text), or its Stamp `sessionId` is not under the signed-in Owner's Tenant_Root, THEN THE Server_Library SHALL return an error with ErrorCode `PARSE` or `SCOPE` respectively and write no record.
9. WHEN the Debug_Panel shows the turns of a Session, THE Debug_Panel SHALL list user and assistant Turns together in ascending `seq` order, each labeled with its `role`.

### Requirement 22: ExtractV1 memory writes (KS01, KS06)

**User Story:** As the owner, I want what I say turned into memories that point back to my words, so that Franki can use it on the next call.

#### Acceptance Criteria

1. WHEN a user Turn's Evidence commits with Source_Class U, THE Server_Library SHALL write exactly one Extract_Job for that Evidence in the same transaction, holding the `epoch` and `policyRev` values current at that commit. IF that transaction fails, THEN neither the Evidence nor the Extract_Job SHALL be stored.
2. WHEN the Extractor starts an Extract_Job, THE Extractor SHALL build one `ExtractV1` input packet for that one user Turn only, with `sourceClass:"U"`, the job's captured `epoch` and `policyRev`, `fields` containing only that Turn's Evidence fields, `open:[]`, `lastTurns:[]` except recorded pronoun antecedents, and a `roster` of at most 50 entries that holds only entities literally mentioned in the supplied fields or needed for a pending pronoun, and never the Owner's global roster (contracts §5 ExtractV1 "Floor/seed").
3. WHEN the Extractor dispatches an `ExtractV1` call, THE Extractor SHALL call the OpenAI Responses API with the model named by `FRANKI_BRAIN_MODEL`, effort `low`, `store:false`, `tools:[]`, no conversation history, strict JSON schema output, and the literal PREFIX followed by the literal ExtractV1 prompt text from contracts §5. The call SHALL have an input cap of 12,000 tokens, an output cap of 4,096 tokens, and a deadline of 10 seconds measured on the Clock_Port `opsClock` from dispatch. Tests SHALL exercise this through Fake_OpenAI and assert these request parameters.
4. IF the ExtractV1 output fails schema validation, is a refusal, is incomplete, or misses the 10-second deadline, THEN THE Extractor SHALL commit no Memory from that output and make exactly one repair attempt with the same parameters as criterion 3. IF the repair attempt also fails by any of these conditions, THEN THE Extractor SHALL commit no Memory, set the Extract_Job to `pending` with an ErrorCode, and leave the Evidence unchanged (KS01, contracts §5 Execution "background one repair then pending").
5. WHEN the Extractor validates an Item, THE Extractor SHALL reject that Item if any of its Spans names an `eid` or `fieldPath` that was not supplied in the packet, has `start` or `end` outside `[0, text length]` or `start > end`, splits a UTF-16 surrogate pair, or has a `quote` that differs from the LF-normalized Evidence text at `[start, end)`. THE Extractor SHALL still commit the other valid Items from the same output.
6. WHEN an Item has `target:"evidenceOnly"` or act `joke`, `venting`, `hypothetical`, `quote` or `none`, THE Extractor SHALL write no Memory for that Item. WHEN a valid Item has `target:"new"` or `target:"update"` and any other act, THE Extractor SHALL write exactly one Memory for that Item, subject to the holds and rejections in Requirement 23.
7. WHEN the Extractor commits a Memory, THE Extractor SHALL store it with Source_Class U, with its Spans, and with `rootSlices`, `rootKeys` and `dependsOn` that trace to the source Evidence, so that the Lineage check (KC03, W-LINEAGE) passes for every committed Memory.
8. WHEN the Extractor commits, THE Extractor SHALL check in the same transaction that the job lease token, job generation, captured `epoch` and captured `policyRev` all equal their current stored values (KS06).
9. IF any value checked in criterion 8 differs from its current stored value, THEN THE Extractor SHALL commit no Memory and no job state change from that attempt, and SHALL requeue the Extract_Job when only the lease token or generation differs, or mark it `failed` with an ErrorCode when the `epoch` or `policyRev` differs (KS06).
10. THE Extractor SHALL compute every Memory key as `H(resolved subject, predicate, scope)`, hashing the scope unless the scope is `global` (KC05, contracts §3), so that two Items with the same resolved subject, predicate and scope produce the same key.
11. THE Extractor SHALL store each Memory's Sensitivity as the higher of the model-proposed Sensitivity and the code lexicon floor (order S0 < S1 < S2), and SHALL never store a Sensitivity lower than the proposed one. THE Extractor SHALL apply the same rule to `gravity`, and SHALL only tighten `flow`, never change `never_outbound` to `open`.
12. THE Extractor SHALL run as a server-side worker in the Server_Library, not as the Cloud Functions trigger `jobWake`. For typed and voice Turns alike, THE Server_Library SHALL start the Turn's Extract_Job after the `/api/turn` response returns, without waiting for hang-up, so the Debug_Panel shows Memories during the call. Session close and session open SHALL each drain the Owner's remaining Extract_Jobs. Session open SHALL wait for that drain for at most the limit stated in the design, racing the drain against the limit so that no job deadline extends the wait, and IF the limit passes, THEN session open SHALL proceed, leave the running jobs to finish in the background, and THE Debug_Panel SHALL show the unfinished jobs. WHEN a test commits a user Turn, runs the Extractor with Fake_OpenAI returning a valid `statement` Item, closes the Session and opens a new one, THE Head compiled at that session open SHALL include the resulting Memory.

### Requirement 23: Authority and Policy on writes (KC04, KC05)

**User Story:** As the owner, I want only my own words to become beliefs about me, so that pasted or inferred text can't change what Franki believes.

#### Acceptance Criteria

1. WHEN an Item with `target` `new` or `update` has act `statement`, `intention`, `promise_mine` or `soft_pref`, and every one of its Spans (1 to 8) lies inside a Source_Class U Slice of the cited Evidence with a quote that matches the Evidence text at `[start, end)`, THE Extractor SHALL write exactly one Memory with `sourceClass:"U"`, `status:"active"`, and `rootSlices` and `rootKeys` covering every one of those Spans (contracts §2 Promotion target, U column) (KC04).
2. IF any Span of an Item lies inside a Slice of Source_Class C, O, T or M, or partly outside every U Slice, THEN THE Extractor SHALL NOT treat the Item as U-rooted and SHALL NOT write a Memory with `sourceClass:"U"` or `status:"active"` from it (KC04).
3. IF an Item would write predicate `allergy`, kind `rule`, or act `rule` or `hard_rule`, THEN THE Extractor SHALL write no Memory and no `core/rules` document for the Item, and SHALL write one ledger `decision` entry with purpose `commit` whose `heldRefs` include the Item's Evidence and whose `reasonCodes` record the hold, because FastSlots and the hard-rule path are outside this slice.
4. IF an Item has act `correction` or `transition`, THEN THE Extractor SHALL write no Memory, leave every existing Memory's `status`, `validTo` and `rev` unchanged, and write one ledger `decision` entry with purpose `commit` whose `heldRefs` include the Item's Evidence and whose `reasonCodes` record the hold, because corrections and transitions are outside this slice.
5. WHEN the Extractor writes a new active U Memory whose `key` (the hash of resolved subject, predicate and scope, KC05) equals the `key` of an existing Memory with `status:"active"`, and the predicate is marked single-valued (`Y`) in the contracts §3 taxonomy, THE Extractor SHALL, in the same transaction as the new write, set the existing Memory's `status` to `"history"` and its `validTo` to the new Memory's `validFrom` (memory-spec §4 bitemporal rule, interval covers now).
6. IF the transaction in criterion 5 fails, THEN THE Extractor SHALL persist neither the new Memory nor the change to the existing Memory, so that after the failure exactly one Memory with that `key` has `status:"active"`.
7. WHEN the Extractor writes a Memory whose predicate is marked multi-valued (`N`) in the contracts §3 taxonomy, THE Extractor SHALL leave every existing active Memory with the same `key` unchanged.
8. IF an Item's predicate is outside the closed predicate taxonomy in contracts §3, or its `args` fail `Args<predicate>` validation (missing required key, extra key, wrong type, or out-of-bound value), THEN THE Extractor SHALL reject that Item, write no Memory for it, record the rejection reason in the ledger, and continue processing the remaining Items of the same `ExtractV1` output (contracts §3).
9. IF an Item's `kind` does not match the contracts §3 kind map for its predicate (for example kind `preference` on predicate `identity.name`), THEN THE Extractor SHALL reject that Item, write no Memory for it, record the rejection reason in the ledger, and continue processing the remaining Items of the same `ExtractV1` output.
10. IF an Item has act `joke`, `venting`, `hypothetical`, `quote`, `promise_theirs`, `outcome` or `none`, or has `target:"evidenceOnly"`, THEN THE Extractor SHALL write no Memory with `status:"active"` for that Item.
11. THE Extractor SHALL write every Memory rooted in T-class Evidence with `sourceClass:"T"`, every Memory rooted only in inference with `sourceClass:"M"`, and neither with `status` `active` or `scheduled` (property, fast-check over generated Items: T and M never write current user truth).
12. IF an Item rooted in T or M would promote predicate `allergy`, `identity.*`, `person.life`, `care`, any `preference.*`, or any permission, THEN THE Extractor SHALL write no Memory for that Item (contracts §2: no T/M promotion of rule, identity, life, preference or permission).

### Requirement 24: Lineage (KC03, never stubbed)

**User Story:** As the owner, I want every memory to trace back to the exact words it came from, so that I can see why Franki believes something and later forget it cleanly.

#### Acceptance Criteria

1. WHEN the Extractor writes a Memory, THE Extractor SHALL set `rootSlices` to the verified Slices behind the Memory's Spans (1 to 128 Slices), `rootKeys` to the hash of each root Slice in the same order (one key per Slice, 1 to 128 keys), `packetEids` to every Evidence ID in the input packet (1 to 200 IDs), and `dependsOn` to `e:<eid>` for every packet input (1 to 1,024 entries) (KC03).
2. WHEN the Extractor writes a Memory, THE Extractor SHALL set `supportingIds` to one Evidence Ref for each distinct Evidence ID referenced by the Memory's Spans (1 to 16 Refs), with each Ref's `rev` equal to the stored revision of that Evidence.
3. IF a Memory would be written with any of the following, THEN THE Store_Port SHALL reject the whole write, store no part of it, leave every existing Record unchanged, and return an error naming the failed lineage check (W-LINEAGE): empty `rootSlices` or empty `dependsOn`; a root Slice whose Evidence does not exist under the same Tenant_Root; a root Slice whose `contentHash` does not equal the hash of the Evidence text at that Slice's `fieldPath` and `[start, end)` range; a `rootKeys` entry that does not equal the hash of its root Slice; a root Slice Evidence ID with no matching `e:<eid>` entry in `dependsOn`; any lineage array longer than its contracts §1 bound (`rootSlices` 128, `rootKeys` 128, `packetEids` 200, `dependsOn` 1,024).
4. THE Core_Library SHALL provide a pure, deterministic lineage resolver that takes a Memory and a set of Evidence records and returns either the resolved Evidence records with the quoted text of each Span, or a list of every failed link, each labeled as one of: missing Evidence, Slice hash mismatch, Span quote mismatch, root key mismatch, or missing `dependsOn` entry.
5. FOR ALL generated sequences of 1 to 50 operations drawn from user turn commits, Extract_Job runs, Extract_Job retries and Fake_OpenAI results with mismatched Span quotes, ranges or Evidence IDs, on the Memory_Store, every stored Memory SHALL resolve through the lineage resolver with zero failed links, to Evidence under the same Tenant_Root whose LF-normalized UTF-16 text at each root Slice range hashes to that Slice's `contentHash` (lineage property; written first, and failing before the extraction code exists).
6. THE Test_Suite SHALL run the lineage property with fast-check at 1,000 runs, using the Memory_Store, the fake Clock_Port and Fake_OpenAI, with no network calls, and SHALL report the fast-check seed and shrunk counterexample when the property fails.
7. IF a Span's `quote` does not exactly equal the LF-normalized Evidence text at its `eid`, `fieldPath` and `[start, end)` range, or the range falls outside that field's UTF-16 length, THEN THE Extractor SHALL not write the Memory that cites that Span, and SHALL still commit the other Memories from the same Extract_Job whose Spans all verify.

### Requirement 25: Eligibility for this slice (KC06)

**User Story:** As a developer, I want one eligibility function for every read, so that later features add rules in one place.

#### Acceptance Criteria

1. THE Core_Library SHALL provide the pure function `eligible(x, c, s)` with the signature in contracts §7 (`x: Dependent`, `c: EC`, `s: Snapshot`, returning `ER = {allow, reason}`). The function SHALL read no clock, store, network or global state, and it SHALL return an identical `ER` for identical inputs (KC06).
2. WHEN the Head_Compiler, the Recall_Tool or the Debug_Panel's Head view reads a Memory, THE Franki system SHALL pass that Memory through `eligible` and SHALL leave out of that reader's output every Memory for which `eligible` returns `allow: false` (KC06).
3. IF any of the following holds for a row, THEN THE `eligible` function SHALL return `allow: false`: the row's `uid` or the Snapshot's `uid` differs from `c.uid` (reason `tenant`); `s.complete` is false; the row's `epoch` or `policyRev` is lower than the current value in `c`; the row is `dirty` (reason `dirty`); the row's `dependenciesComplete` is false; the row's status is `blocked` or `purged` (reason `blocked`); or any entry in the row's `dependsOn` is missing from the Snapshot, is blocked, purged, dirty or retracted. A dependency whose stored `rev` is newer than the referenced `rev` SHALL NOT cause a denial by itself. The design SHALL name the `EligibilityReason` returned for each condition that has no reason named above.
4. WHILE `core/epoch.barrier` is non-null, THE `eligible` function SHALL return `allow: false` with reason `barrier` for every read unless `c.serviceAuthorized` is true and `c.maintenanceOpId` equals the barrier's `opId`. For such a maintenance read, the function SHALL return `allow: false` when `c.stage` is `speech` or `toolReturn`.
5. IF the read's generation check fails, THEN THE `eligible` function SHALL return `allow: false`. The check fails when `c.execution` is `browser` and `c.generation` differs from `s.localGeneration`; when `c.execution` is `serverForeground` and `c.generation` is lower than `s.session.generation`; or when `c.execution` is `worker` and `c.leaseToken` or `c.jobGeneration` differs from the current values on `s.job`.
6. IF no deny condition in criteria 3 to 5, and no deny condition from any other contracts §4 clause that this slice implements, applies to a row, THEN THE `eligible` function SHALL return `allow: true` with reason `ok`. IF a required field of `x`, `c` or `s` is missing or fails its closed schema, THEN THE `eligible` function SHALL return `allow: false` and SHALL NOT throw.
7. THE `eligible` function SHALL implement every clause of the contracts §4 `eligible` pseudocode that this slice's data can trigger. THE design SHALL list every clause of that pseudocode, mark each one as implemented or unimplemented, and name the feature (for example F2, F4 or F6) that adds each unimplemented clause. THE Test_Suite SHALL include at least one test per implemented deny condition that shows the denial and its reason, plus at least one test that shows `allow: true` with reason `ok`.

### Requirement 26: Head compiled at session open

**User Story:** As the owner, I want Franki to start each call knowing what I told it before, so that I can hear it use my words.

#### Acceptance Criteria

1. THE Head_Compiler SHALL be a pure function in the Core_Library that takes Memories, Core state and the Clock_Port's `ClockPair` as its only inputs, performs no I/O and reads no wall-clock time, and returns a Head with exactly the ten sections from contracts §6 in the order `persona`, `policy`, `rules`, `now`, `style`, `people`, `next72`, `apply`, `know`, `openers` (contracts §7 `compileHead`).
2. THE Head_Compiler SHALL include in the `know` section only Memories that pass `eligible` and Spoken_Grade, under the heading "background; don't raise; answer if asked", with the `know` section at or below 450 tokens (memory-spec §3 The Head).
3. THE Head_Compiler SHALL exclude every S2 Memory from every Head section and from `selectedRefs`, and SHALL limit the `apply` section to S0–S1 Memories and the `openers` section to at most 2 S0 lines.
4. WHEN the sum of section tokens exceeds 3,500, THE Head_Compiler SHALL drop whole lines from the `openers` section first, then `know`, then `apply`, then `next72`, then `people`, emptying each section before it drops lines from the next, and SHALL stop dropping once `Head.tokenCount` is at or below 3,500; THE Head_Compiler SHALL never drop lines from `persona`, `policy`, `rules` or `now`.
5. THE Head_Compiler SHALL set `Head.tokenCount` equal to the sum of the ten `sections[].tokens` values and SHALL keep `Head.text` at or below 14,000 characters (contracts §6 `Head`).
6. IF `persona`, `policy`, `rules` and `now` together exceed 3,500 tokens, THEN THE Head_Compiler SHALL return an error result and no Head, and THE Server_Library SHALL leave the previously stored `core/bundle` unchanged.
7. THE Head_Compiler SHALL write into the `now` section the absolute calendar date (year, month and day) and the IANA zone name taken from the `ClockPair` `worldClock`, and SHALL use no relative date words such as "today" or "tomorrow" in that section.
8. WHEN no Memory passes `eligible` and Spoken_Grade, THE Head_Compiler SHALL return a Head with all ten sections present, an empty `know` section and an empty `selectedRefs` list.
9. THE Head_Compiler SHALL set `selectedRefs` to the refs of every Memory line that remains in the Head after the drop order of criterion 4 is applied, with at most 128 refs and at most 40 people lines (contracts §7 compileHead: people40/refs128).
10. WHEN the Head_Compiler returns a Head at session open, THE Server_Library SHALL store the Head, its `headHash`, `selectedRefs`, state `clean`, an incremented `bundleRev` and `compiledAt` from `opsClock` in `core/bundle`, in the same transaction that creates the Session (Requirement 11 criterion 5), before `/api/session/open` returns the Deck. Nothing recompiles the Head during a call in this slice; a Memory written during a call reaches the Head at the next session open, and reaches the call only through the Recall_Tool.
11. IF the `core/bundle` write fails, THEN THE Server_Library SHALL fail `/api/session/open` with an error response, return no Deck, and leave the previously stored `core/bundle` unchanged.
12. THE Head_Compiler SHALL be deterministic: FOR ALL inputs, compiling twice with the same Memories (in any input order), Core state and `ClockPair` SHALL produce byte-identical `Head.text` and the same `headHash` (property).
13. FOR ALL Memory sets, every line in the compiled Head's `know` section SHALL trace to a ref in `selectedRefs` whose Memory passes `eligible` and Spoken_Grade and has Sensitivity S0 or S1 (property).

### Requirement 27: Single-read recall tool (F5)

**User Story:** As the owner, I want Franki to look things up when I ask, so that it can answer about something not in its opening context.

#### Acceptance Criteria

1. WHEN the Voice_Client opens a Realtime session, THE Voice_Client SHALL offer the Realtime_Model exactly one function tool named `recall`, whose args schema matches contracts §6 Tools: `purpose` (answer, plan, why or inspect), `query` (at most 512 characters), `entityRefs` (0 to 8), optional `roleTuple`, optional `predicate`, optional `asOf` (at most 80 characters), optional `anchorId` and `sourceMode` (canonical, raw or both).
2. WHEN the Realtime_Model calls `recall`, THE Voice_Client SHALL send `POST /api/tool` with the current Stamp, the Realtime call ID and the tool call, and THE Server_Library SHALL hold the request until the current user Turn's parse commits, waiting at most 1.5 seconds (memory-spec §3 Tool turn; contracts §6 routes, parse 1.5 s).
3. IF the current user Turn's parse has not committed within 1.5 seconds of the `/api/tool` request arriving, THEN THE Server_Library SHALL return status `hold` with no `result` and SHALL NOT run the RecallAllV1 read for that request.
4. WHEN the hold in criterion 2 ends because the parse committed, THE Server_Library SHALL read the Owner's Memory lines under the Owner's Tenant_Root that pass the eligibility function, Policy and Spoken_Grade, up to 200 lines with each line's text at most 160 characters. THE Server_Library SHALL then run one tool-less `RecallAllV1` read with the model named in Model_Config, an input cap of 8,000 tokens, an output cap of 768 tokens and a 1.5-second deadline. Every line that fits within the 8,000-token input cap SHALL be included in the read (contracts §5 Recall readers).
5. WHEN the RecallAllV1 read completes within its deadline, THE Server_Library SHALL return status `ready` with a result of exactly `{name:"recall", notes, coverage, truncated, cursor, pendingId, snapshot}`, where `notes` holds 0 to 4 notes. THE Server_Library SHALL set `truncated:false` and coverage state `complete` when every eligible line went into the read. THE Server_Library SHALL set `truncated:true` and coverage state `partial` when more than 200 eligible lines exist or any line was left out to stay within the input cap. The whole `/api/tool` response SHALL be returned within 3 seconds of the request arriving (contracts §6 routes, result 3 s).
6. WHEN the Server_Library builds recall notes from RecallAllV1 output, THE Server_Library SHALL include only statements that cite at least one ref or Span supplied in that read's packet, and SHALL drop every statement whose citations are missing or refer to a ref or Span that was not supplied. Each note SHALL carry the `rootKeys` and `dependsOn` of the cited rows.
7. IF the RecallAllV1 read fails, returns invalid, refused or incomplete output, or passes its 1.5-second deadline, THEN THE Server_Library SHALL return status `ready` with empty `notes` and coverage state `unknown`, and SHALL NOT return any uncited text.
8. WHEN the Voice_Client receives an `/api/tool` response with status `ready`, THE Voice_Client SHALL send the function call output for that call ID. THE Voice_Client SHALL then request a new reply through the Admission_Seam and SHALL play that reply's audio only after the Admission_Seam issues a new Permit bound to the response's Stamp (contracts §6 Tools).
9. IF the current user Turn's own words do not contain any of the recall query's terms or aliases, or the speaker of that Turn is not certain, THEN THE Server_Library SHALL treat the `recall` result as not asked and SHALL return empty `notes` (memory-spec §6 "Asked is decided by code"; contracts §5 `explicitRequest`). This slice has no speaker model, so a Turn committed under the signed-in Owner's ID token SHALL count as certain; a later feature replaces this rule.
10. IF the `/api/tool` request's Stamp does not match the Session's current epoch, policyRev, bundleRev, rulesRev, generation or turnId, THEN THE Server_Library SHALL return status `stale` with no `result`, and THE Voice_Client SHALL NOT request a reply for that tool call.
11. IF the `recall` args fail the closed schema in contracts §6 Tools (unknown field, wrong type or bound exceeded), THEN THE Server_Library SHALL reject the request with an error indicating invalid input, SHALL NOT run the RecallAllV1 read, and SHALL NOT write any Record.

### Requirement 28: Spoken-grade wire rule (KC09)

**User Story:** As the owner, I want sensitive things kept off the wire, so that a modified browser can't read what Franki holds back.

#### Acceptance Criteria

1. WHEN the Server_Library builds a Head, a recall note or a `GET /api/debug/memory` response, THE Server_Library SHALL evaluate Spoken_Grade (contracts §4 `spokenGrade`, §2) for each candidate Memory against the current Snapshot. It SHALL include that Memory's content (its text and the `quote` of every Span it cites) only when the result is eligible, except as criterion 4 allows (KC09). Eligible means all of the following hold: the Memory is current or labeled stale, it is not under review, its flow is open, no linked entity has an `exclude` or `careHold` posture, and it is S0 or S1 from Source_Class U, C or O. THE Server_Library SHALL NOT place Memory content in any other route response, response field or error body.
2. IF a Memory fails Spoken_Grade, has no Sensitivity or Source_Class, or Spoken_Grade cannot be evaluated for it, THEN THE Server_Library SHALL leave that Memory out of the Head, Deck and recall notes, SHALL NOT emit a placeholder that carries its text, label or Span quotes, and SHALL still build the rest of the response from the remaining eligible Memories. Only a count of withheld Memories may cross, as allowed for `snapshot` (contracts §7).
3. THE Server_Library SHALL keep the content of every S2 Memory, and the `quote` text of every Span that falls in an S2 Slice, out of the Head, the Deck, recall notes, Realtime_Model session instructions and tool outputs sent to the Realtime_Model. This holds whatever the Memory's other attributes are. This slice builds no allergy exemption, because the KC09 allergy exemption belongs to F7.
4. WHERE the Debug_Panel is enabled, WHEN the authenticated Owner requests `GET /api/debug/memory`, THE Server_Library SHALL include S2 Memory content only for Records under that Owner's Tenant_Root. For each response that contains S2 content, it SHALL write a log entry naming the Owner `uid`, the Memory IDs revealed and the Clock_Port ops-clock time (modeled on "S2 tap logged", contracts §6 `GET /api/memory`). This owner-inspection path is a development-only carve-out, not the logged `inspect` carve-out.
5. IF the Debug_Panel is disabled, or a `GET /api/debug/memory` request asks for a Record outside the requesting Owner's Tenant_Root, THEN THE Server_Library SHALL return no S2 Memory content for that request and SHALL write no S2 reveal log entry.
6. THE Test_Suite SHALL include a fast-check property test, with at least 100 runs, that generates Memories across every combination of Sensitivity (S0, S1, S2) and Source_Class (U, C, O, T, M). The test SHALL assert that the serialized Head, Deck, recall notes and Realtime_Model instructions contain no text or Span quote from any Memory that fails Spoken_Grade.

### Requirement 29: Debug panel and GET /api/debug/memory

**User Story:** As the owner, I want a plain panel that shows exactly what was stored and where it came from, so that I can check memory while I talk.

#### Acceptance Criteria

1. WHEN the Route_Guard has authenticated a `GET /api/debug/memory` request, THE Server_Library SHALL return only Records under the requesting Owner's Tenant_Root: the Owner's Turns, Evidence, Memories and the Head compiled at the Owner's most recent Session open, as at most 50 items per page, with `coverage` on every response and `nextCursor` present if and only if more items remain (contracts §6 Routes).
2. WHEN the Owner requests the page after a given `nextCursor`, THE Server_Library SHALL return the next at most 50 items, with no item repeated from earlier pages and no item skipped across pages that were read with no Records written in between.
3. WHEN the Owner selects a Memory in the Debug_Panel, THE Debug_Panel SHALL show the Memory's fields with the source of each field, its Lineage through `rootSlices`, `rootKeys`, `dependsOn` and Spans to each Evidence ID, and each Span's `[start, end)` range highlighted inside the Evidence text. Where the Span `quote` does not equal the Evidence text at that range, the Debug_Panel SHALL show a visible lineage-mismatch marker on that Span (KC03, W-LINEAGE).
4. THE Debug_Panel SHALL list Turns in ascending `seq` order, showing for each Turn its role (user or assistant), its Client_Seq for user Turns, its transcript state and its linked Evidence ID, or an explicit "none" marker where no Evidence is linked.
5. THE Debug_Panel SHALL show the Head text compiled at the most recent Session open, the token count of each of its ten sections, the total token count against the 3500-token cap, its `headHash` and its `selectedRefs`. IF no Head has been compiled for the Owner yet, THEN THE Debug_Panel SHALL show an explicit "no Head compiled" state in place of these values.
6. THE Debug_Panel SHALL show each Extract_Job with its job ID, the Turn it extracts from, its status and, for a `pending` or `failed` job that carries one, its error code, and SHALL show each admission ledger entry with its Stamp `turnId` and its Permit kind.
7. WHILE a call is open, THE Debug_Panel SHALL fetch `GET /api/debug/memory` at intervals of no more than 5 seconds, and SHALL also fetch it within 1 second after each Turn commit is acknowledged to the Browser_Client.
8. IF a Debug_Panel fetch of `GET /api/debug/memory` fails or returns no response within 3 seconds, THEN THE Debug_Panel SHALL keep showing the last data it loaded successfully, SHALL show a visible stale-data indicator with the time of that last successful load, and SHALL retry at the next interval in criterion 7.
9. IF a `GET /api/debug/memory` request has no valid Firebase ID token, or names an `id` or `cursor` that is malformed or does not belong to the requesting Owner, THEN THE Server_Library SHALL reject the request with an error indicating the reason and SHALL return no Records.
10. THE Debug_Panel SHALL show all stored text, including transcripts, Evidence text, Memory fields, Span quotes and Head text, as escaped literal text, and SHALL NOT render stored HTML or run stored scripts (contracts §6 Routes).
11. WHEN the Server_Library receives an authenticated `GET /api/debug/memory` request, THE Server_Library SHALL finish the response within 3 seconds for a page of up to 50 items (contracts §6 Routes).
12. IF `GET /api/debug/memory` is requested while `NODE_ENV` is `production`, THEN THE Debug_Route SHALL refuse the request with error `CONFIG` before any Store_Port read, and SHALL return no Records. THE Debug_Route SHALL leave the contract's `GET /api/memory` views unbuilt and unchanged.

### Requirement 30: Model IDs and secrets from config

**User Story:** As the owner, I want model IDs and keys to live in configuration, so that a model swap needs no code change and no secret ever enters the repo.

#### Acceptance Criteria

1. THE Server_Library SHALL take every OpenAI model ID it sends to OpenAI from the Model_Config variable named for that use, so that a test which sets a Model_Config variable to an arbitrary non-empty value observes exactly that value in the corresponding request captured by Fake_OpenAI.
2. THE source code in `apps/web/src`, `packages/core`, `packages/server` and `functions/src` SHALL contain no string literal equal to an OpenAI model ID, where an OpenAI model ID means any value listed for a Model_Config variable in `apps/web/apphosting.yaml` or any string beginning with `gpt-`, `text-embedding-` or `whisper-`. Test files, config files (`apphosting.yaml`, `.env*` templates without values) and the single model-config module `packages/server/src/config/models.ts`, which holds the `/api/health` fallbacks so that no route holds a literal ID, are excluded.
3. IF a Model_Config variable or `OPENAI_API_KEY` that an operation uses is unset, empty or whitespace-only when a route handler or the Extractor runs that operation, THEN THE Server_Library SHALL fail the operation with error `CONFIG`, name the missing variable in the error detail without including any configuration value, call no OpenAI endpoint, and write no Memory, Session call ID or other Record derived from a model response.
4. THE Server_Library SHALL read `OPENAI_API_KEY` from the process environment at runtime only, and the key value SHALL NOT appear in any log line, error detail, API response (including `GET /api/debug/memory` and the Debug_Panel), stored Record, built Browser_Client asset or committed file.
5. WHERE the slice needs a config variable that `apps/web/apphosting.yaml` does not yet list (such as a transcription model ID or an ID-hashing key), THE design SHALL name each such variable, state whether it is a plain value or a Secret Manager secret, and state the exact owner action needed to set it.
6. THE build work for this slice SHALL change no Secret Manager, App Hosting, Firebase or Google Cloud setting, and SHALL add new non-secret Model_Config values only as entries in `apps/web/apphosting.yaml`.
7. WHILE the Web_App runs in local development, THE Web_App SHALL read `OPENAI_API_KEY` and `FRANKI_ID_HMAC_KEY` from `apps/web/.env.local`, which holds exactly those two secrets, and `git check-ignore apps/web/.env.local` SHALL report the file as ignored.
8. IF `OPENAI_API_KEY` is unset, empty or whitespace-only when the Web_App starts in local development, THEN THE Web_App SHALL emit one console message naming `OPENAI_API_KEY` as missing and naming `apps/web/.env.local` as where to set it, print no value of any environment variable, and keep running so that routes needing the key fail with error `CONFIG` per criterion 3.
9. IF build work for this slice would require reading, printing or committing the value of `OPENAI_API_KEY` or any other secret, or finds `OPENAI_API_KEY` missing for a local run, THEN THE build work SHALL stop, report the variable name and the needed owner action, and wait for the owner before continuing, without opening any `.env` file.
10. WHEN `npm run dev` starts in `apps/web`, a `predev` script (`scripts/sync-local-env.mjs`) SHALL copy every plain `value:` entry under `env:` in `apps/web/apphosting.yaml`, including Model_Config, the Admin SDK project ID and the `NEXT_PUBLIC_FIREBASE_*` values, into `apps/web/.env.development.local`, so that `apphosting.yaml` stays the single source of those values and the owner copies none of them by hand. The script SHALL never copy a `secret:` entry, SHALL never print any value, and SHALL overwrite only the generated file. `git check-ignore apps/web/.env.development.local` SHALL report the generated file as ignored, and THE Test_Suite SHALL test the script's parsing (plain values copied, secrets skipped, no values in its output).
11. THE Server_Library SHALL initialize `firebase-admin` with an explicit `projectId` read from the plain config variable named in the design, and IF that variable is unset or empty, THEN every operation needing the Admin SDK SHALL fail with error `CONFIG` naming the variable.

### Requirement 31: Tests, checks and CI

**User Story:** As the owner, I want fast, deterministic tests and green checks, so that every change is safe to build on.

#### Acceptance Criteria

1. THE Test_Suite SHALL run unit and fast-check property tests only against the Memory_Store, a fake Clock_Port and Fake_OpenAI, and SHALL pass with `OPENAI_API_KEY` unset and with no network access, so that a run makes zero OpenAI calls and costs nothing.
2. IF a test in the Test_Suite attempts a network request or reads wall-clock time outside the fake Clock_Port, THEN THE Test_Suite SHALL fail that test with an error identifying the attempted network or clock access.
3. THE lineage property in Requirement 24 SHALL be the first property test committed, and the spec's `tasks.md` SHALL record that the property was run and failed before the Extractor code existed, then passed after it was written.
4. THE Test_Suite SHALL include property tests for turn serialization (Requirement 19.7), slice hashing (Requirement 20.7), the T/M authority rule (Requirement 23.11), Head determinism (Requirement 26.12), Head lineage (Requirement 26.13), and schema round trips: FOR ALL valid Records of each in-scope type, validating, then serializing to JSON, then parsing, then validating again SHALL produce a Record deep-equal to the original.
5. THE Test_Suite SHALL run each fast-check property for at least 100 generated cases, and IF a property fails, THEN THE Test_Suite SHALL report the fast-check seed and the shrunk counterexample so the failure can be reproduced by rerunning with that seed.
6. THE `npm test` command SHALL exclude the Firestore emulator tests, SHALL not require Java, and SHALL complete within 60 seconds on the owner's development machine.
7. WHEN the slice is complete, `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` SHALL each exit with code 0, both locally and in the CI `verify` job.
8. WHEN the slice is complete, `GET /api/health` SHALL return the same fields as before the slice (`ok`, `service`, `node`, and `configured` with `openaiKey`, `smokeToken`, `brainModel` and `voiceModel`), and `POST /api/health` SHALL still refuse requests without a valid smoke token and still return the deep health report for authorized requests.
9. WHEN CI runs on a push to `main` or a pull request, THE CI workflow SHALL set up Java 21 and run the Firestore rules tests against the emulator via `npm run test:emulator`, and IF any rules test fails, THEN THE CI workflow SHALL fail.
10. WHEN the build is about to run a live check that spends OpenAI money, the build SHALL first tell the owner that a paid live check is about to run and which Model_Config models it will call, and THE live check SHALL run only after all checks in criterion 7 pass, and only once at the end of the slice unless the owner approves another run.

### Requirement 32: Spec traceability and report

**User Story:** As the owner, I want the work traceable to the contracts and reported honestly, so that judges and I can see how Kiro was used.

#### Acceptance Criteria

1. THE spec's design document SHALL cite, for each component, every contract row ID (KC, KV, KS or KJ rows in contracts §10, such as KC03 and KV10) and every query ID (Q01–Q35 in contracts §9) that constrains that component, and every cited ID SHALL exist in `docs/design/memory-contracts-v2.md`.
2. THE spec's tasks document SHALL record for each task: its dependencies as a list of task IDs or "none", an estimate in hours, the actual time in hours once the task is marked done, and a test witness naming the test file and test name that verifies the task, or "manual check" with the steps for tasks no automated test can cover.
3. THE spec's tasks document SHALL mark every property-test task as required, and SHALL mark no property-test task as optional.
4. WHEN `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all exit with code 0 and `/api/health` returns a success response, THE build SHALL write `docs/briefs/001-report.md` containing: (a) a list of what was built, each item with the task IDs that delivered it; (b) a list of every stub or stand-in, including Dev_Admit and the Stand_In_Avatar, each with the build-plan feature that replaces it; (c) a per-task table of estimate against actual time, with totals for both; and (d) every entry from the design's "Contract questions" section, or a statement that there are none.
5. IF any of `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` or the `/api/health` check fails, THEN THE build SHALL NOT report the slice as complete, and SHALL name each failing check and its error output in the final message.
6. WHEN the slice is complete as defined in criterion 4, the final message SHALL give, in run order, the exact commands to run Franki locally from a fresh clone. It SHALL list every action the owner must take first, including adding `OPENAI_API_KEY` to `apps/web/.env.local` and any Firebase Authentication setting change listed under Requirement 9 criterion 3. It SHALL also state whether real OpenAI calls were made and for which check.
7. IF a contract in `docs/design/` conflicts with another contract or cannot be built as written, THEN THE spec's design document SHALL list the conflict under a "Contract questions" section with the contract IDs involved and a proposed resolution, and THE build SHALL leave the files in `docs/design/` unchanged.
8. THE build SHALL make every commit for this slice on the branch `build/first-spoken-call`, with each commit covering at most one task from the tasks document, and SHALL NOT push to GitHub without the owner's approval.

## Notes for design: contract questions

These are conflicts or gaps noticed while writing requirements. The design phase should list each under "Contract questions" with a proposal. `docs/design/` is not edited.

1. **ID hashing key.** Contracts §1 define `ID` as an HMAC-SHA256 base64url string, which needs a secret key. No such secret exists in Secret Manager or `apphosting.yaml`, and adding one is an owner action.
2. **Voice permit kind without a judge.** `fastO` and `slowOrdinary` for audio both require judge `O` (contracts §6 Admission). F2 is out of scope, so `devAdmit` cannot meet either definition for voice turns.
3. **`TurnRequest.judge` for voice.** The union is `O|H|U|timeout|error|typed`. A voice turn in this slice has no verdict; the design must pick a value, probably `timeout` or a new development value.
4. **Hard rules from ExtractV1.** ExtractV1 can emit `hard_rule` and `allergy` items, but allergies are written by FastSlotsV1 on the turn. This slice holds them; confirm that is acceptable.
5. **`/api/memory` views.** The contract `view` enum is `overview|item|why|receipt|lab|strip` and returns `InspectItem`s. The brief's debug panel also needs turns, raw evidence, lineage, jobs and the Head. A `debug` view, or a development-only route, is needed.
6. **Extraction timing.** Contracts §5 say voice turns extract at close or idle as per-turn jobs, and typed turns extract right after the reply. The brief wants the next call to hear the memory. The design must say where jobs run (Functions `jobWake` or the server) and how a quick re-call sees them.
7. **Required fields with no behavior yet.** `Memory.nextReviewAt` and `endWhen` are required, but `derive` is F6. The design must pick defaults (for example `endWhen:{kind:"standing"}` and a far review date) and say they are placeholders.
8. **Recall seed.** The F5 floor reads "all lines of a 40-memory seed". Seed is F8, so this slice reads the Owner's own Memories instead.
9. **Health route model fallbacks.** `apps/web/src/app/api/health/route.ts` falls back to literal model IDs in code, which conflicts with "never from code". The brief also says keep `/api/health` working, so the design should decide whether to replace the fallbacks with a `CONFIG` result.
10. **Transcription model.** The `session.update` in contracts §6 names `gpt-4o-mini-transcribe` literally. A config variable for it is proposed.
11. **CSRF mechanism.** The architecture decision requires origin and CSRF checks but names no mechanism. With bearer-token auth and no cookies, an origin check may suffice; the design should decide.
12. **Source for typed turns.** The Evidence `Source` union (`gmail|calendar|plaid|voice|notes|tasks|food|fixture|pasted`) has no `typed` value, while `TurnRequest.source` does. The design should map ordinary typed turns to a Source value (probably `voice` with class U) and record the choice.
13. **Error code for idempotency conflicts and in-flight duplicates.** Requirement 10 criteria 9 and 11 need an ErrorCode for an HTTP 409 hash mismatch and for a duplicate whose 15-second lease is still held. The contracts name none for these cases; `HASH` is proposed.
14. **HTTP status for `LIMIT`.** Requirement 10 criterion 7 returns error `LIMIT` for oversize bodies but the contracts give no HTTP status. 413 is proposed.
15. **Source of `worldClock.zone`.** Requirement 6 criterion 1 assumes the zone comes from `core/state.currentZone`. The contracts do not say this directly; the design should confirm it and say how `clientZone` from session open relates to it.
16. **Issuer field for `devAdmit` Permits.** The closed `Permit` type has no issuer field (Requirement 17 criterion 4). The design should say which record or field carries the issuer.
17. **Ledger payloads for admissions.** The closed ledger `delivery` and `decision` payloads may not hold the issuer or `permitId` (Requirement 17 criterion 10). The design should check the payloads and propose where these values go.
18. **Evidence `authorship` for Franki.** The Evidence `authorship` enum has no value that means Franki wrote the text (Requirement 21 criterion 3). The design should pick or propose one.
19. **Receipt kind on barge-in.** Requirement 21 criterion 2 sends `playbackEnded` when audio stops for barge-in. The contracts may intend a `cancelled` kind for that case; the design should decide.
20. **Failed or missing transcripts in clientSeq ordering.** Requirement 19 does not say how a voice Turn whose transcript fails or goes `transcriptMissing` affects `Session.nextClientSeq`. The contract phrase "Failedsequence advances processing only" is unclear; the design should state the rule.
21. **`rev` increment on commit.** Requirement 7 criterion 5 sets `rev` to prior plus 1 on each commit. This is inferred from "Ref.rev=CAS" in the contracts and should be confirmed.
22. **Act `rule` held with `hard_rule`.** Requirement 23 criterion 3 holds act `rule` alongside `hard_rule`. The design should confirm `rule` is an ExtractV1 act and that holding it is correct for this slice.
