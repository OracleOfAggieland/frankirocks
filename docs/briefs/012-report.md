# Brief 012 report

Report for `docs/briefs/012-voice-writes.md`, by wave. Section and row numbers are the design note's (`docs/briefs/012-design.md`).

## Wave A

### Properties run red

**This section and the next three describe the state at `ed6107b`, before the build.** The stubs, `NotBuilt` and the generators named here have changed since; the build table and the review fixes below say how.

**Commit order.** Section 9 lists task A1 (steering) first; it was committed third. `39d197e` holds properties P1, P2, P5, P6 and P8, the typed stubs they ran against, their generators and fixtures, and the frozen extraction lines; `ed6107b` is this section; the steering file came after both, in `17eca05`.

Written first, at commit `39d197e` (from `bc19494`), against typed stubs that throw `NotBuilt` ("not implemented: …"). Every property below ran red for that reason and no other: the first generated case reached a stub. Each was run on its own with `npx vitest run <file>`; the seeds are fast-check's, printed on failure. A counterexample is given by the generated inputs that decide it (the clause list, the item's change, the slice classes and the flags); the derived fields (text, Evidence, items) follow from them.

| Property | File | Test | Seed | Path | Shrunk counterexample | Red because |
|---|---|---|---|---|---|---|
| P1 authority | `packages/core/src/writes/authority.property.test.ts` | an item on a non-U slice gets only `ignored authority` or `outOfScope` | `-808011259` | `0:0:…:0` (28 steps) | one clause `selfAllergy` "shellfish" (text "I'm allergic to shellfish."), item 0 exact span with act `quoted`, one slice, classes all U, routes empty, `speakerCertain` false, not answering, no prior rules | `validateItems` |
| P1 authority | same | on Evidence with no U slice, every verdict is `ignored` and `core/rules` is unchanged | `360726627` | `0:0:…:0` (31 steps) | the same clause, item 0 `shift 0` with act `quoted`, one slice of class T, routes empty, `speakerCertain` false, a valid answer (`failed` false), no prior rules | `validateItems` |
| P1 authority | same | the planners write nothing from a proof on T or M text | `-149302207` | `0:0:…:0` (37 steps) | the same clause, one slice of class T, all three routes, no prior rules; the forged verdict is `affirm {self, [shellfish]}` with the exact span as proof | `planHardRule` |
| P2 only direct words | `packages/core/src/writes/direct-only.property.test.ts` | a non-direct or mismatched item is `ignored` (act or span), or `careOnly` for a transition | `422889427` | `0:0:…:0` (26 steps) | the same clause, item 0 span on another eid with act `quoted`, ASR, `speakerCertain` false | `validateItems` |
| P2 only direct words | same | from such items alone, no rule for a subject is added, activated or removed | `148494661` | `1:0:…:0` (27 steps) | the same clause, item 0 `shift -4` (offsets 0 to 21, quote unchanged) with act `quoted`, ASR, `speakerCertain` false, no prior rules | `validateItems` |
| P5 an error never becomes history | `packages/core/src/writes/error-never-history.property.test.ts` | after a correction, no later plan makes the wrong value current or history again | `1253621642` | `0:0:0` | `["life", false, []]`: the dad's `person.life` `ill` corrected to `hospitalized`, no name row, no later steps | `applyCorrection` (the correction at t) |
| P6 a past fact never demotes the present | `packages/core/src/writes/past-never-demotes.property.test.ts` | `place` gives `history` for a known end at or before now, and closes nothing | `1827765037` | `0:0:0` | `[{to: now, from: now}, "U", "none"]` (now = `2026-11-10T18:00:05.000Z`, 1794333605000) | `place` |
| P6 | same | correcting a past row writes its successor in history and leaves the current row alone | `74919217` | `0:0:0:0:0:0:0` | `[{to: now, from: now − 1 ms}, 0, 0, 0]`: the dad's `person.life` `ill` in history, corrected to `hospitalized`, the current `recovered` row starting at now | `applyCorrection` |
| P8 lineage (pure) | `packages/core/src/writes/lineage.property.test.ts` | every rule and every successor resolves through its span to Evidence text that matches | `784315193` | `0:0:…:0` (30 steps) | the same clause, item 0 with its quote edited at 0 ("x'm allergic to shellfish") and act `quoted`, ASR | `validateItems` |

Runs: P1 300, 300 and 200; P2 300 and 300; P5 300; P6 500 and 300; P8 300.

**The properties can fail on wrong code, not only on a stub.** Before committing, two stubs were swapped for wrong implementations for one run each, then restored (nothing of it was committed):
- `place` returning `history` only for `to < now`: P6 went red, seed `910819447`, shrunk to `[{to: now, from: now − 1 ms}, "U", "none"]`, `expected 'current' to be 'history'`. The `to = now` boundary is weighted in for this.
- `validateItems` ignoring every item for `span`: P2 went red on its converse check, seed `540353905`, `clean item 0 (allergy): expected [ 'act', 'span' ] to not include 'span'`. Ignoring everything doesn't pass P2.

