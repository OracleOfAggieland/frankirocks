# Requirements Document: voice-control

## Introduction

This spec covers Brief 011, the judge in the call (`docs/briefs/011-judge-in-the-call.md`), build-plan task F2 (`docs/design/memory-spec-v3.md` §14), with the answers from `docs/briefs/011-review-requirements.md`. Today every voice reply is admitted by `devAdmit` as `slowOrdinary`: the Browser_Client waits for the transcript, posts `/api/turn`, and only then asks for the reply. This spec puts the judge into the call beside a muted speculative reply, replaces `devAdmit` with the real admission rules, builds the slow gate behind the judge, and gives company, quiet and alone their routes.

It covers contracts §10 rows KV01 to KV06, KV11 and KV13. KV07 and KV08 (forget) join this spec in a later brief. Work happens on branch `build/voice-control`.

Behavior comes from `docs/design/memory-spec-v3.md`, cited as "spec §N". Fields, prompts, wire types and routes come from `docs/design/memory-contracts-v2.md`, cited as "contracts §N". The owner's earlier answers come from `.kiro/specs/first-spoken-call/design.md`, cited as "question N". `docs/design/` is read-only; anything that cannot be built as written, and every answer that departs from or fills a gap in the contracts, goes under "Contract questions" in this spec's `design.md`, numbered on from 52.

### Waves

- **Wave A, admission:** brief scope items 1 to 4, 6 and 7, the property guard, and the parse gap, the `unknown` audience and the parse repair (Requirements 1 to 13, 15.2 to 15.9 and 16 to 19, and properties 1 to 9, 11 and 12 of Requirement 20).
- **Wave B, audience:** brief scope item 5 (Requirements 14 and 15.1, and property 10 of Requirement 20).
- Requirements 21 to 24 apply to both waves.

### Decisions this spec builds on

From question 51 (the owner, Nov 9):

1. The judge and the reply run in parallel. Both are sent at the Commit, and the reply stays muted until a Valid_O.
2. The judge is uncapped (`max_output_tokens:"inf"`), effort `minimal`.
3. The Judge_Deadline is 1,200 ms from the Commit.
4. The ordinary latency target is about 1.3 s p50 from the end of audible speech to audible time. A p50 over 1.5 s is a stop line.

Decided for this spec on Nov 9 on the owner's delegation:

5. The company miss gets both nets: the Slow_Parse on every voice transcript, and a `judge_v2` candidate measured before it replaces `judge_v1`.
6. The VAD stays `semantic_vad` (question 47), with its settings as named constants.
7. Deadlines count from the Commit, as revised by the design review from the measured transcript times (p50 517 ms, p95 1,899 ms after the commit, question 51 run c): a held turn waits 2,500 ms for its transcript, a turn already admitted under `fastO` waits 5,000 ms, a server Permit that arrives before the request times out is played, and a late transcript repairs the gap. This changes two things the owner ruled on and is marked for the owner's confirmation in the design (question 54).
8. Company and quiet hang up and come back in a fresh call. No isolation without a hang-up in this spec.

### Requirement changes

This spec supersedes `first-spoken-call` Requirement 17 where it describes `devAdmit`: criteria 17.4 (the `devAdmit` implementation and its issuer record), 17.5 and 17.6 (its production refusal), 17.8 (the voice rows of `devPermitKind` and the deviation it records) and the issuer `devAdmit` in 17.10. Criteria 17.1, 17.2, 17.3, 17.7 and 17.9 stay in force, amended by Requirements 3, 4 and 8 here. Existing tests are updated to the new requirements; no check is deleted without a replacement that protects the same thing (Requirement 21). It also supersedes `first-spoken-call` R15.11's 1.5 s missing-transcript limit and its rule that a transcript for an already posted Turn is dropped (Requirement 7), and the Voice_Client's 10 s `/api/turn` timeout, which becomes 5 s.

### Out of scope

Forget and its fence (KV07, KV08). `FastSlotsV1`, `applyCorrection`, `applyTransition`. Food through `suggest`. The "why" route. Proactive speech. New S1+ note producers. Topic-level quiet. Isolation without a hang-up. The walked-in tap. A scheduled hang-up Function. The avatar rig. An S0-only `fastHead`.

## Glossary

