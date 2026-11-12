# Brief 032: review of the hard-rule route, and its fixes (lane `writes`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This stage follows brief 018 in the same lane, after tasks B9 to B12.

An independent review read wave B's hard-rule route (brief 018, commits `03fe2f6...9ca44ee`). It confirmed the first two findings by running a throwaway test against the repo's fixtures, and the rest by reading. Its findings are below as it gave them. Three of them fail open: an allergy the owner clearly stated is lost, or a rule for one person is cleared by a statement about another. The product's rule is that allergies fail closed, in every food path, for every attendee. This brief fixes them.

Two of the three follow rulings the design note took on purpose (design 2.5 for H2, CQ 132 and 144 for H3), and H1 leans on ruling W-175 of brief 018. Where a finding and an earlier ruling disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**H1, high, confirmed by a run. One wrong polarity from the model loses a clearly stated allergy everywhere.**
- Files: `packages/core/src/writes/validate.ts` line 117 (row A5 checks only that some negation word is in the span); `hard-rule.ts`, the deny branch (`carried.add`, `denied = true`); `packages/server/src/onturn/execute.ts` line 174 (denial codes become `handled.ruleKeys` with `subjectId: null`); `packages/core/src/extract.ts`, the `handled` skip in `planItem` (`h.subjectId === null` matches any subject).
- Input: the owner types "I can't eat peanuts, I'm allergic." FastSlots returns item "peanuts" for self, polarity `denied`. The "n't" passes A5.
- Wrong result: a ledger-only denial with no rule. Coverage skips peanut because it is carried, and the fallback is skipped because `denied` is set. Extraction then skips the self-peanut item as `handled`, so the backstop proposes nothing. No filter exists anywhere. "I'm allergic to peanuts, not shellfish" with peanut marked denied fails the same way.
- Fix: a denial that lands on an absent slot carries nothing, so coverage still files the code. Extraction's skip matches the subject exactly (this reverses W-175). A denial's codes never cover an affirmed item.

**H2, high, confirmed by a run. Coverage stops at the cue sentence.**
- File: `not-allergy.ts` line 71 (`cueSentenceRanges` returns only the cue sentences).
- Input: "I'm allergic to peanuts. Shellfish too." FastSlots returns peanut only.
- Wrong result: self peanut becomes active, and shellfish gets no slot. The fallback does not run because something was done.
- Fix: on a triggered turn, coverage scans the cue sentence and the sentences that follow it in the owner's text for aliases. It over-filters at worst.

**H3, high, confirmed by reading. A named person's rule clears the anonymous one.**
- File: `hard-rule.ts`, the affirm branch, `supersede(slotIndex(null, code))`.
- Input: turn 1, "One of the guests is allergic to peanuts" (an anonymous pending peanut rule). Turn 2, "My brother's allergic to peanuts."
- Wrong result: the anonymous rule is removed. The Head then says only "Your brother: peanuts", so a dinner without the brother can include peanuts for the guest.
- Fix: supersede an anonymous rule only when it is the asked rule and this turn answers it.

**M1, medium. An allergen outside the gazetteer passes as not-an-allergy.**
- File: `hard-rule.ts`, the G3 check (`modelSays && notAllergyByCode`).
- Input: "I'm allergic to cilantro." FastSlots answers validly with no items and `need: none`.
- Wrong result: no alias and no generic word near the cue, so the outcome is `notAllergy`: no rule and no unresolved filter. The code half of G3 cannot tell "allergic to cilantro" from "allergic to Mondays".
- Fix: the code half requires the cue's object to be a word in a closed non-food list. Otherwise the unresolved fallback runs and Franki asks.

**M2, medium. "Someone else" merges subjects.**
- File: `rules-section.ts`, `subjectName` and the grouping.
- Input: two non-self subjects with no stored label: the brother with peanuts and a guest with shellfish.
- Wrong result: one line, "- Someone else: peanuts, shellfish." A reader cannot tie a rule to an attendee.
- Fix: never group unlabeled subjects together; each gets its own fail-closed line.

**M3, medium. Supersede and failed transcripts never open the route.** This is task B9, built before this brief starts. Check it against the finding: a corrected final transcript that states an allergy must open the route.

**L1, low.** The persona line "An allergy listed under Hard rules is saved; you may say so" also covers pending lines, which sit under that heading, so Franki may call an unconfirmed rule saved. Fix: the line excludes entries that start with `PENDING_PREFIX`.

**L2, low.** `open.ts` compiles the Head with no audience, so it is always private (W-170). Brief 026 builds the audience compile; nothing to do here beyond noting it.

**W-166, weak.** The `handled` ring is the only record of the route's decisions and is bounded to 16 entries. A side effect needs an audit entry. Brief 030 wires the ledger; write down here exactly which decisions need a row.

