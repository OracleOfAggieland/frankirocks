# Brief 044: what a call puts on the screen, and the walked-in tap (lane `screen-b`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. Three things the wiring lanes left for the screen, in this order.

## 1. Cards from a tool result are shown

Finding 2 of `docs/briefs/040-voice-sends.md`'s Outcome: `apps/web/src/client/voice-client.ts` (near line 252) hands the whole `/api/tool` answer to the voice machine, and nothing reads `result.cards`. So in a call the hero's three dinners and the grocery list are talked about and never appear, and a recall the Gate sent to a card (a private detail asked for with company present) is neither spoken nor shown.

Spec §1 and the product rule: text appears only for something to read or approve, as a card, and this is not a chat window.

Build:
- A tool answer's cards go to the screen's card surface, the same one a typed turn's cards use (`apps/web/src/ui/**`, `components/surfaces/**`; find how `TypedTurns` or the `ProactiveShelf` shows a card today and reuse it). The voice machine stays pure and does not carry card content: the client passes the cards to the screen and the tool output to the machine.
- A card is shown only if its stamp still fits: the same Session and generation as the call's current one. A card from a tool answer that arrives after a swap, a narrowing or a hang-up is dropped, not shown late. With company or an unknown audience the server already decides what a card may hold; the client adds no content and removes none.
- All card text is escaped as today; a card never renders markup from a source.
- Cards from a call leave the screen as a typed turn's do (find the rule in the surface's machine and use it; do not invent a second one).

Test first: a client test where `/api/tool` answers `answer` with two cards and the screen's model holds them; one where the answer arrives after the Session changed and nothing is shown.

## 2. A call that names an old visit ends, and the visit reloads

Finding 1 of brief 040's Outcome, now that brief 038 has merged: each reset has a new visit ID and the server answers STALE (409) to an open, turn or bolt that names an old one. `apps/web/src/client/voice-client.ts` `postOpen` (near line 309, `if (res === null) return this.dispatch({ type: "openFailed" })`) reads STALE as a plain failure and retries.

Build: a STALE answer to the call's open ends the call (no retry with the same visit ID) and tells `components/app-controllers.ts` to reload the visit, as a typed turn's STALE already does (brief 038, finding 4; read the "Outcome" of `docs/briefs/038-review-seed-visit.md`). If the voice machine needs a new event for "the visit is gone", add it with its transitions test and re-record the golden corpus in that commit, saying how many traces moved. Property, red first, 1,000 runs: **an old visit never talks.** For any sequence of resets, opens, retries and swaps, after the server has answered STALE no further open carries that visit ID, and the call is not left waiting.

## 3. The walked-in tap (spec §14, addition 4; demo beat 4)

Spec line 211: company is set by the owner's words **or a tap**. The screen has `apps/web/src/components/surfaces/CompanyToggle.tsx`; `/api/turn` refuses every `trustedTap` and `uiControl` turn (`packages/server/src/routes/turn.ts` `checkTurnRequest`), so the tap does nothing. The demo's beat 4 ends with it: tap "Someone walked in", ask the same question, get the narrower answer. The script step is `tap: someone walked in` in `packages/server/src/scripts/beat4-leave-job.test.ts`, waiting.

