# Review of the live harness run, Nov 10

The 24 wave A fixes and the test fix in `96152ad` are accepted. The reviewer reran the checks after them: lint, typecheck, build and `npm run test:emulator` (4 files, 42 tests) pass; `npm test` failed 2 runs in 5 on the one test `96152ad` then fixed.

The reviewer ran the harness live on the owner's 60 takes: parallel, stagger 0, uncapped, effort `minimal`, seed 7, `--judge judge_v2`, with the slow parse live. The run files are `scripts/judge-spike/results/2026-11-10T06-32-11-722Z-owner.json` and `.md`, uncommitted in the working tree.

## What the run showed

**The judge.** `judge_v2` held every control line at any time: 30 of 30, against 28 of 30 for `judge_v1` in run (c) on the same takes and seed. Company went from 1 of 5 to 5 of 5 and correction from 4 of 5 to 5 of 5. False holds went from 1 of 30 to 2 of 30: "What do you remember about me?" in both, and now "I'm allergic to Mondays.", which `judge_v1` also held in run (b). Judge time from send was p50 754 ms and p95 972 ms, against 718 and 1,103.

**The slow parse.** This is its first measurement.

- **Time.** p50 460 ms, p95 743 ms, largest 1,304 ms. 49 of 60 parses missed the 350 ms deadline.
- **Invalid answers.** 5 of 60 parses failed as `invalid` (`c-hardrule-2`, `o-30`, `c-correction-4`, `c-crisis-4`, `o-10`). The run file doesn't say which check failed.
- **Control lines.** Every control line was caught by the parse as not ordinary, 30 of 30, and no line was missed by both nets. But the class is often wrong: "Hang on, Alex just walked in." scored `company` 0.03 and `rushed` 0.97, and "We broke up this morning and I'm a mess." chose `alone` at 0.75.
- **Ordinary lines.** 17 of 30 came back as not ordinary. `alone` was 0.20 or more on 11 of them ("It's so windy out today." 0.41). `company` was 0.20 or more on 4 ("Hey Franki, how's it going?" 0.92). `forget` was 0.21 on "I deleted an old game off my phone, it was eating my evenings."

**Latency.** From the last loud frame to audible time, p50 was 1,553 ms over 28 lines, against 1,317 ms in run (c). The reply's first audio was slower this time (p50 937 ms from send, against about 800). One run is over the 1.5 s stop line and one is under it.

**A caveat on the "within 1,200 ms" control numbers.** Only 9 of the 30 control takes have their tails trimmed, and 14 came in as more than one fragment, so on 25 control lines the judge was sent 100 to 1,224 ms after the commit. Those rows count the harness's own wait as judge time. Read control recall from the "any time" column, and judge speed from "judge sent to judge done".

## What follows

Wave B does not start. With these numbers it would hang up and say "Got it. I'll keep things general for now." on "Hey Franki, how's it going?", and say "Okay, just us again." on a third of ordinary lines. The predicate wording for `company` and `alone` and the route thresholds need a measured answer first, and that is a decision for the owner.

Do the items below on `build/voice-control`, one commit each with the trailer line `Built-with: Kiro`, a failing test first where there is code, edits and commits in separate calls, the telemetry variables set, **no network call and nothing with `--live`**. If a guarded property file would need an edit, stop and report.

### 1. Keep the run's record

Commit the two result files as they are.

### 2. `judge_v2` becomes the app's judge

`APP_JUDGE_SETTINGS.contract` is `judge_v2`. `judge_v1` stays in core as the contract's literal. Record the numbers above in question 52 and mark the judge half of it answered. Note there that it rests on one run, and that the false holds went from 1 to 2.

### 3. The Decisions deadline is 1,000 ms on a call

350 ms can't stand: 49 of 60 parses missed it. 1,000 ms covers 59 of 60. Typed lines with no call keep 2,000 ms. Update the emulator timing test to a fake answer at 1,000 ms, and say in the report what that does to the slow path's worst case against the 2.5 s line. Add a contract question: contracts §5's 350 ms for `TurnIntents` was assumed, and the measured p95 is 743 ms.

### 4. Say why a parse was invalid, and repair it

- `parseDecision` returns which check failed (wrong count, wrong type at an index, name mismatch at an index, refusal, probability out of range) and the question's name. Never the words. The slow parse logs it, the Turn's failure reason carries it if a field exists, and the Harness row and summary show it.
- An `invalid` parse is repaired like a deadline or transport failure: one retry by the Parse_Repair. Today it stores `unknown` for the rest of the Session with no repair, and at 5 in 60 that would turn `fastO` off within a dozen turns of most calls.
- `oversize` stays unrepaired.

### 5. A route that changes what is said needs both nets, or one very sure net

A class at 0.20 is a candidate, as contracts §5 says. That is right for the cheap protections: no S1+ note on the turn, and the decision on the record. It is too low, on these numbers, for a route that cuts a reply, speaks a Fixed_Line or (in wave B) hangs up.

- Such a route fires when the judge's value is not `O` and the class is at 0.20 or more, or when the class alone is at 0.80 or more (`STRONG_P`).
- **Crisis is exempt.** A retained crisis candidate at 0.20 or more takes the reply whatever the judge said.
- In wave A this changes `forget` only: with `judge:"O"` and `forget` under 0.80, the playing reply isn't cut and no Fixed_Line is spoken. A typed line counts as its own judge (`typed`), so it fires at 0.20 as today.
- The same rule will govern company, quiet and alone in wave B. Build it as one pure function in `packages/core/src/intents/` that the Server_Rule calls, with the class, its probability and the judge value as inputs, so wave B adds rows and no new mechanism.
- The server needs the judge's value for this. A turn posted before its verdict says `timeout` (question 56), which is "not `O`". Say in the design what that means here and whether it is safe: a `fastO` reply already playing means the verdict was `O`, and the server learns that from the `admitted` receipt.
- Add a contract question with the numbers above.

### 6. The Harness reports what the routes would do

- Per class, the count of ordinary lines at 0.20 or more and at 0.80 or more.
- "Would cut or swap" counts for ordinary lines and control lines under item 5's rule, per class.
- The invalid reasons from item 4.
- A `--predicates <name>` option that selects a named set of predicate instructions for the Decisions call, with `contract` (contracts §5's literals) as the only set today. A candidate set gets added and measured the way `judge_v2` was.
- In the summary's caveats, the trimmed-tail note above, computed from the rows.

### 7. Report

Add a "Live run, Nov 10" section to `docs/briefs/011-report.md`: the numbers above, items 1 to 6 with their commits, and the two things still open for the owner: the wording of the `company` and `alone` predicates, and whether the 1.5 s latency stop line holds.

## Checks before you stop

`npm test` three times in a row, `npm run lint`, `npm run typecheck` and `npm run build` exit 0. Stop there with a clean tree. Do not start wave B.
