# Brief 023 design note: one-shot time (lane `seed`, second stage, F6)

Built by Claude Code from brief 023, not from a Kiro spec. Sources: spec §5 (rows marked Floor), §6 as far as delivery reads it, §15 beats 1 to 3; contracts `moments`, `When`, `Time`, `CueTiming`, Clocks, `derive`, derive by kind, executors, Q09, Q15, Q16, Q35, `tickUser`, the receipt route and `said`, `POST /api/seed/advance`, KS03, KS04, KS09, KJ02.

Pure code is in `packages/core/src/moments/`. Server code is in `packages/server/src/time/` and `routes/seed-advance.ts`. Every threshold is one named constant in `moments/constants.ts`.

## 1. The derive table for the floor, as data

`DERIVE_FLOOR` in `moments/derive.ts`. A moment's ID is `H("moment", sourceId, kind, occurrenceKey)`.

| Source | Kind | Due | Close | Skipped when |
|---|---|---|---|---|
| Occasion (event Memory, `time.precision` instant) | `wish` | the later of 08:00 and the earlier of 08:30 and start − 3 h, local on the start's day | start | due ≥ start |
| Occasion, instant | `checkIn` | end + 3 h (end = `time.end`, else start + `OCCASION_DEFAULT_MINUTES`) | end + 3 d | never |
| Occasion, day only | `checkIn` | 18:00 local on the last day (`civilEnd` or `civilStart`) | the end of that local day + 3 d | never |
| Occasion, day only | `wish` | none: 08:00 is at or after the day's start (local midnight), so the rule skips it | | always |
| Hero pattern (`takeout_late_meeting_v1`, `eligible` and `mostly`) | `insight` | local midnight after the window's last date | due + 30 d | an insight for the same rollup is due within `INSIGHT_COOLDOWN_DAYS` (30) before it |
| Loop (`loop` Memory, state `waiting` or `eligible`) | `celebrate` | `checkAt` | `checkAt` + 7 d | at open, the predicate does not pass: the moment is `skipped`, silently |
| Bounded fact or preference (`validTo` set, not a rule) | `expiryAsk` | `validTo` | due + 30 d | the Memory is a rule or an allergy |
| Reminder (a ledger `makeReminder` action) | `commitmentDue` | the action's time: its instant, or `REMINDER_DAY_MINUTE` (09:00) local for a day | due + 30 d | |

Precision `month` or `range`, or `time: null`, derives nothing: no moment fires until its time resolves (KS03).

**Identity across a move.** An occasion's source is the root of its `replacesIds` chain among the event Memories read (`occasionRoot`), and its `occurrenceKey` is the root's `time.originalCivilStart`, else the root's first resolved `civilStart`. A moved occasion is a new Memory that replaces the old one, so its root, its key and therefore every moment ID stay the same. `mergeMoment` rewrites a pending moment's due time, close time, `scheduleRev` and note, and never touches a moment past `pending`: a `said` stays said.

## 2. Time can only ask

- `appliesAt(m, at)`: `[validFrom, validTo)`, end-exclusive. A rule or an allergy ignores `validTo` (a bounded fact never applies to `core/rules`).
- `softEffectAt(m, at)`: a soft preference's excludes apply only while `appliesAt`; after it they are `neutral`, never the opposite value.
- A passed bound derives one `expiryAsk` moment. Nothing in `moments/**` returns a Memory: the plan types have no Memory command, and the property checks that every Memory passed in is unchanged.

## 3. The tick

`planTick(moments, sources, worldNow, opsNow)` is pure. It returns transitions in the order (dueAt, momentId):

1. Q16: `leased` with `leaseUntil ≤ opsNow` goes back to `pending`, `attempts + 1`.
2. Q15: every `pending` moment with `dueAt ≤ worldNow`:
   - its source gone or ineligible: `cancelled` (`policy`, or `forgotten` when the source is blocked);
   - otherwise, when `dueAt < closeAt`, it **opens**: `leased`, a lease token, `leaseUntil = opsNow + OPEN_LEASE_MS`;
   - a celebrate whose predicate does not pass is `skipped` instead of opening;
   - then, if `closeAt ≤ worldNow`: a wish is `skipped`, anything else `expired`.
