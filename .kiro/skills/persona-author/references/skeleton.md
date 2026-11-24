# The time skeleton

Plan the days before you write a line. Every limb (bank, calendar, mail, turns) is laid out on the same table of day offsets, and the hero offer is arithmetic over two of them. Sources: `packages/server/src/seed/clock.ts`, `packages/core/src/patterns/takeout.ts` (`TAKEOUT_LATE_V1`), the comments in `packages/server/src/seed/persona/bank.ts` and `calendar.ts`, `apps/web/src/ui/visit/bolt-targets.ts`, `packages/server/src/bank/money-read.ts`.

## The clone's Friday and the window

- A visit starts on **the latest local Friday at 08:40**, in the visitor's own zone, at or before the real now (`cloneWorldStart`). That is `day 0, "08:40"`.
- `day` counts local days from that Friday: `-1` Thursday, `-3` the Tuesday before, `-21` three weeks back. A row at `at(-3, "20:40")` is the Tuesday evening before, whatever date that was.
- The **hero window** is `windowDays` local dates ending the day before the Friday: with `windowDays: 21`, days `-21` to `-1`. Rows on day `0` or later are not in it.
- Everything the persona knows is from before 08:40 on day 0: turns, mail, bank rows and the `at` of every calendar revision are on day `-21` to day `0` (day 0 only before 08:40). Calendar events may *start* later (a meeting on day 0 at 14:00, a report due on day 3).
- Rows outside the window (before day `-21`) are the safe place for a decoy that must be stored but never counted.

## What the visit bar's bolts jump to

The time bolt moves the world clock forward only, to one of four targets from the visit's current world time (`boltTargets`). From the clone's Friday 08:40 they are: **Today, 6 PM**, **Tomorrow, 9 AM**, **Thursday, 6 PM** (the next Thursday, six days on) and **Three weeks on** (exactly 21 days). The first stop is the one that matters for the hero: at 18:00 on day 0 a late meeting that evening makes tonight's takeout the next thing Franki can notice. Put at least one accepted, opaque meeting at or after 18:00 on day `0` (today) so the bolt has something to land on, and keep a meeting or two on days `1` to `6` so Thursday has company.

## The hero: `TAKEOUT_LATE_V1` thresholds

Franki offers "takeout on nights with late meetings" when all of these hold over the window (design `takeoutLateMeetingV1`, `TAKEOUT_LATE_V1`):

| Constant | Value | What it means for the table |
|---|---|---|
| `windowDates` | 21 | `windowDays` is 21 |
| `minCoveredDates` | 14 | at least 14 of the 21 dates have bank and calendar coverage. The load declares coverage complete over the window; also keep **at least 14 distinct dates with a bank row**, as the first persona does (18 of 21), so the check in `hero-check.ts` and the property tests agree |
| `minOrders` | 6 | at least **6 posted takeout orders** (`category: "takeout"`, not pending, purchase instant given) in the window |
| meeting | accepted, confirmed, opaque, timed, starting **at or after 18:00** local | `selfResponse: "accepted"`, `status: "confirmed"`, `transparency: "opaque"` (the default), start minute at least 1080 |
| order | takeout on a date that has such a meeting | counts as a late order |
| `mostly` | late orders are **a majority of both count and cents** of all takeout orders | `lateCount * 2 > ordersCount` and `lateCents * 2 > totalCents` |
| `night` | every late order was bought at or after 18:00 | otherwise Franki says "days", not "nights"; buy after 19:00 (the first persona buys after 20:30) |

The first persona's arithmetic, as its bank file records it: six posted takeout purchases of $30, $28, $34, $34, $24 and $36 (total $186); the first four ($126) on the four nights with an accepted, timed, busy meeting at or after 18:00, each bought after 20:30; 4 of 6 by count and $126 of $186 by cents. Write yours in the same words at the top of `bank.ts`: orders, total, late count, late cents, and the four or more dates.

For a rich persona the contrast is the joke, so keep takeout small and everything else enormous: takeout is the only category the hero reads, so large rocket-fuel rows (`other`) and large deposits do not move it.

## The decoys the first persona's comments record

Each is there to prove the detector counts only what it should. Keep the same kinds so the offer stays honest:

- **A pending takeout order** on a late-meeting night. A pending row inside the window makes the hero `partial` (it may still change), so the first persona puts its pending decoy at **day -22**, the night before the window, where it can be mistaken but never counted. Keep any pending row out of days `-21` to `-1`. Do not put a pending row at 00:20 today either: once the world clock passes midnight the sliding window reaches it (brief 036 finding 7; `seed/hero-jump.test.ts`). No takeout row on day `0` or later at all.
- **A restaurant dinner** (`category: "restaurant"`) on a night that has a late meeting. It is food, but not takeout, so it must not count as an order.
- **A declined late meeting** (`selfResponse: "declined"`) on a night with a takeout order. It must not make that night a late night. (The first persona has it on the $36 night, which is why that order is not late.)
- **An accepted early-evening meeting** (17:00) on a night with takeout, and **late meetings on nights with no takeout**. Neither adds a late order.
- **A refund** is a negative row on the same merchant; it nets against its order. The first persona has none; add one only if you want to test the netting.

## The world-clock ruling for a demo visit

Every other account reads its bank and mail against the real clock (ops clock), "as facts in real time". On a demo visit (spec kiroween-demo, Requirement 28) the money read and the mail and calendar errands take "now" from the **visit's world clock**, which starts at the clone's Friday 08:40 and moves only when the visitor presses a bolt or Start over. So:

- "**this month**" is the month of the world clock's date, and "**last week**", "**last 30 days**" and the rest count back from it. "**Today**" is the clone's Friday until a bolt moves it.
- The simulators lay every row out from the same Friday, so the persona's rows and the simulated bank's rows agree to the cent and to the minute.
- If the clone's Friday falls on the 1st to the 3rd of a month, "this month" holds only those few days. Put the rocket-fuel rows the demo asks about in **days `-1` to `-6`** *and* one on **day `0` before 08:40** (a non-takeout row, so the hero never sees it; it is stored posted on the next morning, which is fine for `read_money`). Then "how much did I spend on rocket fuel this month?" has an answer on every Friday of the year, with the late-month Fridays adding the rest.
- Put at least one event on **day 0** (today) so "what's on my calendar today?" has an answer, and one or two on days `1` to `6`.
- Freshness lines ("last read 5 minutes ago") and leases stay on the real clock; nothing in the persona controls them.

## A table to fill before you write

| Day | Calendar | Bank | Mail | Turns |
|---|---|---|---|---|
| -22 | pending decoy only | | | |
| -21 … -1 | late meetings (>= 18:00, accepted), decoys | takeout (posted, evening), decoys, groceries, rocket fuel, deposits | inbound, own sent, bulk | what Jeffrey told Franki |
| 0 (before 08:40) | | one rocket-fuel row | | |
| 0 (after 08:40) | an event today; a late meeting tonight | | | |
| 1 … 6 | one or two events | | | |

The bible (`docs/briefs/054-persona-bible.md`) holds the filled-in version. If a limb disagrees with the bible, the bible is right until it is corrected.
