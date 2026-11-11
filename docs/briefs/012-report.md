# Brief 012 report

Report for `docs/briefs/012-voice-writes.md`, by wave. Section and row numbers are the design note's (`docs/briefs/012-design.md`).

## Wave A

### Properties run red

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
