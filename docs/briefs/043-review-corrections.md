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

## Outcome

Built by Claude on lane `fix8`, with no Kiro run. Rulings and questions W-216 to W-227 are at the end of the list in `docs/briefs/025-report.md` (brief 041 had already used W-200 to W-215).

### Findings

| # | Failing test first (the reviewer's sequence) | Commit | Ruling |
|---|---|---|---|
| 1 | `server/src/routes/turn.review043.test.ts` "finding 1" (a) and (b); `server/src/worker/extract.review043.test.ts` "finding 1, extraction" | `83dc424` | W-217 |
| 3 | `core/src/writes/hard-rule.review043.test.ts` "finding 3" (the three lines keep the rule; whole denials still clear it) | `881d460` | W-216 |
| 2 | `turn.review043.test.ts` "finding 2" (death, care only, death with no items, deferred correction) | `8c27507` | W-218 |
| 6 | `turn.review043.test.ts` and `core/src/writes/validate.review043.test.ts` "finding 6" | `4cefd80` | W-219 |
| 4 | `turn.review043.test.ts` "finding 4" | `0b2a800` | W-220 |
| 5 | `turn.review043.test.ts` "finding 5" | `34d217a` | W-221 |
| 7 | `extract.review043.test.ts` "finding 7" (Al active, Alec wrong, Alex history) | `21f786d` | W-222, W-223 |
| 8 | `turn.review043.test.ts` "finding 8" | `7d4aaee` | W-224 |
| 9 | `turn.review043.test.ts` "finding 9" | `654f5fa` | W-225 |
| 11 | `turn.review043.test.ts` "finding 11" | `ed04423` | W-226 |
| 10 | Not this lane (brief 041 rewrote `resolveMention`). Untouched. | | |
| 12 | Note only. | | W-227 |

One more fix, found while writing property 1: two identical items in one FastSlots answer wrote one record twice and the turn answered 400. `4578e5a` defers the second item (W-224).

Closed lists, each a named constant with its own unit tests: `life-subject.ts`, `self-life.ts`, `denial-words.ts` (`WHOLE_DENIALS`, `DENIAL_LEADS`, `DENIAL_POINTERS`, `CUE_POINTERS`), `rename-words.ts`, `retract-words.ts`, all in `packages/core/src/writes/`. Each fails closed to a deferral, or for finding 3 to keeping the rule.

### New properties (1,000 runs each, red first against the code before the fix)

| Property | File | Seed | Counterexample on the old code |
|---|---|---|---|
| 1 A typed turn is always answered | `server/src/routes/turn.typed-answered.property.test.ts` | 1845013159 | "My dad passed away last night." with the careful "My dad" death item and a transition candidate: no line |
| 2 Only the owner's words choose who | `core/src/writes/life-subject-owner-words.property.test.ts` | 752086671 | "My dad's dog passed away last night." with subject entityId = dad: dad chosen |
| 3 Never denied away | `core/src/writes/denied-away.property.test.ts` | 192324470 | "No. I think so." with a denied item removed the self peanut rule |
| 4 A rename goes the owner's way | `core/src/writes/rename-direction.property.test.ts` | -969811648 | "No, her name is Maya, not Mira." with Maya stored and replacement Mira: renamed to Mira |
| 5 What the route didn't do, extraction can | `server/src/routes/turn.route-left-to-extraction.property.test.ts` | 1058704789 | "I left my job yesterday and I start at Brill on Monday.", counterpart Brill, no call: the applied entry's refs kept extraction from ending the role |
| 6 Wrong stays wrong | `server/src/worker/extract.wrong-stays-wrong.property.test.ts` | 216207467 | A=Alec, B=Sasha, C=Al, jobs t1, t3, t2: Alec left `history` |
| 7 No stale Head after a death | `server/src/routes/turn.no-stale-head.property.test.ts` | 1881251497 | one later typed "Thanks for listening.": "The owner's dad is ill." still in People |

### Existing assertions changed

None. No committed test file was edited. `extract.past-never-demotes.property.test.ts` passes unchanged, so the one allowed edit (finding 7) was not used.

### Outside the hot-file list

- `packages/core/src/extract.ts` `planItem` (finding 1, extraction half): one check after the subject resolves, and a helper `mentionWords`. `resolveMention` is untouched.
- `packages/server/src/routes/turn.ts`: two lines, the `refreshDirtyTurn` call beside the proposals block (finding 9) and its name on the import line. Not the typed-reply plan.
- `packages/core/src/writes/notes.ts`: `TYPED_LINES.care`.

