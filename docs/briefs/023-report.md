# Brief 023 report: one-shot time (F6)

Built by Claude on lane `seed` (branch `lane/time`). The design note is `023-design.md`.

## Built, by task

1. **Design note**, in `023-design.md`. It covers the derive table, time only asks, the tick, the jump, the delivery order, the said match, the reminder, and 18 gaps.
2. **Derive** is pure, in `packages/core/src/moments/derive.ts`. It covers:
   - an occasion's wish and check-in;
   - the hero pattern's insight;
   - a loop's celebrate;
   - a dated fact's expiry ask;
   - a reminder's `commitmentDue`.

   A moment's ID is `H("moment", sourceId, kind, occurrenceKey)`. For an occasion, the source is the root of its `replacesIds` chain, so moving the occasion keeps its IDs. `merge.ts` rewrites only `pending` rows.
3. **Time can only ask**, in `moments/applicability.ts`. `appliesAt` is end-exclusive. Rules and allergies ignore `validTo`. A passed `validTo` derives an `expiryAsk` and never changes the Memory.
4. **The tick**, in two places:
   - `moments/tick.ts` is pure (`planTick`). It decides each moment by its own `dueAt`, and reports a window that passed as "opened, then closed".
   - `server/src/time/tick.ts` is `memoryTick`, which is what the brief calls `tickUser`. It writes moments only. Each open rereads the source and its deps, the blocks, `eligible` (purpose `proactive`) and the hold effects inside a transaction. A barrier skips the tick. `worker/tick.ts` calls it after `runDueJobs`.
5. **The jump**, `POST /api/seed/advance`, is in `routes/seed-advance.ts` with a thin adapter at `apps/web/src/app/api/seed/advance/route.ts`. It runs in this order:
   1. one transaction moves `worldClock` forward;
   2. a forced `memoryTick`;
   3. a complete `derive` Job citing the opened moments, plus the recorded response.

   It answers 423 under a barrier (`retryAfterMs` 1000), 409 for another clone and 400 for a backward jump.
6. **Delivery** is pure, in `moments/delivery.ts` (`chooseDelivery`). It applies quiet hours, a cap of 3 a day with 1 heavy, the session, idle and opening channels, and the two-turn rule for check-ins. `time/proactive.ts` puts the chosen moment on the wire as a `Proactive`:
   - a whisper worded by code;
   - a `proactive` Permit bound to its hash;
   - never S2.
7. **Said** is pure, in `moments/said.ts` (`matchSaid`). `time/said.ts` holds the server side:
   - `admitMoment` moves a moment from leased to admitted and counts it;
   - `recordSaid` sets `delivered`, `saidAt` and the match, plus a ledger `delivery` row, and only on a matching transcript.
8. **The reminder executor** is in `time/reminder.ts`:
   - `offerReminder` resolves the date with the pure resolver; words it can't resolve offer nothing;
   - `recordPendingRendered` records that the offer was shown;
   - `confirmReminder` answers `stale` with no rendered row and `clarify` on a hedge. A yes writes the `makeReminder` action and its `commitmentDue` moment in one transaction, and a retry writes nothing.

