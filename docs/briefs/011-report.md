# Brief 011 report: wave A (the judge in the call)

Spec: `.kiro/specs/voice-control/` (requirements, design, tasks). Branch `build/voice-control`. Wave A is tasks 1 to 44; all are done. Wave B (tasks 45 to 53) has not started and waits for the owner's live check and answers to Q54, Q68 and Q79.

## Checks

All run with `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1`, on the owner's Windows machine, after task 43:

| Command | Result |
|---|---|
| `npm test` | exit 0: 161 files, 1,464 tests |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 (includes `scripts/judge-spike`; `tests/` checked with `npx tsc --noEmit -p tests`) |
| `npm run build` | exit 0 |
| `npm run test:emulator` | **not run** (see "What couldn't be checked") |

No command called OpenAI. Nothing ran with `--live`. Nothing was pushed or deployed.

## What was built and where

**Core (`packages/core`)**
- Judge settings and the `judge_v2` candidate: `voice/judge.ts` (`5e0bf2c`). `APP_JUDGE_SETTINGS` is judge_v1, no output cap, effort minimal, 1,200 ms; `JUDGE_CONTRACT_SETTINGS` keeps contracts §5's 16 tokens and 600 ms.
- TurnIntents request, parser and priority: `intents/{classes,request,parse}.ts` (`7bdf4c3`). Regex_Table: `intents/regex.ts` (`50040f8`).
- Fixed_Lines and VAD constants: `voice/lines.ts`, `voice/vad.ts` (`737ba98`). Latency_Clock: `voice/latency.ts` (`30fda72`).
- The Server_Rule: `admission.ts` `serverRule` (`2c3d8eb`, fixed in `6b48d19`, late-hit change `7819f9d`). `devPermitKind` and `AdmissionTurn` are deleted (`d7c1dce`).
- The FastO_Rule: `voice/fast-o.ts` (`26c91d2`).
- The Voice_Machine: `voice/machine.ts`, judge and speculative reply at the commit, verdicts and `fastO`, turn responses and cuts, deadlines, `missing` posts and the superseding post, polling, latency rows (`f960485`, `2563adf`; tasks 25 to 28 recorded in `9a82bac`, `4a855ef`, `70e298f`, `2b71e27`).
- Generators and trace helpers for the properties: `voice/testing/`, `intents/testing/` (`6679748`, `d4350cf`, `47b9167`).

