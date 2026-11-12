# Brief 014 report: the state machines, named and pinned

Built on `build/state-machines` and then on `build/next` by Claude Code agents, from `docs/briefs/014-state-machines.md`. None of this is Kiro's work: no commit in this brief carries the Kiro trailer.

**State:** the work stops part done. A1, A2, A3, T1, T2, V1 step 1, B3 and the first part of S6 are built and committed. Everything else in the brief is not built (listed below). **No live call was made on this line**, so nothing here has been checked on a real call, and the ring spark has not been looked at in a browser. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exited 0 on the recorded runs at the end of this report's commits. `npm test` can exit 1 on a fresh seed of the unseeded Property 13 (see "Property 13 on a fresh seed" below).

## Base numbers

On `6882856`, the cut point of `build/state-machines`, after `npm ci`:

| Check | Result |
|---|---|
| `npm test` | exit 0: 165 test files, 1,528 tests, all passed |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:emulator` | not run on the base: the emulator port was shared with another branch's work at the time |

At the join, `02dea73` (`build/state-machines` at the end of A3, then brief 012's wave A and brief 013 merged on top, no conflicts and no extra commits):

| Check | Result |
|---|---|
| `npm test` | exit 0: 220 test files, 2,555 tests (2,538 passed, 17 expected fail) |
| `npm run lint` (forced, nothing cached) | exit 0 |
| `npm run typecheck` (forced, plus the three `tsc` projects run by hand) | exit 0 |
| `npm run build` (forced) | exit 0 |
| `npm run test:emulator` | exit 0: 4 files, 42 tests |

The join holds A3 only. A1, A2, T1 and T2 came in after it, at `74bd398`, which is why the expected-fail count rises from 17 to 20 below.

## What was built, and where

| Task | What it delivered | Where |
|---|---|---|
| A1 | The machine index (one row per machine, by `area.thing` name, with status, what it alone decides, home file and page), one page per area, the state-machine steering file, the voice folder in the voice-control steering pattern, and two tests that keep the index, the pages and the steering pattern true against the code. The index test was shown red once by hand with a page naming a missing file and a missing export. | `docs/machines/`, `.kiro/steering/state-machines.md`, `.kiro/steering/voice-control.md`, `scripts/machines-index.mjs`, `scripts/machines-index.test.ts`, `scripts/state-machines-steering.test.ts` |
| A2 | Pins in new test files: the tick's gate, step order and lost races; the API client's token step; the Voice_Client's mic step at call start; a typed line retried after a lost response; the deadline ladder over the exported limits. Three red cases, listed below. | `packages/server/src/worker/tick.test.ts`, `apps/web/src/client/api.token.test.ts`, `apps/web/src/client/voice-client.mic.test.ts`, `apps/web/src/client/typed-replay.test.ts`, `scripts/deadline-ladder.test.ts` |
| A3 | The voice test rig: a golden corpus of the reducer (600 calls over `arbCall`, seeds 101 to 505, and 500 over the wide generator, seeds 11 to 55, recorded with fast-check 4.10.2); the wide call generator with reach counts and floors; transition tests for setup, recovery, the Turn and posts; the test-side views `turnMode` and `replyStage`, each with a property; seventeen red cases, listed below. The nine property files that were tracked before this brief are unchanged. | `packages/core/src/voice/testing/`, `packages/core/src/voice/golden-traces.test.ts`, `packages/core/src/voice/voice-*.transitions.test.ts`, the four new `*.property.test.ts` files beside them |
| T1 | `ci.yml` lost its gitleaks step; its key grep fails closed (a missing or empty folder, a match, or any grep exit but 1); `cancel-in-progress` applies only to pull requests. A new workflow scans the full history on every push and pull request with a pinned gitleaks CLI. It has never run. | `.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml` |
| T2 | The property guard refuses a case-variant path, a path through `../<repo folder>/` and a write under `GIT_LITERAL_PATHSPECS` like the plain path, and its message says "tracked (staged or committed)". The new cases were run red against the old guard first (4 failed, then 1 more for the pathspec case). | `scripts/property-guard.mjs`, `scripts/property-guard.test.ts` |
| V1 step 1 | The reducer's rails, with no behaviour change: `satisfies never` defaults in `step`, `onTimer` and `onRealtime`; the timer meaning table on `TimerName`; the reset table above `closedFields`; the `@machine voice.call` header; a comment at `AudioLike` saying that unmuted output is taken as heard and the transcript as said. Shown once by hand: three made-up union members fail the typecheck with the rails and compile silently without them. Both corpora equal, no re-record. In this closing step the comments were corrected where a review found them wider than the code, and a test pins `onRealtime`'s default (see below). | `packages/core/src/voice/machine.ts`, `apps/web/src/client/voice-client.ts` (the `AudioLike` comment), `packages/core/src/voice/voice-unlisted.transitions.test.ts` |
| B3 | The ring spark as a pure `ringSparkStep` over `idle` and `sparking`, and a shell, `RingSparkShell`, that runs its grant commands against the Electricity budget. The grant now goes back on `animationend`, `animationcancel`, the button leaving its start form, Reduced_Motion turning on, and unmount; before, only `animationend` gave it back, so a press that started a call held a grant for the whole call. Four red cases went green in the fix commits. | `apps/web/src/ui/ring-spark.ts`, `apps/web/src/ui/ring-spark.test.ts`, `apps/web/src/components/CallScreen.tsx`, `apps/web/src/components/CallScreen.spark.test.tsx` |
| S6, first part | `eligible` compares a stored row on its epoch only; its own `policyRev` is not compared. The read's context must still be at the current epoch and `policyRev`, and forget still fences by epoch. The ruling is CQ 162 in `docs/briefs/012-design.md`, with a matching line in `.kiro/steering/memory-writes.md`. Three red cases went green in the fix commit; the two raise sites of `policyRev` are pinned by a script test. | `packages/core/src/eligible.ts`, `packages/core/src/eligible.test.ts` (one case changed, named in CQ 162), `packages/core/src/eligible.context.test.ts`, `packages/core/src/eligible.row-*.property.test.ts`, `packages/server/src/routes/policy-rise.test.ts`, `scripts/policy-rev-raises.test.ts` |

### Closing this brief

- **The rails comments now say what the code does today** (comment lines only in `machine.ts`): an early timer tick re-arms its deadline instead of doing nothing; three deadlines (`outstanding[].deadline`, `missing[].until`, `stateSentAt + STATE_STALE_MS`) are read with no timer; `step` does not throw on a well-typed event, but six listed Realtime types throw when their fields are missing (`conversation.item.added`, `response.created`, `response.done`, `response.output_audio_transcript.done`, `error`, and `conversation.item.input_audio_transcription.completed` with no `transcript` for an item of the current unposted Turn). The first five were found by a scratch run that sent bare types in LISTENING and SPEAKING; the sixth needs an unposted Turn with that item and was found by a later review run in SPECULATING and SPEAKING. The list is what those runs found, not a proof that no other type throws. The message of commit `17a9279` says five and stays; the `connect` limit covers the microphone prompt today; the answer wait can be armed in RECOVERY (line), where it does nothing; `lineDone` is armed by a `missing` or a `failed` post; `speakCap` can be armed in TOOL_WAIT and its firing is described; the poll's "never two in flight" holds only while every state answer is the Session's own; `reconnect`, `retryUi` and two reset-table cells carry their conditions; `onState`'s reset on reaching LISTENING is noted.
- **`voice-unlisted.transitions.test.ts`** pins `onRealtime`'s default: four unlisted types (`session.updated`, `rate_limits.updated`, `response.output_audio_transcript.delta` and a made-up one) in LISTENING and SPEAKING return the same state object and no commands. Shown red once: with a `throw` in the default, all 8 cases failed; the file was restored before the commit.
- **The pages** now match the code at this HEAD: `deploy.ci` as `ci.yml` runs it, a `deploy.secretScan` entry and index row, and the workflow's path in the steering pattern; `ui.ringSpark` as built, with the ring spark and the three.js ghost as grant holders; eligibility as it is now, where `policyRev` is raised and what it still cancels; where the reset table, the timer table and the closed switches live. Eleven rows whose files now exist moved off `planned`: `voice.turnMode`, `voice.replyStage`, `ui.ringSpark`, `ui.levelTap`, `ui.rendererPhase`, `ui.frameLoop`, `ui.acting`, `memory.status`, `memory.slots`, `memory.ruleState`, `memory.bundle`. Three rows stay `planned` because their files do not exist: `voice.turnAnswer`, `client.authSession`, `client.reaction`.

## Red cases still open

Every `it.fails` in `apps`, `packages` and `scripts`: 20 cases. Each was run once with `.fails` removed, and the message below is what it printed then. Each fails at the assertion that states its title's rule.

### Waiting for B1, B2 and B4

| File > test | Sequence | Failure message | Waits for |
|---|---|---|---|
| `packages/server/src/worker/tick.test.ts` > a stale Q13 does not fail open | Open S1; advance `SESSION_IDLE_MS` + 60 s; open again on a store where a rival rewrites S1 after Q13's close body ran and before its commit | `expected 409 to be 200` | B2 |
| `apps/web/src/client/api.token.test.ts` > a rejecting getToken resolves network | `getToken` rejects with `auth/network-request-failed`; `call("/api/session/close", { body: {}, timeoutMs: 1500 })` | `promise rejected "Error: auth/network-request-failed" instead of resolving` | B1 |
| `apps/web/src/client/typed-replay.test.ts` > a retry on an advancing clock sends a byte-identical body and replays | A typed line; the first `/api/turn` commits on the server, then the fetch throws; the opsClock moves 1,000 ms; send again with the same text | The two bodies differ only in `utteredWorldAt` (`12:00:00.000Z`, then `12:00:01.000Z`) | B4 |

"Today" pins deleted with these fixes, each marked in its file: `today: a Q13 close that loses its race fails the open with 409 STALE` (tick.test.ts), `today: a rejecting getToken rejects the call instead of resolving an ApiResult` (api.token.test.ts), `today: the retry on an advancing clock differs only in utteredWorldAt and answers HASH` (typed-replay.test.ts). `today: a hanging getToken is not on the timeout` stays: B1 does not change it.

### Waiting for V1 steps 3 to 5

| File > test | Failure message | Waits for |
|---|---|---|
| `voice-setup.transitions.test.ts` > CONFIGURING + stateOk (ack dropped by an earlier Session's turn answer) -> asks once more -> LISTENING | a second state request in CONFIGURING: `expected [ 'armTimer' ] to include 'state'` | step 5 |
| `voice-setup.transitions.test.ts` > CONFIGURING + stateOk (ack dropped by a turn answer from before the reconnect) -> asks once more -> LISTENING | the new Session reaches LISTENING, not recovery: `expected 'RECOVERY' to be 'LISTENING'` | step 5 |
| `voice-recovery.transitions.test.ts` > RECOVERY + timer reconnect -> CONNECTING (a muted mic stays muted across the reconnect) | micMuted after the reconnect's open: `expected false to be true` | step 3 |
| `voice-recovery.transitions.test.ts` > LISTENING + connectionLost -> RECOVERY (no Try again shows that a press can't act on) | a shown Try again did nothing when pressed: `expected false to be true` | step 4 |
| `voice-recovery.transitions.test.ts` > HELD + turnFailed -> RECOVERY (connection recovery clears the state-retry control) | stateRetryVisible after connection recovery: `expected true to be false` | step 4 |
| `mic-muted-by-owner.property.test.ts` > micMuted changes only on mutePressed or when the call ends (seed 3, 1,000 runs) | `Property failed after 8 tests`; step 6 (timer, RECOVERY -> CONNECTING) set micMuted false | step 3 |

The sequences are written out in each test. The two mic pins in `apps/web/src/client/voice-client.mic.test.ts` (`today: mic allowed at 8 s goes through RECOVERY, and the call connects on a second Session` and `today: a rejected mic opens four Sessions and shows no mic message`) are today's side of V1 step 2 and flip in that step; they are not `it.fails`.

### Waiting for V2

| File > test | Failure message | Waits for |
|---|---|---|
| `voice-turn.transitions.test.ts` > HELD + timer permit -> RECOVERY (an admitted Turn cut by a higher Deck before its transcript is still posted once) | posts of the admitted Turn: `expected +0 to be 1` | step 2 |
| `voice-turn.transitions.test.ts` > RECOVERY + timer lineDone -> LISTENING (an error naming the admitted create keeps its unposted Turn until posted) | posts of the admitted Turn: `expected +0 to be 1` | step 3 |
| `voice-turn.transitions.test.ts` > HELD + commit, then timer permit -> RECOVERY (a once-admitted Turn grown after a cut is still posted once; seed 42) | posts of the admitted Turn: `expected +0 to be 1`. Shrunk from seed 42, run 18,417 of 20,000 over `arbCall` | step 2 |
| `voice-turn.transitions.test.ts` > RECOVERY + commit -> WAIT_ITEM (a commit after an error on the admitted create still posts the admitted Turn; seed 99) | posts of the admitted Turn: `expected +0 to be 1`. Shrunk from seed 99, run 3,783 of 20,000 over `arbCall` | step 3 |
| `admitted-turn-posted-wide.property.test.ts` > every admitted turn is posted once, or the call ended, or it is still collecting audio (seed 2, 1,000 runs) | `Property failed after 8 tests`; a Turn admitted at step 14 was never posted. It shrinks to the shape of the first voice-turn case above | steps 2 and 3 |
| `voice-posts.transitions.test.ts` > HELD + turnOk stale (higher Deck) -> HELD (the resend gets the full answer wait) | the resend's Permit is sent for checking: `expected false to be true` | step 4 |
| `voice-posts.transitions.test.ts` > HELD + turnOk stale (after a poll's higher Deck) -> HELD (a higher Deck never shortens the resend's answer wait) | the resend's Permit is sent for checking: `expected false to be true` | step 4 |
| `voice-posts.transitions.test.ts` > HELD + timer permit during the Permit's hash check -> HELD (a Permit inside the answer wait plays) | the checked Permit's reply is admitted: `expected undefined to be 'u0000…'` | step 5 |
| `voice-posts.transitions.test.ts` > SPEAKING + turnOk hold with a retry hint -> SPEAKING (an admitted Turn's post is resent after the hint) | a resend is scheduled: `expected undefined to be defined` | step 6 |
| `voice-posts.transitions.test.ts` > LISTENING + turnOk stale for a Superseding_Post -> LISTENING (resent once as a Superseding_Post, no reconnect) | the call is not torn down: `expected true to be false` | step 7 |
| `voice-posts.transitions.test.ts` > RECOVERY + turnOk stale for a Superseding_Post -> RECOVERY (the resend is the Superseding_Post, never the missing post) | the resend is the Superseding_Post: `expected { kind: 'turn', body: {…} } to match object {…}` | step 7 |

For the two stale-resend cases the trace shows the original post's permit wait (`timer:permit HELD->RECOVERY`) ending before the resend's answer arrives. `voice-turn.transitions.test.ts` also pins, as today's behaviour, `SPEAKING + stateOk (higher Deck) -> HELD (today the cut leaves admittedTurnId naming the cut Turn)`; it follows the default of contract question 2 in the brief (leave today's behaviour), so it does not change with V2.

### Property 13 on a fresh seed

`packages/core/src/voice/admitted-turn-posted.property.test.ts` (Property 13, 1,000 runs over `arbCall`, no fixed seed) fails on some seeds. A review of this step's HEAD saw it fail in 3 of 91 runs (one full `npm test`, then the file alone 90 times), at seeds -81537958, -234263625 and 283257402; a second review saw 12 of 300 fresh seeds fail. Brief 012's seed -1393276649 also still fails. These runs were made by the reviews; this step did not rerun them. The failures have three shapes:

- **An error naming the admitted create, then a commit.** The same shape as the seed-99 case under V2 above.
- **A higher Deck cuts the admitted Turn.** The same shape as the seed-42 case under V2 above.
- **An admitted Turn whose only transcript comes back empty.** Sequence: commit, `conversation.item.added`, the judge's `response.created`, the hash check, the judge's answer `O` (`fastO`), the hash check, then `conversation.item.input_audio_transcription.completed` with an empty `transcript`. `maybeAdmit` sees every transcript blank, cancels the reply, clears `admittedTurnId` and goes to LISTENING with no post, so the admitted Turn is never posted. Seeds -81537958 and 283257402 are this shape. It has no `it.fails` case. `machine.test.ts` > `item 9: an empty transcript while the reply plays ends it with a cancel, a clear and its receipt` pins the drop as correct, and the `voice.call` page says noise with an empty transcript is no Turn; Property 13 says the opposite for a Turn that was admitted. Contract question Q-SM18 in the brief asks which holds. The property file is tracked and was not edited.

### Turned green on this line

- B3's four: `SPARKING + reducedOn -> IDLE, grant released`, `SPARKING + formLeft -> IDLE, grant released`, `SPARKING + animationCancel -> IDLE` and `SPARKING + unmount -> IDLE, grant released`. Each failed with the spark still `sparking` and its grant held (`expected { mode: 'sparking', token: 1 } to deeply equal { mode: 'idle' }`, and for unmount `budget.active()` still 1).
- S6's three: `eligible: a stored row's policyRev never decides the answer when the row is at or below the current policyRev` failed with seed 1864038157, counterexample an active U Memory at epoch 1 stamped `policyRev` 1, read at `policyRev` 2, answered `{ allow: false, reason: 'freshness' }`; the two `policy-rise` cases (a late forget on a Superseding_Post, and on a Parse_Repair) failed at `expect(out.recalled.readerCalls).toBe(1)` with 0, because every stored Memory was dropped before the read.

