# Brief 040: what the voice machine sends (lane `voice-b`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This is part B of phase two of `docs/briefs/030-wire-the-seams.md`; read that brief's "Two phases" section and the reports it names for this folder: `docs/briefs/017-report.md`, the "Outcome" sections of `docs/briefs/031-review-voice.md` and `docs/briefs/035-review-audience.md`, and questions H-166 to H-173 in `docs/briefs/022-report.md`.

Another lane (`lane/wire`, part A) is wiring what the server says: delivery, the Gate, the ledger, and the `pendingRendered` row when the hero offer is shown. This lane wires what a call sends. The seam between the two is the wire schema; this lane owns the changes to it named below.

## What to build

**1. `suggest` and `answer` in a call.** The tool list the voice machine sends (`packages/core/src/voice/machine.ts`, `RECALL_TOOL`, `PHONE_TOOL`) gains `suggest` and `answer`, dispatched behind exactly the Permit rules `recall` has: nothing before admission, the same reply staging, the same handling of a late or stale result. A reply after a tool result carries the tools the reply after `recall` carries. Re-record the golden corpus in that commit, and say in the commit message how many traces moved and why.

**2. In a call, `answer` is a trigger, and code decides.** Ruling of the lead, for the owner to confirm; it follows the pattern of `make_phone_call`, which takes no arguments and reads everything from the owner's own committed turn.
- The tool shown to the model has no parameters. The model cannot see a pending ID or a choice ID, and must not be asked to invent one.
- On the wire, `AnswerCall`'s `pendingId` and `choiceId` become nullable. A tap on a card still sends both IDs, as today. A call sends both null.
- With both null, `answerTool` resolves by code: the one offer whose `pendingRendered` row brief 037's binding accepts for this turn (shown in this session, and this is the owner's next turn after it). The choice comes from the owner's own final words in that committed turn: a plain yes from the closed list is yes; a plain no from a closed list you add beside it (`PLAIN_NO`, with its own tests and a property like brief 037's property 4) is declined; anything else is `clarify`. One null and one ID is `clarify`. No offer bound to this turn is `clarify`. Nothing here loosens the path with IDs.
- Write this as contract question H-180 at the end of the list in `docs/briefs/022-report.md`: it amends contracts line 761, where the model passes both IDs.
- If a reminder's offer is answered through the same tool today, say in the report how its yes and no are decided in a call, and whether the null path covers it. Do not change the reminder's handler.

**3. A pasted line in a call is sent as pasted text.** The voice machine's `typedSubmitted` event carries no source, so a pasted line in a call is held back with a message (ruling W-179 of brief 018). Add the source to the event (`typed` or `pasted`), carry it to the post, and remove the hold. A pasted line is third-party text on the server, exactly as a pasted line with no call open is today. Re-record the golden corpus in that commit if digests move.

**4. The visit ID in the voice open.** The machine's open sends `visitId: null` (lines near 532, 965, 978, 1233). It must send the visit ID the screen's visit model holds, on every open it makes: the first, a retry, a swap and a reconnect. The ID arrives as machine input (an event or a field set by the controller); the machine never reads the visit model itself. Another lane (brief 038) is giving each reset a new visit ID and answering STALE to an old one; when the server answers STALE to a call's open, the machine ends the call and the controller reloads the visit. If brief 038 has not merged when you reach this, build against `build/plan-stages` as it is and leave the STALE handling as a listed finding.

**5. The machine's own closes say so.** The machine sends a close with reason `user` from the owner's hang-up, and also from `startSwap` (for a Session other than the one swapped from) and from `dropStaleOpen`. Since brief 035 a `user` close marks a narrowed Session private (question V-172 in `docs/briefs/026-report.md`), so only the owner's own hang-up may send `user`. The other sites send `replace`, which the wire already has. Show with a test through the real machine and the close route that a company Session closed by the machine's own close stays company for the open that follows. Re-record the golden corpus in that commit.

## Properties

Every committed voice property stays green and unedited. Add, red first where the code fails today, 1,000 runs each:

1. **A tool is a tool.** For any event sequence, `suggest` and `answer` are dispatched under exactly the conditions `recall` is: replace the tool's name in any trace and the machine's commands differ only by that name.
2. **Only the owner's hang-up says `user`.** For any event sequence, every close the machine sends with reason `user` follows an owner's hang-up event for that Session.
3. **Every open of a visit names it.** For any event sequence after the visit ID is set, every open command carries it, and none carries an older one.
4. **A yes in a call is the owner's.** For any committed turn, any ledger and any model arguments, `answer` with null IDs applies only when the binding holds and the owner's words are a plain yes; the model's arguments never change the outcome.

## Hot files this lane may edit

`packages/core/src/voice/**` (never a committed `*.property.test.ts`), the golden corpus, `packages/core/src/schema/wire.ts` (the `answer` call, its tool JSON, the typed event's source; additions and the two nullables only), `packages/core/src/patterns/offer.ts` (the closed no list beside the yes list), `answerTool` and its helpers in `packages/server/src/routes/tool-food.ts` (the null path only; another lane is editing `suggestTool` in the same file, so keep to your function), `apps/web/src/client/**` and `apps/web/src/ui/**` where the call is driven and the typed bar submits, `docs/machines/voice-call.md` and `typed-line.md` (regenerate them as the repo's script does, never by hand).

Leave alone: `packages/server/src/routes/tool.ts`, `open.ts`, `turn.ts`, `state.ts` and `receipt.ts` (part A and two fix lanes are in them; if a seam needs one line there, say so as a finding and leave it for the lead), `packages/core/src/gate/**`, `whisper/**`, `moments/**`, `packages/server/src/time/**`, `seed/**`.

## Looking at it

A dev server on port 3210 only, the `/specimens` page only, no sign-in, stopped when you finish. Never port 3000. No live call and no microphone: every claim about a call comes from the machine's tests.

## Done

The five items with their tests, the four properties with seeds and counterexamples recorded, the golden corpus re-recorded with reasons, the checks of brief 016 with `npm run build` and the repo's machine-doc, copy-check, token-check and ui-boundaries scripts, and a section "Outcome" at the end of this file: each item with its commit, each property with its seed, each ruling as a numbered question, each finding left for the lead, and what only a live call can show.

## Outcome

Built by Claude Code on `lane/voice-b`, from `85c58ee`. `build/plan-stages` was merged three times:
- at the start, as a fast-forward;
- before the checks (`d144de3`, clean);
- after brief 039 landed (`87f56c5`, two conflicts).

No live call, browser call, microphone, emulator, paid model call, push or deploy.

"Golden" counts calls whose digest moved: `a` is the 600-call `arbCall` corpus, `w` the 500-call wide corpus.

### Items

| Item | Commit | Test that failed first | Golden moved |
|---|---|---|---|
| 2. `answer` is a trigger, and code decides | `6f0aac1` | `routes/answer-call.test.ts` (12 cases), `patterns/plain-no.property.test.ts`, property 4 | none |
| 1. `suggest` and `answer` in a call | `febd50c` | property 1 | 600 a and 398 w. Every `session.update`, and every later `response.create`, now lists four tools. The wide calls that didn't move never reach `session.update`. |
| 3. A pasted line in a call | `fdde24d` | `machine.test.ts` "brief 040 item 3", `voice-client.test.ts` "a pasted line in a call…" | 58 w: the calls with a typed line. Their `typedSubmitted` event now carries `source: "typed"`, and their commands are unchanged. |
| 4. The visit ID in the voice open | `f159aa4` | property 3, `components/app-controllers.voice-visit.test.ts` | none: no generator sends `visitSet` |
| 5. The machine's own closes say `replace` | `2cf076c` | property 2, `routes/machine-close.test.ts` | 4 w: each an `openOk` that came when the call no longer waited for it. Three were second answers in LISTENING, and one came after a hang-up. |

Item 2 was built before item 1 so the corpus is re-recorded once for the tool list.

- **1.** `CALL_TOOLS` (`recall`, `make_phone_call`, `suggest`, `answer`) go in three places: `session.update`, the speculative reply, and every reply that may call a tool.
  - All four go through one dispatch rule: `dispatchTool`, with `callToolArgs` in `voice/tool-args.ts`. Arguments that don't parse send nothing.
  - A reply after any result except `make_phone_call`'s offers all four tools again.