### Merge of `build/plan-stages` (`9cd2a8b`)

Conflicts, both sides kept: `core/extract.ts` `planItem` (brief 041's ambiguous-name hold and `people` roster first, then this brief's owner-words check); `core/writes/index.ts` (both sets of exports); `server/onturn/execute.ts` (imports only); `server/routes/turn.ts` (both imports; the pasted allergy runs first, then the dirty-Head refresh if nothing else changed the rules). After the merge, `testing/review-043.ts` `seed` accepts any predicate so property 7's `fact` row typechecks.

### Checks after the merge

`npx vitest run --maxWorkers=3`: exit 0, 530 files passed, 4,378 tests passed, 24 expected fail (26 before the merge).

`npm run lint`: exit 0 (one existing warning in `avatar/three/brass.ts`). `npm run typecheck`: exit 0. `npm run build`: exit 0.

### Not done, not verified

- W-223: a correction whose job runs before the refuted value was ever saved still leaves that value unmarked. Property 6 leaves that order out. Its file header calls this "W-215", its number before the merge.
- Brief 041's W-208: the on-turn routes still derive a person by name through `mentionEid` in `writes/subject.ts`, so two people with one name are not told apart on the turn. Not taken up here.
- Finding 12 stays a known limit (W-227).
- The typed plan now reads the memory plan outside the transaction; a write landing between that read and the commit makes the keys differ, and the turn then falls back to the closed or care line. Not tested under a race.
- Nothing ran against the emulator, a live model or a real call.

### Follow-up items from the lead (after the merge as `ef1232c`)

| Item | Test first | Commit | Ruling |
|---|---|---|---|
| 1. The span's edges chose whose allergy it was (hard-rule miss; `others-words-never-clear`, seed 190244370, path "658:3:5:5:8:7:7:7:9") | `core/src/writes/hard-rule.reslice.test.ts`, red on `deb3553` | `1a1560c` | W-230 |
| 1b. A model entityId or mention the sentence doesn't name chose the person (SU4) | `core/src/writes/hard-rule.unnamed-entity.test.ts`, red on `1a1560c` | `ba13041` | W-231 |
| 2. Class-T text reached the brain model as a user message | `server/src/routes/turn.pasted-not-owner.test.ts`, red on the old code | `8327737` | W-232 |

New properties, 1,000 runs each, red first:

| Property | File | Seed | Counterexample on the old code |
|---|---|---|---|
| A reslice never chooses whose allergy it is | `core/src/writes/reslice-never-chooses.property.test.ts` | 1879678608 | no rules, nothing asked, isSelf, span "'m allergic to peanuts" in "I'm allergic to peanuts.": no owner peanut rule, where the full span wrote one |
| An unnamed entityId or mention chooses no one | `core/src/writes/unnamed-subject-never-chooses.property.test.ts` | 512382791 | no rules, nothing asked, "I'm allergic to peanuts." with entityId = the brother (Sam): his rule written |

`others-words-never-clear` with the seed and path above passes in a temporary copy, deleted before the commit. No existing assertion changed.

What the typed path sent for a T-class turn with no call open, before item 2: `instructions` = the Head text; `input` = the last four safe turns as `{ role, content }`, earlier T turns among them as `user`, then `{ role: "user", content: <the pasted text> }`; `tools: []`. Now each T text is `PASTED_STAND_IN`, and nothing else changed. `routes/turn.ts` is unchanged by these items.

Not verified, or left out:
- `reslice-never-chooses` keeps the words "allergic to <allergen>" whole. A cut inside the cue word changes active to pending (W-230).
- `unnamed-subject-never-chooses` leaves out a turn answering the asked rule of that same person, where the existing lend applies.
- What a real model says to the stand-in is not tested. The test only checks the request structure.
- The decisions parse never runs on T (R8.10). Extraction's reading of T turns, and the voice path (brief 045, lane `voice-c`), were not touched.

Checks after the second merge of `build/plan-stages` (`af83916`): `npx vitest run --maxWorkers=3` exit 0, 558 files passed, 4,466 tests passed, 23 expected fail; `npm run typecheck` exit 0; `npm run lint` exit 0 (the one existing warning in `avatar/three/brass.ts`); `npm run build` exit 0.