## The wide generator's reach

Counted over 1,000 samples at seed 2026 by `packages/core/src/voice/testing/arb-call-wide.test.ts`. A floor is about half the lowest count over seeds 2026, 1 and 99; the test fails below it.

| Count | Floor | Situation |
|---:|---:|---|
| 707 | 350 | setup: started at `callPressed` and reached LISTENING through generated steps |
| 412 | 190 | reconnect: a later Session with a new `sessionId` |
| 446 | 210 | gap: an event handled in CONFIGURING before its state answer |
| 178 | 80 | late answer: a turn or state answer from an earlier Session |
| 178 | 75 | late answer in CONFIGURING |
| 145 | 70 | mute: the Owner's `mutePressed` toggled the mic in a call |
| 88 | 40 | mute: muted when connection recovery began |
| 52 | 25 | higher Deck between admission and the transcript |
| 86 | 35 | higher Deck on a stale turn answer |
| 52 | 25 | higher Deck on a poll while a `fastO` reply is admitted |
| 53 | 25 | equal-revision Deck with different safe turns |
| 18 | 6 | equal-revision Deck with different safe turns while a Permit is being checked |
| 15 | 7 | error naming the admitted reply's create |
| 113 | 50 | hold with a retry hint |
| 25 | 12 | hold with a retry hint for an admitted Turn |
| 88 | 30 | stale answer to a Superseding_Post |
| 25 | 12 | permit wait ended while a Permit was being checked |
| 72 | 25 | `retryPressed` in connection recovery while only the state-retry flag shows Try again |