- **2.** `ANSWER_TOOL` has no parameters, and `AnswerCall`'s two IDs are nullable. A call always sends both null (`CALL_ANSWER_ARGS`), whatever the model wrote.
  - `answerTool`'s null path (`choiceByCode`) needs three things: the hero offer, brief 037's binding (`yesFollowsOffer`), and the owner's own final U turn.
  - If they hold, a plain yes becomes the yes ID and a plain no becomes the no ID. Anything else is `clarify`. The plain-no list is `isPlainNo`, with `PLAIN_NO_NEGATIVES` beside the yes list.
  - The chosen IDs then go through the path with IDs, which is unchanged.
  - One null and one ID is `clarify`, and so is no offer bound to the turn.
- **3.** `typedSubmitted.source` is required. `VoiceTurn.source` may be `pasted`, and the post carries it on.
  - A pasted turn is otherwise posted as a typed one.
  - The typed bar's call path passes `pasted` when the box holds pasted words.
  - The App.tsx hold and `COPY.typed.pastedInCall` are removed.
- **4.** The visit reaches the machine as a new event, `visitSet`.
  - `VoiceClient.setVisit` sends it. The signed-in controllers call it at start and on every visit-model change, and read the visit as the typed line's open reads it.
  - The machine keeps it as `visitId`, which no exit resets, and every open names it.
- **5.** Three close sites now send `MACHINE_CLOSE_REASON = "replace"`: `startSwap`, `dropStaleOpen`, and `onOpen` when the call is no longer awaiting the open. Only `hangUp` sends `user`.

### Properties (1,000 runs each)

| # | File | Red-first seed | Shrunk counterexample |
|---|---|---|---|
| 1 | `voice/a-tool-is-a-tool.property.test.ts` (over `arbToolCall`, `testing/arb-tool.ts`) | `1467917370` (suggest), `-273660055` (answer) | A slow-path turn whose admitted reply calls the tool. With `recall` the trace had 32 steps, with `suggest` 24: the call was ignored, never dispatched, answered or replied to. |
| 2 | `voice/only-hangup-says-user.property.test.ts` | `1255017179` | An early-open call whose stale open, answered at step 8 (`openOk`), was closed with `user` by `dropStaleOpen` |
| 3 | `voice/every-open-names-the-visit.property.test.ts` | `367700394` | A wide call with the visit set before `callPressed`, whose first open (step 1) carried `visitId: null` |
| 4 | `server/routes/answer-call.property.test.ts` | `1555773361` (against the old `answerTool`, with the nullable wire) | `[["Maybe later"], null, "{}"]`: the null path answered `stale`, not `clarify` |
| | `core/patterns/plain-no.property.test.ts` | `-902533802` | `["no","","",""]`: `isPlainNo` did not exist |

Property 1 compares two runs step by step. It renames the tool and masks two things: `answer`'s arguments, which it asserts null separately, and the Permit hashes, which each run computes over its own result.
- Reach at seed 2026, over 500 calls: 249 calls dispatch a tool (floor 120), and 103 reply after a tool result (floor 50).
- Property 4 runs the real routes and takes about 35 s.

### Rulings, for the owner to confirm

- **H-186**, in `docs/briefs/022-report.md`: in a call, `answer` takes no arguments and code decides, as item 2 describes, with the closed no list. It was first written as H-180 and renumbered on the lead's word.
  - A reminder's offer is not answered through `answer` today, because `confirmReminder` has no route caller. The null path doesn't cover it, and the reminder's handler is unchanged.
  - Brief 039's diet question (H-179) is found by its pending ID, which a call's null IDs never match. So in a call it falls through to the hero offer, and is `clarify` unless that offer is bound to the turn. This is not tested with a diet fixture.
- **V-182**: the close of an open answered after the call stopped waiting for it says `replace`, not `user`. That covers an open answered after a hang-up, after its wait ended, and a second answer. That Session was never the call's, so this fails closed. This site was not in the brief's list of three.
- `typedSubmitted.source` is required rather than optional with a default, so a missing source can never read as the owner's own words.

### Findings for the lead

