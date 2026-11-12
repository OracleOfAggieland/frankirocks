# Brief 042: what part A left unwired (lane `wire`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This follows part A of `docs/briefs/030-wire-the-seams.md` in the same lane and worktree; its report section "Phase two, part A" in `docs/briefs/030-report.md` lists what was left and three findings. This brief is that list, in the order to build it.

Another lane (brief 041, part 3) is adding filters inside `chooseNow`, `admitMoments` and `proactiveOf` for a person recorded deceased. `packages/core/src/moments/**` and `packages/server/src/time/**` are open to you for this brief, but keep each change there small and additive, and change no existing parameter: add an optional field to a result, or a new function beside the old one.

## Build

**1. An offer shown again can be answered (finding 3).** `pendingRendered` is keyed by the pending ID alone, so when the same offer is shown in a later session the row still carries the first showing, brief 037's binding (shown in this session, and the yes is the owner's next turn after it) fails, and a plain yes answers `clarify`. A visitor who sees the hero offer, closes the tab and comes back can then never say yes. Record every showing: the binding must read the latest showing of that offer in this session. Keep the first showing's row as it is for the ledger. Test first: the offer shown in session one, a new session, the offer shown again, "Yes." applies.

**2. An offer that was answered is closed (finding 2).** An offer answered yes or no but never recorded as said stays open and is offered again (`packages/server/src/time/verdict.ts`). An answer closes it, whichever way it went, with the answer as the reason. Test first, both ways.

**3. A reminder held under crisis is never lost without a trace (finding 1).** It is offered again at each opening after crisis clears, and today expires silently 30 days past its due time. Ruling of the lead, for the owner to confirm: when a confirmed reminder passes its due time while held, the next opening not under crisis says it late, by code template, as a missed reminder ("You asked me to remind you about X at 10. I held it."), once, as `mustSay`; if no such opening comes before its close time, it closes with a `held` ledger row that names the reason, so "why didn't you remind me?" has a row to read. Test first.

**4. Delivery's own Gate verdicts get rows.** `chooseNow` gates every candidate and returns only the choice, so a line the Gate held, steered or blocked inside delivery leaves no ledger row, and the Lab's counts miss it. Return the verdicts beside the choice (an optional field on the result), and have the route write one row per verdict that is not `say`, as IDs and reason codes only, at most once per candidate per session. A `card` verdict is recorded with the Gate's own outcome for it (`steered`); this amends the lead's earlier ruling, which said `held`.

**5. `said` rows from what was heard.** `writeSaid` computes its own match now, and no route calls it. The receipt route calls it for a transcript receipt of an admitted response that carried a whisper or a note: a `said` row only when the transcript matches, by the matcher's own rules; no match, no row. This is spec §6, "no ledger row, no claim". Test first: a matching transcript writes one row, a second receipt writes none, a transcript that does not carry the note's tokens writes none.

**6. The hard-rule route's decisions get rows (question W-166).** The "Outcome" section of `docs/briefs/032-review-hard-rules.md` lists the nine decisions that need a ledger row. Write them from `packages/server/src/onturn/**` where each decision is made, as IDs and reason codes, never the owner's words. Another lane (brief 041, parts 1 and 2) is working in that folder: keep to the one place each decision is made, and merge `build/plan-stages` before you start this item.

**7. The beats still waiting on delivery.** Beat 2's check-in: at Thursday 18:00 delivery chooses the hero offer over the check-in, and `checkInLine` does not match the script runner's `checkIn` template. Decide from spec §6 "Delivery" (the priority order is `mustSay`, wish, check-in, ask, insight, celebrate, others) which is wrong, the choice or the script, and fix that one; a script's expected line changes only if the spec's wording says so, and you say why. Beat 1's texture, if it is a matter of the wish's template and not of new behaviour. Each step that turns green loses its wait in that commit.

## Do not build

- The Gate on typed-reply notes and on `inspect`. Part A found no single Memory candidate fits them. Write, in the report, what input the Gate would need for each, as a design note of a few lines; the owner decides.
- A card route for a `card` verdict.
- Anything in `packages/core/src/voice/**`, the golden corpus, `answerTool`, or the `answer` wire shapes (brief 040's lane).
- Forget closure, resume, purge, No Resurrection.

## Properties, new files, red first where the code fails today, 1,000 runs

1. **A shown offer can always be answered once.** For any sequence of sessions, showings, other turns and answers, a plain yes that is the owner's next turn after the latest showing in that session applies exactly once, and any other yes is `clarify`.
2. **Every verdict that is not `say` has exactly one row.** For any candidates, audience and modifiers, the rows written for a delivery choice are one per held, steered or blocked candidate, and none for the chosen one until it is said.
3. **No row, no claim; no match, no row.** For any transcript and any note, a `said` row exists only if the transcript matches the note by the matcher's rules, and never twice for one response.

## Done

The seven items with their tests, the three properties with seeds recorded, the checks of brief 016 with `npm run build` and the repo's check scripts, and a section "Outcome" at the end of this file: each item with its commit, each step turned green, each ruling as a numbered question at the end of the list in `docs/briefs/030-report.md`, the design note on the typed-reply Gate, and what a live call or a signed-in browser must still show. Merge `build/plan-stages` before the final checks and run the full suite after it.
