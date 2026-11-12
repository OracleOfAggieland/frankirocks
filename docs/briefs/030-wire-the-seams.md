# Brief 030: wire the seams, and walk the demo (lane `wire`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

The lanes of this build each stopped at a seam: a function exported and tested, with the route or screen that should call it left alone because another lane was writing that file. This brief makes those calls. When it is done, a visitor can load the seeded month, type a line, move time, and see Franki raise the right thing, and the demo scripts of brief 029 pass wherever they do not depend on a completed forget.

This brief starts only after these are merged into `build/plan-stages`: voice writes wave B (018), one-shot time (023), the Gate (024), the visit controls (027), the scripts (029) and the audience wave on the server (026). For this stage, this lane is the one writer on the route files.

## Read first

- The "seams", "not built" and "rulings" sections of every report in `docs/briefs/`: 017, 018 (and the wave B section of 012-report), 019, 020, 022, 023, 024, 026, 027, 028 and 029. Brief 029's report has the table of demo beats and what each waits for, and its findings where merged pieces do not fit. Those lists are the task list of this brief. Make your own list from them first, in `docs/briefs/030-design.md`: each seam, the file and function that should make the call, the test that will show it, and the order.
- Spec §15 (lines 462 to 475), §5 lines 192 to 194 (triggers and delivery), §6 lines 196 to 241, the Head (99 to 120).

## What to wire

Each item names the lane that built the piece. If a report's seam list disagrees with this list, the report wins; say so in your design note.

1. **Time into the routes** (023): `tickUser` on open, on a jump and at most once an ops minute from the state route; delivery's choice as the `Proactive` on open and state, and as an idle whisper in an open session; the `said` match in the receipt route, so `saidAt` is set only from an admitted receipt that matches.
2. **The visit on open** (019, 027): `open` reads the visit ID as contracts line 736 gives it, so a visitor's session runs on their clone and its fixture clock.
3. **The hero as a moment** (022, 023): the detector's result becomes an `insight` moment that delivery can choose, with the offer worded by the hero lane's templates; "yes" writes the list and the loop through the hero lane's handler; at `checkAt` the comparison runs and `celebrate` is delivered. It can never play in a session with a transition or crisis candidate, or within two turns of a check-in answer.
4. **The Gate in front of what is said** (024): every candidate that delivery or a tool would put on the wire passes the Gate with the session's audience; the Deck's `whispers` are built by the whisper builder from Gate-approved candidates only; `compileHead`'s third-party labels pass `safeName`.
   Brief 033 fixed the Gate after a review and changed its inputs: read its "Outcome" section before wiring. The context now names the moment (`opener` or `idle`), a whisper is refused unless it matches the Gate result it was built from, `withWhispers` takes the audience, and an asked S2 recall goes to a card until the on-screen ask exists (question G-163). Do not edit `packages/core/src/gate/**` or `whisper/**` here; if a seam needs the Gate to change, write it down as a finding.
   `writeSaid` still trusts the match its caller hands it (finding 12 of brief 033). Compute the match inside it, from the transcript and the whisper, with the time lane's matcher.
5. **The ledger** (024): the turn, tool and receipt routes write said, held, steered, declined and blocked rows as IDs and reason codes, and the Lab's counts read them, so the five Lab counts brief 020 left uncounted become real.
6. **Food and the answer in a call** (022, 017): the tool list the voice machine sends includes `suggest` and `answer`, behind the same Permit rules as `recall`. The golden corpus is re-recorded in that commit, with the count of calls moved and the reason.
7. **The screen** (020, 027): rule motes in the jar from the rules document; the strip's money figure from the loop; the proactive line or card shown when `advance` or `open` returns one; the false-"gone" check on spoken transcripts through the receipt route.
8. **Findings of brief 029:** each place where two merged pieces did not fit.

9. **Smaller seams the lead collected while merging:**
   - `routes/tool-food.ts` builds its snapshot with no blocks, so a blocked item could be offered. Give it the blocks the read route uses (brief 028, finding 3).
   - `SeedResetRequest` and `ResetRequest` are two wire types for one request. Keep one.
   - The decisions of the hard-rule route that need a ledger row are listed in the "Outcome" section of brief 032 (question W-166). Write those rows.
   - In a call, a pasted line is held back with a message, because the voice machine's typed event carries no source (ruling W-179 of brief 018). Add the source to that event, so a pasted line in a call is sent as pasted text. Re-record the golden corpus in that commit if digests move.
   - The seed lane's five properties run 20 to 40 cases. Bring them to 1,000 by making each case cheaper, not by weakening what it checks. This is the one place a committed property file may be edited, and only its run count and set-up.

## What stays out

