# Brief 043: review of corrections and life changes, and its fixes (lane `fix8`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the code brief 025 built: corrections and life changes on the turn (waves C and D) and the rule that a model's polarity alone never removes an allergy rule (W-187). It confirmed eight findings by running them and found four more by reading. They are below as it gave them. Three are high: the model's choice of subject alone can record the owner's mother as dead, a typed life change gets no reply at all, and the W-187 guard still removes a pending allergy rule on a wrong denial.

Where a finding and a ruling of brief 025 disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**1. High, confirmed by a run. The model's subject alone decides who died.**
- Files: `packages/core/src/writes/subject.ts` `resolveSubject`, rows SU4 and SU5, called from `validate.ts` `transitionVerdict`. SU4 accepts any `entityId` that is in `entities`, without checking the span's words. SU5 resolves any verified mention span, even one cut out of a longer noun phrase.
- Sequence: a stored `person.relation` of self with mom. The turn "My friend's mom passed away last night.", with either (a) `subject.entityId` = mom, or (b) a mention span over just "mom". Result in both: `person.life deceased active` is written for the owner's mom, the entry is `transition applied`, and the Head moves every line about her to `know`.
- Ruling: the owner's words choose the subject of a life change, never the model's ID. The subject's words must be the whole noun phrase in the span. A possessive owner before the relation word or name ("my friend's mom", "Sam's dad") means the stored entity is not the subject, unless the whole chain resolves to it by code. Anything code cannot settle is deferred: no write on the turn, a care reply only, and extraction does not get to write a death on a model's ID either.

**2. High, confirmed by a run. A typed life change with no call open gets no reply at all.**
- Files: `packages/server/src/onturn/route.ts` `planTypedReply`; `packages/server/src/routes/turn.ts` near lines 216 to 219 and 320 to 323. `planTypedReply` calls `executeHardRule` without `memory`, so its `planKey` never matches the committed one whenever `planMemoryRoutes` returned an entry, and `typedLineNote([])` returns null.
- Sequence, typed with no call: "My dad passed away last night." with a valid death item: the death is written, `notes: []`, status `ready`; one `responses.create` call was made and its reply dropped. "I might leave my job" (a care-only item): also `notes: []`. The same death text with an empty item list gets "I'm so sorry." A deferred correction gets nothing; a committed one gets only "Corrected." (W-199).
- Ruling: a typed turn with no call always gets exactly one line from Franki. For a life change it is the care line; for a correction, the closed line; for a deferral, the ordinary reply.

**3. High, confirmed by a run. The W-187 guard still removes a pending allergy rule on a wrong `denied`.**
- File: `packages/core/src/writes/denial-words.ts`, used by `hard-rule.ts` `mayRemove`.
- Each line below answers the asked pending self-peanut rule, with the model saying `denied`, and each removes the rule (`pendingResolved`): "No, I'm allergic to it, and to shrimp too." (span "No, I'm allergic to it"); "No joke, I'd end up in the ER."; "No, it's way worse than a dislike. I swell up."
- Why: `^(no|…)\b` matches any answer that merely starts with "no"; `affirmsAllergen` drops a cue whose sentence names another allergen, even when the cue's object is "it"; affirmations without cue words are not seen at all.
- Ruling: a denial removes a pending rule only when the owner's whole answer is one of a closed list of denial forms, as a whole utterance, the way `isPlainYes` reads a yes: "No.", "Nope.", "No, I'm not.", "No, I'm not allergic.", "I'm not allergic to <the asked allergen>." and their near forms, with nothing else in the answer. Any other answer keeps the rule and asks again. A cue whose clause holds "it", "that" or "them", or names the asked allergen, always affirms, whatever else the sentence names.

**4. Medium, confirmed by a run. A rename follows the model's direction, not the owner's words.**
- File: `validate.ts` `correctionVerdict`, row R1. Stored sister name Mara. The turn "No, that's wrong, her name is Mara, not Maya." with the model's rename `replacementValue "Maya"`. Result: Mara becomes `wrong`, Maya active, and the note "The name the owner just corrected is saved" is sent. The code checks only that "Maya" is in the span and "Mara" in the turn.
- Fix: refuse (defer) a rename whose new name is negated in the span ("not X", "isn't X"), or whose old name is the asserted one ("name is X").

