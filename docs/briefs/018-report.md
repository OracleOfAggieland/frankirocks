# Brief 018 report: voice writes, wave B

Built by Claude on lane `writes` (branch `lane/writes`). Kiro wrote none of it. Build table, red seeds, checks and live-check steps: `012-report.md`, section "Wave B: allergies and hard rules".

**Built:** task 0 and B1 to B8, each with its witnesses.
**Not built:** B9 (repair and supersede), B10 (paste is T), B11 (Debug_Panel rules). **Next task: B9.** B12's checks were run at the B8 boundary and pass.

## Checks

- vitest, `--maxWorkers=3`: 295 files, 3,243 passed, 20 expected fails. The expected-fail count is unchanged.
- One voice property outside this lane failed once under load and passed 6 of 6 alone.
- lint: 0 errors. typecheck: 4 of 4 packages pass. build: not run, since `apps/web` is unchanged.

## Rulings needed

- **Unmeasured constants.** `FAST_SLOTS_DEADLINE_MS` (900) and the G19 speaker gate are still named and unmeasured. No `--live` run was made.
- **P4c's word list** still differs from the code. It was left alone, and the decision stays with the owner.
- **The contract questions below**, W-163 to W-176. Each is a ruling taken in the code, failing closed.

## Contract questions

| # | Ruling |
|---|---|
| W-163 | Wave B's state lives on `core/rules`, not where the design put it: `subjectLabels` replaces `AllergyRule.subjectLabel`, a `handled` ring replaces `WorkJob.handled`, `ask` replaces `Session.allergyAsk`, plus `proposals`. Session, WorkJob and `jobs.ts` have writers this lane can't edit. |
| W-164 | Task 0: on an answering turn, R's subject is lent only when the span names no one (`LEND_ONLY_WHEN_NAMES_NO_ONE`). The word sets are in `writes/names-own.ts`. |
| W-165 | A turn opened only by a parse candidate, with no RX4 sentence and no verified allergy span, is scanned whole for aliases (`cueSentenceRanges`). |
| W-166 | `planHardRule`'s ledger decisions aren't written as rows. The `handled` entry records the outcome and every code a denial named. Its `refs` stays empty, because `Ref` has no rule type. |
| W-167 | The backstop builds its pending rules itself rather than through `planHardRule`. A subject other than `self` is anonymous. There is a proof only when the quote names the code. |
| W-168 | The FastSlots packet sends no `lastTurns`. `pendingId` is the asked rule's ID, and `ownerConfirmed` is true for typed turns. |
| W-169 | A planned question counts as asked when the spoken transcript holds a "?" (`QUESTION_MARK`). Franki's own question counts when it is a question sentence with an RX4 word. |
| W-170 | The bundle's Head is compiled for the turn's effective audience, so a company turn hides pending subjects until the next compile. |
| W-171 | `TurnResponse.pendingId` and `question`, and `Turn.pendingId`, aren't set in wave B. |
| W-172 | The typed lines live in core `writes/notes.ts`. The line for `noneSaved` is "Saved.". |
| W-173 | The rules section's pending-line format differs from the design's example (`PENDING_PREFIX`). |
| W-174 | A turn that only applies open proposals raises the Deck and cuts (`committed`, `deckRaised`). |
| W-175 | Extraction's `handled` skip treats an anonymous rule key as covering any subject's item with that code. |
| W-176 | Bounds: 8 rules per proposal and 3 `handled` entries per Evidence. A ring of 16 is kept. At 16 proposals, a new one merges into the newest, and past 8 rules the anonymous `unresolved` rule stands in for the rest. |

## Hot files touched

- **Listed for this lane:**
  - `routes/turn.ts`, `open.ts`, `receipt.ts`, `state.ts`
  - `core/admission.ts`, `head.ts`, `worker/extract.ts`
  - added blocks in `schema/records.ts`, `testing/samples.ts`, `core-docs.ts` and the `writes` barrel
- **Outside that list, each named in the design's file plan:**
  - `server/admission/seam.ts` (B4's one call to `writeRule` and `admittedNotes`)
  - `core/extract.ts` (B8's skip reason `handled`)
  - `core/writes/not-allergy.ts` (W-165)
  - `docs/machines/` (the index row)
- **Not touched:** `voice/**`, `eligible.ts`, `worker/tick.ts`, `worker/jobs.ts`, `wire.ts`.
