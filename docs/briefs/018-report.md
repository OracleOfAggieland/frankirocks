# Brief 018 report: voice writes, wave B

Built by Claude on lane `writes` (branch `lane/writes`). Kiro wrote none of it. Build table, red seeds, checks and live-check steps: `012-report.md`, section "Wave B: allergies and hard rules".

**Built:** task 0 and B1 to B12, each with its witnesses. The lane merged `build/plan-stages` (`d4c3b32`) at `21a7f7e` before B9; the one conflict, two added rows in `docs/machines/README.md`, kept both.
**Not built:** nothing in the wave's table. Still open: the items under "Not built" in `012-report.md` (the typed path's first reply, proposals on a turn with no route), and the in-call paste gap below.

## Checks

Run Nov 12 at `36f682d`, one at a time:
- vitest, `--maxWorkers=3`: exit 0, 349 files, 3,558 passed, 0 expected fails (the voice lane fixed all 20 before the merge). After the merge, before B9: 347 files, 3,540 passed.
- lint: exit 0, 0 errors, plus 1 warning in `apps/web/.../avatar/three/brass.ts` that this lane didn't cause.
- typecheck: 4 of 4 packages pass.
- build: exit 0. `specimens-absent` and `three-chunk-check` pass.
- `copy-check`, `token-check` and `ui-boundaries`: exit 0.
- No committed `*.property.test.ts` was edited. B9 to B11 add no property, since their witnesses in the design's table are unit cases. Each new case was run against the code without its task's change and failed (B9: 5 cases; B10: the route case), then passed with it.
- One existing test changed its count: `DebugPanel.test.tsx` expected 12 calls for two loads of six sections. It now expects 14, for seven sections.

## Rulings needed

- **Unmeasured constants.** `FAST_SLOTS_DEADLINE_MS` (900) and the G19 speaker gate are still named and unmeasured. No `--live` run was made.
- **P4c's word list** still differs from the code. It was left alone, and the decision stays with the owner.
- **The contract questions below**, W-163 to W-180. Each is a ruling taken in the code, failing closed.

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
| W-177 | B9: a late route (supersede or repair) never answers the open question (`LATE_ANSWERS`), so it lends no subject and closes nothing. A supersede opens on RX4 or a parse candidate only. |
| W-178 | B9: a repair's proposal only adds rules. A late denial, or a pending rule the plan would make active, changes nothing; it plans no question. Subject labels it learns are written at once (they raise no `rulesRev`). |
| W-179 | B10: once a paste has put words in the box, the line is pasted until the box is cleared (`PASTE_STICKS_UNTIL_CLEARED`). The call's typed line goes through the voice machine, which can't carry `pasted` (`packages/core/src/voice/**` is not this lane's), so a pasted line is held back during a call with `COPY.typed.pastedInCall`. The voice lane should add the source to `typedSubmitted`. |
| W-180 | B11: the Debug section `rules` is one item of kind `rules` with the whole `core/rules` and a `proofs` list, not one `rule` item per rule with a page field `rules` as the design has it. |

## Hot files touched

- **B9 to B12 (this run):** `routes/turn.ts` (`postSupersede`, one block), `intents/repair.ts` (one call after the lease), `schema/wire.ts` (the `rules` section and item, added blocks), `apps/web` `App.tsx`, `TypedLine.tsx`, `TypedInput.tsx`, `ui/copy.ts`, `client/typed-turns.ts`, `client/debug-panel.ts`, `DebugPanel.tsx`, `server/turns.ts` (`classifyTurn`), `routes/debug-memory.ts` (one case). New: `onturn/late.ts`, `routes/debug-rules.ts`.
- **Listed for this lane:**
  - `routes/turn.ts`, `open.ts`, `receipt.ts`, `state.ts`
  - `core/admission.ts`, `head.ts`, `worker/extract.ts`
  - added blocks in `schema/records.ts`, `testing/samples.ts`, `core-docs.ts` and the `writes` barrel
- **Outside that list, each named in the design's file plan:**
  - `server/admission/seam.ts` (B4's one call to `writeRule` and `admittedNotes`)
  - `core/extract.ts` (B8's skip reason `handled`)
  - `core/writes/not-allergy.ts` (W-165)
  - `docs/machines/` (the index row)
- **Not touched:** `voice/**`, `eligible.ts`, `worker/tick.ts`, `worker/jobs.ts`, `MainScreen.tsx`.

## Not tested

- No live call, no browser. The paste event (B10) and the "Hard rules" box (B11) were tested only through rendered markup and the routes on the fakes, never in a real browser.
- A supersede and a repair carrying an allergy were tested on Fake_FastSlots and the scripted Decisions fake only. The three live-check steps in `012-report.md` are still owed before wave B goes to a deployed build.
