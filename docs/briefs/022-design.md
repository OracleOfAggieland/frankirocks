# Brief 022 design note: the hero pattern, the loop and food

Lane `hero`, F7. Built by Claude Code from brief 022, not from a Kiro spec. Sources: spec §10, §9 (`celebrate`), §6; contracts `Observation`, `Loop`, `rollups`, `candidates`, the `suggest` tool, Money, KJ01 to KJ03.

Everything below is pure code in `packages/core` except the tool handlers in `packages/server/src/routes/tool-food.ts`. Every threshold is one named constant, so a change is one line.

## 1. The detector, `takeout_late_meeting_v1`

File: `packages/core/src/patterns/takeout.ts`. Constants: `TAKEOUT_LATE_V1` in the same file.

| Constant | Value | Source |
|---|---|---|
| `windowDates` | 21 | spec line 305 |
| `minCoveredDates` | 14 | spec line 305 |
| `minOrders` | 6 | spec line 305 |
| `eveningFromMinute`, `eveningToMinute` | 1080, 1440 (18:00 to midnight, end-exclusive) | contracts Money "Night=purchaseinstant[18:00,24:00)" |
| `meetingFromMinute`, `meetingToMinute` | 1080, 1440 | contracts Money "start[18:00,24:00)" |

**Inputs** (`PatternInput`): bank rows (evidence ID, root key, the `bank` Observation), receipt rows (evidence ID, root key, the `receipt` Observation), calendar rows (evidence ID, root key, the `calendar` Observation), the bank coverage and the calendar coverage (`Cov`), and the window (`fromCivil`, `toCivil`, `zone`, `currency`). The server reads these from Evidence; the detector never reads a store.

**Order of work.**
1. *Window.* The dates from `fromCivil` to `toCivil`, both inclusive, in the window's zone. Anything but 21 dates gives `insufficient`.
2. *Covered dates.* A date is covered when both coverages are `complete` or `partial`, both span the whole local day, and no missing range of either touches it. A day whose midnight the zone skips, or whose bounds can't be found, is not covered. Fewer than 14 covered dates gives `insufficient`.
3. *Bank rows that count* (`spendRows`, shared with the loop). Posted (`pending:false`, `removed:false`, `postedAt` set), the category asked for (`takeout` here), the window's currency, a positive amount. A second posted row with the same `providerKey` is dropped as a duplicate. A refund (`refundOfId` set, negative amount) nets against the order it names and is cited with it; a refund of an order that isn't counted is excluded. An order netted to zero or below is not counted.
4. *Purchase time.* Its own basis, never `postedAt` and never a mail date:
   - `providerAuthorized` with precision `instant` and an instant: the instant.
   - Otherwise a receipt enriches: `match:"exact"`, `bankEvidenceId` naming this row, an `orderAt`, and amount and currency equal to the bank row's when the receipt has them. Its `orderAt` is used as a `receiptMatched` instant, but only when it falls on the bank row's own civil date (if the bank gave one). A receipt never adds an order: a receipt that names no counted bank row is ignored.
   - `providerDate` with precision `day` and a civil date: the date, no instant.
   - Anything else is unknown. The row is excluded and the result is `partial`.
5. *Orders in the pattern.* Orders whose local date is in the window and covered. An in-window order on an uncovered date is excluded and makes the result `partial`. Fewer than 6 orders, or a total of zero or less, gives `insufficient`.
6. *Late-meeting dates.* Calendar rows with `status:"confirmed"`, `selfResponse:"accepted"`, `allDay:false`, `transparency:"opaque"`, and a local start in [18:00, 24:00) on a window date. Tentative, declined, unanswered, cancelled, all-day and free events never count.
7. *Late orders.* Orders on a late-meeting date. The unit is `night` when every late order has an evening local instant, else `day`. With no late orders the unit is `day`.
8. *Mostly.* `lateCount * 2 > orderCount` and `lateCents * 2 > totalCents`. A `partial` result never says mostly.
9. *Status.* `insufficient` as above; `partial` when any in-window row was excluded for time or coverage; else `eligible`.