- **Browser_Client**, **Voice_Client**, **Server_Library**, **Core_Library**, **Owner**, **Session**, **Turn**, **Deck**, **Head**, **Stamp**, **StateAck**, **Permit**, **Model_Config**, **Debug_Panel**, **Level_Meter**: as in the `first-spoken-call` and `lab-ui-foundation` requirements.
- **Voice_Machine**: The pure call-state reducer `step` in `packages/core/src/voice/machine.ts`.
- **Commit**: The browser opsClock time of the last `input_audio_buffer.committed` of a Turn (contracts §5: t0 = commit). Every deadline in this spec counts from it.
- **Unadmitted_Fragments**: Every committed audio item of the current generation since the last admitted reply, in commit order, at most 8 (KV01).
- **Judge**: The out-of-band text response built by `judgeCreate` (contracts §5 `judge_v1`), with the contract name set by the Judge_Setting.
- **Judge_Setting**: The judge's contract name (`judge_v1` or `judge_v2`), output cap, effort and deadline. The app's setting is `judge_v1`, `"inf"`, `minimal`, 1,200 ms.
- **Verdict**: The result of `parseJudgeDone`. A **Valid_O** is a verdict `O` with `valid:true`.
- **Judge_Deadline**: Commit + 1,200 ms.
- **Speculative_Reply**: The reply `response.create` sent beside the Judge at the Commit, with `conversation:"none"` and metadata purpose `speculative`, whose audio stays muted until admitted.
- **Muted_Audio_Start**: The `output_audio_buffer.started` event of the Speculative_Reply while output is muted.
- **Outstanding_Turn**: A posted `/api/turn` request whose response has not arrived and whose deadline has not passed.
- **FastO_Rule**: The pure Core_Library function that issues a `fastO` Permit in the browser (contracts §6: `fastO` local). It is the browser half of admission.
- **Admission_Seam**: The single Server_Library module that creates every server Permit and writes one ledger `decision` per admission, including the record of a browser-issued `fastO`.
- **Server_Rule**: The real admission rule the Admission_Seam calls in place of `devAdmit`.
- **Slow_Parse**: The `TurnIntents` check (contracts §5): the regex check, then the Decisions call.
- **Regex_Table**: The closed, hold-only table of cue patterns in the Core_Library that the Slow_Parse checks first.
- **Decisions_Port**: The Server_Library port through which the Slow_Parse calls the OpenAI Decisions API, with a fake for tests.
- **Control_Class**: One of `forget`, `quiet`, `correct`, `transition`, `hardRule`, `crisis`, `company`, `alone`, `why`, `rushed`, `food`, `action`, `answer` (contracts §5 TurnIntents).
- **Control_Hit**: A Slow_Parse result that is not an Ordinary_Parse and did not fail: a chosen Control_Class, or an `uncertainSpeaker` at or above 0.10. A regex match alone is never a Control_Hit.
- **Ordinary_Parse**: A Slow_Parse result with every Control_Class probability below 0.20 and `uncertainSpeaker` below 0.10 (contracts §5 "Ordinary=controls<.20,speaker<.10"). A regex match does not enter it.
- **Regex_Match**: A Regex_Table hit on the transcript. It is recorded for every Turn (server log and Harness row), and it decides only when the Slow_Parse failed.
- **Parse_Gap**: An earlier user Turn of the Session whose Slow_Parse failed, or whose transcript was missing or failed, and that has not been repaired.
- **Parse_Repair**: The single retry of a failed Slow_Parse after the Turn's response has been sent, or the Slow_Parse of a Superseding_Post (Requirement 15).
- **Superseding_Post**: A second `/api/turn` request for a Turn first posted `missing`, sent when its transcript arrives late, with `transcriptState:"final"` and `supersedesRequestId` naming the first request.
- **Late_Turn**: A Turn whose server Permit arrived after Commit + 2,500 ms.
- **Neutral_Line**: `RECOVERY_LINE`, "Sorry, say that again?", played under `recoveryOnly`.
- **Fixed_Line**: A reply whose exact text is a Core_Library constant, never model-worded.
- **Audience**: The Session's `audience` field: `private`, `company` or `unknown`.
- **Effective_Audience**: `unknown` while a Parse_Repair is pending, otherwise the stored Audience.
- **Call_Swap**: Hanging up every registered call of the Session and opening a fresh call with a new Deck, while the interface stays in the call.
- **Latency_Clock**: The per-turn timing record kept on the browser opsClock (Requirement 18).
- **Harness**: `scripts/judge-spike/harness.ts` and its CLI.
- **Property_Guard**: `scripts/property-guard.mjs`, the PreToolUse check that blocks agent writes to tracked property test files.

## Requirements

### Requirement 1: Steering and the property guard first

**User Story:** As the owner, I want the voice-control rules in steering and the properties protected before any code changes, so that every later task is held to them.

#### Acceptance Criteria

1. THE first build task SHALL write `.kiro/steering/voice-control.md` with `inclusion: fileMatch`, matching the Voice_Machine, the Voice_Client, the admission files in `packages/core` and `packages/server`, and the turn route, in under 80 lines.
2. THE voice-control steering file SHALL state each of these rules and name the contract section it comes from: five Permit kinds, each bound to one Turn and one generation (KV03); nothing dispatches before admission, meaning no audible audio, tool call, action or receipt (KV02); a reply held by `H` or `U` never resumes and a later `O` for the same Turn changes nothing; an `O` after Muted_Audio_Start cancels, clears and regenerates, and no suffix of the earlier response is ever heard; S2 is never in the Head; an S1+ note stays off the Deck and arrives beside its Permit only once every earlier Turn's parse has committed (KV11); a note that misses its deadline drops and the reply still plays; every wait has an opsClock deadline (KV06); speech start cancels and clears older output and Permits (KV04); a higher revision cancels older Decks and speech (KV05).
3. THE first build task SHALL update the "Admission seam" paragraph of `.kiro/steering/memory-rules.md` so that it no longer names `devAdmit`, states that every server Permit comes from the Admission_Seam, and states that `fastO` comes only from the FastO_Rule, the browser half of admission.
4. THE first build task SHALL update the "Design docs are read-only" paragraph of `.kiro/steering/memory-rules.md` so that contract questions go in the `design.md` of the spec being built.
5. THE second build task SHALL add `scripts/property-guard.mjs`, in the style of `scripts/clock-guard.mjs`, with tests: it reads a PreToolUse hook event on stdin and exits 2 when an agent write targets a `*.property.test.ts` file that git already tracks, with a message that says to add the new property in a new file or to stop and report.
6. THE Property_Guard SHALL allow every write to a `*.property.test.ts` file that git does not track, and SHALL exit 2 when the event cannot be parsed or names no target path.
7. THE build SHALL not write to `.kiro/hooks/`; the reviewer writes the hook file.
8. From the Property_Guard task on, every new property in this spec SHALL go in a new file.

### Requirement 2: Judge and Speculative_Reply at the Commit

**User Story:** As the owner, I want the judge and the reply to start together, so that an ordinary turn is not slowed by waiting for the verdict.

#### Acceptance Criteria

