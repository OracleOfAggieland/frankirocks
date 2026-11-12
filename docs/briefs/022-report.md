# Brief 022 report: the hero pattern, the loop and food (lane `hero`)

Built by Claude Code from brief 022, not from a Kiro spec. No commit here ends `Built-with: Kiro`. Design note: `docs/briefs/022-design.md`.

## Built, by task

1. **Design note:** `docs/briefs/022-design.md`, with 21 gaps and the answer chosen for each.
2. **The detector, `takeout_late_meeting_v1`:** `packages/core/src/patterns/takeout.ts`, with the row counting shared with the loop in `spend.ts`. It is pure, and its thresholds are in `TAKEOUT_LATE_V1`:
   - It counts posted bank purchases only. Receipts enrich a dated row's time and never add an order. A purchase's time comes from its own basis, never from the posting time or a mail date.
   - Meetings count when they are accepted, confirmed, timed and busy, starting from 18:00.
   - It needs 21 dates, at least 14 of them covered, and at least 6 orders. "Mostly" needs a majority of both count and cents. "Nights" needs an evening instant on every late order.
   - The output is `associationOnly`, with every cited ID.
3. **The words:** `patterns/words.ts`, the spoken template table. No server template table existed, and `copy.ts` holds screen copy only. Every line goes through `hasCausalWord` before it is returned.
4. **The loop:**
   - `planHeroLoop`: equal windows, the comparison starting the day after the yes, and `checkAt` at local midnight after the comparison window ends.
   - `loopPredicate`: computed from rows. A comparison is stated only when both windows have equal length, the same weekday mix, the same currency, full coverage and an unmoved baseline. It returns `categoryLess` for takeout and `netReductionScoped` for total food.
   - `loopStateAfter`: the state table.
5. **`celebrate`:** `celebration` gives words only for a closed loop with a fall. A miss, an incomplete loop, a cancelled loop and a loop that has already celebrated all stay silent.
6. **Food:** `packages/core/src/food/`.
   - An 18-recipe catalog with plain names and closed manifests, over a 55-ingredient table with gazetteer codes.
   - The filter runs in the design note's order. With rules unreadable, everything is removed. Unknown status is removed. Every rule that could cover an attendee filters, pending as if active, and a rule with no subject covers everyone. An unknown rule code removes everything. Excludes are removed last.
   - Code picks three quick dinners.
7. **Tool handlers:** `packages/server/src/routes/tool-food.ts`, with one dispatch line each for `suggest` and `answer` in `routes/tool.ts`.
   - `heroOffer` and `compareLoop` are left for brief 023 and the strip to call.
   - "Yes" writes a `makeList` ledger action and a `loop` Memory with lineage, once, after code checks the owner's own words.

## Properties, red first

Each ran red on a stub, then went green. Seeds are fast-check's own.

| Property | File | Seed | Shrunk counterexample on the stub |
|---|---|---|---|
| F1 zero hard-rule misses | `food/zero-hard-rule-misses.property.test.ts` | 764140416 | A place with no manifest came back |
| P1 detector numbers have sources | `patterns/takeout-sources.property.test.ts` | 53460513 | Cited rows' root keys were missing |
| P2 thresholds | `patterns/takeout-thresholds.property.test.ts` | 1920722248 | Empty rows; an offer line on an insufficient window |
| P3 never a cause | `patterns/never-cause.property.test.ts` | -867988675 | "You spent $0 on takeout because of meetings after 6." |
| P4 loop numbers have sources | `patterns/loop-sources.property.test.ts` | 851761491 | No rows; `beforeCents` 1 citing nothing |
| P5 equal windows | `patterns/loop-equal-windows.property.test.ts` | 882591240 | No rows; eligible an hour before `checkAt` |