3. Q35: `admitted` with `closeAt ≤ worldNow`: `expired`.
4. A `leased` moment past `closeAt` is `expired` too.

A jump runs the same plan once at the new world time. Because each moment's open is decided by its own `dueAt`, and a moment that both opens and closes inside the jump is reported as opened and then closed, a jump opens the same moments in the same order as ticking each minute (the property).

**The server's transaction** (`time/tick.ts` `memoryTick`), one per transition: reread the moment (same status and rev), `core/epoch` (no barrier, or stop the whole tick), `core/state` (fixture world clock), the source Memory and its dependencies, the blocks and the effects on it, then `eligible` with a read context; write the moment. Before the opens, derive runs over the Memories read (paged by ID, at most `MEMORY_SCAN_MAX`; more and derive writes nothing that tick) and upserts the plans through `mergeMoment`, each in its own transaction.

Triggers: `startTick` (open, state, receipt) now also runs `memoryTick` in its scheduled part, under its once-a-minute gate. The advance forces one, past the gate. No cron.

## 4. The jump, step by step

`POST /api/seed/advance {requestId, fixtureNamespace, to}` in the idempotent mutation wrapper:

1. One transaction: read core. A barrier (forget or reset) answers BARRIER 423 with `retryAfterMs` `ADVANCE_RETRY_MS`; the browser's retry is the wait (ruling). Not a clone, or a stale namespace: STALE 409. `to` before the world clock: PARSE 400 (`planAdvance`). Then `setWorldClock`, which moves `core/state.worldClock` only.
2. The forced `memoryTick` at the new world time.
3. One transaction writes a `derive` Job, status `complete`, citing the opened moments, and records the response `{worldClock, jobId, proactive: null, deck: null}`.

The ops clock is never written. Facts and actions are not touched: the tick writes moments only.

## 5. Delivery order

`chooseDelivery(input)` is pure, one call per idle moment or session opening:

1. Held (reason code, nothing chosen): an `insight`, `celebrate` or `ask` in a session with a transition or crisis candidate (`transitionHold`), or within `CHECKIN_GAP_TURNS` (2) turns of a check-in answer (`afterCheckIn`).
2. Rank: `mustSay`, wish, check-in, ask, insight, celebrate, others; then `dueAt`, then ID.
3. Channel: an open session that is listening and silent for `IDLE_SILENCE_MS` (8 s) gets one `whisper`; an open session not idle gets nothing now (`notIdle`); a session opening gets one `opening` line; the rest go to at most two `card`s.
4. Speech limits (whisper and opening only): quiet hours `[21:30, 08:00)` local, `PROACTIVE_DAY_CAP` 3 a world day, `HEAVY_DAY_CAP` 1. A moment that would break one is offered as a card instead (`quietHours`, `dayCap`, `heavyCap`). `mustSay` passes all three, and a `deliveryOverride` passes only the limit it names.

Heavy (`isHeavy`): a moment whose source has gravity ≥ 2, or kind `griefAsk`, `transition` or `door`. mustSay (`isMustSay`): no floor kind is mustSay; the flag is an input for later kinds. The counts come from `core/counters` (`day`, `heavy`, and the `speech` count) through `countDelivery`, which the receipt seam calls when a proactive line is admitted.

## 6. The `said` match

`matchSaid(receipt, moment)`, contracts line 749. Nothing matches unless the receipt is `admitted` or `transcript` on an admitted response, and names the moment.

- `idTagged`: the receipt's `momentIds` name the moment and the transcript holds every one of its tokens.
- `exactTemplate`: the normalized transcript contains the moment's normalized template text.
- `candidateAndReason`: the transcript contains the candidate name and the reason substring (both must be non-empty).

`saidUpdate` returns `{saidAt, saidMatch}` only for an admitted receipt with a match; otherwise null, and `saidAt` stays null. The server's `recordSaid` writes the moment and a ledger `delivery` row in one transaction: no ledger row, no claim.

## 7. The reminder