1. WHEN a Commit's matching `conversation.item.added` has arrived and every committed item of the Turn has its `commitSeq`, THE Voice_Machine SHALL, in the same step, emit the Judge over all Unadmitted_Fragments in commit order and the Speculative_Reply, and SHALL enter `SPECULATING` (contracts §6 States, KV01).
2. THE Judge SHALL be built by `judgeCreate` with the app's Judge_Setting, with `metadata.contract` equal to the Judge_Setting's contract name, `turnId` the current Turn and `generation` the current generation.
3. THE Speculative_Reply SHALL carry `conversation:"none"`, the Deck's Head text as `instructions`, the Deck's safe turns and an `item_reference` for each of this Turn's own audio items as `input` (the same items the server hashes; only the Judge hears earlier Unadmitted_Fragments), the recall tool, and metadata purpose `speculative` with the current `turnId` and generation.
4. WHILE a Speculative_Reply is unadmitted, THE Voice_Client SHALL keep output muted at the audio element.
5. IF no matching `conversation.item.added` arrives within 600 ms of a Commit, THEN THE Voice_Machine SHALL send no Judge for that Turn and SHALL take the slow path (contracts §6 States, `WAIT_ITEM`).
6. WHEN speech starts while a Judge or Speculative_Reply is in flight, THE Voice_Machine SHALL cancel both by response ID and clear the output buffer; at the next Commit it SHALL send a new Judge and Speculative_Reply over all Unadmitted_Fragments, with the Judge_Deadline counted from the new Commit.
7. IF `judgeCreate` refuses a Turn (more than 8 Unadmitted_Fragments or more than 4 safe turns), THEN THE Voice_Machine SHALL send no Speculative_Reply for it and SHALL take the slow path; no fragment SHALL be dropped to make it fit (contracts §5: no control truncation).
8. THE Voice_Machine SHALL send the Judge and the Speculative_Reply as two out-of-band responses on the Session's `oai-events` data channel, as the Harness's parallel mode does over its WebSocket.
9. WHILE the Deck's `noteWaiting` is true, THE Voice_Machine SHALL send the Judge alone, with no Speculative_Reply, and SHALL enter `JUDGING` (contracts §6 "noteWaiting+O=>HELD/nospeculation").

### Requirement 3: Acting on the Verdict

**User Story:** As the owner, I want Franki to speak only when the judge has cleared the turn, so that a control turn is never answered before it is understood.

#### Acceptance Criteria

1. WHEN a Valid_O arrives for the current Turn and generation before the Judge_Deadline, AND every `fastO` condition in Requirement 4 holds, THE Voice_Machine SHALL issue a `fastO` Permit through the FastO_Rule, check it with the same checks as any other Permit (stamp, generation, expiry, Deck expiry, kind, StateAck and payload hash), and unmute output only after the check passes.
2. WHEN a Valid_O arrives after Muted_Audio_Start of the Speculative_Reply, THE Voice_Machine SHALL cancel that response by ID, clear the output buffer, and create a new reply under the checked `fastO` Permit; no audio of the earlier response SHALL be audible (spec §3).
3. WHEN the Verdict is `H` or `U`, THE Voice_Machine SHALL cancel the Speculative_Reply by its response ID, clear the output buffer and enter `HELD`, and that response SHALL never resume.
4. WHILE a Turn is `HELD` after `H`, `U` or a Judge_Deadline miss, THE Voice_Machine SHALL ignore any later Verdict for that Turn.
5. IF no Verdict has arrived by the Judge_Deadline, THEN THE Voice_Machine SHALL cancel the Judge and the Speculative_Reply by response ID, clear the output buffer and take the slow path.
6. IF a Valid_O arrives but a `fastO` condition fails, THEN THE Voice_Machine SHALL cancel the Speculative_Reply and treat the Turn as held for the slow path, as for `U`.
7. WHEN a reply is admitted under `fastO`, THE Voice_Client SHALL send an `admitted` receipt with `permitKind:"fastO"` before the `playbackStarted` receipt.
8. WHEN a reply is admitted by any Permit for a Turn, THE Voice_Machine SHALL ignore every other Permit that later arrives for the same Turn, so that at most one reply of a Turn is audible, except that a Control_Hit response cuts that reply (Requirement 11).
9. THE Voice_Machine SHALL send in the TurnRequest's `judge` field the Verdict known when the request is sent, and `timeout` when none has arrived.

### Requirement 4: The `fastO` conditions

**User Story:** As the owner, I want the fast path to need fresh proof that nothing changed, so that a stale deck can't speak.

#### Acceptance Criteria

1. THE FastO_Rule SHALL issue a `fastO` Permit only when all of these hold (contracts §6 Admission, KV13): a Valid_O for this Turn and generation; a held StateAck whose four revisions (epoch, policyRev, bundleRev, rulesRev) equal the Deck's, whose generation is at most the local generation, and whose age on the browser opsClock is under 2,500 ms; no Outstanding_Turn; and a StateAck that came from a `/api/session/state` request sent after the last `/api/turn` response arrived.
2. THE Server_Library SHALL answer `/api/session/state` with `ack:null` WHILE an S2 user Turn is among the Session's last four user Turns, a Parse_Gap exists, or the Effective_Audience is `unknown`; so no S2 Turn among the last four, no Parse_Gap and no `unknown` audience are conditions of `fastO` through the StateAck. A `company` Session keeps `fastO`, because its Head has no S1+ line.
3. WHEN the Voice_Machine posts a Turn, THE Voice_Machine SHALL drop its held StateAck.
4. An ack obtained before an Outstanding_Turn's response arrives SHALL NOT grant `fastO`; this is what "no control hit pending" means.
5. WHILE a call is live, THE Voice_Client SHALL request `/api/session/state` at most once per second to keep the StateAck fresh (contracts §6 "poll1s").
6. THE `fastO` Permit SHALL carry the current Stamp, scope `reply`, `approvedPayloadHash` equal to the hash of the payload the Speculative_Reply was created from (contracts §6 Hash), no notes, and `expiresAt` equal to the issuing opsClock time plus 10,000 ms.
7. THE FastO_Rule SHALL be a pure Core_Library function that reads no clock and takes time as an argument.

### Requirement 5: `noteWaiting` (KV11)

**User Story:** As the owner, I want a personal note to wait for its permit, so that it is never spoken before every earlier turn is understood.

#### Acceptance Criteria