The gap count reads 446, 425 and 436 at seeds 2026, 1 and 99. With the gap steps switched off it reads 103 and the test fails on that line. Rare paths with no floor: the reply stage `toolWait` was seen 85 times over 30,000 `arbCall` calls and 5 times over 30,000 wide calls (seed 31337); `judgeOnly` was never produced by either generator.

## Not built

What a person on a call meets today because of each:

- **V1 step 2, the microphone as a step.** The 5 s connect limit runs while the browser's permission prompt is open, so an Allow after 5 s goes through recovery; a blocked mic is retried three times as "trouble connecting"; an unplugged mic leaves Franki in Listening, deaf.
- **V1 step 3, mute kept across a reconnect.** A reconnect turns a muted mic back on.
- **V1 step 4, "Try again" never dead.** "Try again" can show in connection recovery and do nothing when pressed.
- **V1 step 5, the setup step asking once more.** A late answer from the last call can cost the new call a reconnect.
- **B1, a rejecting token.** After a hang-up whose token refresh fails, the Call button stays on "Hanging up", the first Sign out does nothing, and the receipt is never retried.
- **B2, the tick's lost race.** A lost maintenance race fails the open.
- **B4, a typed line's identity.** A typed line the server saved answers 409 HASH on every retry.
- **B5, background failures in the log.** A failed background task never reaches the JSON log.
- **V2.** An admitted turn can go unposted after a higher Deck; an error on the admitted reply drops the unposted turn; after a stale answer the resend gets 2.5 s or about 1 s, so a saved turn may never be spoken; a Permit that arrives just before the limit is dropped mid-check; a held turn dropped by a barge-in leaves later turns unrecorded, and an admitted turn answered `hold` is never retried; a late transcript's Superseding_Post answered `stale` or a network error tears the call down; Call, hang up, Call can adopt the first open's Session, or die on the first open's failure.
- **V3.** The Permit hash does not bind the create that is sent; the judge hears less than the reply after a barge-in; latency rows can be negative, left open, or carry a loud time from the last call; cancels for finished responses count as Realtime errors, and an error in CONFIGURING is not counted.
- **S1, routes.** The reply can be stored before its question; a committed open can answer an error.
- **S2, recall.** "Nothing saved" is said for a withheld answer and for an empty parsed read; a second recall in one turn goes silent.
- **S3, the worker.** A rejection at commit time is never counted as an attempt.
- **S4, the Debug panel.** The Debug ledger's "played" row can be wrong after a cut.
- **S5, server config.** A missing server variable makes the call loop.
- **S6, the rest.** A past event can still be called coming up; a correction may not reach the Head during a call; the store does not refuse a status move outside the table.
- **S7, the judge spike.** Nothing on a call. The spike's summary numbers are as before.
- **S8, the typed line.** The first typed line after a call can fail STALE, a draft is wiped on success, and wire codes show in the typed box.
- **U1, Electricity grants.** An Electricity holder that was refused a grant never asks again until its effect runs again.
- **U2, avatar events.** The wake can replay on a quick redial.
- **U3, level taps.** Nothing known on a call; the change would give each analyser its own tap state.
- **W1, App wiring.** A sign-out from another tab can leave a call running; Call can be pressed during a typed open; hiding the page does not hang up.

