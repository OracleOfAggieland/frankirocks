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