1. WHILE the Deck's `noteWaiting` is true, THE Voice_Machine SHALL send no Speculative_Reply, and on a Valid_O SHALL wait for the stamped server Permit and its note from the `/api/turn` response.
2. IF the note has not arrived by its deadline (Commit + 1.5 s, contracts §6), THEN THE Voice_Machine SHALL drop the note and play the plain reply under the Turn's `O`.
3. THE Server_Library SHALL add no new note producer in this spec.

### Requirement 6: Mute, dispatch and the avatar (KV02)

**User Story:** As the owner, I want nothing to happen on an unadmitted turn, so that a tool call or receipt can't leak ahead of the gate.

#### Acceptance Criteria

1. THE Voice_Machine SHALL unmute output only in `SPEAKING` under a Permit that passed every check and is bound to the current Turn and generation.
2. WHILE a reply is unadmitted, THE Voice_Machine SHALL emit no `/api/tool` request, no `admitted` or `playbackStarted` receipt, and no action command for that Turn.
3. WHEN a Speculative_Reply emits a function call before admission, THE Voice_Machine SHALL hold the call undispatched; WHEN the reply is then admitted, THE Voice_Machine SHALL dispatch the held call; WHEN the reply is held or cancelled instead, THE Voice_Machine SHALL drop it.
4. THE `avatarState` function SHALL map `WAIT_ITEM`, `JUDGING`, `SPECULATING`, `HELD` and `SWAPPING` to `thinking`, and SHALL return `speaking` only while output is unmuted.

### Requirement 7: Speech start, revisions and deadlines (KV04, KV05, KV06)

**User Story:** As the owner, I want every wait to end and every interruption to win, so that the call never hangs or talks over me.

#### Acceptance Criteria

1. WHEN speech starts, THE Voice_Machine SHALL mute output, cancel every in-flight response by ID (the Judge, the Speculative_Reply and any admitted reply), clear the output buffer and drop every unplayed Permit (KV04).
2. WHEN a Deck or Stamp with a higher revision or generation arrives, THE Voice_Machine SHALL reject the older Deck and cancel and clear every reply built on it (KV05).
3. WHEN the Voice_Machine starts any wait (item, Judge, transcript, server Permit, tool, state, swap), THE Voice_Machine SHALL arm an opsClock deadline for it (KV06).
4. IF no final transcript has arrived by Commit + 2,500 ms and no reply is admitted, THEN THE Voice_Machine SHALL post the Turn as `missing`, and THE Server_Rule SHALL answer `recoveryOnly`, so the Neutral_Line plays.
5. WHEN a server Permit for a held Turn arrives before that `/api/turn` request times out (5,000 ms from the post), THE Voice_Machine SHALL check and play it, even after Commit + 2,500 ms, and THE Latency_Clock SHALL mark the Turn a Late_Turn. IF the request times out with no Permit, THEN THE Voice_Machine SHALL enter `RECOVERY`, as a failed request does today. Speech start still cancels a late Permit (criterion 1).
6. WHEN the final transcript is missing at Commit + 5,000 ms while a reply is already admitted under `fastO`, THE Voice_Machine SHALL post the Turn as `missing` and leave the reply untouched.
8. WHEN a transcript arrives for a Turn already posted `missing`, and every item of that Turn then has its transcript, THE Voice_Machine SHALL send one Superseding_Post with the same `turnId` and `clientSeq`, `transcriptState:"final"` and `supersedesRequestId` naming the first request, and SHALL speak no reply for it.
9. Every wait limit in this requirement (Judge 1,200 ms, held transcript 2,500 ms, admitted transcript 5,000 ms, `/api/turn` response 5,000 ms from the post) SHALL be a named Core_Library constant counted on the browser opsClock.
7. THE Voice_Machine SHALL read all times from the `now` argument (the browser opsClock), and the clock guard SHALL apply.

### Requirement 8: Real admission behind the same seam

**User Story:** As the owner, I want the real rule to admit every reply, in production too, so that the deployed app can speak.

#### Acceptance Criteria

1. THE Admission_Seam SHALL call the Server_Rule in place of `devAdmit`, SHALL remain the only Server_Library code that creates a Permit, and SHALL write exactly one ledger `decision` entry per admission in the caller's transaction.
2. THE Server_Rule SHALL run when `NODE_ENV` is `production`.
3. THE Server_Rule SHALL return exactly one Permit kind or a hold for every combination of Turn source, transcript state, `judge` value, Slow_Parse result and Effective_Audience.
4. WHEN a voice Turn has a final transcript and an Ordinary_Parse, THE Server_Rule SHALL issue `slowOrdinary`, whatever the `judge` value (contracts §6 Admission).
5. WHERE a `slowOrdinary` Permit would carry an S1+ note, THE Server_Rule SHALL also require `judge:"O"`, at least one ASR word per 2 s of total `audioDurationMs`, every item `final:true`, no Parse_Gap and an Effective_Audience of `private`; otherwise it SHALL issue the Permit without the note.
6. WHEN a Turn has a Control_Hit, THE Server_Rule SHALL issue the Permit its route names (Requirement 12) and no S1+ note.
7. WHEN a voice Turn's transcript is `missing` or `failed`, or its Slow_Parse fails, THE Server_Rule SHALL issue `recoveryOnly` with no notes and no tool output. THE Server_Rule SHALL take no input from the server clock compared with a browser timestamp.
8. WHEN a typed U line has an Ordinary_Parse, THE Server_Rule SHALL issue `slowOrdinary` as today, with no judge; WHEN it has a Control_Hit, THE Server_Rule SHALL route it as a voice Control_Hit.
9. WHEN a typed U line arrives with no call open, THE Server_Library SHALL run the Decisions call at the same time as the typed reply's Responses call, and SHALL discard the typed reply on a Control_Hit.
10. WHEN a pasted (T) line arrives, THE Server_Rule SHALL keep today's behaviour: no Slow_Parse, `postCommitControl`, scope `reply`, no S1+ note.
11. WHEN a tool continuation is admitted, THE Server_Rule SHALL issue `slowOrdinary` only after the Turn's Slow_Parse has committed, waiting at most 1.5 s, and otherwise hold.
12. THE Server_Rule SHALL never issue an S1+ note on a Turn whose `judge` is not `O`.
13. THE `/api/health` output SHALL stay unchanged.