**Server (`packages/server`)**
- Decisions_Port with live adapter and fake: `intents/decisions-port.ts`, `openai/{fake,live}.ts` (`6e17f89`). Slow parse runner: `intents/slow-parse.ts` (`fcc8c57`, `99ef7be`).
- Admission_Seam: `admission/seam.ts` `admitRule` and `recordFastO` (`2a94f27`). `admit` and `dev-admit.ts` are removed (`d7c1dce`); `seam.test.ts` carries every check `dev-admit.test.ts` had (listed in that commit's body).
- `/api/turn` with the slow parse and the Server_Rule on every transcript, the status mapping and the audience lease: `routes/turn.ts`, `audience.ts`, `turns.ts` (`12da9dd`).
- The Superseding_Post: `routes/turn.ts` `postSupersede`, `audience.ts` `advancedWatermark` (`6e49b74`).
- The Parse_Repair: `intents/repair.ts`, scheduled from `routes/turn.ts` (`4ca0461`).
- `/api/session/state` ack refusal and the 30 s write throttle (`791818e`); `/api/receipt` records `fastO` (`01c3894`); `/api/tool` through the Server_Rule (`1d3c7ab`).
- Debug route reads the seam's records: `routes/debug-memory.ts`, `DebugPage` in `core/schema/wire.ts` (`d7c1dce`).

**Web (`apps/web`)**
- Voice_Client: `client/voice-client.ts` answers `hashPayload`, dates `stateOk` with `sentAt`, sends `lastLoudAt` on each commit from 20 ms samples of the new `LevelMeter.rawInput()`, keeps every `/api/turn` attempt inside 5,000 ms, and sends the Superseding_Post with the first request's ID (`109db43`).
- Debug_Panel: `components/DebugPanel.tsx`, `client/debug-panel.ts`: latency block, audience block, decisions grouped by Turn with the played one marked (`aac85a5`).

**Harness (`scripts/judge-spike`)**
- `--judge judge_v1|judge_v2`, the app's 1,200 ms deadline by default, the slow parse per line through a fake Decisions port (live only with `--live`), new per-row fields, the slow-parse summary section, and the run file's `decisions` field: `harness.ts`, `cli.ts`, `summary.ts`, `decisions.ts` (`cad2e90`). `lines.json` is unchanged (`git diff --exit-code` exits 0).

**Tests and repo**
- Steering (`cc62b0f`), the property guard (`bf2983e`, hook `de3e4bf`), twelve wave A properties (tasks 14 to 23 and 33), the emulator timing test `tests/firestore/slow-path-timing.test.ts` (`ff69521`).

## Properties that ran red

Each was recorded in its task's Notes in `tasks.md` before any fix. No property file was edited by the build; the one property correction (P5) was made by the reviewer.

**P5, stale events are inert (task 18).** It passed 1,000 runs when committed, then failed in the full suite on other seeds:
- seed `-1920710077`, path `270:5:0:0:…`: `[[commit (300), itemAdded 0 (40), transcript 0 (0), turnFailed 0 (0), timer due (100), commit (300), itemAdded 0 (40), transcript 0 (0), turnOk 0 ordinary hashOk (400), hash 0 ok (0), created 0 (30), started 0 (300)]]`;
- seed `192887172`, path `47:1:2:0:…`: `[[connectionLost (0), timer due (100), timer due (100), commit (300), itemAdded 0 (40), transcript 0 (0), turnOk 0 ordinary hashOk (400), hash 0 ok (0), created 0 (30), started 0 (300)]]`, failing with `expected 'SPEAKING' to be 'HELD'`;
- seed `1882653300`: the same shape after a `connectionLost`.
- Cause: the statement counted any `teardown` before a step as cancelling a response, even one before the response existed, so a reconnected call's first permitted reply looked stale. The machine was right. The build stopped (`caee0b7`); the reviewer corrected the property in `d607111` (only a cancel or teardown after the response was created counts). It passed 6,000 runs, including these three seeds.

**P6, every wait ends (task 19).** Red as expected on the old machine: seed `-944006138`, path `8:1:1:0:0:…`, `[[commit (dt 300), itemAdded pick 0 (dt 40), transcript pick 0 (dt 0)]]`. The turn was posted and the machine sat in HELD with no deadline. Fixed in `2563adf` (task 27): every post arms the permit wait at post + 5 s, and SPEAKING has a 45 s cap.

**P8, the seam is total and closed (task 22).** Red on first run: seed `391587391`, path `39:1:2:2`, `{source:"tool", transcript:"final", judge:"error", parse:{kind:"none"}, regexMatch:false, audience:"private", narrowedHere:false, callLive:false, parseGap:false, noteSens:"none", wordsPer2s:false, allFinal:false, toolParseCommitted:true, wave:"A"}`. Rule row 3 gave a tool continuation all notes on a turn the judge didn't mark O (R8.12); row 13 had the same fault for typed sources with a non-typed judge. Fixed in the rule, `6b48d19`. Separately, its exhaustive half (1.7 M inputs, about 67 s) could not fit vitest's 5 s limit; the plain generator now enumerates 36,288 inputs, which the reviewer accepted.

**First full runs of the new Voice_Machine (task 24, before `2563adf` landed).** Each red run was fixed in the machine, not the property:
- P6, seed `317106658`, path `307:5:0:0:…`: `[commit 300, itemAdded 0 40, transcript 1, timer due 100, stateOk fresh 100, turnOk ordinary 400, higherDeck, timer due 100, stateOk fresh 100]`. A higher Deck cancelled a pending check in HELD and armed no deadline. Fix: a higher revision in HELD also arms the permit wait.
- P6, seed `-710847600`, path `216:2:1:…`: `[commit, itemAdded, created 1, hash ok, judgeDone O 100, hash ok, transcript, turnOk ready 400]`. Stuck in HELD after a cut with a pending check. Fix: every `requestVerify` arms the permit wait if none is armed.
- P1, seed `-2068053382`, path `242:4:0:2:4:…`: the hash at unmute differed from the Permit's. The run printed no counterexample; the cause came from the next run's shrunk shape: a commit joined a Turn whose reply was already admitted and changed its audio IDs. Fix: such a commit is a barge-in.
- P1, seed `1315630625`, path `13:5:0:0:…`: `[commit 300, itemAdded 40, hash ok, transcript, turnOk ordinary 400, hash ok, created 30, started 300, fnCall]`. Output was unmuted in TOOL_WAIT (the old machine did this too). Fix: a recall during audio stays SPEAKING until the audio stops; a ready tool result mutes and clears a lead-in still playing.
- P4, seed `-261621374`, path `824:5:0:…`, and seed `-1254558683`, path `923:5:0:1:…`: `[stateOk, speechStop, commit, itemAdded, created, created, hash, started, hash, stopped, done, timer, speechStart, commit, itemAdded, transcript, transcript, hash, transcript, turnOk ordinary, hash, created, started]`. A speculative reply that had finished generating left `inFlight`, so barge-in never cancelled it by ID. Fix: `cancelAll` also cancels the judge's and the speculative reply's IDs.
- P4, seed `-1179874900`, path `388:4:1:…`: `[commit, itemAdded, created 1, created 0, hash, judgeDone U, foreign cancelledStart, hash, transcript, turnOk ordinary, hash, created, started]`. Audio of an already cancelled reply started after the clear, and the next reply was created without another clear. Fix: stray audio is cancelled by ID and sets `strayAudio`; the next reply clears first.
- P2, seed `1285614937`, path `760:4:1:…`: `[commit, itemAdded, created 1, timer due, timer due, commit, itemAdded, created 1, hash, judgeDone O, hash, hash, created 0, started]`. After a judge timeout held the Turn, a new fragment joined it and a second speculative reply under the same turnId played. Fix: a held Turn never speculates again.
- P7, seed `592073658`, path `729:5:0:…`: `[commit, itemAdded, transcript, timer due, stateOk fresh, turnOk ordinary 0, commit, itemAdded, created 1, judgeDone O 100, hash ok]`. An ack that arrived before a later `/api/turn` answer granted `fastO`. Fix: every turn answer drops the held ack.
- After these fixes, the eight machine properties passed 12 consecutive full runs of 1,000 cases each on fresh seeds.

**P11, a repaired gap leaves no trace (tasks 33, 37, 38).** Red as expected until the repair existed:
- task 33: seed `-2118694151`, path `0:0:0:0:0`, `[{kinds:["typed"], k:0, how:"deadline"}]`. The wrong run had `committedParseSeq` 0 (want 1), the lease still held, `parseState` "failed" and `uncertainSpeaker` 0. An earlier run (seed `249418788`) failed inside the generator, which queried jobs with an undeclared index; `arb-turns.ts` now reads the job by ID.
- after task 37 (superseding post built, repair not yet): seed `-123574846`, path `1:0:0`, the same counterexample.
- Fixed by the Parse_Repair (`4ca0461`). Green in every run since.

**Why `2266a67` raised the test timeout.** After task 38, a full `npm test` failed property 8's exhaustive half with "Test timed out in 5000ms": it took 5,234 ms. Alone it takes about 2 s. The full suite runs about 160 files in parallel workers, and under that CPU contention the 36,288-input loop crossed vitest's default 5 s per-test limit. The property file is committed and guarded, so it can't take its own timeout argument; the global `testTimeout` in `vitest.config.ts` went from 5 s (the default) to 15 s instead. No assertion, input count or run count changed, and nothing was red apart from the timeout. The cost: any test that hangs now takes 15 s to fail instead of 5 s. If the owner prefers, the alternative is a per-file limit added by the reviewer in the property file.

## Contract questions

Q52 to Q92 are in `.kiro/specs/voice-control/design.md` under "Contract questions". The three marked Owner need an answer before wave B: **Q54** (deadlines), **Q68** (crisis always takes the reply) and **Q79** (quiet is recorded as company).

52. The company miss gets both nets.
53. The VAD stays `semantic_vad`.
54. Deadlines, from the measured transcript times. **Owner.**
55. Company and quiet always hang up.
56. `judge` on a turn posted before its verdict.
57. The ledger can't record kind, verdict, route or false hold.
58. Two decisions for one turn.
59. A Fixed_Line is an `ack` note.
60. What each `TurnResponse.status` means.
61. How `fastO` learns what the browser can't see.
62. No speculation while `noteWaiting`.
63. A `fastO` reply plays on when the transcript goes missing.
64. Typed U lines are parsed.
65. `slowOrdinary` audio doesn't need judge `O`.
66. Which transcripts get the parse.
67. Wave A routes for classes without handlers.
68. Crisis always takes the reply. **Owner.**
69. Where `why` sits.
70. The Regex_Table, and where it decides.
71. The 800-token input cap.
72. The Decisions request.
73. The parse watermark.
74. The generation stays per Session.
75. Fragments across turns.
76. A function call inside a speculative reply.
77. Tool continuations.
78. `fastO` is the browser half of the seam.
79. Quiet is recorded as company. **Owner.**
80. `unknown`, the Effective_Audience and the repair.
81. Swap mechanics (wave B).
82. Judge settings.
83. The Latency_Clock's ends.
84. The state route's Session write.
85. `event_id` on the judge and the speculative reply.
86. Local phases.
87. Which control replies have tools.
88. Permit scope `ack` means "no tools".
89. The Superseding_Post.
90. A Regex_Match has no field.
91. Where `alone` sits (raised in task 4).
92. A late hit cuts only when its route changes what is said (raised by the review of the build).

One more point for v3, not yet a numbered question: a late hit from the Parse_Repair writes a `blocked` decision with `reasonCodes:["time"]`, because the closed reason enum has no code for "late control hit".

## Requirement changes

Before the build (requirements and design reviews, `ecee93a`, `5c1b656`, `73ad3fb`, `2b90779`): this spec supersedes first-spoken-call R17's `devAdmit` criteria (17.4, 17.5, 17.6, 17.8 and the issuer in 17.10), R15.11's 1.5 s missing-transcript limit and its rule that a late transcript is dropped, and the Voice_Client's 10 s `/api/turn` timeout, now 5 s.

During the build:
- **R10.7** (`7bdf4c3`, Q91): `alone` added to the priority order directly after `quiet`.
- **R11.6 and R12.7** (`7819f9d`, Q92, from the review of the build): only a control hit whose route changes what is said (retained `crisis`, `forget`, and in wave B `alone` and the company or quiet swap) cuts a reply already playing; any other hit answers `ordinary` with its `postCommitControl` Permit, and the playing reply finishes.

## What couldn't be checked

- **`npm run test:emulator`, including the new slow-path timing test (R23.2, R24.3).** Not run. Java 21 is installed here, but the script starts `npx -y firebase-tools@15.34.2`, which can reach the npm registry and download the emulator, and this build makes no network call. CI runs it on push, and nothing was pushed, so it has not run anywhere yet. The test is written and typechecked; it prints max, p95 and p50, and fails on any run over 2,500 ms from the commit, which is the R23.2 stop. Its fake Decisions answer takes exactly 350 ms against the 350 ms deadline, so a run can land on either side; the printed `kinds` says which.
- **Two out-of-band responses on the WebRTC data channel (R23.1).** The Harness proved it over a WebSocket; the app's data channel is untested. What failure looks like is below, in step 6 of the live check.
- **Live latency.** Every number in the tests comes from fake time.
- **The live Decisions deadline share.** No Decisions call has been made.
- **Not built:** the Debug_Panel doesn't count Realtime `error` events, and the Voice_Client doesn't log them. The machine records a refused judge or speculative reply on its state (`spec.failed`, or a judge verdict of U), and the latency row's path shows the effect, but there is no counter to read.

## R23 stop conditions

- R23.1: not checked (live only).
- R23.2: not checked (emulator not run).
- R23.3: met by design and test: one `/api/session/state` poll per second, never two in flight (`voice-client.test.ts`, `machine.test.ts`).
- R23.4: no property is red.
- **R23.5 (local Decisions timing):** no local number can measure a Decisions call. The only Decisions answers here are fakes: the Harness dry run answers at 0 ms (0 of its parses miss 350 ms, which says nothing), the route tests answer at once or never by script, and the emulator test answers at 350 ms by construction. So the "1 in 10 misses 350 ms" check can't be made from dry numbers; the live share comes from the Harness run after wave A (`--live`, `judge_v2` against `judge_v1`, whose summary now prints "Parses over 350 ms" with p50 and p95).

## Live check for the owner (R24.2)

Run on localhost with the Debug_Panel open (`?debug=1`). This is the first time OpenAI is called for this work: the Realtime call, and one Decisions call per spoken turn. Before each step, note the turn count in the Turns section.

1. **An ordinary question.** Say: "What's a good name for a small dog?"
   - Hear an answer in about a second and a half.
   - Latency: last turn path `fastO`, verdict O, refused —, end of speech to audible near 1,300 ms; the `fastO` row of the table gains one. (Before the wave A fixes, most turns showed refused `outstanding` or `ack` here: the turn's own post refused its own `fastO`.)
   - From the second turn of the call on, the turn's reply has the earlier turns in context: the Deck from the state poll carries the last four safe turns, Franki's own replies included.
   - Decisions: one group for the turn with two rows: `▶ played … permit fastO · issuer browser (fastO)`, and `permit slowOrdinary · issuer seam`, not played.
   - Audience private, failed parses 0, no "fastO off" line. Realtime errors 0.
1b. **A follow-up.** Right after step 1's answer ends, wait a second, then ask: "What did I just ask you?"
   - Hear Franki repeat your question about a dog's name, and refer to its own answer if asked.
   - Latency: path `fastO`, as in step 1.
   - If the answer is "I don't know" or a guess, the safe turns did not reach the reply: note the Turns section (the assistant turn from step 1 should be there) and report it.
2. **A line that holds.** Say: "Forget what I said about work."
   - Hear exactly "I can't forget things yet."
   - Latency: path `slow` (or `regenerated` if the judge said O and the cut came after), verdict H or U, refused `verdict`.
   - Decisions: `permit postCommitControl · issuer seam · class: not recorded`, played.
3. **A false hold.** Say a plain line that mentions someone else, for example: "My sister says the weather is nice today."
   - If the judge holds it: a short pause, then a normal reply.
   - Latency: path `slow`, verdict H, refused `verdict`.
   - Decisions: `permit slowOrdinary · issuer seam … false hold`, played. If the judge passed it, the turn reads like step 1; try another line.
4. **An interruption mid-reply.** Ask: "Tell me the whole history of bread." Talk over the answer a few words in.
   - The reply stops at once and no more of it is heard.
   - A new turn starts with your words. The first turn's latency row is closed, and the next answer belongs to the second turn.
5. **Two fragments with a pause.** Say "I'm going to the market," wait about a second, then say "and then to the park."
   - Either one user Turn holding both items and both texts (the second commit came before the first was posted), or two Turns where the first one's reply was cut before it was heard.
   - Every decision belongs to a Turn in the Turns section, and nothing is heard from a reply of a cut turn.
6. **What the data-channel failure in design §"If two out-of-band responses can't run at once" would look like.** Any of these is the R23.1 stop; report it and don't work around it.
   - The speculative reply refused: step 1's row shows path `regenerated` with no muted start, and end of speech to audible longer by about the judge time.
   - The judge refused: every turn takes path `slow`, and every decision is `slowOrdinary` with verdict U.
   - One response cancels the other: a judge `response.done` with status `cancelled`, which parses invalid and holds, so every turn reads like step 3.
   - No error count is shown on the panel (see "Not built" above). Read the effect from the paths.
   - Since the wave A fixes, the panel's "Realtime errors" line counts every Realtime `error` event by the client event it names (judge, spec, reply, other) with the last code. Any count above 0 during steps 1 to 5 is the R23.1 signal; read the code.

## Stop

Wave A ends here. Wave B (tasks 45 to 53: Head compile by audience, company and quiet, the swap, `alone`, property 10) starts only after the live check and answers to Q54, Q68 and Q79.

## Wave A fixes (`docs/briefs/011-review-wave-a.md`)

The review was committed as is (`50b1874`). The reviewer's property 7 change is `704d3de`. Each item has its own commit and a test that failed on the code before it. The first run stopped at item 17, because its crisis sub-item needed an edit to property 8, which is guarded. **The reviewer then changed property 8 in `97d5893`** (the agent's proposal, accepted): a typed line with no call open may carry its typed reply as a note on a crisis hit, still with scope `ack` and no fixed line. Items 17 to 23 were then built, one commit each. All 23 items are done; none was declined.

| Item | Commit | Test that failed first |
|---|---|---|
| 1. A turn's own post doesn't refuse its own `fastO` | `8acb55e` | `machine.test.ts` "item 1: a turn's own post doesn't refuse its own fastO" (the post had dropped the ack). R4.1, R4.3, R20.1.7, design §"The FastO_Rule" and Q61 updated. |
| 2. The poll's Deck carries the safe turns | `5796201` | `state.test.ts` "the Deck carries the Session's current safe turns" (it was `[]`); `machine.test.ts` "a poll sent before the last turn answer doesn't replace that answer's Deck". The state route reads the last turns once for the S2 check and the safe turns (`safeTurnsOf`, shared with `/api/turn`), no new index; the design's budget now says up to 23 reads per poll. |
| 3. A typed line during a call gets its reply | `1bbfc13` | "item 3" (stayed in LISTENING) |
| 4. Speech start in HELD or waiting for the Neutral_Line drops the wait | `1b968e5` | "item 4" (two cases) |
| 5. A new turn doesn't inherit the old turn's deadlines | `8fb9522` | "item 5" (`permit` still armed) |
| 6. An unrecorded post of this Session reconnects, current or not | `d4be34d` | "item 6" (four cases: failed post of a non-current turn, stale answer of a non-current turn, the permit deadline and the request timeout in either order, a non-current answer's higher Deck) |
| 7. An admitted turn whose reply ended is still posted | `8454238` | "item 7" (three cases) and the new property 13 (below) |
| 8. A turn kept after barge-in waits for the next commit | `208f313` | "item 8" (`transcript` deadline still armed) |
| 9. An empty transcript ends a playing reply through `cancelAll` | `c51a8df` | "item 9" (no cancel, no clear) |
| 10. One in-flight check for every state request | `d967b9e` | "item 10" (5 state requests where 2 were expected) |
| 11. An early timer tick re-arms its deadline | `cce1a5d` | "item 11" |
| 12. Stray audio rules out playing the speculative reply as is | `feae6e9` | "item 12: stray audio is cleared before a fastO reply". Its second case (a rejected reply clears) passes on the old code too, because the turn answer's `dropSpeculation` already clears; it stays as a guard for the new clear in `rejectReply`. |
| 13. An empty hash never matches | `3fee5ac` | "item 13" (a `fastO` reply was admitted on two empty hashes) |
| 14. A refused reply create ends the reply in RECOVERY | `7b62827` | "item 14" (waited for the 45 s cap) |
| 15. Realtime `error` events counted and shown | `91e2027` | "item 15" in `machine.test.ts` and `DebugPanel.test.tsx` |
| 16. A `policyRev` rise requeues extraction | `4c88ee5` | `extract.test.ts` "a raised policyRev runs the job again at the new one" (the job was failed STALE). Contract question 93 proposes the KS06 amendment: a changed epoch still fails STALE; a raised `policyRev` requeues at the new one. |
| 17. A typed line with no call open always gets an answer | `7239766` | `turn.typed-no-call.test.ts`: a crisis line, another hit, a failed parse and the 2,000 ms deadline all failed; the `forget` case already passed. R8.9 and Q64 updated. |
| 18. The Parse_Repair's transaction is retried | `3de598f` | `repair.test.ts` "a lost compare-and-set is retried and the gap closes" and "each retry re-checks the lease" (the repair threw `staleRevision` and was lost) |
| 19. An early Superseding_Post gets a retryable hold | `fc45a58` | `supersede.test.ts` "while the missing post is still pending" and the updated "not visible" case (both PARSE); `voice-client.test.ts` "a superseding post that is answered hold is resent" |
| 20. A late `alone` closes its own turn's gap | `38ad73c` | `repair.test.ts` "a parsed alone closes its own turn's gap" and `supersede.test.ts` "closes its own turn's gap" (watermark stayed 0). The old repair test that pinned 0 for the turn's own gap now expects 1; a new case keeps another turn's gap open (R15.8). |
| 21. A pasted turn's tool output is S0 | `c1fc2f5` | `tool.test.ts` "a pasted (T) turn's tool output is limited to S0" (an S1 note came back) |
| 22. The late-hit decision is written by the seam | `5daca01` | `seam.test.ts` "no server source outside admission/seam.ts writes a decision with purpose answer" (`intents/repair.ts` did) and "recordLateHit writes one held decision" |
| 23. The Decisions call starts beside `ensureCoreDocs` and `beginRequest` | `f289b1d` | `turn.typed-no-call.test.ts` "the Decisions call starts beside ensureCoreDocs and beginRequest" (it started after the first transaction) |
| 24. A typed hit with no call keeps its reply in a private audience (owner's decision, after the limit reported for item 17) | `636651b` | `turn.typed-no-call.test.ts` "a hit with no Fixed_Line, crisis included, keeps the S1 typed reply" (notes came back empty). Its other two cases (S0 in a company audience or with a gap; a Fixed_Line class shows its line) passed before and stay as guards. R8.6, R8.9, R8.12, R12.1, R12.2, design rows 7 and 12 and Q64 updated. |

**Choices made while fixing.**
- Item 4: speech start counts as a barge-in in HELD, with a check pending, or in RECOVERY waiting for the Neutral_Line, so a late Permit for the posted turn can't play over the owner. That turn gets no reply; the owner's new speech is the next turn.
- Item 6: an unrecorded answer (`stale`, an error, or a retry `hold`) for a turn that is no longer current reconnects. The current turn's second `stale` and any error answer now reconnect too, instead of dropping the reply and leaving `nextClientSeq` ahead of the server.
- Item 7: the turn is kept as `heldBack`. It is posted `final` when its transcript arrives, `missing` at t0 + 5 s (then a late transcript sends the Superseding_Post), or `missing` just before a newer turn's post, so `clientSeq` keeps commit order.
- Item 14: "recovery, as for a failed slow reply" is read as the same RECOVERY the 5 s permit timeout uses: nothing plays, then listen again.

**Property that ran red.** New property 13, "an admitted turn is posted" (`packages/core/src/voice/admitted-turn-posted.property.test.ts`, helper `drainAll` in `testing/trace.ts`). It fires every armed timer after the trace. Every turn whose reply was admitted must be posted at most once, and exactly once unless the call ended or the turn is still collecting audio. Run on the code before item 7, it failed: seed `-231391213`, shrunk counterexample `[speechStop 900, stateOk fresh 100, commit 200, itemAdded 0 40, created 1 20, judgeDone 0 O 0, hash 0 ok 0, hash 0 ok 0, created 0 30, started 0 300, stopped 1500]`. The `fastO` reply ended before the transcript, and the turn was never posted. It is green since item 7. No other property ran red.

**Item 17 and the property 8 change.** The first run stopped here, as the rules require: property 8 said every crisis reply has `notes: "none"`, and with no call open a typed line's reply exists only as a note. The agent proposed an exception for a typed line with no call open; **the reviewer accepted it and made the edit to the guarded file in `97d5893`** (the agent did not edit it). The crisis clause still requires scope `ack` and no fixed line on every crisis reply. With that, item 17 landed in one commit:
- The Decisions deadline with no call open is 2,000 ms (`DECISIONS_NO_CALL_DEADLINE_MS`). "No call open" means the Session has no `callId` and no registered calls.
- The typed reply is no longer discarded on a hit. Row 12 keeps it as an S0 note. A crisis line keeps it under scope `ack` (row 7, now `S0` for a typed line with no call). A Fixed_Line class shows its line instead, because the seam replaces the notes with the line.
- A failed parse on a typed line with no call carries `RECOVERY_LINE` as an `ack` note, so it shows as text.
- The typed client already rendered every note the Permit carries; nothing changed there.
- One limit, from R8.6 as it then stood: a typed reply whose Head drew on S1 Memories is S1, so on a hit it was filtered out and nothing showed. **Resolved as item 24** by the owner's decision: see below.

**Choices made in items 18 to 23.**
- Item 18: up to 8 transaction attempts, as the routes use. Each attempt re-reads the Session and re-checks the lease token and window. If all fail, the lease runs out and the next request stores `unknown`, as before.
- Item 19: a missing or still-pending superseded entry answers `hold` with `retryAfterMs` 250 and records nothing. The Voice_Client resends a superseding post on that hold inside its 5,000 ms budget, so the machine sees only the final answer; if the budget runs out it is a failed turn, which reconnects (item 6). A complete entry for another turn is still PARSE.
- Item 21: a T-class Turn reaches the rule as not judge-O and not typed, so row 3 limits its tool output to S0. `RuleInput` gained no field, so the property 8 enumeration is unchanged.
- Item 22: the decision's `audience` is the Effective_Audience after the repair commits (the lease is cleared by then, so it equals the stored audience).
- Item 23: a replayed request now costs one Decisions call that nothing uses. The parse also checks the Session for an open call first, which costs one read before the parse starts.

**Properties.** No property ran red in items 17 to 23. Property 8 passed after item 17's rule change, under the reviewer's new statement.

**Item 24.** The owner decided that for a typed line with no call open, in a private Effective_Audience with no parse gap, a control hit whose class has no Fixed_Line keeps the typed reply whatever its Sensitivity, crisis included. That is what an ordinary parse would have shown, and no one else hears typed text. In any other audience, or with a gap, it stays S0. Rule rows 7 and 12 now return notes `all` in that case. The condition also requires `judge:"typed"`: property 8's "all notes" clause needs judge O or typed, and the enumeration found a typed source with judge H on its first run, so the rule follows it. No guarded file changed, and no property ran red apart from that one run, before the condition was added (the exhaustive half of property 8, assertion `expected [ 'O', 'typed' ] to include 'H'`; it prints no seed). Checks after item 24: `npm test` (163 files, 1,510 tests), `npm run lint` and `npm run typecheck` exit 0.

**A flaky test, fixed in `96152ad`.** The reviewer's full-suite runs failed 2 in 5 on `voice-client.test.ts` "a superseding post goes to /api/turn with the first request's ID and speaks nothing" (one extra speech `response.create`); the file alone always passed. With a temporary diagnostic in the test, the 4th full run reproduced it and printed the extra create: `event_id` `speech:<missing turnId>:3`, purpose `speech` for the missing turn, instructions "Say exactly this and nothing else: "Sorry, say that again?"", `tools: []`, no input. That is the Neutral_Line of the earlier `missing` post, as the reviewer guessed. The sequence was: the missing post's answer arrives (`hold`, `recoveryOnly`), the test reads `createsBefore` (0), the late transcript arrives, then the Neutral_Line's hash check returns and its reply is created. Under load, `crypto.subtle` finishes after the count. This is a test race, not a product defect: the Neutral_Line is the right answer to that post. The test now waits for the pending check and asserts the one create is the Neutral_Line before it counts. No other test in the file counts reply creates before the check it depends on: the others wait for an active reply, LISTENING, a receipt sent after admission, or the create itself. After the fix, `npm test` passed five full runs in a row (163 files, 1,510 tests each).
**Checks after item 23** (telemetry variables set, no network call, nothing with `--live`):
- `npm test`: 163 files, 1,507 tests.
- `npm run lint`, `npm run typecheck` and `npm run build`: exit 0.
- The wave A properties (P1 to P9, P11, P12) and P13 (12 files, 13 tests) passed five full runs in a row.

## Live run, Nov 10 (`docs/briefs/011-review-live-run.md`)

The review was committed as is (`07e69c0`). The reviewer ran the Harness live on the owner's 60 takes: parallel, stagger 0, uncapped, effort `minimal`, seed 7, `--judge judge_v2`, slow parse live. The run files are committed in `420c807`.

**The review's numbers, checked against the run file.** The ones the file can show are right:
- `judge_v2` held 30 of 30 control lines at any time (5 of 5 in every class).
- False holds: 2 of 30 (o-05 "What do you remember about me?", o-10 "I'm allergic to Mondays.").
- Judge time from send: p50 754 ms, p95 972 ms.
- Parse time: p50 460 ms, p95 743 ms, largest 1,304 ms. 49 of 60 parses were over 350 ms, and 1 was over 1,000.
- Invalid parses: 5 (`c-hardrule-2`, `o-30`, `c-correction-4`, `c-crisis-4`, `o-10`).
- Control lines: 30 of 30 were not ordinary to the parse, and none was missed by both nets.
- Ordinary lines: 17 of 30 were not ordinary to the parse. `alone` was 0.20 or more on 11, `company` on 4, `forget` on 1.
- The quoted lines: "Hang on, Alex just walked in." scored `company` 0.03 and `rushed` 0.97; "We broke up this morning and I'm a mess." chose `alone` at 0.75; "It's so windy out today." scored `alone` 0.41; "Hey Franki, how's it going?" scored `company` 0.92; "I deleted an old game…" scored `forget` 0.21.
- Latency from the last loud frame: p50 1,553 ms over 28 lines. The reply's first audio came p50 937 ms after send.
- Control takes: 9 had their tails trimmed and 14 came in as more than one fragment. On 25 control lines the judge was sent 101 to 1,224 ms after the commit.

The run (c) comparisons (28 of 30, 1 of 30, 718 and 1,103 ms, 1,317 ms, about 800 ms) are from an earlier run file that I didn't recheck. The file stores no transcripts for the owner's takes, by design, so I read the quoted lines' text from `lines.json`.

| Item | Commit | Test that failed first |
|---|---|---|
| 1. Keep the run's record | `420c807` | (files only) |
| 2. `judge_v2` becomes the app's judge | `300820c` | `judge.test.ts` `APP_JUDGE_SETTINGS`, `machine.test.ts` judge `metadata.contract`. Q52's judge half answered; R16.4 updated. |
| 3. The Decisions deadline is 1,000 ms on a call | `2fa2649` | `turn.typed-no-call.test.ts` "is 1,000 ms: an answer at 800 ms is used". `DECISIONS_CONTRACT_DEADLINE_MS` keeps 350 as the contract's literal; Q94 added; R11.2 and R17.5 updated; the emulator test answers at 1,000 ms. |
| 4. Say why a parse was invalid, and repair it | `73642b7` | `parse.test.ts` "names the check and the question", `slow-parse.test.ts` "an invalid answer says which check failed", `repair.test.ts` (an invalid answer wasn't repaired), `harness.test.ts` "each row says which check". |
| 5. A route that changes what is said needs both nets, or one very sure net | `52296b1` | `route.test.ts`, `admission.test.ts` "a route that changes what is said needs both nets", `turn.test.ts` "a recorded fastO counts as judge O", `repair.test.ts` "a weak late hit with judge O raises no policyRev". Q95 added; R8.6 and the design updated. |
| 6. The Harness reports what the routes would do | `30a23b5` | `harness.test.ts` "what the routes would do" (three cases) |

**Notes on the items.**
- **Item 2.** R16.4 said `judge_v2` would replace `judge_v1` only if "nothing else" went down. The false holds went from 1 to 2, so the switch is the review's decision, not that criterion. R16.4 now says so. The Harness keeps `judge_v1` as its default, so a run without `--judge` is still the contract's judge.
- **Item 3, the slow path's worst case.** I didn't measure it, since the emulator wasn't run. Counting round trips at 75 ms each:
  - Since item 23, the parse runs while `ensureCoreDocs`, the request-ledger read and the request transaction run (about 4 round trips, 300 ms). So the wait before the main transaction is the parse itself, up to 1,000 ms.
  - The main transaction is then about 10 sequential round trips (750 ms): the Session, the five core documents in parallel, the `fastO` decision, the earlier turns and up to 4 of their Evidence, the request entry, and the commit.
  - From a commit 500 ms before the post, that puts the worst case on time near 500 + 1,000 + 750 ≈ 2,250 ms, against the 2.5 s line. With a 350 ms parse it was near 1,600 ms.
  - So the margin goes from about 900 ms to about 250 ms. The emulator test, which now answers at 1,000 ms, is the measurement; an answer right at the deadline may land on either side, and its printed `kinds` says which.
- **Item 4.**
  - The Turn has no failure-reason field, so the reason goes to the log (`turn.parseInvalid`, with the reason, the index and the question name) and to the Harness row and summary, not to the Turn.
  - The Nov 10 run file predates this, so its 5 invalid rows show "not recorded".
  - An invalid parse now opens the 2,500 ms repair lease. `oversize` still stores `unknown` with no repair.
- **Item 5.**
  - **What the judge value means.** The server uses the request's judge value, except that a recorded `fastO` decision makes it `O`. A turn posted before its verdict says `timeout`, which counts as not `O`, so a route fires at 0.20. That is the safe side, since it can only cut or narrow more often. The one unsafe-looking case is a `fastO` reply whose `admitted` receipt hasn't reached the server yet: a weak `forget` would cut it, which is what happened before this change.
  - **One change beyond the review's text.** The Parse_Repair and the Superseding_Post raised `policyRev` on any hit, and a raised `policyRev` cancels speech through the next Deck. That is a cut by another path, so they now raise it only when `changesWhatIsSaid` holds. They still write the held decision for every hit. This also removes an older inconsistency with Q92, where a late `rushed` hit could cancel speech.
  - **Properties.** Properties 8 and 9 stayed green. Their generators (plain modules) now give each candidate a probability, and the exhaustive half enumerates 41,472 inputs (16 parse shapes) instead of 36,288.
- **Item 6, run on the Nov 10 file.** Under the item 5 rule, counting wave B's routes:
  - 1 ordinary line would cut or swap: "Hey Franki, how's it going?", where `company` reached 0.92 with judge O.
  - 20 control lines would fire: forget 5, company 6, quiet 4, alone 3, crisis 2. `correction` and `hardRule` have no route that changes what is said.
  - At the old 0.20 line, the ordinary count would have been much higher: `alone` alone was at 0.20 or more on 11 ordinary lines, and all of those had judge O.
  - `--predicates contract` is the only set, and the run file records it.

**Still open for the owner.**
- **The wording of the `company` and `alone` predicates.** Even under the route rule, "Hey Franki, how's it going?" would hang up in wave B, and the parse misread "Hang on, Alex just walked in." as `rushed`. A candidate set goes into `PREDICATE_SETS` and is measured with `--predicates` the way `judge_v2` was.
- **Whether the 1.5 s latency stop line holds.** This run measured p50 1,553 ms from the last loud frame, over the line; run (c) measured 1,317 ms, under it.

No item was declined. Wave B has not started.

**Checks** (telemetry variables set, no network call, nothing with `--live`): `npm test` three runs in a row, 164 files and 1,527 tests each; `npm run lint`, `npm run typecheck` and `npm run build` exit 0.

## Wave B (tasks 45 to 53; briefs 017 and 026)

Built by Claude Code, not by Kiro: the machine and client half (tasks 46, 47, 52) under brief 017, the server half (tasks 45, 48 to 51) and this section (task 53) under brief 026. The full report of the server half is `docs/briefs/026-report.md`.

### Checks

`npx vitest run` (389 files, 3,716 tests), `npm run lint`, `npm run typecheck` and `npm run build` exit 0 on `79f844c`; see `docs/briefs/026-report.md`, "Checks". `npm run test:emulator` was not run: it fetches firebase-tools through `npx -y`, this build makes no network call, and the emulator's port is shared between lanes. No command called OpenAI.

### What was built and where

- **45** `packages/core/src/head.ts` (`headAdmitsSens`): outside `private` the Head keeps only S0 Memory lines. `packages/server/src/head-build.ts`: `buildHead` takes the audience.
- **46, 47, 52** See `docs/briefs/017-report.md`.
- **48, 49** `packages/server/src/audience-swap.ts` holds the logic; `routes/turn.ts` runs the rule in wave B and keeps one block per seam: `narrowedHere` (row 1), `precompileAudienceHead` (before the transaction), `audienceEffect` (in it), and the hangup Job after the response.
- **50** `routes/open.ts`: the named Session is read under the Owner's uid; `inheritedAudience` and the swap line through the Admission_Seam.
- **51** `routes/close.ts` with `errorCloseCarry`; `sessions.ts`'s `beginCloseInTx` takes the extra fields so the close stays one Session update.

### Properties that ran red

- Property 10, machine half (task 46): see `docs/briefs/017-report.md`.
- Property 10, server half (`packages/server/src/routes/turn.narrowing.property.test.ts`, new in task 48): red first at seed 749011380. Shrunk counterexample: a company hit at 0.30 with judge H on a live call answered `ordinary`, since the route still ran the rule in wave A. Fixed by tasks 48's wave B rule and the narrowed-Session branch.

### Contract questions

V-165 to V-170, in `docs/briefs/026-report.md`.

### Requirement changes

None.

### What couldn't be checked

The swap on a real call; the second microphone grant; a real Realtime hang-up; the open's 3.5 s budget with the extra read (`tests/firestore/open-retry.test.ts`, emulator only); whether the swap line's Permit (10 s TTL from the open) is still valid when the fresh call's ack matches on a slow network.

### Live check for the owner (R24.2, wave B)

Run on localhost with the Debug_Panel open (`?debug=1`), in Chrome. Before the check, tell Franki one personal thing in a private call (for example "My sister Ana is moving in with me next month"), and confirm in the Debug_Panel's Head that it is listed.

1. **"My cousin just sat down."**
   - The reply stops. The avatar shows thinking, and the call button stays in its hang-up form. There is a short gap with no sound, then exactly "Got it. I'll keep things general for now."
   - Debug_Panel: the old Session's audience is `company`. The decision for the turn is a hold with reasons `audience`, `blocked`. A new Session appears with audience `company`. Its Head has the Now line "Audience: company.", no line about Ana, and the Hard rules section unchanged.
   - Then ask "What do you know about my family?" Franki answers from the narrow Head and says nothing about Ana.
2. **"Keep that between us."** (Start from a fresh private call.)
   - The same swap and the same company line as step 1. Quiet is recorded as company (Q79).
   - Debug_Panel: the decision's reasons include `quiet`; the new Session's audience is `company`.
3. **"Okay, it's just us now."** (In the company call from step 1 or 2.)
   - Exactly "Okay, just us again." No hang-up, no gap.
   - Debug_Panel: audience `private`. The Deck's bundleRev is one higher, and its Head lists Ana again with "Audience: private.".
4. **A crisis line said with someone present.** For example: "My cousin's here and I really can't cope anymore."
   - A care reply that mentions 988 plays in full, on the same call. Then the swap happens, with no company line.
   - Debug_Panel: the first Session's audience is `company` with crisis set. The new Session is `company`, with no proactive line.
   - If the care reply is not heard, or the company line is heard after it, stop and report.
5. **What would be a stop.** Any reply heard on the old call after step 1's line ends, any S1+ line in the new Session's Head, or a swap on a plain line (for example "Hey Franki, how's it going?"; Q95) is a stop. Note the turn, the verdict and the class probabilities from the Debug_Panel.

### Stop

Wave B ends here.
