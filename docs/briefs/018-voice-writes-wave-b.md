# Brief 018: allergies and hard rules on the turn (lane `writes`, F3 wave B)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Brief 012 built wave A of voice writes: the pure planners, `FastSlotsV1`, validation and the gazetteer. No route calls them. This brief builds wave B of that same brief: an allergy the owner says becomes a hard rule before Franki answers, and anything less fails closed. Brief 012 and its design note stay the source for what to build. This brief adds the rulings that open wave B and the order of work.

## Read first

- `docs/briefs/012-voice-writes.md` in full (wave B is the section "Wave B: allergies and hard rules").
- `docs/briefs/012-design.md`: sections 1 to 8 as far as they cover the hard-rule route, and section 9's wave B table (tasks B1 to B12, lines 1126 to 1141). That table is the task list.
- `docs/briefs/012-report.md` lines 160 to 208: what is open before wave B.
- `.kiro/steering/memory-writes.md` and `memory-rules.md`.
- Spec §3 lines 77 to 93, §4 lines 122 to 166. Contracts lines 256 to 269 (`core/rules`, `AllergyRule`), 275 to 338 (authority and policy), 441 to 459 and 612 to 638 (Execution, `FastSlotsV1`), 698 to 703, 720, 740 and 749.

## Task 0: close the three answering-turn items, red first

Before B1. Each gets a new property file, run red with its seed recorded, then the code. All three are in `packages/core/src/writes/validate.ts` (`namesNothing`, `allergyVerdict`).

1. **`namesNothing` reads the span as well as the item** (report item 1, fails open). Build what the report proposes: an asked rule is answered, or its code taken, only when every allergen alias in the span has its code; a generic noun names nothing only beside a pointer or quantifier; a cue-word item names nothing only when the cue has no object of its own in the span; an otherness word (other, another, different, else) makes the item name its own. The property's generator makes head-noun and cue-word items over spans holding another alias, an off-table word or "other".
2. **Echoes of the question** (report item 2, fails closed). Settle it in the same decision: an article, an intensifier or the question's own words in `item` name nothing of their own. The sentences the report lists become unit cases.
3. **A lent subject never outruns the words** (report item 3, fails open). Ruling for this build, for the owner to confirm: answering rule 2 lends the asked rule's subject only when the answer's span names no one (`namesSomeone` is false). When the span names someone, the subject comes from the words; if that is not the asked rule's subject, the asked rule is kept as it is. So "Not mine." about the brother's pending rule is a denial for `self` and the brother's rule stays.

**P4c is left alone.** Its written-out word list differs from the code (report, "Disputes"). It is a committed property and it is green. Do not edit it. The question of aligning its list stays with the owner; carry it into your report.

## Then B1 to B12, in order

As the design note's table gives them: the files, the dependencies and the witnesses. One commit per task. The properties of B1 run red first.

Rulings for this build, for the owner to confirm:
- **The 900 ms `FastSlotsV1` deadline and the speaker gate stay as named constants at their designed values.** Neither has been measured on a live call. A slow, failed or invalid answer takes the safe path of its route, as brief 012 says. The report repeats the three live-check steps the owner still owes before this goes to a deployed build.
- **No `--live` run.** Tune nothing against a model. `ExtractV1`'s frozen lines stay frozen.

## Hot files this lane may edit

This lane is the one writer on `packages/server/src/routes/turn.ts`, `open.ts`, `receipt.ts` and `state.ts`, on `packages/core/src/admission.ts` and `head.ts`, and on `packages/server/src/worker/extract.ts` for this wave. It also adds to `schema/records.ts`, `schema/wire.ts`, `testing/samples.ts`, `core-docs.ts` and the barrels (task B2), each addition in its own block.

It does not edit `packages/core/src/voice/**`, `eligible.ts`, `worker/tick.ts` or `jobs.ts`.

## Done

Task 0 and B1 to B12 with their witnesses, the checks of brief 016, and the wave B section added to `docs/briefs/012-report.md` (task B12 names that file; add a one-page `docs/briefs/018-report.md` that points to it and carries the rulings, the contract questions and the hot files touched).

If the whole wave does not fit in one run, stop at a task boundary with the tree green, and say in your final message exactly which task is next.