### Requirement 9: Recording `fastO` on the server

**User Story:** As the owner, I want a fast reply on the record too, so that the ledger and the Debug_Panel show every reply that played.

#### Acceptance Criteria

1. WHEN `/api/receipt` accepts an `admitted` receipt with `permitKind:"fastO"`, THE Admission_Seam SHALL write one ledger `decision` for that Turn's `fastO` admission, without creating a Permit, and THE Server_Library SHALL record on the Turn that it was admitted with `judge:"O"`.
2. THE `fastO` record SHALL be the same whichever of the `admitted` receipt and the Turn's `/api/turn` request the server processes first.
3. IF the closed `decision` payload (contracts §1 ledger) cannot say what is needed, THEN THE design SHALL raise a contract question and SHALL add no field.

### Requirement 10: The Slow_Parse in `packages/core`

**User Story:** As the owner, I want the slow gate's logic to be pure and testable, so that the deciding code never depends on a model call.

#### Acceptance Criteria

1. THE Core_Library SHALL hold, as pure functions: the Regex_Table check, the `TurnIntents` request builder, the Decisions response parser, normalization, the 0.20 candidate threshold, the Ordinary_Parse test and the priority order.
2. A Regex_Match SHALL never select a route and SHALL not overrule a Slow_Parse that succeeded. THE Server_Library SHALL record every Regex_Match (its cue IDs) in the Turn's server log line and in the Harness row; the closed Turn record has no field for it, so THE design SHALL raise a contract question. WHEN the Slow_Parse fails and a Regex_Match exists, THE Server_Rule SHALL answer `hold` with `recoveryOnly`, and that response SHALL cut a playing reply.
3. THE Regex_Table SHALL be a small closed table of general cue words, listed in full in the design; no sentence from `scripts/judge-spike/lines.json`, and no close copy of one, SHALL appear in it, and a test SHALL assert that.
4. THE request builder SHALL send the developer prefix from contracts §5 once and each selected row as `{type:"predicate", name, instructions}` with the literal predicate instruction from contracts §5: the 14 fixed rows and at most 8 `opens_{topicId}` rows, at most 22 questions.
5. IF the developer prefix, the utterance and the last question together exceed 2,400 UTF-16 code units, THEN THE Slow_Parse SHALL hold rather than truncate (contracts §5 "Over800: hold"), with no tokenizer dependency.
6. THE response parser SHALL match answers to questions by position, map them to the 14 named probabilities and the `opens` list, and SHALL treat a refusal, a missing answer, an extra answer, a name that does not match, or a probability that is not finite in [0, 1] as a failure.
7. THE priority function SHALL choose among candidates at or above 0.20 in this order: `forget` > `company` > `quiet` > `alone` > `crisis` > `hardRule` > `correct` > `transition` > `why` > `food` > `action` > `answer` > `rushed` (contracts §5, with `why` placed directly before `food` and `alone` directly after `quiet`, design questions 69 and 91), and SHALL retain every candidate.
8. THE request and response shapes SHALL be checked against the `openai` package's own `Decisions` types in `node_modules` (`DecisionCreateParams`, `Decision`).

### Requirement 11: The Slow_Parse on every transcript

**User Story:** As the owner, I want every voice transcript read by the slow gate, so that a judge miss is caught before the next sentence.

#### Acceptance Criteria

1. WHEN `/api/turn` receives an `asr` Turn with a final transcript, THE Server_Library SHALL run the Slow_Parse on it, whatever the `judge` value; and WHEN it receives a typed U line, THE Server_Library SHALL run the Slow_Parse on it (spec §3 step 5).
2. THE Slow_Parse SHALL call the Decisions API through the Decisions_Port with the model from `FRANKI_BG_MODEL` and a 350 ms opsClock deadline enforced by the caller; a failure, refusal or missed deadline SHALL mean the parse failed.
3. THE Slow_Parse result SHALL commit in the same transaction as the Turn, and a failed parse or a missing or failed transcript SHALL advance `nextClientSeq` without advancing `committedParseSeq` (contracts §6 "Failedsequence advances processing only").
4. WHEN the Turn has an Ordinary_Parse while its reply is already playing under `fastO`, THE Server_Library SHALL change nothing about that reply.
5. WHEN the Turn has an Ordinary_Parse and the Turn is held, THE Server_Library SHALL return a `slowOrdinary` Permit and a plain reply with no S1+ note, and the false hold and the judge's Verdict SHALL be recorded as Requirement 13 says.
6. WHEN the Turn has a Control_Hit while a reply is playing, THE `/api/turn` response SHALL tell the Browser_Client, and THE Voice_Machine SHALL at once mute, cancel the reply by ID, clear the output buffer and enter `HELD`, then take the route of Requirement 12.
7. WHEN the Turn's Slow_Parse fails with no Regex_Match while a reply is already playing under `fastO`, THE Voice_Machine SHALL let the reply finish; WHEN it fails with a Regex_Match, THE Voice_Machine SHALL cut the reply as in criterion 6.
9. WHEN `/api/turn` receives a Superseding_Post for a Turn stored as `transcriptMissing`, THE Server_Library SHALL run the Slow_Parse on its transcript and commit the parse, the text and the Evidence on the existing Turn, without a new `clientSeq`; an Ordinary_Parse SHALL close the Parse_Gap as a Parse_Repair does, a Control_Hit SHALL run as a late hit, and the response SHALL carry no Permit.
8. THE Server_Library SHALL make no Decisions call in `npm test`; tests use the fake Decisions_Port.

### Requirement 12: Wave A routes

**User Story:** As the owner, I want each control class to land somewhere safe now, even before its handler exists, so that Franki never claims to have done what it can't.

