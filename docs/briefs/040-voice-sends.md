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