`offerReminder` resolves the spoken day with `resolveSpoken`; unresolved words offer nothing. The offer's pending ID is a hash of the source, the text and the resolved time, so it needs no stored pending (as in brief 022). `recordPendingRendered` writes a ledger `decision` row keyed by the pending ID when the browser reports `pendingRendered`. `confirmReminder` runs only when that row exists, the choice is the offer's yes ID, and the owner's own final words are a plain yes (`isPlainYes`). Then one transaction writes the ledger `action` row (`makeReminder`, the audit entry) and the `commitmentDue` moment. Both IDs come from the pending ID, so a retry writes nothing new.

## 8. Gaps, and the answer chosen

| # | Gap | Answer (fails closed) | Where |
|---|---|---|---|
| 1 | No `moments` collection or record schema exists | Added: `Moment` in `records.ts`, the collection in `store/paths.ts` and `store/checks.ts` (outside this lane's hot-file list; listed in the report) | records.ts |
| 2 | `occurrenceKey` is typed ID, but contracts say it is the original civil start | Stored as the Civil string; the moment ID hashes it | `Moment` |
| 3 | A moment has `memoryId` xor `rollupId`, and a reminder has neither | A third source, `actionId`, and the xor is over three | `Moment` |
| 4 | An instant occasion with no end | End = start + 60 min (`OCCASION_DEFAULT_MINUTES`), so the check-in can't come while it's still on | derive |
| 5 | "A check-in never precedes its end" against 18:00 for a day-only date | For a day-only date the rule is the table's 18:00; the property checks instant occasions against their end, and day-only ones against their start | property |
| 6 | Local 08:00 inside a DST gap | Shifted forward by the gap's length (02:30 in a 02:00 to 03:00 gap reads 03:30); a repeated hour takes the first | `localMinuteAt` |
| 7 | What "open" is as a status | `leased`, with an ops lease (`OPEN_LEASE_MS` 15 min); an expired lease returns it to `pending` | tick |
| 8 | The jump "waits for a forget" | It answers BARRIER 423 with a retry hint; the client's retry is the wait | `ADVANCE_RETRY_MS` |
| 9 | A backward jump | Refused, PARSE 400; an equal `to` moves nothing and still ticks | `planAdvance` |
| 10 | No rollups collection | The insight's rollup ID is `H("rollup", "takeout_late_meeting_v1")` | derive |
| 11 | No pending collection | Pending IDs are hashes; rendering is a ledger `decision` row | reminder |
| 12 | Where a day's proactive count lives | `core/counters`: `speech` counts proactive lines, `heavy` heavy ones, both reset when `day` changes | `countDelivery` |
| 13 | A day-only reminder | Due at 09:00 local (`REMINDER_DAY_MINUTE`), as the commitment row's "due 09:00" | reminder |
| 14 | Spoken words for moments | Code templates in `moments/words.ts`: "Good luck at 2 PM: {value}.", "How did it go: {value}?" | words |
| 15 | Quiet hours or a cap | The moment is offered as a card, never spoken | delivery |
| 16 | The demo's "the takeout moment is due after the bolt" | The insight is due at local midnight after the window; ordering against the check-in is delivery's rank and the two-turn rule. The demo script (brief 029) decides the clock steps | report |
| 17 | Moments, effects and blocks have no declared index for the tick's queries (Q15, Q16, Q35, Q25) | Paged ID scans (Q28) filtered in code, capped (`MOMENT_SCAN_MAX`, `MEMORY_SCAN_MAX`); a full page of effects fails closed | `time/tick.ts` |
| 18 | A tick on a tenant with no core documents | Skipped (`noCore`), nothing written | `memoryTick` |

## Contract questions added by brief 036 (the review of this lane)

Each amends a ruling above, for the reading that fails closed. Each is the lead's ruling, for the owner to confirm.

- **S-177 (amends §5 step 1, finding 4):** crisis and transition are separate inputs. Crisis holds every candidate that is not `mustSay` (`crisisHold`), so no wish or check-in plays after "He didn't make it". A transition holds insight, celebrate, ask, expiry ask and now `griefAsk` (`transitionHold`). The older single flag `transitionOrCrisis` still reads and holds as both.