**Output** (`PatternResult`, contracts Money, plus the cited IDs): `associationOnly:true`, status, unit, `totalCents`, `orderCount`, `lateCents`, `lateOrderCount`, `mostly`, the `Window` (its `purchaseIds` are every bank row counted, refunds included; `valueCents` is `totalCents`; `weekdayCounts` counts covered dates by weekday, Sunday first), `latePurchaseIds`, `meetingIds` (the late meetings on late-order dates), `receiptIds` (the receipts that enriched), `rootKeys`, `excluded`, `coveredDates`. `totalCents` is the sum of the amounts of `window.purchaseIds`; `lateCents` is the sum over `latePurchaseIds` and the refunds that net against them.

## 2. Words

File: `packages/core/src/patterns/words.ts`. This is the spoken template table: no spoken template table exists on the server today, and `apps/web/src/ui/copy.ts` holds screen copy only, so the spoken lines live in core beside the numbers they need. Every line is a code template; a model never writes a number.

- Offer (only `eligible` and `mostly`): "You've spent $186 on takeout in this window, mostly on nights with meetings after 6. Sources are on the card. Want three quick dinners for those nights, with groceries on your list?" With unit `day`: "days with meetings after 6" and "those days".
- Comparison (only `eligible`, `claim:"categoryLess"`): "Takeout's $71, down from $186 over the same three weeks." and "$115 less on takeout."
- Scoped total food (only when its own result is `eligible` on the same windows): "All food spending was $X, down from $Y over the same three weeks."
- Money: whole dollars as "$186", otherwise "$186.50". "Three weeks" when the window is a whole number of weeks, otherwise "{n} days".
- `CAUSAL_WORDS`: because, caused, cause, thanks to, won back, led to, due to, so you saved. `hasCausalWord` checks any line; every template is checked by a property.

## 3. The loop

File: `packages/core/src/patterns/loop.ts`.

**"Yes"** (`planHeroLoop`): from an `eligible`, `mostly` pattern and the world instant of the accepted action. Baseline is the pattern's window. Comparison is the same number of dates, starting the day after the accepted action's local date. `checkAt` is local midnight at the start of the day after the comparison window ends. `metric:"takeoutSpend"`, `predicateVersion:"takeout_late_meeting_v1"`, `state:"waiting"`. The comparison window's `purchaseIds` are empty and `valueCents` null until it is computed; its `weekdayCounts` are the calendar weekday counts of its dates.