#### Acceptance Criteria

1. WHEN `crisis` is a retained candidate at or above 0.20, whichever class wins the priority order, THE Server_Rule SHALL issue `postCommitControl`, scope `ack`, with no notes, and THE reply SHALL be the crisis care reply, created with `tools:[]`.
2. WHEN the chosen class is `forget`, `correct`, `transition`, `hardRule`, `food`, `action`, `why` or `answer`, and `crisis` is not a candidate, THE Server_Rule SHALL issue `postCommitControl` with no S1+ note, scope `reply`, or scope `ack` when the reply is a Fixed_Line.
3. WHEN the chosen class is `forget` and `crisis` is not a candidate, THE reply SHALL be the Fixed_Line "I can't forget things yet.", never model-worded.
4. THE Server_Library SHALL deliver a Fixed_Line as one `W` note of kind `ack`, sensitivity S0, covered by the Permit's `noteIds` and payload hash, under a Permit of scope `ack`, and THE Voice_Machine SHALL speak an `ack` note's text verbatim with `tools:[]`.
5. In wave A, WHEN the chosen class is `company`, `quiet`, `alone` or `rushed`, or the Turn is held by `uncertainSpeaker` alone, THE Server_Rule SHALL issue `postCommitControl`, scope `reply`, with no S1+ note. In wave B, `company`, `quiet` and `alone` take the routes of Requirements 14 and 15.
6. THE crisis care reply, every Fixed_Line and every `recoveryOnly` reply SHALL be created with `tools:[]`; THE Voice_Machine SHALL tell them apart by the Permit's kind `recoveryOnly` or scope `ack`, since it can't see the parse.
7. Every other `postCommitControl` reply (`correct`, `transition`, `hardRule`, `food`, `action`, `why`, `answer`, `rushed`, an `uncertainSpeaker` hold, and `company`, `quiet` and `alone` until wave B) SHALL keep the tools a speech reply has today; its tool continuation SHALL follow Requirement 8.11, with notes limited to S0 WHILE the Effective_Audience is not `private`.

### Requirement 13: Ledger and Debug_Panel

**User Story:** As the owner, I want every admission decision on the record, so that the Debug_Panel shows why each reply played or didn't.

#### Acceptance Criteria

1. THE Admission_Seam SHALL write one ledger `decision` per admission, keyed as today (by `permitId` for a server Permit, by `H("hold", stamp, requestId)` for a hold) and by `H("fastO", sessionId, turnId)` for a browser `fastO`, with `audience` equal to the Effective_Audience.
2. THE Server_Library SHALL record the judge's Verdict and the parse state on the Turn (`judge`, `parseState`, `uncertainSpeaker`), which already have fields.
3. THE design SHALL raise one contract question proposing that contracts v3 add the Permit kind, the judge's Verdict and the route to `decision`; until then the Debug_Panel SHALL derive the Permit kind and a false hold from stored records, and SHALL show "not recorded" for the Control_Class.
4. THE Debug_Panel SHALL stop deriving the Permit kind from `devPermitKind`, stop reporting issuer `devAdmit`, and group decisions by Turn, so a Turn with a `fastO` and a `slowOrdinary` decision reads as one reply.
5. THE Debug_Panel SHALL show the Session's Audience and the count of failed parses in the Session, and WHILE a Parse_Gap exists SHALL show "fastO off: parse gap" with the Turn that caused it.

### Requirement 14: Company and quiet (wave B)

**User Story:** As the owner, I want Franki to go general the moment someone else is there, so that nothing personal is heard by a guest.

#### Acceptance Criteria

1. WHEN the chosen class is `company` or `quiet`, THE Server_Library SHALL raise `policyRev`, set the Audience to `company` (with `reasonCodes:["quiet"]` on the decision for `quiet`), and hang up every registered call of the Session when the control commits.
2. WHEN a Call_Swap follows a `company` or `quiet` hit, THE Server_Library SHALL open the fresh call with a Deck whose Head has no S1+ line and still has the hard rules.
3. WHEN the fresh call is ready, THE first thing heard SHALL be the Fixed_Line "Got it. I'll keep things general for now."
4. WHILE a Call_Swap runs, THE Browser_Client SHALL keep the call looking live, with the avatar in `thinking`; IF the swap fails, THEN the existing connection recovery SHALL apply.
5. THE Voice_Machine SHALL let no reply be audible on a call opened before the hit (contracts §6: narrowing needs a closed call).
6. WHEN the connection drops while an Outstanding_Turn exists, THE Voice_Machine SHALL wait for that Turn's response, up to its deadline, before it chooses between the Call_Swap and the recovery screen.
7. WHEN `crisis` is also a candidate on the Turn, THE Server_Library SHALL still record the Audience and raise `policyRev`, but the hang-up and the Call_Swap SHALL wait until the care reply has finished playing or been interrupted, and the company Fixed_Line SHALL not be spoken on that Turn.
8. In this spec, `quiet` SHALL narrow the whole Session, as `company` does, and a Session opened by the Owner's call button SHALL start `private`.

### Requirement 15: Alone, unknown and the parse repair

**User Story:** As the owner, I want Franki to open up again when I say we're alone, and to stay careful when it isn't sure, without hanging up on a hiccup.

#### Acceptance Criteria