Build, and keep it narrow:
- `/api/turn` accepts a `trustedTap` turn whose `uiControl.verb` is `company` or `alone`, with no target IDs and no text. Every other verb stays refused exactly as today.
- A `company` tap narrows exactly as a company line does, through the same code (`packages/server/src/audience-swap.ts`; read the "Outcome" of `docs/briefs/035-review-audience.md`): the Session narrows, `policyRev` rises, a call in progress hangs up and swaps to a narrow Head, the answer carries no Deck. An `alone` tap widens as the owner's own "it's just us" does. No model is called, no Evidence of words is written (there are none), and one ledger row records the tap as an ID and a reason code.
- It works with a call open and with none, and twice in a row is one change.
- The toggle shows the audience the server last confirmed, never its own guess, and is unavailable while the visit is cloning or failed (brief 038's input gate).
- The turn route is shared with two other lanes right now. Keep your change there to the one check and one call into a module of your own (`packages/server/src/routes/turn-tap.ts` or similar).

Properties, red first, 1,000 runs:
- **A tap narrows like the words do.** For any session state and any sequence of turns, a `company` tap and the line "my boss just walked in" leave the same audience, the same `policyRev` step and the same next Head.
- **Only two taps exist.** For any `uiControl` verb other than `company` and `alone`, and any `trustedTap` carrying text or targets, the turn is refused and nothing is written.

The beat 4 step turns green with its wait removed in that commit, and the next step ("same question, narrower answer") too if it then passes.

## Hot files this lane may edit

`apps/web/src/client/**`, `apps/web/src/ui/**`, `apps/web/src/components/**` (the surfaces, `app-controllers.ts`, `App.tsx`), `apps/web/src/app/specimens/**` (a specimen for cards in a call and for the toggle's states), `packages/core/src/voice/**` only for item 2's event (never a committed `*.property.test.ts`), the golden corpus if item 2 moves it, `packages/core/src/schema/wire.ts` (additions only), `packages/server/src/routes/turn.ts` (the one check and call), a new module for the tap, `docs/machines/*.md` for any machine that changes, and the beat 4 script's waiting steps.

Leave alone: `packages/server/src/onturn/**`, `packages/core/src/writes/**`, `moments/**`, `time/**`, `gate/**`, `whisper/**`, `routes/open.ts`, `state.ts`, `receipt*.ts`, `tool*.ts`, `delivery-wire.ts`, `seed/**`. If a seam needs a line there, write it as a finding for the lead with the file and line.

## Looking at it

A dev server on port 3210 only, the `/specimens` page only, no sign-in, stopped when you finish. Never port 3000. Look at the cards and the toggle there in a narrow and a wide window, and say what you saw. No live call and no microphone.

## Done

The three items with their tests, the three properties with seeds and counterexamples recorded, the checks of brief 016 with `npm run build` and the repo's copy-check, token-check, ui-boundaries and import-boundaries scripts, and a section "Outcome" at the end of this file: each item with its commit, each ruling as a numbered question, each finding left for the lead, every existing assertion changed and why, and what only a live call or a signed-in browser can show. Merge `build/plan-stages` before the final checks and run the full suite after it.

## Outcome

Built by Claude on lane `lane/screen-b`. Not pushed or deployed, and Kiro was not run.

### Items and commits

| Item | Commits |
|---|---|
| 1. Cards from a tool result are shown during a call | `c0d5f89` |
| 2. An open that names an old visit ends the call and reloads the visit | `440edb3` |
| 3. The walked-in tap, server half | `1e9c2fc` |
| 3. The walked-in tap, screen half and specimens | `91afc5d`, `37e72c3` (the specimen fits a 375 px window) |
| Merge of `build/plan-stages` (no conflicts) | `3d33e13` |

1. **Cards.** `apps/web/src/ui/call-cards.ts` decides when a tool answer's cards fit, and they must pass every check:
   - status `ready`;
   - the call is not closed;
   - the request's and the answer's Session and generation are the call's;
   - the deck's `policyRev` and epoch are no newer than the request's stamp.

   `apps/web/src/client/call-cards.ts` holds the cards, and they appear in the Card_Dock with the memory and proactive cards. They are cleared by a Session or generation change, a reset, a forget and sign-out.
2. **Old visit.** In the voice machine, `visitGone` ends the call when an open is answered STALE for the tab's visit. The call closes with `error: "visit"` and the visit reloads through brief 038's `gatedApi`. "Call" stays refused until then. A STALE that names another visit is a failed open. No golden trace moved.
3. **Tap.**
   - `packages/server/src/routes/turn-tap.ts` takes a trusted `company` or `alone` tap and narrows through the same Server_Rule, `audienceEffect`, `withNarrowHead` and hangup Job a line uses. It writes one Admission_Seam decision row with reason `audience`. `turn.ts` gained one check and one call.
   - `apps/web/src/client/company-tap.ts` drives the toggle. It shows only what an answer confirmed, and it is disabled while brief 038's gate holds input.
   - The beat 4 step `tap: someone walked in` passes with its wait removed. The script has no "same question, narrower answer" step, so nothing more turned green.

### Properties (1,000 runs each)

| Property | File | Red at base? | Seed | Counterexample |
|---|---|---|---|---|
| An old visit never talks | `packages/core/src/voice/old-visit-never-talks.property.test.ts` | Yes | 900752614 | A wide call whose server visit moved at step 0 ("elsewhere"). After STALE at step 2 the call was still CONNECTING. Path `10:0:0:0:0:0:2:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:2:0:1:1` |
| A tap narrows like the words do | `packages/server/src/routes/tap-narrows-like-words.property.test.ts` | Yes | 1056445634 | `[{"live":false,"before":[]}]`: the tap left the Session private where the line made it company. Path `0:0:0` |
| Only two taps exist | `packages/server/src/routes/only-two-taps.property.test.ts` | No | (none) | Green at base, because the old route refused every control turn. Kept as a guard. |

### Rulings

- **SB-221.** Call cards also leave on a Session or generation change, not only at hang-up.
- **SB-222.** A tap is not a Turn. It takes no clientSeq, writes no Turn or Evidence, and leaves `clientSeq` alone.
- **SB-223.** An `alone` tap widens only on a fresh Stamp, as the owner's own line does. A `company` tap needs only a current Session and generation, so a stale view never stops a narrowing.
- **SB-224.** A tap to the audience the Session already has, or on a Session already narrowed here, changes nothing: twice in a row is one change. The words, by contrast, raise `policyRev` again on a Session that is already company with no call open. The property allows for that one case.
- **SB-225.** STALE on an open that names a visit other than the tab's is a failed open, not a gone visit.

### Findings for the lead

1. No wire field carries the Session's audience, so the toggle shows only what tap answers confirmed. A company line spoken in words does not move it (`apps/web/src/client/company-tap.ts:44`).
2. With a call open, a tap's hang-up is recovered by the browser's reconnect. The new open inherits company and plays the swap line. The voice machine is not told directly, because this brief allows machine changes only for item 2.
3. The tap's decision row names a Turn that is never written (`packages/server/src/routes/turn-tap.ts:165`). The tap writes two ledger rows: the mutation's request entry and the decision.
4. `turn-tap.ts:45` imports `statusOf` from `./turn`, which imports `turn-tap`. The cycle works, but `statusOf` could move to a shared module.
5. `packages/server/src/testing/script-runner.ts` was edited outside the listed files, because the runner's tap body did not match the wire schema. A tap now posts `uiControl {verb, targetIds: []}` with no words and does not advance `nextSeq`.

### Existing assertions changed

None was loosened.
- `packages/server/src/scripts/beat4-leave-job.test.ts`: the `waits` line came off the tap step, which now passes.
- `voice-client.test.ts` and `specimens.test.tsx` only gained tests, plus a setup option for `onToolCards`.
- `apps/web/src/components/app-controllers.voice-visit.test.ts:41` failed at base; plan-stages commit `3e27bd2` fixed it in the merge.

### Checks after the merge (`3d33e13`)

- Full suite: 525 files, 4,357 passed and 23 expected fail.
- `npm run lint` passes (one warning, already there, in `components/avatar/three/brass.ts`).
- `npm run typecheck` and `npm run build` pass.
- copy-check, token-check, ui-boundaries and import-boundaries all pass.

### Seen on `/specimens` (port 3210, no sign-in)

- **1280×900:**
  - The hero's two cards sit in the Card_Dock under the call controls, two depths stacked, front card 343×180.
  - Markup in a card shows as escaped text.
  - After a press, the toggle is disabled with `aria-checked` false. It turns true only after "Server answers", and "Server refuses" leaves it as it was.
  - The gated toggle is disabled.
- **375 wide:** all four tiles fit (right edge 359 px or less). The page as a whole is 560 px wide at that size, which predates this lane.
- The "visit gone" call form shows its copy.

### Only a live call or a signed-in browser can show

- The Realtime model calling a tool whose answer brings cards in a real call.
- A real STALE after a reset in another tab, ending the call and reloading the visit.
- A tap during a live call: the hang-up, the reconnect and the swap line.
- The toggle on a signed-in lab, with the typed Session opened by a tap.