Unit cases:
- The fixture ($186, four of six late orders for $126, then $71, "$115 less on takeout") is in `patterns/takeout.test.ts` and `loop.test.ts`.
- The 40 scripted food moments, plus the three dinners with no rules and with a shellfish rule, are in `food/food-moments.test.ts`.
- The route cases are in `routes/tool-food.test.ts`.

An independent read-only review found 11 issues. The ones fixed are in `ea5d4ca`:
- An empty manifest, or an unknown ingredient code, now counts as unknown status.
- Pesto now lists garlic.
- A pending purchase, an unposted purchase, or a refund that can't be netted yet now makes the result partial.
- A refund nets whatever its category, and only once per provider key.
- The yes now needs a final turn of class U, and hedged words count as no.
- The offer card now counts orders, not nights.

## Not built

- **The voice machine's tool list** still offers only `recall` and `make_phone_call` (`voice/**` isn't this lane's). `SUGGEST_TOOL` and `ANSWER_TOOL` are in `wire.ts`, ready to add.
- **Venues:** places from memory are always removed for unknown status. Venues are Later in KJ01.
- **Not stored:** rollups and candidate records (no collection, and `store/paths.ts` isn't this lane's), and the `pending/{id}` offer.
- **Not called yet:** nothing puts the offer on a moment or the strip (later briefs), and nothing calls `markCelebrated`.
- **Not tested:** fixture clock mode (`ownerClock` refuses it today), the Firestore emulator, and any live call.

## Contract questions

