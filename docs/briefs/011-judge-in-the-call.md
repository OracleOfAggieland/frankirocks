# Brief 011: the judge in the call (F2)

The judge spike is measured and decided (contract question 51). The app doesn't use any of it yet. Every voice reply is still admitted by `devAdmit` as `slowOrdinary`: the Browser_Client waits for the transcript, posts `/api/turn`, and only then asks for the reply. This brief puts the judge into the call, replaces `devAdmit`, builds the slow gate behind the judge, and gives company, quiet and alone their routes.

Work as a new spec, `voice-control`, in `.kiro/specs/voice-control/`, on branch `build/voice-control`. It covers contracts §10 rows KV01 to KV06, KV11 and KV13. KV07 and KV08 (forget) join this spec in a later brief.

Read first, in full:

- `docs/design/memory-spec-v3.md` §3 (the life of a turn, the five permits, the control turn), §13 (targets and gates) and §14 (F2, and addition 13).
- `docs/design/memory-contracts-v2.md` §5 (Execution table, `judge_v1`, `TurnIntents`) and all of §6 (wire types, the Admission table, Realtime, the `/api/turn` and `/api/receipt` rows, States).
- `.kiro/specs/first-spoken-call/design.md`, contract questions 46 to 51.
- `packages/core/src/voice/judge.ts`, `packages/core/src/voice/machine.ts`, `packages/core/src/admission.ts`, `packages/server/src/admission/`, `packages/server/src/routes/turn.ts`.
- `scripts/judge-spike/harness.ts`. Its parallel mode is the working reference for a judge and a muted reply running as two out-of-band responses at once.

## Phases. Stop after each one.

1. **Requirements.** Write `requirements.md` in EARS form from the design docs and this brief. Stop for review.
2. **Design.** Write `design.md`, with a Correctness Properties section and a "Contract questions" section. Stop for review.
3. **Tasks.** Write `tasks.md` in two waves: wave A is admission (scope items 1 to 4, 6 and 7), wave B is audience (item 5). Every property task is required, not optional. Each task names its dependencies, its estimate and its test witness. No two tasks in the same parallel group touch the same file. Stop for review.
4. **Build wave A.** One commit per task, each message ending with the trailer line `Built-with: Kiro`. Stop for the live check.
5. **Build wave B.** Same rules. Stop.

## Decisions this spec builds on

From contract question 51 (the owner, Nov 9):

1. The judge and the reply run in parallel. Both are sent at the commit, and the reply stays muted until a valid `O`.
2. The judge is uncapped (`max_output_tokens:"inf"`), effort `minimal`.
3. The judge's deadline is 1,200 ms from the commit.
4. The ordinary latency target is about 1.3 s p50 from the end of audible speech to audible time. A p50 over 1.5 s is a stop line.

Decided for this spec on Nov 9, on the owner's delegation. Record each as a contract question in this spec's `design.md`, numbered on from 52:

5. **The company miss gets both nets.** The judge held 1 of 5 company lines. First net: the slow parse runs on every voice transcript, whatever the judge said, and a late hit cuts the audio. Second net: a `judge_v2` candidate with one sentence added about another person being present (scope item 6). `judge_v2` replaces `judge_v1` in the app only after a measured run shows company recall up and nothing else down.
6. **The VAD stays `semantic_vad`** (question 47). Being cut off mid-sentence is worse than a slower commit. Its settings are named constants, and the latency clock reports the commit delay so they can be tuned from numbers.
7. **Deadlines count from the commit.** The slow path starts when the transcript arrives; it doesn't wait for the judge's deadline. A turn with no transcript by 1.5 s gets the neutral line, as today. A turn whose judge is late but whose transcript arrived gets until 2.5 s for its server permit before the neutral line. Question 51 kept "the 1.5 s neutral line"; with a 1,200 ms judge deadline, that would leave the slow path 300 ms and turn most late verdicts into "Sorry, say that again?". Mark this one as needing the owner's confirmation.
8. **Company and quiet hang up and come back in a fresh call** (the floor in spec §3 and contracts §6). No isolation without a hang-up in this spec.

## Scope

### 1. Steering, as the first task

- Write `.kiro/steering/voice-control.md` with `inclusion: fileMatch`, matching the voice machine, the voice client, the admission files and the turn route. Under 80 lines. It states these rules and names the contract sections they come from:
  - There are five permit kinds, and each permit is bound to one turn and one generation (KV03).
  - Nothing dispatches before admission: no audible audio, tool call, action or receipt (KV02).
  - A reply held by `H` or `U` never resumes. A later `O` for the same turn changes nothing.
  - An `O` that arrives after muted audio began cancels, clears and regenerates. No suffix of the earlier response is ever heard.
  - S2 is never in the Head. An S1+ note stays off the deck and arrives beside its permit, only once every earlier turn's parse has committed (KV11).
  - A note that misses its deadline drops. The reply still plays.
  - Every wait has an opsClock deadline (KV06). Speech start cancels and clears older output and permits (KV04). A higher revision cancels older decks and speech (KV05).
