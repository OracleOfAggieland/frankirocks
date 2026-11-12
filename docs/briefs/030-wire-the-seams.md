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
5. **The ledger** (024): the turn, tool and receipt routes write said, held, steered, declined and blocked rows as IDs and reason codes, and the Lab's counts read them, so the five Lab counts brief 020 left uncounted become real.
6. **Food and the answer in a call** (022, 017): the tool list the voice machine sends includes `suggest` and `answer`, behind the same Permit rules as `recall`. The golden corpus is re-recorded in that commit, with the count of calls moved and the reason.
7. **The screen** (020, 027): rule motes in the jar from the rules document; the strip's money figure from the loop; the proactive line or card shown when `advance` or `open` returns one; the false-"gone" check on spoken transcripts through the receipt route.
8. **Findings of brief 029:** each place where two merged pieces did not fit.

## What stays out

- **Forget.** No route calls the forget code, and admission rule 11 stays as it is. Closure, resume, "Gone" and the No Resurrection property are reserved for a later run (brief 021). The parts of beat 5 that need a completed forget stay expected-fail.
- Tuning anything against a live model or a live call.
- Corrections and life changes (brief 025's).

## How to work

One seam per commit. For each: the test first (a route test, or the demo script that waits for it, which loses its `it.fails` in that commit), then the call. Keep each call small: the logic lives in the lane's module, and the route gains a few lines. If a seam needs the piece itself to change, change it in its own module, with its tests.

Properties from other lanes must stay green and untouched: the rule is in every Head, nothing ineligible is shown, subtract only, a jump equals waiting, zero hard-rule misses, at-most-once admission, the serialization of `/api/turn`.

## Hot files this lane may edit

All of them, for this stage, except `packages/core/src/eligible.ts` (call it) and `packages/core/src/forget/**` and `packages/server/src/forget/**` (leave them).

## Looking at it

A dev server on port 3210 only, `/specimens` only, no sign-in, stopped when you finish.

## Done

The seams wired, the demo scripts green except the reserved parts of beat 5, the checks of brief 016 with `npm run build`, and `docs/briefs/030-report.md`: each seam with its commit, the table of beats, what a live call and a signed-in browser would still need to show, and the rulings taken.