**Seed fix** (`2b397fc`, this lane's own seed). Purchase amounts were stored negative, and the pending decoy sat inside the hero window. Both fixes are listed as S-170 and S-171 below. On the seeded clone, the first tick now opens the interview wish (due 08:30) and the takeout insight.

## Seams: the exact call each route needs

| Route (not this lane's) | Call | Where |
|---|---|---|
| `routes/open.ts`, `routes/state.ts` | `const { choice, moments } = await chooseNow(ctx, mode, { transitionOrCrisis, turnsSinceCheckInAnswer })`. When `choice.spoken` is set, `proactive = await proactiveOf(ctx, choice.spoken.momentId, moments.get(id)!, stamp)`, and the result goes in `OpenResponse.proactive` or `StateResponse.proactive` | After the stamp is minted, before the response |
| `routes/receipt.ts` on `kind:"admitted"` | Inside its transaction, for each `momentIds[i]`: `admitMoment(tx, uid, momentId, responseId, deps.clock)` | Next to the permit's admission write |
| `routes/receipt.ts` on `kind:"transcript"` | Inside its transaction, for each `momentIds[i]`: `recordSaid(tx, uid, momentId, receipt, permit.kind, deps.clock, deps.hasher)` | After the transcript is stored |
| `routes/receipt.ts` on `kind:"pendingRendered"` | `recordPendingRendered(tx, uid, pendingId, opsNow, deps.hasher)` | Inside its transaction |
| Worker / `tickUser` | `memoryTick(ctx)`, already called from `startTick` in `worker/tick.ts` | Done |
| Tool or turn route for "remind me" | `offerReminder(deps.hasher, { sourceId, note, spoken, worldNow, zone })` to word the offer. Then, on the answer, `confirmReminder(ctx, offer, choiceId, turn)` | Behind its `reply` Permit |

## Properties, red first (each 1,000 runs)

| Property | Red seed | Counterexample, in short |
|---|---|---|
| Wish before the occasion, check-in after its end | 834169133 | A stub wish due at the start |
| A moved occasion keeps its moment IDs | 1332666938 | The stub keyed on the newest Memory |
| Nothing fires on an unresolved source | -260082784 | An occasion corrected to no time still opened |
| Time only asks | 1062013997 | Stub `appliesAt` |
| A jump opens what waiting opens | -1377457393 | The naive stub expired closed wishes without opening them. The first stub passed trivially, and I've recorded that as is |
| Caps and quiet hours | -1025543029 | A wish spoken at 00:00 |
| No row, no claim | -1004539745 | `saidAt` set on a pending moment |
| The jump route: monotone world, ops clock untouched, nothing under a barrier | -554877260 | A one-minute backward jump moved the world clock back. The route was written first, so this red ran with `planAdvance`'s checks removed |

## Not built

- `Proactive.cards` is always empty.
- The jump returns `proactive` and `deck` as null, so the browser reads the moment on its next state call.
- No route calls the seams yet.
- There are no Firestore indexes for moments.
- Not tested:
  - the Firestore emulator and live paths;
  - the tick at scale beyond the scan caps;
  - a DST day on the seeded clone.

## Contract questions

- **S-170:** purchase rows were stored as negative cents, and the hero detector reads positive cents. The seed now stores positive cents.
- **S-171:** a pending row inside the window makes the hero result `partial`, so the seed's decoy now sits at 00:20 on day 0, outside the window. Is a pending decoy meant to be visible to the hero?
- **S-172:** `Moment.occurrenceKey` is typed ID, but contracts call it the original civil start. It's stored as Civil.
- **S-173:** a reminder's moment has no `memoryId` or `rollupId`. I added `actionId`, so exactly one of the three is set.
- **S-174:** queries Q15, Q16, Q25 and Q35 have no declared index. The tick uses paged ID scans (Q28) filtered in code.
- **S-175:** there is no `pending` collection. Pending IDs are hashes, and rendering is a ledger `decision` row.
- **S-176:** `core/counters` has no proactive count, so `speech` stands in for it.

## Rulings needed (each is one constant or function)

Gaps 1 to 18 in the design note. The main ones:
- Wish timing: `WISH_EARLIEST_MINUTE` is 08:00, `WISH_LATEST_MINUTE` is 08:30 and `WISH_LEAD_MS` is 3 h.
- Check-in timing: `CHECKIN_AFTER_END_MS` is 3 h, `CHECKIN_DAY_MINUTE` is 18:00 and `OCCASION_DEFAULT_MINUTES` is 60.
- Quiet hours run from 21:30 to 08:00. A moment in quiet hours, or over the cap, is offered as a card only.
- Caps: `PROACTIVE_DAY_CAP` is 3, `HEAVY_DAY_CAP` is 1, and `HEAVY_GRAVITY` is 2.
- `OPEN_LEASE_MS` is 15 min, and `ADVANCE_RETRY_MS` is 1000.
- Scan limits: `MEMORY_SCAN_MAX` and `MOMENT_SCAN_MAX` are 2000. A full page of effects fails closed.
- Spoken lines are code templates in `moments/words.ts`.

## Hot files touched

These are additions only:
- `schema/records.ts`: the `Moment` block.
- `schema/wire.ts`: `SeedAdvanceRequest`/`Response` and `type Proactive`.
- `core/src/dates.ts`: `localMinuteAt`, `localMinuteOf` and `addCivilDays`.
- `core/src/index.ts` and `core/src/testing/index.ts`: one line each.
- `server/src/index.ts`.
- `worker/tick.ts`: one import and one `racing` line.

Outside the hot-file list:
- `store/paths.ts` and `store/checks.ts`, for the `moments` collection;
- this lane's own seed files.

## Checks

- `npx vitest run --maxWorkers=3`: exit 0. 341 files; 3491 passed, 20 expected fail (unchanged from the start's 20).
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, with one warning that predates this work (`avatar/three/brass.ts`).
- `npm run build`: exit 0.