**5. Medium, confirmed by a run. A null replacement retracts a real relation on the model's say-so.** The turn "That's wrong, I meant my sister Maya is coming Saturday." with `correction person.relation`, `replacementValue null`. Result: the sister relation becomes `wrong` and "no longer used" is sent. Row C6 needs only the value word ("sister") in the turn.
- Fix: retract only when the span holds a negation tied to the target's value or name ("don't have a sister", "isn't my sister"). Otherwise defer.

**6. Medium, confirmed by a run. `isSelf` plus any "I" in the span records the owner ill.** The turn "I just found out my brother was diagnosed with cancer." with `transition illness`, `subject isSelf`. Result: self `person.life ill` and self `care open`, both active.
- Fix: for a transition, `isSelf` needs the first person to be the subject of the change by a closed list of forms ("I was diagnosed", "I have", "I'm sick"), and defers when the span also names a relation word or a known name.

**7. Medium, confirmed by a run. A delayed correction that meets a later row leaves the refuted value as history (ruling W-194).**
- File: `packages/server/src/worker/extract.ts` lines 447 to 455. Sequence: "My name is Alec." is extracted. "No, my name is Alex, not Alec." is said and its job delayed. "These days my name is Al." is said and extracted. The correction's job runs. Result: Al active, Alec history, Alex history. The owner said Alec was wrong, and it now reads as a past true name, because the `continue` skips marking the targets `wrong`.
- `packages/server/src/worker/extract.past-never-demotes.property.test.ts` asserts exactly this outcome for act `correction`, so the property encodes the defect.
- Ruling: W-194 is reversed for corrections. In the `later` branch the earlier-asserted targets are still marked `wrong`; only the later row is spared. Spec §4: a correction marks the old value `wrong`, never history. **Narrow ruling on the committed property:** in `extract.past-never-demotes.property.test.ts`, the expectation for act `correction` alone may be changed to say the refuted value ends `wrong`, in the same commit as the fix, with the seed that shows the old oracle failing against the fix recorded. Nothing else in that file changes.

**8. Medium; the route half confirmed by a run, the extraction half by reading. A transition that writes nothing is recorded `applied`, with every row it read in `refs`, and that blinds extraction.**
- File: `packages/server/src/onturn/memory-route.ts`: the transition entry is pushed `applied` even when `puts.length === 0`, and deferred entries also carry refs. Sequence: one role at Acme, then "I left my job yesterday and I start at Brill on Monday." with counterpart "Brill". Result: the role stays active and the entry is `{outcome:"applied", keys:[], refs:[the Acme role]}`. `pickOpen` (`handledRefs`) and `closable` in `core/extract.ts` then refuse that role as a target, so extraction cannot end it either, and the job change is lost. The same holds for a breakup or reunion with no matching row, and for every deferral after validation.
- Fix: with no puts, the entry is `deferred` with no refs. A deferred entry never carries refs: a deferral is extraction's to apply.

**9. Medium, by reading. On the fastO path a death leaves the stale Head for the rest of the session.** `execute.ts` `headMoves` (G1): the bundle is not recompiled, so later turns in the same call still have "dad is ill" and the care-open lines in `people`.
- Fix: mark the bundle dirty without raising the Deck, so the next turn recompiles.

**10. Low to medium, by reading. The rename index merges on a name.** `core/extract.ts` `resolveMention`: `mentionName(r.to.name) === name` returns the renamed entity for any mention of the new name, of any type. A later "my coworker Mara" becomes the sister. **This one belongs to the lane building brief 041, part 2, which is rewriting how a name resolves. Do not fix it here; leave `resolveMention` alone.**