**Properties that assert too little.** Property 4 is satisfied when a code is merely recorded as a denial (so H1 passes), and it ignores the subject (so H3 passes). Property 3 checks the subject only for `self`. Property 9's "ask" check passes on any pending rule, not the one asked about. These are committed files and are not edited. Add new property files beside them:
- **Stated means filtered:** for any owner sentence that affirms an allergy to a gazetteer item, and any FastSlots answer at all (wrong polarity, missing items, empty, invalid, late), after the turn that item is filtered for that subject: an active rule, a pending rule or the unresolved filter. Never nothing.
- **Another person's words never clear a rule:** for any stored rules and any turn about subject X, every rule whose subject is not X, including an anonymous one, is still there afterwards unless it was the asked rule and this turn answered it.
- **Every alias in the owner's text has a slot:** on a triggered turn, each gazetteer alias in the cue sentence or after it ends the turn with a slot or under the unresolved filter.
- **Each subject is its own line:** for any rules, the Head's rules section never puts two subjects on one line, for every audience.

## How to work

For each of H1, H2, H3, M1, M2 and L1: the failing test first (the reviewer's inputs above as unit cases, and the new properties red with their seeds recorded), then the smallest fix, one finding per commit. Then check M3 against B9. Where a fix changes a design ruling, add a numbered contract question at the end of the list in `docs/briefs/012-design.md` (that design note is this lane's own working note, so it may be added to), saying which earlier question it amends and why.

## Hot files this lane may edit

As brief 018: `packages/core/src/writes/**`, `packages/core/src/extract.ts`, `head.ts`, `packages/server/src/onturn/**`, `worker/extract.ts`, and `routes/turn.ts` only if a fix needs it.

## Done

The six fixes with red-first tests, the four new properties green, the checks of brief 016, and a section "Outcome" at the end of this file: per finding, the test, the commit, and the ruling it changed.

## Outcome

Built by Claude on lane `writes`. Kiro wrote none of it. The lane merged `build/plan-stages` at `849542f` with no conflict. The merge left a second `COPY` import in `App.tsx`, removed in `0969af1` to match the integration branch. Green start: 385 files, 3,692 passed.

Unit cases for every finding are in `packages/core/src/writes/hard-rule.review.test.ts`, one block per finding, plus the server cases named below. Each case was run against the code without its fix and failed, then passed with it, except where the table says otherwise.

| Finding | Commit | Failed first | Ruling it changes |
|---|---|---|---|
| H1 | `36fb307` | 4 core cases (the reviewer's two inputs, an unknown item "that", an uncertain speaker); 2 of 3 in `worker/extract.review.test.ts`; 1 in `routes/turn.review-hard-rules.test.ts` | W-175 reversed (extraction's skip matches the subject exactly); W-166 (a denial's codes are no longer `handled` keys); row A6 and CQ 148 (an uncertain speaker's denial carries a code only where an anonymous rule for it exists). W-181. |
| H1, follow-up | `01dc3e5` | 2 core cases | A denial reaches only a rule stored before the turn (found by property 3). W-181. |
| H2 | `dcea7e2` | 1 core case ("I'm allergic to peanuts. Shellfish too."); properties 1 and 3 | CQ 157 for coverage (not for the code half of G3); design 2.5's cue sentences. W-182. |
| H3 | `80cb7c5` | 2 of 3 core cases (answering the asked rule passed before and after); property 2 | CQ 132 and CQ 144: an anonymous rule leaves only when it is the asked rule and this turn answers it. W-183. |
| M1 | `98f0875` | 2 core cases | G3's code half (design 2.5, CQ 98, CQ 157): the cue's object must be in `NOT_ALLERGEN_OBJECTS`. W-184. |
| M2 | `062762f` | 2 core cases; property 4 | Design 2.8's grouping and W-173: one line per subject, each anonymous rule its own line. W-185. |
| L1 | `01b659a` | 1 core case | G29's persona line. W-186. |

`cb491ba` fixes a type error in the H3 cases: vitest passed, typecheck didn't.

**The reviewer's M1 input.** "I'm allergic to cilantro." never reached the G3 check, because cilantro is in the gazetteer (code `coriander`) and coverage already filed it. The cases use "durian" and "jackfruit", which are off the table.

### Properties, red first (1,000 runs each)

| Property | File | Seed and path | Counterexample |
|---|---|---|---|
| Stated means filtered | `core/src/writes/stated-means-filtered.property.test.ts` | H2: `-1573682996`, `6:1:1:1`. H1, run with the H2 shape left out: `-908657263`, `114:1:3:4:4:4:1:1` | "I'm allergic to sesame. Shellfish too." with an empty answer left shellfish unfiltered. "I can't eat shellfish, I'm allergic." marked denied, with an uncertain speaker, left shellfish unfiltered. |
| Another person's words never clear a rule | `core/src/writes/others-words-never-clear.property.test.ts` | `1356233431`, `111:3:2:2:3:3:2` | The owner's own "I'm allergic to peanuts.", with nothing asked, removed an anonymous pending peanut rule. |
| Every alias in the owner's text has a slot | `core/src/writes/every-alias-has-slot.property.test.ts` | `824500117`, `1:0:0:0:3:3:3:3:3:3:3:3:3:3`; after H2, `1996656851`, `415:1:1:1:1:2:3:6:6:6:6:7` | "I'm allergic to shellfish. Can you order tree nuts for Friday?" with no items left tree_nut with no slot. After H2: "…I'm allergic to eggs. I'm not allergic to eggs." with need `subject`: the denial resolved the pending rule its own turn wrote (fixed in `01dc3e5`). |
| Each subject is its own line | `core/src/writes/each-subject-own-line.property.test.ts` | `-1265853170`, `0:1:1:1:1:2:3:2:2:2:2:2:2:3:3:3` | The owner's pending milk rule and an anonymous pending eggs rule, for the audience "unknown", shared the line "for someone: milk, eggs." |