- Update `.kiro/steering/memory-rules.md`: the "Admission seam" paragraph (no more `devAdmit`), and the "Design docs are read-only" paragraph, so that contract questions go in the design of the spec being built.

### 2. The Browser_Client: judge and speculative reply together

Follow contracts §6 "States" (`WAIT_ITEM`, `JUDGING`, `SPECULATING`, `HELD`) with the decisions above. In the pure reducer:

- At each commit, once the matching `conversation.item.added` has arrived, send the judge (`judgeCreate`, all unadmitted committed fragments since the last admitted reply, in commit order) and, in the same step, the speculative reply (`conversation:"none"`, metadata purpose `speculative`). Output stays muted at the audio element.
- **Valid `O`, and every `fastO` condition in the Admission table holds:** issue the `fastO` permit locally, check it like any other permit, and unmute. If muted audio has already begun, cancel, clear and regenerate instead.
- **`H` or `U`:** cancel the speculative response by its ID, clear the output buffer, and go to `HELD`. That response never resumes.
- **No verdict by 1,200 ms from the commit:** cancel the speculative response and take the slow path.
- **`noteWaiting` on the deck:** follow contracts §6: on `O`, no speculation is unmuted until the stamped permit and its note arrive; a missed note drops and the plain reply plays (KV11). No new note producers in this spec.
- A function call inside a speculative response is not dispatched before the reply is admitted.
- The new phases map to the avatar's thinking look. The avatar never shows speaking while output is muted.

### 3. The server: real admission behind the same seam

- Replace `devAdmit` with the real rule for each permit kind in the Admission table. For voice: `slowOrdinary` needs a final transcript and an ordinary parse; an S1+ note also needs judge `O`, at least one ASR word per 2 s of audio, every item final and every earlier turn parsed. Typed and pasted lines keep today's behaviour. Timeouts get `recoveryOnly`.
- The real rule runs in production. The seam stays the only function that creates a server permit, and it still writes exactly one ledger decision per call.
- `fastO` is issued by the browser (contracts §6: `fastO` local, others server). Design how the server records it from the `admitted` receipt and the turn's `judge:"O"`. If the closed ledger payload can't say what's needed, raise a contract question; don't add a field.

### 4. The slow gate: every voice transcript is parsed

- `TurnIntents` as contracts §5 gives it: the regex check first (regex can only hold), then the Decisions call with the literal predicate rows, the model from `FRANKI_BG_MODEL`, a 350 ms deadline, and failure meaning hold. Normalization, the `.20` candidate threshold and the priority order are pure functions in `packages/core`. The request builder and the response parser are pure too, and the call goes through a port with a fake. Check the Decisions request and response shapes against the `openai` package's own types in `node_modules`.
- `/api/turn` runs it on every `asr` transcript, whatever `judge` says, and on typed U lines.
- **Ordinary, reply already playing under `fastO`:** nothing changes.
- **Ordinary, turn held:** a `slowOrdinary` permit, a plain reply with no S1+ note, and a ledger decision that records the false hold and the judge's verdict.
- **A control hit while a reply is playing:** the response tells the browser, and the browser cuts the audio at once (cancel, clear, `HELD`), then takes the route below.

Routes in wave A:

- **Crisis:** the care reply, `tools:[]`, no notes, under `postCommitControl`.
- **Classes whose handlers come in later specs** (`forget`, `correct`, `transition`, `hardRule`, `food`, `action`, `why`, `answer`): the reply plays under `postCommitControl`, scope `reply`, with no S1+ note, and the ledger decision records the class. For `forget`, the reply is a fixed code line, "I can't forget things yet.", never model-worded, so Franki can't claim anything is gone.

### 5. Audience: company, quiet and alone (wave B)

- **`company` or `quiet`:** `policyRev` rises and the audience is recorded. Every registered call is hung up, and a fresh call opens with a narrower deck: no S1+ line in the Head, hard rules still present. The first thing heard in the fresh call is a fixed code line.
- **In the interface the call never looks ended.** The avatar stays in the call and shows thinking during the swap. If the swap fails, the existing recovery applies.
- **`alone`:** the audience returns to private with a higher `policyRev` and a new deck. No hang-up. A fixed code line confirms it.
- **A parse that fails or goes missing** sets the audience to `unknown` until a parsed `alone`. `unknown` allows what `company` allows.
- In this spec quiet narrows the whole session, as company does. The topic-level quiet effect comes with forget.
- The fixed lines live as constants in one module. Company and quiet: "Got it. I'll keep things general for now." Alone: "Okay, just us again."

### 6. `judge_v2` candidate, and measuring the slow parse