- **H-163:** two tool requests on one stamp with identical output collide on the seam's decision ID (`permitId` is hashed from the stamp, kind and payload). The second request gets STALE 409. A retried yes on a new request ID hits this. Proposed fix: include the request ID in the decision ID.
- **H-164:** the `suggest` result has no field for removed or held candidates. The removals are only logged.
- **H-165:** should a coconut rule follow tree nuts? The gazetteer keeps them apart, and so does the filter.
- **H-166 (brief 037, finding 2; amends "Attendee IDs come from the model"):** the food paths now filter by every stored rule of every subject, always (`FILTER_EVERY_SUBJECT` in `routes/tool-food.ts`). The model's `attendeeIds` may add to the set and never narrow it. The model never sees entity IDs, so "dinner for my sister" could not have named her. The cost is over-filtering: a partner's rule removes dinners the owner eats alone. For the owner to confirm, and one line to change when code resolves attendees.
- **H-167 (brief 037, finding 3; amends brief 022's ingredient table, where `known:true` claimed a complete profile):** an ingredient now has a `profile`. A prepared food whose makeup varies by brand is `varies`: it is tagged with the union of what it commonly holds, and any covering food rule removes a recipe holding it (reason `mayContain`). Absent means `complete`. Curry paste stays `known:false`. Does a `varies` food need a brand-level override later, so that someone with a sesame rule can have a bread they've checked?
- **H-168 (brief 037, finding 4; amends "`isPlainYes` decides"):** a yes is a whole utterance from a closed list (`PLAIN_YES_AFFIRMATIVES`, with at most one of `PLAIN_YES_TAILS`). It must also be the owner's next user turn after the offer's `pendingRendered` ledger row, recorded during this session. No record carries a session ID, so "during this session" is read from times: the session's `startedAt` is at or before the record, and no other user turn of the session committed at or after it, within the last `YES_LOOKBACK_TURNS` (32) turns. Should `pendingRendered` carry the session and turn instead?
- **H-169 (brief 037, finding 4):** nothing sends `pendingRendered` for the hero offer yet (it reaches no call until brief 030's second phase). Until something does, every hero yes in the app answers `clarify`. The tests and the beat 3 script record it as the receipt route would.
- **H-170 (brief 037, finding 6; amends "`EVIDENCE_SCAN_MAX` is 2,000 and `MONEY_ROWS_MAX` is 128"):** `EVIDENCE_SCAN_MAX` is now 50,000 and bounds the scan only. `MONEY_ROWS_MAX` (128 of each kind) counts rows after filtering to the window, the posting lag and the category. Evidence is still read by document ID because no index by kind exists, so a large account reads every page. Is an index on `kind` wanted?
- **H-171 (brief 037, finding 8; amends brief 022's spend rows, which left an unlinked negative row out):** an unlinked negative row in a counted category, posted on or after the window's first date, makes the result `partial`. One posted before the window can't refund a counted order and is ignored.
- **H-172 (brief 037, finding 10; amends brief 022's offer card):** the card's lines come from `heroOfferCardLines` in core, and every line passes the guard. The third line is now "Seen together in your own records, and nothing more". The card cites up to 32 sources (`CARD_SOURCES_MAX`) and then says how many more (`moreSourcesLine`). The yes is stale past 128 cited rows (`LOOP_CITED_MAX`), not cut. Meetings are cited once per provider key, lowest ID first.
- **H-173 (brief 037, finding 1; amends brief 022's yes, which wrote in its own transaction before admission):** suggest and the yes are checked again inside the tool route's admission transaction. `rulesRev` must equal the stamp's, and the dinners from the rules read there must be the ones answered. Otherwise the route is `Unrecorded` stale. The list and loop are created only after the Permit, with the stamp's epoch and policyRev. A proposal doesn't raise `rulesRev`, so the dinners comparison is what catches it. H-163 still applies: a retried yes on a new request ID gets STALE 409.
- **H-180 (brief 040, item 2; amends contracts line 761, where the model passes both IDs):** in a call, `answer` is a trigger and code decides. The tool shown to the model (`ANSWER_TOOL`) has no parameters, and the call sends `pendingId` and `choiceId` both null whatever the model wrote (`callToolArgs`). With both null, `answerTool` takes the offer brief 037's binding accepts for this turn (its `pendingRendered` row recorded in this session, and this the owner's next turn after it) and reads the choice from the owner's own final words: a plain yes (`isPlainYes`) is the yes, a plain no from the closed list beside it (`isPlainNo`, `PLAIN_NO_NEGATIVES`) is the no, and anything else, one null with one ID, or no offer bound to this turn is `clarify`. A card's tap still sends both IDs, and that path is unchanged. A reminder's offer is not answered through `answer` today (`confirmReminder` has no route caller), so the null path does not cover it. For the owner to confirm, with the no list.

## Rulings needed (each is one constant or function)

Gaps 1 to 21 in the design note. The main ones:
- **Windows and currency:** inclusive windows; coverage from both sources; `HERO_CURRENCY` is USD.
- **When the offer speaks:** no offer on a `partial` or not-mostly result. `POSTING_LAG_DAYS` is 5.
- **Who said yes:** `isPlainYes` decides.
- **Loop Memory:** class `C`, sensitivity `S1`.
- **Read limits:** `EVIDENCE_SCAN_MAX` is 2,000 and `MONEY_ROWS_MAX` is 128.
- **Attendee IDs** come from the model unresolved. Only `self` and rules with no subject are certain to apply.

## Hot files touched

All of these are additions only:
- `schema/records.ts`: a block at the end exporting `LoopWindow`.
- `schema/wire.ts`:
  - two new imports;
  - the `SuggestCall`, `AnswerCall`, `SuggestResult` and `AnswerResult` blocks;
  - two members added to each of `ToolCall` and `ToolResult`;
  - `SUGGEST_TOOL` and `ANSWER_TOOL`.
- `core/src/index.ts`: two barrel lines.
- `core/src/testing/index.ts`: one line.
- `routes/tool.ts`: one import and two dispatch lines.

`wire.test.ts`: the unknown-tool case now uses "connection", because "suggest" is a tool. I also added suggest and answer cases.

## Checks

- `npx vitest run --maxWorkers=3`: exit 0. 291 files; 3307 passed, 20 expected fail (unchanged from the start's 20).
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run build`: not run, because nothing under `apps/web` changed.
