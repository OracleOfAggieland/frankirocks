# Brief 012: what the owner says sticks, on the turn (F3)

The judge and the slow parse are in the call (brief 011, wave A). A control hit on `hardRule`, `correct` or `transition` still does nothing of its own: the reply plays, and background extraction picks the turn up seconds later. Extraction can't write an allergy or a standing rule at all, and Franki tells the owner so. This brief builds the on-turn handlers: an allergy said by voice becomes a hard rule before Franki answers, a correction marks the old value wrong before Franki answers, and a life change the owner states updates the record on that turn.

This feature is built by Claude Code agents from this brief, not from a Kiro spec. The branch is `build/voice-writes`, cut from `build/voice-control`. It covers contracts §10 rows KC04, KS01, KS02 and KS06, and the hard-rule half of the Safety property family in spec §13.

Read first, in full:

- `docs/design/memory-spec-v3.md` §3 (the control turn and its route table), §4 (what gets written, the bitemporal rule, authority, the evidence ladder), §7 (life changes) and §13 (property families 2, 3 and 4).
- `docs/design/memory-contracts-v2.md` §1 (`core/rules`, memories, overlays, pending), §2 (Authority and Policy, in full), §3 (predicate taxonomy), §5 (the Execution table and `FastSlotsV1`), §7 (`applyCorrection`, `applyTransition` and their notes) and §10.
- `.kiro/specs/first-spoken-call/design.md` contract questions 34 to 44: how extraction handles corrections and changes today.
- `.kiro/specs/voice-control/design.md` rule rows and questions 87, 92 and 95, and `docs/briefs/011-review-live-run.md` for the measured numbers.
- `packages/core/src/extract.ts`, `packages/server/src/worker/extract.ts`, `packages/core/src/admission.ts`, `packages/core/src/intents/`, `packages/server/src/routes/turn.ts`, `packages/core/src/head.ts`.

## How the work runs

1. **Design note**, `docs/briefs/012-design.md`: every gap, ambiguity or conflict between this brief, the design docs and the code, each with the answer chosen; a Correctness Properties section; sequence diagrams for the three routes; the file plan for each wave; and "Contract questions" numbered on from 96 (the last question in `voice-control` is 95).
2. **Waves A to D**, in order. In each wave the properties are written first and run red, then the code is written, then the checks run and the wave is reviewed.

## What the owner should experience

- "I'm allergic to shellfish, and my brother's in trouble again." Franki answers both: it confirms the allergy is saved, in its own words and briefly, and it answers the line about the brother with care. From that turn on, the rule is in every reply's context.
- "I'm allergic to Mondays." No rule. Franki can laugh.
- "I think I might be allergic to something in that curry." No rule is invented. Food stays filtered until it's cleared up, and Franki asks one short question.
- "No, her name is Mara, not Maya." The reply already knows it's Mara, and so does every reply after it. Maya is never offered again, and never shows up as "used to be".
- "My dad passed away last night." Franki answers with care. The record changes on that turn, and nothing cheerful about him is raised afterwards.
- Franki never says something is saved, corrected or changed unless the write has committed.

## Lessons from brief 011 that are rules here

- **No assumed number decides a route before it is measured.** Contracts §5 gives `FastSlotsV1` 900 ms, assumed. The 350 ms assumed for `TurnIntents` was missed by 49 of 60 calls. Wave A builds the measurement. Until the owner approves a live run, every deadline is a named constant, and a slow or failed answer takes the safe path of its route.
- **A write follows validation; a cut follows `routeFires`.** Whether a reply already playing is cut is decided by `routeFires` (voice-control question 95). Whether a rule or a correction is written is decided by code validating the extracted item. The two are separate decisions.
- **Properties first, red first,** with the seed and shrunk counterexample recorded in the report before any fix. A committed property test is never edited to make it pass. If a property looks wrong, stop and report it.

## Scope

### Wave A: pure pieces, and the measurement

1. **Steering, as the first task.** `.kiro/steering/memory-writes.md`, `inclusion: fileMatch`, matching the extraction, intents, rules and turn-route files, under 80 lines, each rule with its contract section:
   - A correction marks the old value `wrong`. It never becomes history (spec §4).
   - Third-party and inferred text (classes T and M) never writes a rule, a preference, an identity or `life` (contracts §2).
   - A hard rule is added only from the owner's own direct words, for an item in the gazetteer, with its span as proof. It is removed only by a trusted tap. No model output, correction, change or forget removes one.
   - An unresolved allergy fails closed.
   - Models read, extract and word. Code validates spans, authority, subject, value and gazetteer before anything is written.
   - Nothing is called saved before its write has committed.