**Generators and fixtures** are in `packages/core/src/writes/testing/`: `arb-writes.ts` (clauses, item changes, span oracle, fixed rows with real lineage, context builders), `gazetteer-oracle.ts` (an independent copy of design 2.1's IDs and aliases, used only as an oracle) and `arb-writes.test.ts`, which checks the fixtures on their own and is green: the target rows resolve with `resolveLineage`, careful items quote the composed text exactly and verify with extraction's `anchorSpan` and `verifySpan`, and the item changes give both clean and faulty items (over 50 of each in 200 runs).

**Frozen extraction lines.** `scripts/extract-check/lines.json`, committed in `39d197e` before any run: 30 typed lines (8 allergy and hard-rule, 6 corrections, 8 life changes, 6 near-miss and 2 ordinary), each with `writes` and `neverWrites`. Every expectation has the same closed shape `{predicate, subject, value, status, target, names}`, null meaning any; correction and change lines list the `prior` rows they act on. Four first drafts held a 4-word window of a judge-spike probe line ("i m allergic to", "my dad passed away", "m allergic to mondays") and were reworded before the commit; the committed file has none, checked with `scripts/close-copy.mjs` `closeCopies` against all 60 probe lines. No run has been made on them.

**Checks after the commit.** `npx vitest run`: 171 files, 1,541 tests; the 9 failures are exactly the tests above, and every other test passes. `npm run typecheck` and `npm run lint` exit 0. `npm run build` and `npm run test:emulator` were not run.

### Choices made where the design left the shape open

These are in `packages/core/src/writes/types.ts`; it is not a property file, and later tasks may change it, but the properties above use these shapes.
- `Plan = {ok: true, commands: Command[]} | {ok: false, error}`, with `Command` the closed subset of task A6 (`putMemory` with `expectRev`, `putRules` with `expectRulesRev`, `burnBundle`, `ledger`).
- `applyCorrection(v, rows, env)` and `applyTransition(v, rows, env)`: `rows` is every row the planner may read (the targets and their same-key rows, as G36 reads them in the transaction); `env: PlanEnv` carries the turn's Evidence, the verified proof span and the packet lineage of G37. `CorrectionVerdict` is the design's union unchanged, so the proof travels in `env`, not in the verdict.
- `AllergyVerdict`, `TransitionVerdict`, `HardRuleTurn`, `HardRulePlan`, `LedgerDecision`, `TurnEvidence` and `SubjectIndex` are spelled out from the tables of 2.4, 2.5 and 6.2.
- `initialSlots(regex: boolean)`: design 6.1 types it over `RegexFamily[]`, a type the code doesn't have.
- `AllergyRule` and `Dep` are local type aliases in `types.ts`, because the core index already exports values of those names.

### What this wave's property author did not do

- P4 (pure) and P12 are in task A2's file plan but were not part of this assignment; they are not written.
- P8 has no pure file in the design's section 7 (it is route level, in waves B and C). `writes/lineage.property.test.ts` is the pure level the assignment asked for; the route files are still to come.
- The worker and route variants of P1, P5, P6 and P8 belong to later waves.
- No stub was built, and task A10b (the check script and the SHA pin of `lines.json`) is not written.

### Readings a reviewer may want to check

- **P1, forged verdicts.** The half that hands planners a verdict validation would never give uses T and M only. Contracts §7 lets U and C carry subject truth through `applyTransition` (and O its own anchor), so a C or O proof there isn't a clear "nothing written". The pipeline half, through `validateItems`, covers T, M, O and C as the design's P1 says.
- **P2, `authority` on a bad span.** P2 says a mismatched item is ignored for `act` or `span`. Rows A1, C1 and T1 check authority first, so a span on another eid or past the U slice has no U slice covering it. The property also accepts `authority` in exactly that case.
- **P2, no answering turn.** Answering rule 1 fills an item from the asked rule, which would make "item not in the span" a valid answer, so P2 runs with `answering: null`.
- **P5, both planners apply transcript order.** G35 puts the `negated` skip and "an earlier turn never closes a later row" in both planners, so P5 expects `applyCorrection` and `applyTransition` to refuse the wrong value from a turn asserted at or before the correction, and expects a transition from an earlier turn not to close the successor.
- **P6, "the plan".** The only route planner that meets a past interval is `applyCorrection` of a `history` row (G24: the successor keeps its interval), so P6's plan half is that case.
- **P8, rule root keys.** "The root keys are that Evidence's" is read as: each of the rule's `rootKeys` is the root key of one of its proof Evidence's slices.
- **Frozen line labels that are judgment calls**: `x-allergy-8` (a steakhouse ban, labelled a held standing rule), `x-allergy-3` (a doctor's "might be", labelled a held allergy, since a hold fails closed), `x-change-2` (in the hospital with pneumonia, labelled `hospitalized`, with a `care` row of any subject).

### The build, tasks A1 to A11

Every task of section 9's wave A is built and committed by path, one commit per task. Each commit message is plain. Every committed property was made green by changing code, and no property file was edited after its commit.

| Task | Commit | What was built, and where |
|---|---|---|
| A1 Steering | `17eca05` | `.kiro/steering/memory-writes.md` (`fileMatch`, under 80 lines, the brief's six rules and the design's five, each citing its section); `scripts/memory-writes-steering.test.ts` pins the front matter, the pattern, the length and a citation per rule. |
| A2 (rest) | `8b93fe4` | P4 pure (`writes/hard-rule.property.test.ts`, generators in `writes/testing/arb-hard-rule.ts`) and P12 (`writes/slots-phase.property.test.ts`), written red against the stubs. Red seeds: P4 `1628951698`, path `1:0:0:0:0:0:0:0:0:0`, shrunk to the turn "I'm allergic to shellfish." with a failed answer, no certain speaker, nothing asked and empty rules, red on `planHardRule`; P12 `-482643729` (path `0:0`, `[false, []]`) and `1301602386` (path `0:0:0`, `[false, false, false, 0]`), red on `initialSlots`. |
| A3 Gazetteer | `2606365` | `writes/gazetteer.ts`: gz1 with **108** entries, the rows of design 2.1 (the commit message says 114; that is wrong, and the table and the oracle both have 108). Normal form, whole-word matching with offsets on the caller's text, the longer match winning, `lookupAllergen` (the only source of the `none` entry) and `scanAliases`. `gazetteer.test.ts` holds 2.1's witnesses and checks the table against the oracle copy. |
| A4 FastSlotsV1 | `162da09` | `writes/fast-slots.ts` (constants, the contract literal after `PREFIX`, the guide, input bounds and trim, the strict schema, `parseFastSlots`), `server/onturn/fast-slots-port.ts` (`FRANKI_BG_MODEL`, the caller's deadline on the opsClock), `server/testing/fake-fast-slots.ts`, and `fastSlots` in `RouteDeps`. |
| A5 Validation | `3e7844b` | `writes/subject.ts` (rows SU1 to SU8), `writes/spans.ts` (extraction's anchor and verify, the U parts), `writes/validate.ts` (the allergy, answering, correction and transition tables, with a running bound on handled keys and refs), `writes/validate.test.ts` (45 cases). |
| A6 Status and planners | `9e1f210` | `writes/status.ts` (`statusTransition`, the one function for a Memory's next status; extraction's replaced loop now calls it and skips `refuse`), `writes/bitemporal.ts` (`place`, `closesCurrent`), `writes/bundle.ts`, `writes/keys.ts`, `writes/plan.ts`, `writes/correction.ts` (`applyCorrection`, with renames through `identity.name`), `writes/transition.ts` (`applyTransition`, the truth-order table and transcript order), `writes/plans.test.ts`. P5 and P6 green. |
| A7 Rules | `7728ef0` | `writes/rule-state.ts` (`ruleTransition`, every move of 6.3), `writes/not-allergy.ts` (the G3 double check), `writes/hard-rule.ts` (`planHardRule`: slots from U proofs only, cross-slot reach, coverage over the U cue sentences, the `unresolved` fallback, the bounds, the outcome read from what changed), `writes/hard-rule.test.ts` (29 cases). P1, P2, P4 and P8 green. P4 found a real defect on the way (CQ 131), fixed in code: seed `-1822335196`, a hedge plus a global denial ("I'm not allergic to anything") left a pending shellfish rule with neither a slot nor a recorded denial. |
| A8 Call phase | `bc91caf` | `writes/slots-phase.ts` (`initialSlots`, `nextSlots`: never before the context is read, at most one start, the deadline from the starting event, a due deadline always settles) and `slots-phase.test.ts`, one case per row of 6.1. P12 green. |
| A9 Harness | `930e657` | `scripts/judge-spike/fast-slots.ts` and `fast-slots-fixture.ts` (synthetic entities and targets, none of the owner's words), `--fast-slots` in `cli.ts`, the FastSlotsV1 section in `summary.ts`, six cases in `harness.test.ts`. Rows hold the time, result, invalid reason and path, and item kinds; never line text. From the Nov 10 run file (`2026-11-10T06-32-11-722Z-owner.json`), **hardRule 4 of 5 and correction 3 of 5 lines pass `speakerCertain`**: `c-hardrule-2` and `c-correction-4` had failed parses, and `c-correction-5` had company at 0.3. `transition` reports "no lines" (G21). The review found its correction count measured the shared fixture, not FastSlotsV1 (fixed in `b5fe6ee`, below). |
| A10b Extraction check | `72cea4a` | `scripts/extract-check/check.ts`, `run.mjs`, `check.test.ts`, `tsconfig.json`; the root `typecheck` now covers it. `LINES_SHA256` pins `lines.json` (`7bba56d2…0a0b`, read with LF line endings) and a run refuses any other file. Every item is planned with the extractor's own `planItem`; a hold counts as `held`, a memory plan as its own status, and each target it closes as `wrong` or `history` (CQ 143). The test checks the pin, the class counts, that no line holds a 4-word window of a judge-spike probe line (`closeCopies`, as `regex-copy.test.ts` does), real answers for an allergy, a misplaced allergy, a correction and a change on a correction line, and that the fake run exits 0. |
| A11 | this report | |

A fake extraction run (`node scripts/extract-check/run.mjs`) passes 9 of 30: exactly the lines that expect no write, since every fake answer is empty. It measures nothing about ExtractV1.

### Contract questions raised

CQs 130 to 155 are in the design note's section 8. 130 the turn is never cut; 131 a global denial's ledger codes; 132 cross-slot resolution only on a newly active rule; 133 answering rule 5 keeps the asked rule pending (the owner's call, with 128); 134 past words place a change at the turn; 135 `SubjectIndex.seen`; 136 row A10's reason; 137 `RuleEvent.install`; 138 no `subjectLabel` until wave B; 139 the care row's subject and topic; 140 a correction with another current row on its key is refused; 141 a change meeting a later-asserted row ends at now; 142 what `--fast-slots` sends; 143 the extraction check's single call. From the wave A review: 144 cross-slot reach only where the new rule answers the pending one; 145 row A9 and A7's codes exactly `[none]`; 146 answering rule 5 only for R's own subject; 147 an answer's rule depends on both Evidences, root keys the proof's; 148 an uncertain speaker's denial carries only verified codes; 149 SU2's "my" and "mine"; 150 subjects only from a plain mention, and notAllergy over the whole U text; 151 a change said for the turn's own day defers unless past; 152 a death stands, a reunion brings back only a partner; 153 an asked rule landing on an active slot stays (the owner's call); 154 `targets[].line` and the planner signatures; 155 row C5b's `preference.*`. From the second review: 156 answering rules 1 and 3 take the asked rule's code only for an item that names nothing of its own; 157 `notAllergy` reads outside the cue sentences only for a cue with no object (amends 150); 158 a certain denial holding "I" answering the anonymous `unresolved` rule (the owner's call); 159 SU2's readings for transitions and the answer "Mine." (amends 149).

### Review fixes

The wave A review confirmed 17 findings and listed smaller ones. Every confirmed finding is fixed in code; no committed property file was edited.

**Property 4b, written red first.** P4 was weak, not wrong: its generator never made a turn where a pending rule could leave for another rule's answer. `packages/core/src/writes/hard-rule-slots.property.test.ts`, with its generator `writes/testing/arb-hard-rule-answers.ts`, was committed red in `e12c423`: a pending rule leaves only for its own slot, an answer's rule names this turn in `dependsOn`, `pendingKept` never comes with no rule and no change, and coverage holds except on a plain "My X" mention. Red seeds at `e12c423` (1,000 runs each; log `_sm/logs/f3/p4b-red.log` outside the repo):

| Seed | Failure |
|---|---|
| `105783578` | "I'm allergic to penicillin" removed the owner's pending `unresolved` rule |
| `-1548683395` | a pending kiwi rule for anyone left on "I'm allergic to penicillin." while kiwi was asked |
| `-1100999920` | the owner's `unresolved` rule left on "I'm allergic to penicillin. Yes." |
| `849322210` | "My brother with the milk allergy…": milk uncovered |
| `-91000851` | a shellfish rule written without the turn in `dependsOn` |
| `-877453753` | `pendingKept` with no rule on "I'm allergic to shellfish." |
| `364412852` | the same on "I'm allergic to shellfish. Yes." |
| `-31857720` | the same on "My brother." |
| `-1709706888` | "I'm allergic to kiwi. Yes.": kiwi uncovered |

P4b is green after `67fee10`, over 12 repeated runs alongside P1, P2, P4 and P8.

| Commit | What it fixes |
|---|---|
| `67fee10` | `planHardRule` and validation: cross-slot reach only for the new rule's own slot or an asked anonymous `unresolved` rule (CQ 144); A9 and A7 (145); rule 5's subject (146); an answer's lineage (147); A6's verified codes (148); SU2 (149); plain mentions, the fallback over the uncut cue sentences, `notAllergy` over the whole U text (150); the catch-all `pendingKept`; the `superseded` rule move through `ruleTransition`; `RULES_MAX` refusing growth; `ruleKept` precedence; same-day times (row T6b, CQ 151) and an ambiguous transition subject deferring (SU6); the dead `NotBuilt`, `mentionSpanOf` and `removeId`. The commit message names CQs 144 to 151, but CQ 151's text landed in the next commit (its code is here). |
| `5ed99ac` | Every planner status move goes through `statusTransition`; a death needs a U proof, has gravity 3 and stands against a later illness or recovery; a reunion brings back only a partner or spouse (152); a correction takes the current row's place whatever order its targets come in; a rename's `replaces` names the old name's row; the worker drops a refused row from its replaced set; CQs 151 to 155 recorded. |
| `5faa799` | One scope function: `writes/keys.ts` calls extraction's `scopeIdOf`, so the on-turn route and extraction give one row the same key (pinned by a test in `c1f769d`); `preference.schedule` is not key-stable (CQ 155); validation reuses `protectedRow` and `sameValue` instead of its own copies. |
| `c1f769d` | The extraction check meets an allergy in ExtractV1's guide shape (`value boolean true`, the allergen in `args.allergenCode`), and its output states that same-key closes are under-counted. |
| `b5fe6ee` | `--fast-slots`: each correction line is sent the row it corrects, written from its own text; a row counts the items passing the code's first checks (exact span on the turn, a gazetteer allergen, only targets that were sent); the summary says validateItems' full tables don't run and event corrections defer (C5b). A live run counts speaker certainty from its own parses, else from the Nov 10 run. |
| `fb2ad05` | The FastSlots port answers `transport` rather than throwing when `FRANKI_BG_MODEL` is missing. |
| `e29ce93` | The two emulator tests' `RouteDeps` lacked `fastSlots`, which nothing compiled; `npm run typecheck` now runs `tsc` on `tests/`. |
| `c5ca360` | The clock and model-literal guards now scan `scripts/extract-check` (no violations). |

**Smaller findings skipped,** each with its reason:
- Hardening a denial whose `need` isn't `none`: it needs a new ignored reason and changes P4's coverage clause.
- The plant-milk row of gz2: it changes the frozen gazetteer and its oracle; a question for the owner, not a fix.
- The "just a dislike" answer template: it belongs to wave B's notes.
- Tidying only: the duplicate `rangeClassOn`, a cast in `spans.ts` and in `check.ts`, `SlotsRoute` vs `Route`, the unused exports `normalizeAllergenText` and `hasWholeWordSequence`, and unread fields (`ValidateContext.source`, `trigger.asked`, `RuleEvent`'s proof and deps).

**Seen, not fixed here.** `voice-control` Property 13 failed once under a full `npm test` (seed `-1393276649`) and passed on rerun. It is outside brief 012's files and belongs to another wave.

### Second review fixes

The re-check of the review fixes at `dc3b0c3` confirmed three more findings. Each is fixed in code, one commit each; no committed property file was edited.

| Commit | What it fixes |
|---|---|
| `c36829c` | On an answering turn an item found in its span that the gazetteer doesn't know ("durian", "something") took the asked rule's code: "I'm not allergic to durian" removed the owner's asked peanut rule, "Nobody here is allergic to durian, no" cleared an anonymous one through A9, and "I'm allergic to durian" or "My brother is allergic to something too" made an active peanut rule. R's code is now taken only for an empty item, one not in the span, or reference and answer words (`REFERENCE_WORDS`); A9 refuses a denial whose item names something of its own (CQ 156). |
| `5cf9c01` | CQ 150 failed G3's code half on an alias anywhere in the turn, so "I'm allergic to Mondays. Can you order eggs for breakfast?" and three like it wrote the all-food filter and asked. The check is back over the RX4 sentences, and reads the whole U text only when a cue has no object of its own (`cueHasNoObject`, CQ 157). |
| `ba2bd7d` | CQ 149's strict "my" also stopped transitions ("My job ended last week.", "My contract wasn't renewed.", "My marriage to Sam is over.") and the answer "Mine.". `hasFirstPerson` takes a closed `SelfReading`: `allergy` (strict), `answer` ("Mine." alone or after it's or that's) and `transition` ("my" before a word that names no other person or pet) (CQ 159). |

**Property 4c, red first.** `packages/core/src/writes/hard-rule-off-table.property.test.ts` (1,000 runs) uses P4b's generator, which now also makes "durian", "something" and "My brother isn't allergic to X". It checks that an allergy item naming something off the table never gives a verdict carrying the asked rule's code or a denial answering it, and that an asked pending rule with a gazetteer code stays when every allergy item is such an item. Run against the old `validate.ts` (restored to `dc3b0c3`'s copy for one run, then put back; nothing of it was committed) it went red at seed `1266071246`, path `4:4:3:3:3:3:3:4:4`, shrunk to "I'm definitely allergic to durian. Yes." answering an anonymous pending peanut rule: the durian item carried `peanut`. Log: `_sm/logs/f3/f1-red.log` outside the repo. Green after `c36829c`, over 5 repeated runs alongside P1, P2, P4, P4b and P8.

**Read differently from the finding, with the reason.** Finding 2 suggested counting an alias outside the RX4 sentences when "the cue word is its last word". That also covers "My boss is so intolerant.", one of the four lines the same finding wants as `notAllergy`, since the boss line ends on its cue. A sentence-final cue therefore counts only when it is `allerg…`, or when the next sentence starts with "to", "of" or "with" (CQ 157).

### Third review fixes

The re-check at `e3906e3` confirmed two more findings, both on answering turns. Each is fixed in code, one commit each; no committed property file was edited.

| Commit | What it fixes |
|---|---|
| `c70cfc4` | "Not mine.", "It's not mine.", "That's not mine.", "No, not mine." and "It isn't mine." answering who has an anonymous peanut rule resolved no one, and row A9 read the bare denial as an answer, so the peanut filter was cleared though the speaker only said it wasn't theirs ("Not me." already gave a denial for `self`). The `answer` reading now takes "mine" when every other word is an answer word, a cue word or an alias word (`MINE_CONTEXT`), so these are a denial for `self` and the anonymous rule stays, and "Mine too.", "Definitely mine.", "That one's mine.", "The allergy is mine." and "Mine, actually." are an affirm for `self`. Row A9 also needs the denial's span to name no person (`namesSomeone`), so "My brother doesn't." or "She isn't." no longer clears it (CQ 160). |
| `63ed59c` | `namesNothing` accepted CQ 156's 17 reference words only, so an item copied as "that stuff", "any of that", "those things", "either", "allergic", "that allergy" or "nobody" counted as another allergen: a plain no to the owner's asked peanut rule left it pending with no further question, and a plain yes wrote the all-food filter and asked `whatItem`. It now also accepts generic pointer and quantifier words and the allergy and intolerance cue words, only when the gazetteer finds nothing in the item ("any allergies" stays a global denial). Row A10 on an answering turn is now `pendingKept` for the asked rule, so a "no" to Franki's question never adds the all-food filter (CQ 161). |

**Property 4d, red first.** `packages/core/src/writes/hard-rule-mine-answers.property.test.ts` (1,000 runs, generator in `writes/testing/arb-plain-answers.ts`) checks that a negated "mine" is a denial for `self` (when the item says `isSelf` or the asked rule has no subject to lend it), that "mine" among answer words is an affirm for `self` with the asked code, and that after a negated "mine" or a denial naming a person an asked anonymous rule stays. Run against `e3906e3`'s `subject.ts` and `validate.ts` (restored for one run, then put back; nothing of it was committed) it went red at seed `1805914381`, path `1:0:0:0:0:0`, shrunk to "Not mine." (empty item, no subject) answering the anonymous pending peanut rule: the verdict was a denial answering it. Log: `_sm/logs/f3/p4d-red-head.log` outside the repo.

**Property 4e, red first.** `packages/core/src/writes/hard-rule-plain-answers.property.test.ts` (1,000 runs, same generator) checks that an item made only of pointer, generic and cue words, or an empty one, gives a verdict carrying, answering or keeping the asked rule's gazetteer code, and adds no `unresolved` rule; and that a denial on an answering turn adds no rule at all. Run after `c70cfc4` and before `63ed59c` it went red at seed `-979140169`, path `5:0:0:0:0:0:0`, shrunk to "Yes, I am allergic to that stuff." (item "that stuff", `isSelf`) answering the anonymous pending peanut rule: the verdict was `unsure`, `unresolved`, `whatItem`. Log: `_sm/logs/f3/p4e-red.log`.

Both are green after `63ed59c`, with P1, P2, P4, P4b, P4c and P8, over 5 repeated runs (one run hit the P1 generator error below; the other four were clean).

**Read differently from the findings, with the reason.**
- Finding 1 suggested reading "mine" after any word but "of". The fix uses a closed list of answer words instead, which is stricter and fails closed: "Mine and my brother's.", "Mine is the one with the dog." and "a friend of mine" still resolve no one. It also added the A9 guard, the finding's second option, since a denial naming another person ("My brother doesn't.") cleared the anonymous rule the same way. "No, nobody in my family." now goes to A10 too, which keeps the rule.
- Finding 2 named the cue words as `allerg…` and `intoleran…`. RX4 also matches "celiac", "epipen" and "anaphyla…", which name something of their own, so only the allergy and intolerance words count. "anybody" and "sort" were added to the generic list beside the finding's words. "Nobody." alone holds no word of row A5's negation list, so it reads as `uncertain` rather than reaching A10 as the finding described; with the fix it takes the asked code about no one, which keeps an anonymous asked rule. A5's list is unchanged.

**Seen, not fixed here.**
- Answering rule 2 gives an item with no subject the asked rule's subject before any word is read, so "Not mine." with no subject, answering a question about the brother's pending peanut rule, is a denial for the brother and removes his rule. An item with `isSelf` gives a denial for `self`. This is the rule as designed, outside both findings; P4d leaves the case out and says so.
- The committed P1 (`authority.property.test.ts`, "on Evidence with no U slice") threw `RangeError: buildSlice: surrogateSplit` once in 5 repeated runs: its generator cuts the text at `Math.floor(f * text.length)`, which can split a surrogate pair. It is a generator error, not a property failure, and fast-check gave no seed. Not edited (a committed property file); the fix would be in the generator's cut points.

### Disputes

- **P4c's written list now differs from the code (CQ 161).** `hard-rule-off-table.property.test.ts` writes out CQ 156's 17 reference words in its own `REFERENCE` set and treats any other item word found in the span as naming something off the table. `namesNothing` now also accepts generic words ("stuff", "either", "nobody"…) and the allergy and intolerance cue words, so for an item such as "that stuff" or "allergic" P4c's oracle and the code disagree. P4c stays green because its generator only makes "durian", "something" and gazetteer items. If its generator ever made such an item, P4c would fail on correct behaviour. It was not edited; the wider list is pinned in the new P4e. A person should decide whether to align P4c's `REFERENCE` with `REFERENCE_WORDS`, `GENERIC_WORDS` and the cue words.
- Earlier: no committed property was found wrong; P4 was found weak, and P4b adds to it. P4b was also weak for answers naming something off the table, since it counts only gazetteer codes in an answer's span; P4c adds to it.

### Open before wave B

Wave A closes with three answering-turn items open. Nothing here is reachable from a route yet: `fastSlots` is built in `packages/server/src/routes/live-deps.ts` and typed in `routes/runtime.ts`, but no route calls it or the `writes` planners (only `scripts/judge-spike` calls the port, by hand). The extraction worker's replaced loop now goes through `statusTransition`; both of its sources (the same-key query and the named targets) hold only `active` rows, so the result is the same as before. All three items depend on what FastSlotsV1 really puts in `item`, which has not been measured (no model call was made). "Fails open" below means a food rule is removed or moved though the speaker did not say so; "fails closed" means a wider filter or a repeated question. Each example is one item, certain speaker, span over the whole sentence; each was run through `validateItems` and `planHardRule` at `33b568d`.

1. **Fails open: `namesNothing` reads only `item`** (`packages/core/src/writes/validate.ts`, `namesNothing` and its use in `allergyVerdict`). Since `63ed59c` a generic word or a cue word names nothing, so an answer whose span names something else still takes or clears the asked rule when `item` holds only that word. Anonymous pending peanut rule asked: "My brother is allergic to stuff too." (item "stuff") gives the brother an active peanut rule and removes the anonymous one; "Nobody here is allergic to that other thing, no." (item "thing") clears it; "No, nobody is allergic to shellfish." clears it with item "allergic", "nobody" or an empty item (A9 counts codes from `item` only), and also writes an anonymous pending shellfish rule and asks `whoHas`. Owner's pending shellfish rule asked: "I'm not allergic to the other thing." (item "thing") and "I'm not allergic to durian." (item "allergic") remove it. Proposed, not built: decide from the span as well as the item. An asked rule is answered, or its code taken, only when every allergen alias in the span has its code; a generic noun names nothing only beside a pointer or quantifier; a cue-word item names nothing only when the cue has no object of its own in the span; an otherness word (other, another, different, else) makes the item name its own. Pin it with a new property whose generator makes head-noun and cue-word items over spans holding another alias, an off-table word or "other".
2. **Fails closed: echoes of the `isAllergy` question count as another allergen** (same function). With the owner's pending shellfish rule asked, an item holding an article, intensifier or the question's own words names something of its own: "It's a real reaction.", "Yes, it's an allergy." (item "an allergy"), "Yes, I'm really allergic." and "Yes, I'm allergic to that food." write a pending `unresolved` rule (the all-food filter) and ask `whatItem`; "No, just a dislike." and "No, it's not an allergy." leave the rule pending with no note. With `item` empty and no subject the same sentences answer correctly: an active rule, or the rule removed. With `item` empty but `isSelf` set, "It's…" and "No, just a dislike." have no first person, resolve no one and still miss, which the same decision should cover.
3. **Fails open: answering rule 2 lends the asked rule's subject before any word is read** (`allergyVerdict`, the `isEmptySubject` branch). "Not mine." with no subject, answering about the brother's pending peanut rule, is a denial for the brother and removes his rule. Already under "Seen, not fixed here" in the third review fixes; P4d leaves the case out.

P4c's written-out word list and `namesNothing` differ (see "Disputes"); settle that together with these three, after FastSlotsV1's real `item` output has been seen.

### Checks

After the third review fixes (`63ed59c`), run one at a time, logs in `_sm/logs/f3/check-*.log` outside the repo: `npm test` exit 0 with 186 files and 1,726 tests; `npm run lint` exit 0, and `turbo run lint --force` (0 cached) exit 0; `npm run typecheck` exit 0; `npm run build -- --force` exit 0 (0 cached), `specimens-absent` passes; `npm run test:emulator` (Java 21, port 8080 free beforehand) exit 0 with 4 files and 42 tests.

After the second review fixes (`ba2bd7d`), run one at a time, logs in `_sm/logs/f3/fix2-*.log` outside the repo: `npm test` exit 0 with 184 files and 1,716 tests; `npm run lint` exit 0 (it lints `apps/web` only, from turbo's cache); `npm run typecheck` exit 0; `npm run build` exit 0, `specimens-absent` passes; `npm run test:emulator` (Java 21) exit 0 with 4 files and 42 tests.

After the review fixes (`c5ca360`), run one at a time, logs in `_sm/logs/f3/fix-*.log` outside the repo: `npm test` exit 0 with 183 files and 1,709 tests; `npm run lint` exit 0; `npm run typecheck` exit 0 (packages, `scripts/judge-spike`, `scripts/extract-check`, and now `tests/`); `npm run build` exit 0, `specimens-absent` passes; `npm run test:emulator` (Java 21) exit 0 with 4 files and 42 tests.

Earlier, after A10b, logs in `_sm/logs/f3/a11-*.log`:

| Check | Result |
|---|---|
| `npm test` | exit 0: 182 files, 1,682 tests |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 (packages, `scripts/judge-spike`, `scripts/extract-check`) |
| `npm run build` | exit 0; `specimens-absent` passes |
| `npm run test:emulator` (Java 21) | exit 0: 4 files, 42 tests |

### What could not be checked

- **No live call was made** (no paid or network call in this wave's build). `liveFastSlotsPort` and `liveExtractPort` have never run; FastSlotsV1's real latency, validity and item kinds, and ExtractV1's pass count on the frozen lines, are unknown. The 900 ms deadline stays assumed (design 6.1).
- **The extraction check's matching is a reading.** Subjects match on the owner's words with "my", "the" or "the owner's" dropped; values match on whole words, and an allergy value through `lookupAllergen`. It is tested on hand-built answers, never on real model output. A live result that looks wrong may be the matcher; that would be fixed in check.ts, never by relabelling a line.
- Nothing of wave A is wired into `/api/turn` yet: the planners are pure and only extraction's status loop calls new code. The worker and route variants of P1, P3, P5, P6 and P8 belong to waves B to D.

### Live-check steps for the owner (paid; each needs your yes first)

1. `node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --source owner --live --fast-slots` on your takes. The run refuses if `scripts/judge-spike/lines.json` has uncommitted changes. Read the FastSlotsV1 section of the summary: p50, p95, the largest time, the share over 900 ms, valid items per class, and the speaker-certainty line.
2. `node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/extract-check/run.mjs --live`. It prints one line per frozen line and the pass count by class, and writes `scripts/extract-check/results/<time>-extract-check.json` (IDs, indexes and plan kinds, no words).
3. If more than a small share of FastSlots calls are over 900 ms, or the speaker gate fails many clean lines, the deadline and the gate are your call before wave B goes live (design section 11, step 1).

## Wave B: allergies and hard rules (brief 018, tasks 0 and B1 to B12)

Built by Claude on lane `writes`. Kiro wrote none of this wave. Every task, 0 and B1 to B12, is built. The lane merged `build/plan-stages` at `21a7f7e` before B9.

### The build

| Task | Commit | What |
|---|---|---|
| 0 | `40e3cca`, `93dc129` | Report items 1 to 3 of wave A. On an answering turn, validation reads the item's span as well as its `item` (`writes/names-own.ts`). R's subject is lent only when the span names no one (`LEND_ONLY_WHEN_NAMES_NO_ONE`). A9 needs a span that fits R. New P4f, written red first. |
| B1 | `3a328d2` | The red properties: P10 (`admission-write`), P3 pure (`head-rules`), and the route halves of P3, P4, P8 and P9. They are driven by `testing/arb-rule-turns.ts`. |
| B2 | `5b0c43d` | Wave B's state is on `core/rules`: `subjectLabels`, `proposals`, the `handled` ring (16) and `ask`. Older documents read through `withRulesDefaults`. |
| B3 | `6e56487`, `d0dea7c` | `writes/notes.ts` (route notes, typed lines), `writes/pending.ts` (6.4) and `writes/rules-section.ts` (2.8). The machine row `memory.allergyAsk`. |
| B4 | `303985c` | `writeRule` and `admittedNotes` in `core/admission.ts`, called at `admission/seam.ts`. P10 is green. |
| B5 | `c050ab4` | `compileHead` renders the rules section for the call's audience. The persona carries G29's text and its two added lines. P3 pure is green. |
| B6 | `c7e87d4` | `server/onturn/`: `trigger`, `context`, `execute`, `proposals`, `route`, `typed`. `postTurn` runs FastSlots through `nextSlots` and the executor in its transaction. `open` applies proposals before it compiles. P3, P4, P8 and P9 route are green, with 15 cases in `routes/turn.rules.test.ts`. |
| B7 | `8f09cbc` | A receipt moves `core/rules.ask`. The state route returns no ack while a question is asked (`routes/receipt.ask.test.ts`). |
| B8 | `5f6927f` | Extraction skips allergies the route handled (skip reason `handled`). `writes/backstop.ts` turns the rest into a pending proposal. Every turn transaction applies open proposals. P1 worker and P15 are green, with 4 cases in `worker/extract.backstop.test.ts`. |
| B9 | `0c64049` | `onturn/late.ts`. A Superseding_Post runs `executeHardRule` in its own transaction and returns the higher Deck with no Permit. A Parse_Repair commits the parse under its lease as before, then runs the route once outside the lease and writes a `repair` proposal (no `rulesRev` rise) with a `proposed` entry in `handled`. Both skip when `handled` already has a hardRule entry for the Evidence. 4 cases in `intents/repair.test.ts`, 3 in `routes/supersede.test.ts`. |
| B10 | `fbc9099` | The composer reports paste events, and `TypedTurns` sends the line as `source: "pasted"` until the box is cleared (`PASTE_STICKS_UNTIL_CLEARED`). `classifyTurn` reads it as T. A pasted line in a call is held back with `COPY.typed.pastedInCall`. Tests: `client/typed-paste.test.ts` (4, on the real routes), `TypedLine.test.tsx` (2), `routes/turn.rules.test.ts` (1). |
| B11 | `36f682d` | Debug section `rules`: one item with `core/rules` and a proof check per rule and proposed rule (`routes/debug-rules.ts`). The panel's "Hard rules" box lists rules, pending rules and proposals with their proof spans and mismatches, then `noneConfirmed` and the open question. Tests: `routes/debug-rules.test.ts` (2), `DebugPanel.test.tsx` (2). |
| B12 | this commit | The checks below and this section. |

### Red first

| Property | Seed | Counterexample |
|---|---|---|
| P4f | `-289222150`, path `7:1:2:2` | "Yes, I'm allergic to durian." with item "allergic", answering an anonymous peanut rule, made an active peanut rule from R's proof |
| P10 | `-379104524` | `writeRule` not built |
| P3 pure | `-518073548` | `readRulesSection` not built |
| P4 route | `352243733` | typed "I'm allergic to shellfish." left no hardRule `handled` entry |
| P3 route | `161444132` | `readRulesSection` not built |
| P9 | none (count check) | no claim was ever seen, because no route note existed |
| P8 | none (count check) | no rule was ever checked |
| P1 worker | `391910470`, path `0:0:0:0:0` | `backstopProposal` not built |
| P15 | `-132578416`, path `0:0:0:0` | "I'm allergic to shellfish. Oh, and cashews too." with an empty FastSlots answer: cashew had no slot |
| P4 route, during B6 | `-1542448610` | "It was the shellfish." opened by the parse alone, with an empty valid answer, left shellfish with no slot. This led to ruling W-165. |

### Checks (Nov 12, at `5f6927f`)

- `npx vitest run --maxWorkers=3`: 295 files, 3,243 passed and 20 expected fails. No skip and no expected fail was added or removed. No committed `*.property.test.ts` was edited; the 8 property files in the diff are new.
- `voice/admitted-turn-posted.property.test.ts` failed once during the B5 core run, in 303 ms (not a timeout). It passed 6 of 6 times when run alone. It is not this lane's file, and it imports none of this lane's modules.
- `npm run lint`: 0 errors, plus 1 warning in `apps/web/.../avatar/three/brass.ts` that this lane didn't cause.
- `npm run typecheck`: 4 of 4 packages pass.
- `npm run build`: not run, because `apps/web` is unchanged.

### Checks (Nov 12, at `36f682d`, after B11)

- `npx vitest run --maxWorkers=3`: exit 0, 349 files, 3,558 passed, 0 expected fails (the voice lane's merge fixed the 20).
- `npm run lint`: exit 0, 0 errors and the same 1 warning in `brass.ts`. `npm run typecheck`: 4 of 4 packages pass. `npm run build`: exit 0, `specimens-absent` and `three-chunk-check` pass. `copy-check`, `token-check` and `ui-boundaries`: exit 0.
- No committed property file was edited. `parse-gap.property.test.ts` is green. The only changed assertion in an existing test is the Debug_Panel's load count, from 12 to 14 calls, for the added section.

### Not built

- **In a call, a pasted line is held back, not sent as T** (W-179). The voice machine's `typedSubmitted` has no source, and `voice/**` belongs to the voice lane.
- **A late route never answers the open question**, and a repair's proposal never removes or upgrades a rule (W-177, W-178). The owner's next turn does that.
- **Typed path (G17):** the first typed reply is abandoned only once the parse returns, not cancelled.
- **Proposals:** a turn the route didn't open reads the context only when proposals are open at arrival.

### Disputes

- P4c's word list still differs from the code (CQ 161). It was left alone, as brief 018 says, and the question stays with the owner.

### Live-check steps for the owner (paid; each needs your yes first)

These are unchanged from wave A, and none has been run:

1. Run the judge spike with `--live --fast-slots` on your takes. Read p50, p95, the largest time, the share over 900 ms, and the speaker-certainty line.
2. Run `scripts/extract-check/run.mjs --live`.
3. If many FastSlots calls are over 900 ms, or the speaker gate fails many clean lines, the deadline (`FAST_SLOTS_DEADLINE_MS`, 900) and the gate are your call before wave B goes live.

## Wave C: corrections and renames (brief 025, W-187 and tasks C1 to C6)

Built by Claude on lane `writes`. Kiro wrote none of this wave. No live model call was made.

### The build

| Task | Commit | What |
|---|---|---|
| W-187 | `3e06aeb` | Model polarity alone never removes an allergy rule. A denial removes a pending rule only on the answering turn, with a denial form in the quote and no allergy affirmed for that code in the turn (`writes/denial-words.ts`). Off an answering turn the pending rule is kept and asked about again (`isAllergy`). New property `polarity-never-removes`. |
| C1 | `81bc7d2` | The red properties: P5 and P6 worker halves, P7, P8, P9 and P11, driven by `testing/arb-corrections.ts`. |
| C2 | `330e386` | `correctionTargets` and `packetTargets` (extraction's `open` for the same snapshot, minus protected rows), entity labels by G7/G33 (`writes/entities.ts`), and `resolveMention` through `mentionName`. 8 cases in `onturn/context.test.ts`. |
| C3 | `c81234e` | The correct route in the turn's transaction (`onturn/memory-route.ts`, `executeOnTurn`). RX6 and the parse's correct and transition candidates open it; targets are re-read in the transaction; a moved target, an unseen same-key row, two targets or no usable answer defer. The reply's Head is compiled from the written rows. P8 and P9 green; 7 cases in `routes/turn.corrections.test.ts`. |
| C4 | `a7927f6` | The rename index (`writes/renames.ts`) in the Head, recall and extraction's `open`; `resolveMention` maps the new name to the entity and the old name, said after the rename, to a salted new entity. P11 green; 8 cases in `worker/extract.renames.test.ts`. |
| C5 | `86862d8` | Extraction honours `handled.keys` and `handled.refs`, takes `assertedAt` from the root Evidence, skips `negated` restatements, and never closes a later-asserted row (it writes `history` instead). P7, P5 worker and P6 worker green; 3 cases in `worker/extract.handled.test.ts`. |
| C6 | this commit | The checks below and this section. |

### Red first

| Property | Seed | Counterexample |
|---|---|---|
| W-187 `polarity-never-removes` | `1769163058`, path `435:0:1` | pending self peanut, nothing asked; "I can't eat peanuts, I'm allergic." with a denied item removed it |
| P7 | `-890287752`, path `71:1:1:1:2` | a value correction the route applied nowhere; extraction corrected the name row |
| P5 worker | `526688380`, path `0:0:1:1` | Alec corrected to Alexa; Alec came back active from Evidence asserted 12:01 |
| P6 worker | `1729967520`, path `1:0:1` | Alec then Alexa, the earlier job committed last; the current row moved to history |
| P8 | `1144980804`, path `0:0:1` | "No, her name is Maya, not Mara." The route wrote nothing |
| P9 | `1514352300`, path `1:0:1:1:1:1:1` | the Mara turn committed a correction with no note |
| P11 | `942852772`, path `0:0:1:1:1:1:1` | "Maya is the owner's sister." still said Maya after the rename to May |

### Rulings made here (named constants, fail closed)

- `ROUTE_ROWS_ROOT_AT_TURN_SLICE`: route rows are rooted at the covering turn slice, not the span slice. P8's root-key clause is stricter than the design's text and holds with this.
- The route acts only on targets that were in the FastSlots packet; correction targets go in the packet only when the correct route is known open when the call starts (RX6, or the parse was awaited).
- A turn that opened only the correct or transition route plans no allergy rule and leaves no hardRule `handled` entry (G38).
- Two speakable current names for one entity name nothing: its old-name lines are left out.
- A `wrong` row with no `validTo` negates every later restatement of its value.
- An item meeting a later-asserted row is written `history` even when it is a correction (a correction can't refute something said after it).
- The worker now reads the Memories on every job, since the rename index decides whose a name is.

### Changed assertions

- `writes/hard-rule.test.ts`, `writes/hard-rule.review.test.ts`, `routes/turn.rules.test.ts` (W-187): a certain denial off an answering turn now keeps the pending rule and asks again, instead of removing it.
- `worker/extract.fixture-clock.test.ts` (C5): `assertedAt` and `validFrom` are the root Evidence's; the owner's world clock is checked through `nextReviewAt`.

### Checks

`npx vitest run --maxWorkers=3`: 440 files, 3,889 passed, 34 expected fail. `npm run lint` (one existing web warning), `npm run typecheck` and `npm run build` exit 0. `apps/web` was not touched.

## Wave D: life changes (brief 025, tasks D1 to D4)

Built by Claude on lane `writes`. Kiro wrote none of this wave. No live model call was made.

### The build

| Task | Commit | What |
|---|---|---|
| D1 | `a358056` | P13 (`writes/transition-orders`) and P14 (`head-deceased`). P14 was red; P13 passed on its first run, since `applyTransition` was built in wave A. Its guard checks that more than 50 of the 1,000 runs reach real writes. |
| D2 | `0588f64` | The transition route. RX7 or the parse's transition candidate reads code's own truth-order targets (`truthOrderTargets`), kept out of the FastSlots packet. Hedged or uncertain changes are `careOnly`, and a change dated after now defers. No route note. A transition-only write under fastO writes no bundle (G1). Fail closed: an active row on a new row's key that the plan didn't read defers the change. 8 cases in `routes/turn.transitions.test.ts`. |
| D3 | `afbac92` | The Head's deceased join (G15). A current, eligible `person.life = deceased`, S2 included, moves every line naming that EID into `know`. P14 green. The `head.test.ts` witness: "Dad" and "my dad" are reached, "my father" is not. |
| D4 | this commit | The checks below and this section. |

### Red first

| Property | Seed | Counterexample |
|---|---|---|
| P13 | none | green on the first run (see D1) |
| P14 | `165581234`, path `0:1:0:0:0` | dad's active `person.life` is deceased (S0) with one relation line naming him; "The owner's dad is deceased." was in people |

### How "nothing cheerful afterwards" is reached

Only through the record. The death writes `person.life = deceased` and resolves dad's care rows, and the Head reads that truth. `moments/**`, `time/**` and the Gate were not touched. Moments or whispers that read the stored rows see `deceased` and `resolved` care. Whether delivery checks either is the lead's seam (see brief 025's report).

### Checks

`npx vitest run --maxWorkers=3`: 443 files, 3,901 passed, 34 expected fail. Lint (one existing web warning) and build exit 0. `npm run typecheck` fails on one line of the committed P13 file (D1's generator reads `value.code` on a `Value`). That file may not be edited under the brief's rule, so it is left for the lead.

### Live-check step for the owner (paid; needs your yes first)

Step 8 of the design's live list, not run: say "My dad passed away last night." Expect a care reply and no "saved", and no cut and restart on a fast-path take. The Memories should show `person.life` deceased. In the next call, nothing about him should be raised unprompted.