1. **STALE on the call's open.** Brief 038 has not merged.
   - Today `apps/web/src/client/voice-client.ts` `postOpen`, at about line 309 (`if (res === null) return this.dispatch({ type: "openFailed" })`), reads a STALE answer as any other failure. A first open shows the open error, and a reconnect retries the same old visit three times.
   - When 038 lands, `postOpen` needs to tell `r.ok === false && r.kind === "http" && r.error === "STALE"` apart, and dispatch an event that ends the call. The controller (`apps/web/src/components/app-controllers.ts`) then reloads the visit.
2. **Tool cards in a call are not shown.** `suggest`'s food card and `answer`'s list card come back in the tool result, and `voice-client.ts` (about line 252, the `tool` command) passes the whole response to the machine. Nothing puts `result.cards` on the screen. Recall's cards aren't shown either.
3. **Friend Tests failed after merging `lane/writes`.** After this lane merged `lane/writes` (`1aeafb9`), 4 tests in `packages/server/src/scripts/gate-friend.test.ts` failed: "expected 1 responses.create, actual 2" on "My mom passed away last night."
   - They still failed with this lane's production code set back to its `build/plan-stages` versions, so the failure came from that merge, not from this lane.
   - The next `build/plan-stages` (`9ca2385`, G17) fixed it, and the file is green after the second merge.
4. The comment in the committed `a-tool-is-a-tool.property.test.ts` still says H-180 for what is now H-186. It is left unedited, as the rules require.

### Existing assertions changed

- `packages/core/src/voice/machine.test.ts`, both because item 1 changes the tool list:
  - the `session.update` tool names are now `["recall","make_phone_call","suggest","answer"]`;
  - the reply's tool count goes from 2 to 4.
- `apps/web/src/client/voice-client.test.ts`: the `session.update` tool names, for the same reason.
- No assertion changed in these, only the events they send:
  - the two `typedSubmitted` events in `machine.test.ts` and the two `sendTyped` calls in `voice-client.test.ts` now name `source: "typed"`;
  - so does the wide driver's typed line, in `testing/arb-call-wide.ts`.

### Hot files touched

- `packages/core/src/schema/wire.ts`: the two nullables in `AnswerCall`, `ANSWER_TOOL`'s parameters, and one comment.
- `packages/core/src/patterns/offer.ts`: the no list, and one normaliser shared with the yes list.
- `routes/tool-food.ts`: `answerTool` and `choiceByCode` only.
- `apps/web/src/client/voice-client.ts`: `sendTyped` and `setVisit`.
- `apps/web/src/components/app-controllers.ts`: one block, just before the return.
- `apps/web/src/components/App.tsx`: the call path's submit line and chip line.
- `apps/web/src/ui/copy.ts`: one key removed.
- `docs/machines/voice-call.md` and `typed-line.md`: edited by hand. The repo's machine-doc script (`scripts/machines-index.mjs`, run by `machines-index.test.ts`) checks these pages but doesn't generate them, and it passes.

Not touched: `tool.ts`, `open.ts`, `turn.ts`, `state.ts`, `receipt.ts`, `suggestTool`, `seed/**`, `ui/visit/**`, and the barrels. The new core module is re-exported from `machine.ts`.

### Checks (after the last merge, `87f56c5`)

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=3` | exit 0: 491 files, 4,252 passed, 35 expected fail (39 at this lane's start; the drop came from merged lanes) |
| `npm run lint` | exit 0; one warning, in `components/avatar/three/brass.ts`, not touched here |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `machines-index.test.ts`, `state-machines-steering.test.ts` | 23 passed |
| `node scripts/copy-check.mjs`, `token-check.mjs`, `ui-boundaries.mjs` | exit 0 each |

The voice-call doc edits (the close rule, property 2's file in the tests row) came after the full run; the two machine-doc tests were run again on them and pass.

Forget closure, resume, purge and No Resurrection were not touched, and no route calls the forget code.

### What only a live call can show

- That the Realtime model calls `suggest` and `answer` at the right moments, and calls `answer` with no arguments.
- That a real hero yes, said aloud after the offer is shown, applies.
- That a pasted line, put in the bar during a live call, reaches the server as pasted.
- That the visit ID reaches a real open after a reset.
- That on Firestore, a real swap's close of a company Session keeps the next call company.