## Not verified

- **No live call has been made on this line.** None of the voice changes, the ring spark or the eligibility change has been checked on a real call.
- **The ring spark's look in a browser.** Not looked at. The React wiring (the prop effect, the unmount cleanup, the `animationEnd` closure, the `animationcancel` listener on the span's ref, `pressed` carrying Reduced_Motion, and the span's key) has no test: the web app has no DOM test environment. Steps for a browser check, beyond a hang-up showing no spark: press the start ring and, inside the spark (about 640 ms), turn on reduced motion, then start a call and see both wake strikes; press and sign out inside the spark, sign in, call, see both strikes; press and cancel the animation inside the spark, call, see both strikes; with reduced motion on, press: no spark and no strike lost.
- **The ring spark's release runs in a passive effect,** after the avatar's Electricity effects in the same commit. Not reachable today, because the look arrives on a later animation frame; a later change that publishes the look in the same commit as the voice state would make a refused Electricity lose a strike. The `PURE_MODULES` line for `ring-spark.ts` has no test, and "the step never reads the budget" is a review rule, not a check.
- **The secret scan has never run.** It needs a push, and a push needs the owner's yes. It is predicted to fail on its first run: `apps/web/apphosting.yaml` sets `NEXT_PUBLIC_FIREBASE_API_KEY` to the public Firebase web config value, which has the shape gitleaks' `gcp-api-key` rule matches, and it is in history reachable from every branch. The choice is one reviewed `.gitleaksignore` line exempting that commit, file, rule and line only, or an accepted red scan. The first run's log should be read for other hits before choosing. No workflow has a local test. gitleaks' default OpenAI rule needs the full key shape and no default rule matches the `ek_` prefix the build grep checks.
- **T1's three done-when checks are not done:** the first run's "commits scanned" against the commit count (`git log -p` shows no diff for a merge, so the two may differ by the merges; the workflow prints both counts), a throwaway branch with a fake full-shape key deep in history going red, and a branch with a build folder missing going red. The key grep's exit 2 path (an unreadable folder) was never exercised. The message of commit `a0d81ad` says a pushed branch's run always finishes; the workflow comments were corrected later in `8298880`, and the commit message stays.
- **The machine index.** The path scan skips a backticked path with a line number, a folder, and a path whose top folder it does not list. A multi-line mermaid note would be read as states; no page has one. Of the store page's transaction rules, only "an update needs a read or an expected rev" has a conformance test by that name; the others are enforced by the store code.
- **The deadline ladder** imports limits from twelve files. A limit renamed on another branch turns it red at that merge, and the failure names the constant.
- **The voice rig.** "Connection lost while a reply slot is filled" is reached about once in 500 calls and has no floor; a pin covers it instead. A red case cannot tell its rule failing from a broken setup step; today each fails at its labelled assertion. The wide driver's `fire` can jump past timers due earlier. Two of the Turn-mode allow-list's entries (`admittedWithoutReply`, `admittedWithoutTurn`) follow from a cut leaving `admittedTurnId` set, which contract question 2's default keeps, so they cannot empty unless that question is reopened; the third (`unpostedInRecovery`) has to change its wording when V2 step 3 lands. The recall path is rarely reached: the wide generator reached TOOL_WAIT on 0 of 40 seeds and `arbCall` on 8 of 40 at 1,000 runs, so a regression there is caught on about one run in eight.
- **The reducer's review findings not acted on here.** The six Realtime types that throw on a missing field are now stated in the header, not guarded. Whether `onLateTranscript` and `onHeldBackTranscript` throw on a `transcription.completed` with no `transcript` was not run; by reading, they store it and do not call `trim`. `stateOk` and `stateFailed` still do not name their request, so another Session's late answer can end the poll's wait early. Two paths are invisible to the corpus and the suite: `closeFailed` while hanging up, and the `tool` timer firing in SPEAKING with a recall pending; no transition test covers them yet. The `onTimer` default is not reachable at run time and has no test.
- **Steering.** Rule 4 of `.kiro/steering/state-machines.md` still says a timer "whose deadline is absent or not reached does nothing"; the reducer re-arms a tick that comes early. Only the `fileMatchPattern` line of that file was changed in this step.
- **Eligibility.** The epoch half has the same shape as the `policyRev` one: nothing restamps the rows that survive a forget, so an unrelated Memory would be hidden by a forget unless forget's closure rewrites it (CQ 162, left for F4). The row-epoch property's header describes a wider generator than it draws, and the row-`policyRev` property's title says rows where it draws Memory rows only; both are tracked property files, so they were not edited, and `eligible.row-stamp.property.test.ts` states both properties over Memory and Evidence rows. The memory-writes steering test's title still names one phrase fewer than its list holds.
- **The pages' other blocks** were not all re-read against the merged code in this step. Re-read: `deploy.ci`, `deploy.secretScan`, every `ui.*` block named above, `memory.eligible`, `memory.epoch`'s raise sites, the four write-side blocks, and the `voice.call`, `voice.turnMode` and `voice.replyStage` blocks.
- **`npm run test:emulator`** was not run in this step.

## Checks

Run in the `build/next` worktree after the last code commit of this step (`30513db`) and the page commit, one at a time:

| Check | Result |
|---|---|
| `npm test` | exit 0 on the recorded run: 236 test files, 2,665 tests (2,645 passed, 20 expected fail). Can exit 1 on a fresh seed of Property 13 (3 of 91 runs in a later review; seeds above) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `scripts/machines-index.test.ts`, `scripts/state-machines-steering.test.ts` | 2 files, 23 tests passed |
| `packages/core/src/voice` | 28 files, 178 passed and 17 expected fail, golden corpora equal with no re-record |
| `voice-unlisted.transitions.test.ts` with a `throw` in the `onRealtime` default | 8 of 8 failed (shown once, then restored) |

`npm run test:emulator` was not run. No command made a network call.