2. **The allergen gazetteer.** A closed, versioned table in `packages/core`: an ID, a label and aliases for each entry, covering the major allergens and the common specific ones a person would name. List it in full in the design note.
3. **`FastSlotsV1`,** as contracts §5 gives it: the request builder, the strict output schema and the parser, pure, in `packages/core`. The call goes through a port with a fake. The model comes from Model_Config.
4. **Validation,** pure: spans against the Evidence text, authority by source class, subject (self, one known entity, or ask), value, gazetteer, and `act` (only `direct` writes; quoted, hypothetical and uncertain never do).
5. **The bitemporal rule** of spec §4 as one pure function, and `applyCorrection` and `applyTransition` as contracts §7 gives them, each returning a plan and writing nothing.
6. **The Harness measures `FastSlotsV1`.** A `--fast-slots` option runs it on every line whose parse has `hardRule`, `correct` or `transition` at 0.20 or more, through a port that is fake unless `--live`. Per line: the time, whether the output was valid and why not, and the item kinds returned. In the summary: p50, p95 and largest time, the share over 900 ms, and, per control class, how many lines produced a valid item of the expected kind. No words from the owner's takes are stored.
7. **An extraction check on frozen lines.** 30 typed lines in a committed file, each with what it should and shouldn't write, and a script that runs `ExtractV1` on them through a port that is fake unless `--live`. Frozen before any run; a label is never changed because of a result.

The live Harness run is a paid call and waits for the owner's go-ahead. Nothing in this brief runs with `--live`.

### Wave B: allergies and hard rules

- On a turn where `hardRule` is a candidate, `/api/turn` runs `FastSlotsV1` before the transaction and validates its items.
- **An affirmed, direct allergy from the owner, for a gazetteer item and a resolved subject,** becomes an active rule in `core/rules` in the turn's transaction, with its span as proof and `rulesRev` raised. The Head compiled after it carries the rule for every audience.
- **Anything less** (an item outside the gazetteer, an unsure subject, `uncertain` polarity, a failed, slow or invalid `FastSlotsV1` answer) writes no rule. It writes the unresolved-safety filter contracts §1 describes, and Franki asks one short question from a code template. The next clear statement resolves it.
- **A denial** never removes a rule. A denial from the owner with no rule on record writes `noneConfirmed`, as contracts §5 says.
- The reply may carry one note that restates what the owner just said and what was saved. It is rooted in this turn's own span. Say in the design note how that note is allowed on a held turn without loosening any guarded property.
- The persona stops saying allergies can't be saved.
- The Debug_Panel lists the active rules with their proof spans. Removal stays in the "What I know" sheet and is not built here.
- Non-allergy standing rules are out of scope (contracts §10: later).

### Wave C: corrections

- On a turn where `correct` is a candidate, `FastSlotsV1` gets the turn and the candidate targets: the owner's eligible memories that the turn could be about, chosen by code the way extraction's gated `open` set is chosen today.
- A validated correction runs `applyCorrection` in the turn's transaction: the target `wrong`, the successor and its edge written, the bundle burned, the overlay added. A correction with no replacement only retracts.
- The reply is created from the new Head.
- **Extraction must not apply it twice.** After the on-turn route and the turn's Extract_Job have both run, the Memories are the same as after the on-turn route alone, for what the route handled. Extraction keeps doing what the route didn't handle.

### Wave D: life changes

- On a turn where `transition` is a candidate, a validated transition from the owner's direct words runs `applyTransition`: the truth orders of spec §7 for death, recovery, illness, breakup, reunion, move and the owner's own job change.
- The restraint orders of spec §7 that need moments or effects with no reader yet are listed in the design note with the feature that will build them. Don't build a writer with no reader.
- `uncertain` or hypothetical ("I might leave my job") changes nothing and gets a care reply.

## Properties to write

1. **Authority.** For any text of class T or M, and any `FastSlotsV1` output whatever, no rule, preference, identity or `life` is written.
2. **Only direct words write.** An item whose `act` isn't `direct`, or whose span doesn't match the Evidence text, writes nothing.
3. **A rule, once active, is in every Head** compiled afterwards, for every audience, through any sequence of corrections, changes, parses and audience changes, until a trusted tap removes it.
4. **Allergies fail closed.** On a `hardRule` candidate, every outcome is one of: a rule written, the unresolved filter written, or a denial recorded. Never nothing.
5. **An error never becomes history.** After `applyCorrection`, no sequence of later writes makes the corrected value current or `history`.
6. **A fact about the past never demotes the present.** An interval entirely in the past inserts as history and leaves the current value alone.
7. **No double apply.** The on-turn route followed by extraction equals the on-turn route alone, for what the route handled.
8. **Lineage.** Every rule and every successor resolves through its span to Evidence text that matches.
9. **Nothing is acknowledged before it commits.** No reply note says saved, corrected or changed for a write that isn't in the same committed transaction.

## Rules that apply here

- One commit per task, with a plain message. These commits are Claude's and never carry `Built-with: Kiro`.
- **No network call and nothing with `--live`.** No new dependency. No push or deploy.
- `docs/design/` is read-only. What can't be built as written goes under "Contract questions" in the design note, with the answer chosen and why.
- Every deadline is a named constant. Model IDs come from Model_Config.
- No probe line or frozen extraction line is relabeled.
- New state is explicit: a status or phase is a closed union with one pure function that decides every transition, never a set of loose flags.

## Out of scope

Forget. The company, quiet and alone routes. Food through `suggest`. Moments, wishes and check-ins. Non-allergy standing rules. Rule removal in the interface. Real mail, calendar and bank. The pending-question machinery beyond the one allergy question.

## Report

`docs/briefs/012-report.md` after each wave: what was built and where, the contract questions raised, every property that ran red with its seed and shrunk counterexample, what couldn't be checked, and the live-check steps for the owner.

## Checks before a wave is done

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` exit 0, and no command made a network call.