**11. Low, by reading. More than three entries on one turn are cut silently.** `HANDLED_ENTRIES_MAX = 3` takes `slice(0,3)` over the hard rule plus any number of correction and transition entries, so a turn with three corrections and a death drops the death's entry and extraction applies it a second time.
- Ruling: nothing is applied on the turn without its entry. Entries are kept in the order hard rule, life changes, corrections; an item past the cap is not applied on the turn and is left whole to extraction.

**12. Low, by reading, no change.** "No, her name is Mara, not Maya, and she's allergic to peanuts.": the hard-rule route starts at arrival with no targets, so the correction is extraction's and this turn's reply still says Maya (W-190). Write it down as a known limit.

**What the properties miss.** `polarity-never-removes` uses ten fixed lines whose span is the whole text and whose labels mirror the closed lists. `transition-orders` starts from a verdict whose subject is already chosen. `head-deceased` restates the code and cannot see a death written for the wrong person. `head-renames` checks rendering only. `turn.correction-ack` and `turn.successor-lineage` always open a call and generate only a careful model's items. `extract.no-double-apply` never checks that a deferred or no-op entry still lets extraction apply the change. `extract.past-never-demotes` asserts the wrong outcome for a correction. `extract.error-stays-wrong` never puts a later row between a correction and its job.

## New properties

In new files beside the existing ones, red first, 1,000 runs, the seed and counterexample recorded:

1. **A typed turn is always answered.** For any typed turn with no call, whatever FastSlots returns, the response carries exactly one Franki line.
2. **Only the owner's words choose who it happened to.** For any life-change item whose span names someone other than a stored entity E (by a possessive or by another name), and any subject the model gives, no row of E changes.
3. **An affirmed allergy is never denied away.** For any pending rule and any answer that is not, as a whole, one of the closed denial forms, a `denied` item never removes the rule; and an answer holding an affirming cue never removes it whatever its first word.
4. **A rename goes the way the owner said.** For any correction whose span asserts "X is the name" or "not Y", the active name afterwards is never Y.
5. **What the route did not do, extraction still can.** For any route entry that wrote nothing, the same turn's extraction can still close every row the owner's words target.
6. **Wrong stays wrong in any order.** For any order of route commits and extraction jobs, a value the owner called wrong ends `wrong`, never `history` or `active`.
7. **No stale Head after a death.** For any session in which a death commits on the fast path, no later turn's Head in that session places the deceased in `people` or `apply`.

## How to work

For each finding 1 to 9 and 11: the failing test first (the reviewer's sequence), then the smallest fix, one finding per commit. Order: 1, 3, 2, then 6, 4, 5, 7, 8, 9, 11. Every fix that reads the owner's words uses a closed list as a named constant with its own unit tests, and fails closed to a deferral.

Another lane (brief 041) is working in the same folders right now: part 1 added the pasted line's pending filter to the hard-rule route, part 2 is changing `resolveMention` in `packages/core/src/extract.ts`, and part 3 is in `moments/**` and `time/**`. Keep each change to the function the finding names. Do not touch `resolveMention`. Merge `build/plan-stages` before the final checks and say what you resolved.

A third lane (brief 042) is adding ledger rows for the hard-rule route's decisions inside `packages/server/src/onturn/**`, one line where each decision is made. Leave those lines as you find them.

## Hot files this lane may edit

`packages/core/src/writes/**` (`subject.ts`, `validate.ts`, `denial-words.ts`, `hard-rule.ts`, and new files), `packages/server/src/onturn/**`, `packages/server/src/worker/extract.ts` (the `later` branch only), the typed-reply plan in `packages/server/src/routes/turn.ts` (a few lines), and the one expectation in `extract.past-never-demotes.property.test.ts` that finding 7 names. No other committed property file.

## Done

The fixes with their red-first tests, the seven properties green, the checks of brief 016 with `npm run build`, and a section "Outcome" at the end of this file: per finding, the test, the commit and the ruling it changed (as numbered questions W-210 on, at the end of the list in `docs/briefs/025-report.md`); per property, the seed and counterexample; every existing assertion changed and why; what is not verified.