1. (Wave B) WHEN the chosen class is `alone`, THE Server_Library SHALL set the Audience to `private`, raise `policyRev` and issue a new Deck, with no hang-up, and THE reply SHALL be the Fixed_Line "Okay, just us again."
2. WHILE the Effective_Audience is `unknown`, THE Server_Library SHALL issue no S1+ note and no StateAck, so no reply uses `fastO` and every reply takes the slow path; there SHALL be no hang-up and no Fixed_Line.
3. WHEN a Slow_Parse fails on its deadline or on a transport error, THE Server_Library SHALL run one Parse_Repair after the Turn's response has been sent, through the same Decisions_Port, with a 2,000 ms deadline.
4. WHEN the Parse_Repair commits an Ordinary_Parse, THE Parse_Gap SHALL close and the Effective_Audience SHALL return to the stored Audience.
5. WHEN the Parse_Repair commits a Control_Hit, THE Server_Library SHALL run that route as a late hit.
6. IF the Parse_Repair fails, THEN THE Server_Library SHALL set the Audience to `unknown` until a parsed `alone`, and the Parse_Gap SHALL stay for the Session.
7. WHEN a voice Turn is posted `missing`, THE Effective_Audience SHALL be `unknown` until a Superseding_Post commits its parse or its repair window ends; an ordinary Superseding_Post SHALL close the gap as criterion 4 says, and no Superseding_Post by the end of the window SHALL set the Audience to `unknown` as criterion 6 says. WHEN a voice Turn's transcription `failed`, THE Server_Library SHALL set the Audience to `unknown` with no repair.
8. A parsed `alone` SHALL restore the Audience but SHALL NOT close a Parse_Gap (contracts §6 "alone canrestoreaudience,notgap").
9. THE Fixed_Lines SHALL live as constants in one Core_Library module.

### Requirement 16: `judge_v2` candidate

**User Story:** As the owner, I want a judge that hears company better, measured before it ships, so that the fix is proven and not assumed.

#### Acceptance Criteria

1. THE Core_Library SHALL export `JUDGE_V2_INSTRUCTIONS` beside `judge_v1` in `packages/core/src/voice/judge.ts`, equal to the `judge_v1` literal with this sentence added on its own line after the `H:` line: `Another person present, arriving, listening, on speaker or being addressed is company: H, even when said as small talk.`
2. A test SHALL assert the exact text of `JUDGE_V2_INSTRUCTIONS`, and a test SHALL assert that no line of `scripts/judge-spike/lines.json`, and no close copy of one, appears in it.
3. THE `judgeCreate` function SHALL take the contract name as part of the Judge_Setting and SHALL put it in `metadata.contract`.
4. THE app's Judge_Setting SHALL stay `judge_v1`; `judge_v2` SHALL replace it only after a measured run shows company recall up and nothing else down.
5. THE Core_Library SHALL keep contracts §5's values as `JUDGE_CONTRACT_SETTINGS`, and SHALL add the app's Judge_Setting as a separate constant.

### Requirement 17: The Harness measures the slow parse

**User Story:** As the owner, I want the spike to score the judge, the slow parse and their joint miss, so that the two nets are measured together.

#### Acceptance Criteria

1. THE Harness CLI SHALL take `--judge judge_v1|judge_v2`.
2. WHEN a line's transcript arrives, THE Harness SHALL run the Slow_Parse on it with the same Core_Library functions and a Decisions_Port that is the fake unless `--live` is given.
3. THE Harness SHALL record per line the regex hit, every probability and the parse time.
4. THE Harness summary SHALL add, per control class, recall for the Judge, for the Slow_Parse and their joint miss, and false holds for each.
5. THE Harness summary SHALL report the share of parses that miss the 350 ms deadline, and the parse time's p50 and p95.
6. THE Harness SHALL record the judge deadline and contract name of each run in its run file, so runs at 600 ms and 1,200 ms stay comparable.
7. THE file `scripts/judge-spike/lines.json` SHALL not change.

### Requirement 18: The Latency_Clock

**User Story:** As the owner, I want each turn's timings on screen, so that the VAD and the judge can be tuned from numbers.

#### Acceptance Criteria

1. WHEN a voice Turn completes, THE Browser_Client SHALL record on the browser opsClock: the last loud input frame (from the existing Level_Meter), the Commit, Judge sent, Verdict, Muted_Audio_Start, audible start, and the path taken (`fastO`, regenerated, slow, recovery).
2. THE Debug_Panel SHALL show the last Turn's row, and the p50 and p95 of "end of audible speech to audible start" for the Session, by path.
3. THE Latency_Clock SHALL report the commit delay (last loud frame to Commit), so the `semantic_vad` settings can be tuned (decision 6).
4. THE Latency_Clock SHALL add no wire field; IF the design wants these numbers on the server, THEN it SHALL raise a contract question.
5. THE design SHALL name the loudness threshold for "last loud frame" and the Realtime event used for audible start, and say how they compare with the Harness's `SPEECH_RMS_THRESHOLD` and its audio deltas.
6. THE LatencyRow SHALL carry why `fastO` was refused (`refused`: null, `verdict`, `ack`, `outstanding`, `staleAck`, `noteWaiting` or `hash`), and THE Debug_Panel SHALL show it in the last Turn's row with a count per reason for the Session.
7. THE LatencyRow SHALL carry whether the Turn was a Late_Turn, and THE Debug_Panel SHALL count Late_Turns for the Session.

### Requirement 19: VAD settings

**User Story:** As the owner, I want to keep the VAD that doesn't cut me off, with its settings in one place.

#### Acceptance Criteria

1. THE `sessionUpdate` function SHALL keep `turn_detection.type` `semantic_vad`, with `create_response:false` and `interrupt_response:false`.
2. THE `semantic_vad` settings SHALL be named constants in the Core_Library.

### Requirement 20: Properties

**User Story:** As the owner, I want the admission rules proven over arbitrary event orders, so that a race can't make Franki speak out of turn.

#### Acceptance Criteria