**The comparison** (`loopPredicate`, contracts signature with bank rows, receipts and coverage): pure, from rows.
- A `cancelled` loop stays `cancelled`.
- Before `checkAt`: `waiting`.
- Both windows recomputed by `spendRows` over bank rows only (receipts enrich time and never add; the loop doesn't need time). The baseline's recomputed value must equal the stored `valueCents`, or the result is `incomplete`: the rows moved under it.
- Equal windows: same number of dates, same weekday mix (`weekdayCounts` of all dates equal), same currency, every date of both windows covered by bank coverage, no unknown-time or uncovered exclusion. Otherwise `incomplete`, which says nothing.
- `after < before`: `eligible`, `claim:"categoryLess"` (takeout) or `"netReductionScoped"` (total food), `deltaCents = before - after`. Otherwise `noChange`, silent.
- `rootKeys` cite every row in both windows.

**State** (`loopStateAfter`, a table): `waiting` → the predicate's status; `eligible` → `celebrated` only through `markCelebrated` after the line has played; `noChange`, `cancelled` and `celebrated` are terminal; `incomplete` gets one more review (`INCOMPLETE_REVIEWS = 1`), then stays `incomplete`.

**Celebrate** (`celebration`): a closed loop (`eligible`) with a good outcome gives the comparison line and the "less" line, kind `celebrate`. Any other status gives null. A miss stays silent. Brief 023's `derive` calls `loopPredicate` and `celebration` at `checkAt`.

## 4. Food

Files: `packages/core/src/food/ingredients.ts`, `catalog.ts`, `filter.ts`, `suggest.ts`.

**Ingredients.** A closed table: ID, plain label, allergen codes from the gazetteer, and `known:true|false`. An ingredient with `known:false` has unknown allergen status. Labels are generic ("rice", "soy sauce"), never brands.

**Catalog.** Recipes: ID, version, plain dish name, minutes, meal (`dinner`), the ingredient IDs (the closed manifest), `manifestVersion`. Each recipe's `allergenFlags` are computed from its manifest: `contains` for each code its ingredients carry, `unknown` when an ingredient isn't in the table or is `known:false`.

**Filter order** (`filterFood`):
1. No rules document: every candidate is removed, reason `rulesUnavailable` ("allergy data unavailable, recommend no food").
2. A candidate with any `unknown` flag, or any ingredient outside the table, is removed (`unknownAllergen`).
3. Every rule that could cover an attendee filters, whatever its state: an `active` or `pending` rule on an attendee, and every rule with no subject (anonymous or unresolved), which covers everyone. Attendees always include the owner.
4. A rule's code covers its own code and every code its gazetteer `includes` reach, transitively. An ingredient code conflicts when it is in that set, or when the rule's code is in the ingredient code's set (an ingredient flagged only "shellfish" conflicts with a shrimp rule). A rule code the gazetteer doesn't know removes every candidate (`unknownRule`). A known code outside the food domain (latex, pollen) removes nothing.
5. Excludes remove by candidate ID (`excluded`); the server writes them into the decision's `heldRefs`.
6. Places from memory: a place has no closed manifest, so its allergen status is unknown and step 2 removes it. Nothing claims a venue is safe. Venues are Later in KJ01.

**Pick** (`pickFood`): code picks. Kept recipes of the meal asked, at most `QUICK_DINNER_MAX_MINUTES` (30) for quick dinners, ordered by minutes then ID, the first `SUGGEST_MAX` (3). The first is selected. The reason is code: `fitsGap` with "Ready in {n} minutes". A model may only word the choice and that one reason.

## 5. Tool handlers

File: `packages/server/src/routes/tool-food.ts`, one dispatch line each in `routes/tool.ts`.

- `suggest` (`domain:"food"`): reads `core/rules`, runs filter then pick over the catalog for the attendees plus the owner, returns `candidateIds`, `selectedId`, `reason`, a food card with the ingredients, and coverage. Any other domain returns no candidates with coverage `unknown`. With no rules document it returns no candidates and the question "allergy data unavailable, recommend no food".
- `answer` (the hero offer's "yes"): the `pendingId` is the offer's ID (below). With `choiceId:"yes"` it reruns the detector on current Evidence; if the offer ID no longer matches, `stale`. Else, in one transaction: a ledger `action` row (`makeList`, the three dinners' groceries as items, `loopId`), and a `loop` Memory holding the `Loop`. Both IDs derive from the offer ID, so a retry writes nothing new. Any other choice is `declined` and writes nothing.
- `compareLoop` (the comparison): reads the loop Memory and the bank Evidence, runs `loopPredicate`, and on `eligible` returns the worded lines. Exported for brief 023's `derive`; it is not a voice tool, since the contract has no comparison tool.

## 6. Gaps and the answers chosen

| # | Gap | Answer (fails closed) | Where |
|---|---|---|---|
| 1 | Is `toCivil` inclusive? | Inclusive: 21 dates means from and to both count. | `windowDates` |
| 2 | Which coverage counts a date? | Both bank and calendar, whole day, no missing range. | `coveredDate` |
| 3 | An order on an uncovered date, or with unknown time | Excluded, and the result is `partial` (no "mostly", no offer). | `takeout.ts` step 5 |
| 4 | Is a tentative meeting "accepted"? | No: `status:"confirmed"` and `selfResponse:"accepted"` both. | step 6 |
| 5 | Does the offer play on a `partial` or not-mostly result? | No. Only `eligible` and `mostly`. | `heroOfferLine` |
| 6 | No `pending/{id}` collection exists, and `store/paths.ts` isn't this lane's | The offer's pending ID is a hash of the detector version, window and cited row IDs; the "yes" reruns the detector and must reproduce it. | `heroOfferId` |
| 7 | No `rollups` or `candidates` collection exists | The rollup isn't stored; the catalog is code. | report |
| 8 | Unknown rule code | Removes every candidate. | `filterFood` |
| 9 | Rule on a subject not attending | Doesn't filter. A rule with no subject filters for everyone. | `filterFood` |
| 10 | The voice machine lists only `recall` and `make_phone_call` | The server accepts `suggest` and `answer`; adding them to the Realtime tool list is the voice lane's (voice/** isn't this lane's). | report |
| 11 | Grocery items | The union of the three dinners' ingredient labels, sorted, at most 128. | `groceryItems` |
| 12 | Incomplete reviews | One more review, then it stays `incomplete` and silent. | `INCOMPLETE_REVIEWS` |
