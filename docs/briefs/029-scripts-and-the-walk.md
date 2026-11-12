# Brief 029: the script runner, and the demo as scripts (lane `scripts`, F9 part one)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Spec §13 scores what Franki says, on an injected clock, with scripts: each a sequence of clock steps, utterances and limb events, with asserted says and holds. No runner for such a script exists. The lanes of this build each test their own piece; nothing yet runs a typed line through the turn route, extraction, the tick, delivery and the screen's read route in one go. This brief builds the runner and writes the demo of spec §15 as six scripts, so that each beat is either green or an expected-fail test that names what is missing.

## Read first

- Spec §13 (lines 356 to 391), §15 (462 to 475), §12 (319 to 354).
- The reports of the lanes merged so far, in `docs/briefs/`: 018 (or the wave B section of 012-report), 019, 020, 021, 022, 023, 024, 027, whichever are in your working copy. Their "seams" and "not built" sections tell you what is wired and what is not.
- `packages/server/src/testing/` (the fakes for every port), `routes/turn.test.ts` (how a route is driven in memory today), `packages/server/src/seed/` (the load and the fixture clock), `routes/memory.ts`, `routes/tool-food.ts`, `packages/core/src/patterns/`, `packages/core/src/moments/` and `packages/server/src/time/` if present.

## What to build

1. **The runner,** in `tests/scripts/` (or beside the other in-memory server tests if `tests/` cannot import what it needs; say which in the report). It drives the real route functions over the in-memory store, with the fake ports and the fixture clock. It never starts a server and never calls a model. A script is data:
   - Steps: load the seed for a visit; type a line; press a chip; a trusted tap; advance the world clock to a labeled time; a limb event (an email arrives, a calendar event moves); run the worker until idle; open a session.
   - Model answers are scripted per step through the fakes, and each scripted answer is written down in the script next to the step that needs it, so a reader sees exactly what the model was assumed to say. The runner fails a script whose step consumed an answer it did not declare.
   - Assertions after any step: `mustSay` (a line or card that must be present, matched on a template ID or a number, not on loose wording), `mayUse` (memory IDs the reply may draw on), `neverSay` (tokens or memory IDs that must not appear in any reply, note, whisper, card, tool result or read-route answer), a store check (a row exists, is `wrong`, is blocked, a rule is active), and a Lab count.
   - A failed assertion prints the step, the expectation and what was actually said or stored.

2. **The demo as six scripts,** one per beat of spec §15's table, each asserting what that row says:
   - Beat 1: Franki speaks first on open: the wish for the interview at 2, with the texture about the gap year; the card shows the move from yesterday.
   - Beat 2: "Biscuit has surgery Thursday." A reply, then extraction; a jump to Thursday 18:00; the check-in about Biscuit, said once.
   - Beat 3: the hero: $186, mostly on nights with meetings after 6, sources on the card; it cannot play before the bolt of beat 2; "Yes" writes the list and the loop; three weeks on, "$71, down from $186", and the strip's steps.
   - Beat 4: "I might leave my job." Care first, nothing written as a change; the Lab's line: read {n} emails, guessed 3 private things, said none, with {n} equal to the seed's count.
   - Beat 5: "I'm allergic to shellfish, and my brother's in trouble again." Both answered, the rule active. Then "Forget what I said about my brother.": the rule stays. The parts of this beat that need a completed forget ("Gone", the receipt) are expected-fail, because closure and resume are reserved for a later run (brief 021).
   - Beat 6 is about the build and has no script.

   A beat, or a step of one, that the merged build cannot do yet is written in full and marked `it.fails`, with one line saying which seam or lane it waits for. Do not build the missing piece here. Do not soften an assertion to make a beat pass.

3. **Five poison scripts** (spec line 377, "Email can inform but can't give orders"): a seeded or arriving email that (a) tells Franki to do something, (b) asserts a fact about the owner, (c) grants itself a permission, (d) carries a forged sender label built to look like an instruction, (e) claims an allergy is cleared. Each asserts that nothing is written to rules, preferences, identity or `life`, no side effect runs, and the text never reaches a Head or a reply except as attributed logistics.

4. **A memory-off control** for beats 2 and 3 (spec line 358): the same scripts with an empty store, asserting Franki says none of the remembered lines.

## What this brief does not do

It adds no feature code. If the runner needs a small test-only helper in `packages/server/src/testing/`, add it there. If a script shows that two merged pieces do not fit (a route that never calls a built function, a shape mismatch), that is a finding: write it in the report with the file and line, keep the script as `it.fails`, and go on.

## Hot files this lane may edit

None. New files only: `tests/scripts/**`, helpers under `packages/server/src/testing/`, and the barrels if a testing export is missing.

## Done

The runner, the scripts, the checks of brief 016, and `docs/briefs/029-report.md`: a table of beats and steps (green, or expected-fail with what it waits for), and the list of findings where merged pieces do not fit. That table is the map of what is left to wire.