1. THE build SHALL have fast-check properties, over arbitrary sequences of Voice_Machine events including out-of-order and repeated Realtime events where the property is about the browser, for each of:
   1. **No permit, no sound.** Output is unmuted only in `SPEAKING` under a Permit that passed every check and is bound to the current Turn and generation.
   2. **A held reply never resumes.** After `H`, `U` or a Judge_Deadline miss for a Turn, no audio of that Turn's Speculative_Reply is ever audible, whatever arrives later.
   3. **Nothing dispatches before admission.** No tool request, `admitted` or `playbackStarted` receipt, or action command is emitted for a Turn before its Permit.
   4. **No clipped suffix.** After an `O` that follows Muted_Audio_Start, the audible response is a new response, and the earlier one was cancelled and cleared first.
   5. **Stale events are inert.** Events of another generation, or for a cancelled response, never move the machine or unmute output.
   6. **Every wait ends.** From any reachable state, with timers firing at their deadlines and no other events, the machine reaches `LISTENING`, `RECOVERY` or `CLOSED` in bounded time.
   7. **`fastO` needs a fresh ack.** A `fastO` Permit is issued only with a matching four-revision StateAck under 2.5 s old, obtained after the last `/api/turn` response, with no Outstanding_Turn.
   8. **The seam is total and closed.** For every combination of Turn kind, transcript state, `judge` value, Slow_Parse result and Effective_Audience, the Server_Rule returns exactly one Permit kind or a hold, and never an S1+ note on a Turn the judge didn't mark `O`.
   9. **Priority is stable.** For any probability vector, the chosen class follows the order of Requirement 10.7, a retained `crisis` candidate always gets the care reply, a Regex_Match never selects a route, and a Regex_Match never changes the outcome of a parse that succeeded.
   10. **Narrowing needs a closed call** (wave B). After a `company` or `quiet` hit, no reply is audible on a call opened before the hit, except the hit Turn's own crisis care reply (Requirement 14.7).
   11. **A repaired gap leaves no trace.** After a Parse_Repair that commits an Ordinary_Parse, and after a Turn posted `missing` and then superseded with an ordinary final transcript, the Session's state equals the state of a run in which the first parse, or the transcript, had arrived in time.
   12. **A late Permit plays; a timed-out request doesn't.** A checked server Permit that arrives before its request times out leads to a reply even after Commit + 2,500 ms, unless speech starts first; one that arrives after the timeout leads to none; and the Turn is a Late_Turn exactly when its Permit arrived after Commit + 2,500 ms.
2. Every property task SHALL be required, not optional.
3. WHEN a property fails during the build, THE build SHALL put the seed and the shrunk failing sequence in the report before fixing the code, and SHALL never weaken a property to make it pass.
4. IF a property is still red after a real attempt, THEN THE build SHALL leave it red and report the counterexample.
5. Generators, arbitraries and trace helpers SHALL live in plain modules (`packages/core/src/voice/testing/`, `packages/core/src/intents/testing/` and `packages/server/src/testing/`), and each `*.property.test.ts` file SHALL hold only property statements, so that fixing a generator is an ordinary edit and changing what a property claims needs a stop and a report.

### Requirement 21: Existing tests and Requirement 17

**User Story:** As the owner, I want the old checks carried forward honestly, so that replacing `devAdmit` loses no protection.

#### Acceptance Criteria

1. THE build SHALL update `dev-admit.test.ts`, `debug-memory.test.ts`, `voice-client.test.ts`, `machine.test.ts` and `DebugPanel.test.tsx` to the new requirements.
2. WHEN a test of `devAdmit` or `devPermitKind` is removed, THE build SHALL add a test of the Server_Rule or FastO_Rule that protects the same thing: one decision per outcome, the payload hash, `postCommitControl` with no S1+ note for pasted lines, `recoveryOnly` for missing and failed transcripts, and no Permit outside the seam.
3. THE generation SHALL stay one per Session in this spec (question 27); responses are told apart by Turn ID and response ID.

### Requirement 22: Build rules

**User Story:** As the owner, I want the build to cost nothing and touch nothing it shouldn't.

#### Acceptance Criteria

1. THE build SHALL make no call to OpenAI or any other network service and SHALL run nothing with `--live`.
2. THE build SHALL set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next.
3. All waits and timestamps SHALL use the opsClock, and the clock guard SHALL apply.
4. Model IDs SHALL come from Model_Config, never from code.
5. No reply path SHALL skip the Admission_Seam or the FastO_Rule, and no probe line SHALL be relabeled.
6. THE build SHALL make edits and commits in separate calls, end every commit message with the trailer line `Built-with: Kiro`, add no dependency without asking, and neither push nor deploy.
7. THE build SHALL read the relevant guide in `node_modules/next/dist/docs/` before writing any route or other Next.js code (`apps/web/AGENTS.md`).

### Requirement 23: Stop and report

**User Story:** As the owner, I want the build to stop on the known failure modes instead of working around them.

#### Acceptance Criteria

1. IF the Judge and the Speculative_Reply can't run as two out-of-band responses over the app's data channel the way the Harness ran them over its WebSocket, THEN THE build SHALL stop and report.
2. IF, with 75 ms added per Firestore round trip on the emulator, the slow path can't return its Permit within 2.5 s of the Commit, THEN THE build SHALL stop and report.
3. IF keeping the `fastO` StateAck fresh needs more than one `/api/session/state` request per second during a call, THEN THE build SHALL stop and report.
4. IF a property is still red after a real attempt, THEN THE build SHALL stop and report its counterexample.
5. IF more than 1 in 10 Decisions calls misses 350 ms on the dry numbers that can be measured locally, THEN THE report SHALL say so; the live number comes from the Harness run after wave A.

### Requirement 24: Report and checks

**User Story:** As the owner, I want a report after each wave, so that I can run the live check and see what changed.

#### Acceptance Criteria

1. WHEN a build wave ends, THE build SHALL write `docs/briefs/011-report.md` with what was built and where, the contract questions raised, the requirements changed, every shrunk counterexample (seed, sequence, fix), what couldn't be checked, and the live-check steps for the owner (what to say, and what the Debug_Panel should show).
2. THE wave A live-check steps SHALL cover at least: an ordinary question (path `fastO`, with its Latency_Clock row), a line that holds ("forget what I said about…", expecting the Fixed_Line), a false hold, an interruption mid-reply, and two fragments said with a pause between them.
3. WHEN a build wave ends, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` SHALL all exit 0, and no command run SHALL have called OpenAI.