- Add `JUDGE_V2_INSTRUCTIONS` beside `judge_v1` in `packages/core/src/voice/judge.ts`. It is the `judge_v1` literal with one sentence added after the `H:` line: `Another person present, arriving, listening, on speaker or being addressed is company: H, even when said as small talk.` A test asserts its text. No frozen probe line, and no close copy of one, appears in it.
- `judgeCreate` takes the contract name as a setting, and `metadata.contract` carries it. The app's setting stays `judge_v1`.
- Harness: a `--judge judge_v1|judge_v2` option. After each line's transcript arrives, run the slow parse on it with the same core functions and a Decisions port (fake by default, live only with `--live`). Record per line the regex hit, the probabilities and the parse time. The summary adds, per control class, recall for the judge, for the slow parse, and their joint miss, and false holds for each.
- `scripts/judge-spike/lines.json` doesn't change.

### 7. The latency clock

- Per voice turn, on the browser opsClock: the last loud input frame (from the existing level reader), commit, judge sent, verdict, first muted audio, audible start, and the path taken (`fastO`, regenerated, slow, recovery).
- The debug panel shows the last turn's row, and p50 and p95 of "end of audible speech to audible" for the session, by path.
- No new wire field. If the design wants these numbers on the server, raise a contract question.

## Properties to write

With fast-check, over arbitrary sequences of reducer events, including out-of-order and repeated Realtime events:

1. **No permit, no sound.** Output is unmuted only in `SPEAKING` under a permit that passed every check and is bound to the current turn and generation.
2. **A held reply never resumes.** After `H`, `U` or a judge timeout for a turn, no audio of that turn's speculative response is ever audible, whatever arrives later.
3. **Nothing dispatches before admission.** No tool request, `admitted` or `playbackStarted` receipt, or action command is emitted for a turn before its permit.
4. **No clipped suffix.** After an `O` that follows muted audio, the audible response is a new response; the earlier one is cancelled and cleared first.
5. **Stale events are inert.** Events of another generation, or for a cancelled response, never move the machine or unmute output.
6. **Every wait ends.** From any reachable state, with timers firing at their deadlines and no other events, the machine reaches `LISTENING`, `RECOVERY` or `CLOSED` in bounded time.
7. **`fastO` needs a fresh ack.** A `fastO` permit is issued only with a matching four-revision ack under 2.5 s old, no control hit pending and no S2 turn among the last four.
8. **The seam is total and closed.** For every combination of turn kind, transcript state, judge value and parse result, the server rule returns exactly one permit kind or a hold, and never an S1+ note on a turn the judge didn't mark `O`.
9. **Priority is stable.** For any probability vector, the chosen control class follows the contracts §5 order, and regex alone never selects a route.
10. **Narrowing needs a closed call** (wave B). After a company or quiet hit, no reply is audible on a call opened before the hit.

When a property fails during the build, keep the shrunk counterexample: put the seed and the failing sequence in the report before fixing the code. Never weaken a property to make it pass.

## Requirement changes

This spec supersedes `first-spoken-call` Requirement 17 where it describes `devAdmit`, its production refusal and the voice rows of `devPermitKind`. Say so in `requirements.md`. Update the existing tests to the new requirements honestly; never delete a check without replacing what it protected.

## Rules that apply here

- All waits and timestamps use the opsClock. The clock guard applies.
- Model IDs come from Model_Config, never from code.
- `docs/design/` is read-only. Anything that can't be built as written goes under "Contract questions" in this spec's `design.md` with a proposed resolution.
- No reply path skips the seam. No probe line is relabeled.
- **Make no call to OpenAI or any other network service, and don't run anything with `--live`.** Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next.
- Make edits and commits in separate calls. Add no dependency without asking. Don't push or deploy.

## Out of scope

Forget and its fence. `FastSlotsV1`, `applyCorrection`, `applyTransition`. Food through `suggest`. The "why" route. Proactive speech. New S1+ note producers. Topic-level quiet. Isolation without a hang-up. The walked-in tap. A scheduled hang-up Function. The avatar rig.

## Stop and report, don't work around

- The judge and the speculative reply can't run as two out-of-band responses over the app's data channel the way the harness ran them over its WebSocket.
- A property is still red after a real attempt. Leave it red and report the counterexample.
- With 75 ms added per Firestore round trip on the emulator, the slow path can't return its permit within 2.5 s of the commit.
- Keeping the `fastO` ack fresh needs more than one `/api/session/state` request per second during a call.

## Report

Write `docs/briefs/011-report.md` after each build wave: what you built and where, the contract questions you raised, the requirements you changed, every shrunk counterexample the properties found (seed, sequence, fix), what you couldn't check, and the steps of the live check for the owner (what to say, and what the debug panel should show).

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` all exit 0, and no command you ran called OpenAI.
