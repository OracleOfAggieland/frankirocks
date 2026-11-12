# Brief 022: the hero pattern, the loop and food (lane `hero`, F7)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Spec §10 gives Franki's hero moment: it notices takeout spending against late meetings, offers three quick dinners, and three weeks on reports the number that changed. The `Loop` and `celebrate` shapes exist in the schema, and the hard-rule planners exist in `packages/core/src/writes/`. No detector, no loop logic, no recipe catalog and no food filter exist. This brief builds them as pure code with properties, and the tool handlers that call them.

## Read first

- Spec §10 (lines 301 to 309) in full, §9 line 293 (`celebrate`), §6 lines 196 to 241 as far as it covers what may be said about a pattern, §15 beat 3 (line 470).
- Contracts: bank `Observation` (line 23), `Loop` (82), `rollups` (164 to 170), `candidates` (233 to 240), the `suggest` tool (760, 764), `StripView` (706), the pattern and loop functions (829 to 830, 864), Money (870 to 876), Q12 (912), Q23 (924), Q24 (925), and the IDs KJ01, KJ02, KJ03 (972 to 1007).
- `.kiro/steering/product.md` (the hard rules of the product), `memory-writes.md`.
- `packages/core/src/writes/gazetteer.ts`, `rule-state.ts`, `hard-rule.ts`; `schema/records.ts` (`Loop`, rollups, candidates, the rules document); `packages/server/src/routes/tool.ts`; `packages/core/src/intents/` (the `food` and `answer` control classes).

## What to build

1. **A short design note,** `docs/briefs/022-design.md`: the detector's inputs and thresholds as data, the loop's window arithmetic, the catalog's shape, the filter's order, and every gap with the answer chosen.

2. **The detector, `takeout_late_meeting_v1`,** pure, in `packages/core/src/patterns/`. Exactly as spec line 305: bank-anchored posted purchases; receipts enrich and never add; purchase time has its own basis and precision, and a mail date alone never proves it; accepted, timed, busy meetings starting at or after 18:00; a window of 21 dates with at least 14 covered local dates and at least 6 orders; "mostly" needs a majority of both count and cents; "nights" needs an evening local purchase instant, and a date alone gives "days with meetings after 6". The output carries the numbers, the wording class, and the IDs of every source row. It is `associationOnly`.

3. **The answer.** The words for the offer come from a code template with the detector's numbers, in `apps/web/src/ui/copy.ts` or the server's template table, wherever spoken templates live today. No causal word: never "because", "caused", "thanks to" or "won back".

4. **The loop.** "Yes" writes the grocery list and `loop{metric, baseline, comparison, coverage, predicate, checkAt}`. Equal windows, same weekday mix. The comparison is computed, pure, from rows: with $186 before and $71 after it gives "$71, down from $186 over the same three weeks" and "$115 less on takeout". If total food spend also fell, that scoped number may be stated. A comparison without equal coverage says nothing.

5. **`celebrate`** on a closed loop with a good outcome. A miss stays silent.

6. **Food.** `suggest(food)`: open domain moments first; then real candidates from a recipe catalog with closed ingredient manifests, in `packages/core/src/food/`, plus places from memory. Removal by every attendee's rules and by excludes. A candidate with unknown allergen status is removed. A `pending` or unresolved rule filters as if it were active, for everyone it could cover. Nothing claims a venue is safe. Code picks; a model only words the choice and one reason. Three quick dinners for late-meeting nights must come out of the catalog for a person with no rules and for a person with a shellfish rule.

7. **Tool handlers** for `suggest`, the loop's "yes" and the comparison, in a new `packages/server/src/routes/tool-food.ts`, with one dispatch line each in `routes/tool.ts`.

The recipe catalog uses plain dish names and generic ingredients. No brand names.

## Properties, red first

- **Zero hard-rule misses:** for any attendees, any active, `pending` or unresolved rules and any catalog, no candidate `suggest` returns holds an ingredient any attendee's rule covers, and no candidate with unknown allergen status is returned. Also 40 scripted food moments as unit cases (spec line 303).
- **Every number has a source:** each number in the detector's output and the loop's comparison equals the sum of the rows it cites, to the cent.
- **Thresholds hold:** below 14 covered dates or 6 orders the detector returns nothing; "mostly" appears only with a majority of both count and cents; "nights" only with an evening purchase instant on every counted order.
- **Never a cause:** for any detector output and comparison, the worded line holds no causal word.
- **Equal windows:** the comparison is stated only when both windows have the same length and weekday mix and both meet coverage.
- **The fixture:** $30, $28, $34, $34, $24, $36 gives $186, four of six on late-meeting nights, $126 (a unit case, spec line 305).

## Hot files this lane may edit

`packages/server/src/routes/tool.ts` (dispatch lines only), `apps/web/src/ui/copy.ts` if templates live there, additions to `schema/records.ts`, `schema/wire.ts`, `testing/samples.ts` and the barrels. New: `packages/core/src/patterns/**`, `packages/core/src/food/**`, `packages/server/src/routes/tool-food.ts`. Not `routes/turn.ts`, `open.ts`, `admission.ts`, `head.ts`, `eligible.ts` (call it), `worker/**` or `packages/core/src/voice/**`.

Putting the pattern on a moment so Franki raises it at the right time, and the strip on screen, are later briefs. Leave clear functions for them to call.

## Done

The detector, the loop, `celebrate`, the catalog and filter, the tool handlers, the properties green, the checks of brief 016, and `docs/briefs/022-report.md`.
