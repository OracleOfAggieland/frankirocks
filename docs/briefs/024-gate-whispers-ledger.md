# Brief 024: the Gate, whispers and the ledger (lane `gate`, F11)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Spec §6 puts a pure function in front of every speaking model: the Gate decides what may be said unprompted, to whom, in what form. Today `compileHead`, `spokenGrade` and `effectiveAudience` exist, the Deck carries `whispers: []`, and the ledger records requests. There is no Gate, no `safeName`, no whisper is ever made, and the ledger does not record what was said, held, steered, declined or blocked. This brief builds those as pure code with properties. It tunes nothing against a live voice.

## Read first

- Spec §6 (lines 196 to 241) in full, the Head (99 to 120), permits and the ordinary turn (45 to 75), §9 line 297 (words), §5 line 194 (delivery).
- Contracts: Policy and `spokenGrade` (lines 301 to 338), the wire types (690 to 708), admission (710 to 720), `gate`, `eligible`, `spokenGrade`, `safeName`, `compileHead` (816 to 820, 834, 837), the ledger (153 to 162), session audience (134), and the IDs KC04, KC09, KV03, KV05, KV11, KV13 (972 to 1007).
- `.kiro/specs/first-spoken-call/design.md` questions 16, 17, 38 and 57; `.kiro/specs/voice-control/design.md` questions 87 and 95.
- `packages/core/src/head.ts`, `spoken.ts`, `eligible.ts`, `admission.ts`, `schema/wire.ts` (whispers, `Proactive`), `schema/records.ts` (ledger); `packages/server/src/audience.ts`, `deck.ts`, `head-build.ts`, `ledger/`.

## What to build

1. **A short design note,** `docs/briefs/024-design.md`: the ceiling table as data, the modifiers, the forms, the floors, the whisper's shape and bounds, the ledger rows, and every gap with the answer chosen.

2. **The Gate,** pure, in `packages/core/src/gate/`. Its input is a candidate thing to say (a memory or moment with its class, sensitivity, source, age and topic state), the audience, the session's recent turns, and the day's counts. Its output is `say`, `card`, `hold` or `silent`, the form (item, named check-in, door, use), and reason codes. It implements:
   - The ceiling table of spec lines 202 to 206, cell by cell, as data.
   - Audience, where modifiers only subtract: company, unknown, rushed and crisis, as lines 210 to 214 give them.
   - "Asked" decided by code (line 216): a recall result counts as asked only if the owner's own words this turn hold a query alias or term and the speaker is certain.
   - The floor build's S2 rule: S2 stays off the wire (line 218), except the logged carve-outs of the spoken-grade test (line 120).
   - Doors (line 220): a door opens only on a term match or `opens(label)` on the owner's words in that turn.
   - Floors (line 224): `mustSay` for a hard-rule conflict, a commitment due within 24 hours and critical logistics; the warmth floor is not in this brief.
   - It fails quiet. For hard rules it fails closed: with rule data unavailable, the output is the fixed line "allergy data unavailable, recommend no food".
   - "Don't bring it up" always wins over an authorization.

3. **`safeName`** (spec line 118): 40 characters, 4 tokens, letters and `'-.` only, otherwise "a sender". Pure, with the injection case from the spec as a unit test.

4. **Whispers.** A whisper is made by code from one note's tokens and can add no fact (spec line 297): a builder that takes one Gate-approved candidate and returns the note the Deck carries, with its ID, its tokens and its expiry. Templates for third-party renders, S2 renders, controlled acknowledgments and clarifications. A check that a spoken line added no fact a note did not hold: pure, token-based, for use on transcripts.

5. **The ledger.** Rows for said, held, steered, declined and blocked, as IDs and reason codes, never words. A pure reader for "Why did you bring that up?" that answers from a row, and answers nothing without one. Questions 16, 17 and 57 say the stored ledger lacks fields for the issuer, the permit kind, the verdict and a false hold: add them as optional fields with a defaults read, in their own block.

## Seams, not edits

`packages/core/src/head.ts`, `admission.ts` and `packages/server/src/routes/**` are being changed by other lanes. Do not edit them. Export what they will call (the Gate, `safeName`, the whisper builder, the ledger writers) and list in your report the exact call each needs and where: `compileHead`'s third-party labels through `safeName`, the Deck's `whispers`, the turn and receipt routes' ledger rows. A later brief makes those calls.

## Properties, red first

- **Subtract only:** for any candidate, narrowing the audience never turns a `silent`, `hold` or `card` into `say`.
- **The ceiling holds:** for any candidate, the Gate's output is never more open than its cell of the table.
- **S2 stays off the wire** in the floor build, outside the three logged carve-outs, for any input.
- **Third-party and inferred text is never said unprompted as fact:** a class T or M candidate is `say` only in the attributed or offer forms its cell allows.
- **Hard rules fail closed:** with rule data missing or unreadable, no food candidate is `say`.
- **A whisper adds nothing:** every token of a built whisper comes from its one note or a fixed template.
- **`safeName` is total and closed:** for any string, the output matches the allowed pattern or is "a sender".
- **No row, no claim:** the "why" reader returns nothing for an ID with no ledger row.
- **Quiet wins:** a topic marked "don't bring it up" is never `say` or `card` unprompted, whatever authorization exists.

## Hot files this lane may edit

`packages/server/src/deck.ts` and `audience.ts` (additions in their own blocks), additions to `schema/records.ts`, `schema/wire.ts`, `testing/samples.ts`, `core-docs.ts` and the barrels. New: `packages/core/src/gate/**`, `packages/core/src/safe-name.ts`, `packages/core/src/whisper/**`, `packages/server/src/ledger/said.ts`. Not `head.ts`, `admission.ts`, `eligible.ts` (call it), `spoken.ts` (call it; if it looks wrong, report it), `routes/**`, `worker/**` or `packages/core/src/voice/**`.

## Not in this brief

Persona tuning and whisper quality on a live voice (the plan's early sign for F11 is measured on live calls). The warmth floor and the on-screen ask are later additions.

## Done

The pieces above with their properties green, the checks of brief 016, and `docs/briefs/024-report.md` with the seam list.