- **Forget.** No route calls the forget code, and admission rule 11 stays as it is. Closure, resume, "Gone" and the No Resurrection property are reserved for a later run (brief 021). The parts of beat 5 that need a completed forget stay expected-fail.
- Tuning anything against a live model or a live call.
- Corrections and life changes (brief 025's).

## Two phases

Three fix lanes are still open when this brief starts: the voice fixes (brief 031, in `packages/core/src/voice/**`), the hard-rule fixes (brief 032, in `packages/core/src/writes/**` and `packages/server/src/onturn/**`) and the Gate fixes (brief 033). Leave those folders alone until their lanes have merged. So this brief runs in two phases.

**Phase one: everything that puts no new words on the wire.** The tick on open, on a jump and from the state route; the visit on open; the `said` match in the receipt route; the hero's result stored as an `insight` moment and the loop's check at `checkAt` (stored, not yet delivered); the screen's leftovers, including showing a `proactive` when one is returned; the findings of brief 029 (the hero window after a jump, the loop's lineage, the Lab's count of guesses); and the smaller seams of item 9 except the pasted line in a call.

**Phase two: everything that does.** Delivery's choice as the `Proactive` on open and state and as an idle whisper; the hero offer and `celebrate` said; the Gate in front of all of it; the ledger rows; `suggest` and `answer` in a call; the pasted line in a call. Nothing in phase two may be built so that a candidate reaches the wire without passing the Gate, not even for one commit.

A later review of the time lane (brief 036) moved the Gate for delivery inside `chooseNow`: it gates every candidate with the session's audience and modifiers, rereads the source at admission and enforces the caps there. So for delivery a route passes the audience and modifiers in and puts the answer on the wire, and does not gate a second way. That lane is the one writer on `packages/core/src/moments/**` and `packages/server/src/time/**`.

Before phase two, merge `build/plan-stages` and look for an "Outcome" section at the end of `docs/briefs/033-review-gate.md`, `docs/briefs/036-review-time.md` and `docs/briefs/031-review-voice.md`. If all are there, go on. If any is missing, stop at that boundary with the tree green and everything committed, and report what phase one did. The lead will send you on when the fixes have landed.

### Phase two, in two parts

Two fix lanes are still editing `packages/core/src/voice/**`, the hero's yes binding and `packages/server/src/food/**` when phase two starts (briefs 035 and 037). So phase two runs in two parts.

**Part A, now: what the server says.** Delivery's choice as the `Proactive` on open and state and as an idle whisper, through the gated `chooseNow`; the hero offer and `celebrate` said; the Gate in front of every tool result and every whisper built outside delivery; the ledger rows, with the Lab's counts reading them; `writeSaid` computing its own match; showing a `Proactive` that an open returns.

**Part B: what the voice machine sends.** `suggest` and `answer` in the call's tool list, the pasted line in a call, and the visit ID in the voice open. This moved to its own lane and brief, `docs/briefs/040-voice-sends.md`, once the audience fixes had merged. This lane leaves `packages/core/src/voice/**`, the golden corpus, `answerTool` and the `answer` wire shapes alone. The seam between the two lanes is the `pendingRendered` row part A writes when the hero offer is shown or said.

Part A also takes question V-181 of `docs/briefs/026-report.md`: the tool route narrows on a company or quiet hit exactly as the turn route does, with its own new property file.

Read the "Outcome" sections of briefs 033 and 036 before part A. Brief 036's has the table of changed signatures (`chooseNow`, `admitMoments`, `recordPlayback`, `isMustSay`, `proactiveOf`); brief 033's has the Gate's caller contract.

Rulings of the lead for part A, each for the owner to confirm:

- **A Gate `card` verdict is not spoken and not shown** until the on-screen ask exists (`S2_SCREEN_ASK_BUILT` is false). Write a `held` ledger row with the Gate's reason. Do not build a card route for it here.
- **Crisis holds a confirmed reminder too.** Contracts line 332 lets `mustSay` skip quiet hours and caps, nothing else, so the Gate's reading stands over delivery's. A held reminder stays planned and is offered again at the next opening after crisis clears; it is never dropped silently. If the code drops it today, say so as a finding with the smallest fix.
- **A session with no known audience is `unknown`, never `private`.** A route that has no audience for the session passes none, and `chooseNow` treats that as `unknown`.
- **The hero offer's whisper carries the IDs the yes needs** (the pending ID and the choice IDs), as data for the server, never as words for the model. Brief 037 binds the yes to the offer just shown; use its binding when part B wires `answer`.

Other lanes are making small edits in `packages/server/src/routes/open.ts`, `state.ts`, `turn.ts` and `receipt.ts` (a barrier check, a visit check, the narrowing on a repair). Keep each of your edits there to a few lines that call into a module, so the merges stay easy.

## How to work

One seam per commit. For each: the test first (a route test, or the demo script that waits for it, which loses its `it.fails` in that commit), then the call. Keep each call small: the logic lives in the lane's module, and the route gains a few lines. If a seam needs the piece itself to change, change it in its own module, with its tests.

Properties from other lanes must stay green and untouched: the rule is in every Head, nothing ineligible is shown, subtract only, a jump equals waiting, zero hard-rule misses, at-most-once admission, the serialization of `/api/turn`.

## Hot files this lane may edit

All of them, for this stage, except `packages/core/src/eligible.ts` (call it) and `packages/core/src/forget/**` and `packages/server/src/forget/**` (leave them).

## Looking at it

A dev server on port 3210 only, `/specimens` only, no sign-in, stopped when you finish.

## Done

The seams wired, the demo scripts green except the reserved parts of beat 5, the checks of brief 016 with `npm run build`, and `docs/briefs/030-report.md`: each seam with its commit, the table of beats, what a live call and a signed-in browser would still need to show, and the rulings taken.
