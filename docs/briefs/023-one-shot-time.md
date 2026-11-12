# Brief 023: one-shot time (lane `seed`, second stage, F6)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This stage follows brief 019 in the same lane and builds on its fixture clock.

Spec §5 makes time a set of rows: a memory with a date derives moments, a tick opens the ones that are due, and delivery decides what Franki may raise and when. Today the pure resolver exists (`packages/core/src/dates.ts`, `resolveSpoken`), the clock pair exists, the job kind `derive` and the ledger's `makeReminder` executor are named in the schema, and nothing derives, ticks, jumps or delivers. This brief builds the floor's version: clear dates only, one-shot occasions, the two clocks, the jump, delivery, `said`, and the reminder.

## Read first

- Spec §5 (lines 168 to 194) in full; the rows marked Floor in its table are the scope. §6 lines 196 to 241 as far as delivery reads it. §15 beats 1, 2 and 3 (lines 468 to 470).
- Contracts: `moments` (lines 94 to 106), `When`, `Time`, `CueTiming` (21), Clocks (271), `derive` (813), `resolveTime` (815, 836), derive by kind (844 to 862), executors (866), Q09, Q15, Q16 (909 to 917), Q32 (934), Q35 (937), `tickUser` (955), the receipt route and `said` (742, 749), `POST /api/seed/advance` (746), and the IDs KS03, KS04, KS09, KJ02 (972 to 1007).
- `.kiro/specs/first-spoken-call/design.md` questions 7, 31, 39 and 40; `.kiro/specs/lab-ui-foundation/design.md` question 8.
- `docs/briefs/019-report.md` and `019-design.md` (your own lane's first stage).
- `packages/core/src/dates.ts`, `time.ts`, `clock.ts`, `schema/records.ts` (moments, ledger, jobs), `packages/server/src/core-docs.ts`, `worker/tick.ts`, `jobs.ts`, `routes/receipt.ts`, `state.ts`, `open.ts`.

## What to build

1. **A short design note,** `docs/briefs/023-design.md`: the derive table for the floor as data, the tick's transaction, what a jump does step by step, the delivery order, the `said` match, and every gap with the answer chosen.

2. **`derive`,** pure, in `packages/core/src/moments/`. For an occasion with a resolved time: a `wish` at the later of 08:00 and the earlier of 08:30 and start minus 3 hours, skipped at or after the start; one `checkIn` at end plus 3 hours, or at 18:00 for a day-only date. For a pattern: an `insight` once its detector passes, with a 30-day cooldown. For a loop: `celebrate` at `checkAt` if the predicate passes; a miss stays silent. A moment's ID comes from the memory, its kind and its original occurrence, so a moved occasion keeps its identity and its `said`. No moment fires until its time resolves. `prepare` and `ask` are not in the floor.

3. **Time can only ask** (spec line 190): a passed bound opens a question and never changes a belief. Applicability is end-exclusive. Expiring a soft constraint removes its effect without establishing the opposite. A bounded fact never applies to `core/rules`.

4. **The tick.** `memoryTick` opens due moments in leased transactions, rereading state, blocks, life and cooldown, for one owner: on open, on a jump, and at most once an ops minute from an open browser (`tickUser`). A session sweep repairs what a tick missed. No cron: `functions/` is not touched.

5. **The jump,** `POST /api/seed/advance` as the contract gives it, in a new route file: the world clock moves forward only, for one visitor; it waits for a forget in progress and answers 423 under a barrier; it forces a tick; it preserves facts and actions. `opsClock` never jumps. A jump is refused while a fence is up (KS09).

6. **Delivery,** pure: in an open session, a whisper at the next idle moment (listening and silent for 8 seconds); otherwise the next session's opening line, by priority `mustSay`, wish, check-in, ask, insight, celebrate, others; otherwise a card. Quiet hours 21:30 to 08:00. Three proactive a day, one heavy. No insight, celebrate or ask in a session with a transition or crisis candidate, or within two turns of a check-in answer. The output is a choice and its reason codes; putting it on the wire is the seam below.

7. **`said`** (contracts line 749): `saidAt` is set only from an admitted receipt whose transcript matches by `idTagged`, `exactTemplate` or `candidateAndReason`; otherwise it stays null. No ledger row, no claim. Build the pure match and its tests. Calling it from `routes/receipt.ts` is the seam below.

8. **The reminder executor:** "Want a reminder Thursday?" then "yes" writes a one-shot reminder moment through the ledger's `makeReminder`, with an audit entry, only after an explicit confirmation bound to a rendered pending ID.

## Seams, not edits

`routes/open.ts`, `state.ts` and `receipt.ts` are being changed by the writes lane. Do not edit them. Export the functions they will call (`tickUser`, the delivery choice as a `Proactive`, the `said` match) and write down, in your report, the exact call each route needs and where. A later brief makes those calls.

## Properties, red first

- **Nothing fires unresolved:** for any memory set, no moment with an unresolved time is ever opened.
- **A wish never follows its start,** and a check-in never precedes its end.
- **Identity is stable:** for any move of an occasion, the moment IDs and any `said` are unchanged.
- **The world clock only moves forward,** the ops clock is never changed by a jump, and a jump under a barrier changes nothing.
- **A jump equals waiting:** for any state, jumping to T opens the same moments, in the same order, as ticking minute by minute to T.
- **Caps and quiet hours hold:** for any day of due moments, delivery never chooses more than three proactive, more than one heavy, or any inside quiet hours, and `mustSay` is the only bypass.
- **No row, no claim:** `saidAt` is never set without an admitted receipt and a match.
- **Time only asks:** for any passed bound, no belief's value changes.

## Hot files this lane may edit

`packages/core/src/dates.ts`, `packages/server/src/core-docs.ts`, `worker/tick.ts` and `jobs.ts` (additions in their own blocks; the voice lane changed how the tick treats an open, so merge first and keep its fix), additions to `schema/records.ts`, `schema/wire.ts`, `testing/samples.ts` and the barrels. New: `packages/core/src/moments/**`, `packages/server/src/time/**`, `packages/server/src/routes/seed-advance.ts` and its thin route file. Not `routes/turn.ts`, `open.ts`, `state.ts`, `receipt.ts`, `admission.ts`, `head.ts`, `eligible.ts` or `functions/**`.

## Done

The pieces above with their properties green, the checks of brief 016, and `docs/briefs/023-report.md` with the seam list.