The generators are in `core/src/writes/testing/arb-review.ts`. Each property body is pure (validate and plan, or render), and all four run in under a second together.

What the properties don't cover: property 1 never gives the model a wrong subject (an "I" item for "My brother…"). It covers wrong polarity, act, span, item and need, dropped items, an empty answer and no answer. Prior rules in properties 1 and 3 never name the turn's own codes (see W-187).

### Existing assertions changed on purpose

- `writes/hard-rule.test.ts`, "a certain denial resolves…": the guest's (uncertain) "I'm not allergic to peanuts." with a pending self peanut rule now adds an anonymous pending peanut rule and asks who has it, instead of a ledger-only denial (H1).
- `writes/hard-rule.test.ts`, the four jokes ("I'm allergic to Mondays. Can you order eggs for breakfast?" and three more): their plan was `notAllergy` with no rule. It is now `pendingWritten` with anonymous pending rules only. Their `notAllergyByCode` assertions are unchanged (H2).
- `writes/hard-rule.test.ts`, "a newly active rule resolves…": the unasked anonymous peanut rule now stays beside the owner's active rule, and the title says so (H3).
- `writes/notes.test.ts`, "outside a private audience…": the line "for someone: any food, peanuts." is now two lines (M2).

No committed `*.property.test.ts` was edited.

### M3 against B9

B9 (`0c64049`) covers it, so no change was needed. A Superseding_Post (the corrected final transcript of a turn whose transcript was missing) runs `lateSlots` and then `executeHardRule` in its own transaction when the line has an RX4 cue or a committed parse with a hardRule candidate (`onturn/late.ts`, `lateOpens`). A Parse_Repair (a failed parse) runs the route once after its lease and writes a `repair` proposal. Both are covered by `routes/supersede.test.ts` ("an allergy line writes the rule…", "a failed FastSlots answer still fails closed…") and the four B9 cases in `intents/repair.test.ts`, all green after these fixes. Still open from W-177: a late route never answers the open question.

### W-166: the decisions that need a ledger row

The wiring lane (brief 030) should write one decision row for each of these, in the same transaction as the `core/rules` write. Each row cites the turn's Evidence, the rule IDs, the codes and `rulesRev` after. Today only the last two come out of `planHardRule` as `ledger` entries. The rest are read from the plan's outcome and from the difference between the rules before and after.

1. `ruleWritten`: each new active rule, with its subject, code and proof span.
2. `pendingWritten`: each new pending rule, with where it came from: a verdict, coverage, the unresolved fallback, or the bound's stand-in.
3. `pendingResolved` by a rule: each pending rule a new active rule superseded (now only the asked anonymous rule and the subject's own `unresolved` rule), naming the rule that answered it.
4. `pendingResolved` by a denial: each pending rule a certain denial removed, including row A9's answer to the asked rule.
5. `ruleKept`, why `denied`: a certain denial against an active rule, refused.
6. `noneConfirmed` changed: a subject added by a global denial, or a subject removed or the list cleared by a new pending rule (2.6).
7. Proposals: the backstop's proposal written by the extraction worker, a repair's proposal, and `applyProposals` installing either on a later turn or `open`. The row at install time cites the proposal's Evidence.
8. `denialRecorded`: each denial with the codes validation verified, including an uncertain speaker's and one that reached no rule. This is a decision only; nothing changes.
9. `notAllergy`: both halves of G3 passed and nothing was written.

No row is needed for `ruleKept` (duplicate or weaker) or `pendingKept`, since nothing changed. Subject labels change the Head's words but no rule, so a row for them is optional.

### Rulings needed

- W-181 to W-186 in `012-design.md`, each failing closed, for the owner to confirm. What they cost: a true denial of an allergen nobody has ("I'm not allergic to peanuts." with no rule) is filed as an anonymous pending rule, and Franki asks who has it. A joke with a food word in a later sentence is filed the same way. "I'm allergic." alone and "I had an allergic reaction." now get the all-food filter and the question.
- W-187, a residual the brief doesn't name: a wrong polarity against a rule already pending for the same subject still resolves it.

### Not tested

No live call, no browser and no paid model call. Whether the model follows L1's wording is unmeasured. The extraction side of H1 was tested on the fake OpenAI port only.
