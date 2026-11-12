# Brief 037: review of the hero, the loop and food, and its fixes (lane `fix6`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the hero lane's work (brief 022, merged as `737ff7c`) as it stands today. It confirmed most findings by running a throwaway test and the rest by reading. Its findings are below as it gave them. Two of them put an allergen on the grocery list. The product's rule is that allergies are hard rules, in every food path, for every attendee, failing closed.

Where a finding and a ruling of brief 022 disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**1. High, confirmed by a run. The grocery list is written before admission, against rules read earlier.**
- Files: `packages/server/src/routes/tool-food.ts` lines 322 and 330 to 354, called from `routes/tool.ts` line 170. `answerTool` reads the rules outside its write transaction and builds the dinners from that read. It then commits the ledger `makeList` row and the loop Memory without checking `rulesRev` again. Inside the transaction it reads `readCoreDocs(tx)` (line 333) and never uses `core.rules`. All of this commits before the admission transaction in `tool.ts` line 173 ("nothing dispatches before admission").
- Input: the hero fixture, the turn "Yes, let's do it". Between the rules read and the write, an egg rule on `self` is written.
- Wrong result: the route answers `status:"stale"` with `result:null`, yet the ledger row exists and its items include "eggs" (the veggie omelet is the first pick). The list holds an allergen of an active rule, and Franki cannot say it was written.
- Fix: the write happens inside the admission transaction, after the Permit is issued. In that transaction the rules are read again, `rulesRev` must equal the stamp's, and the dinners are computed from the rules read there.

**2. High, confirmed by a run. The hero's dinners filter only the owner's rules.**
- File: `tool-food.ts` line 322, `suggestFood({ rules, attendeeIds: [] })`. An empty attendee list is read as "only the owner": an active egg rule on a partner still returns the veggie omelet, and the list includes "eggs". At line 234, `suggestTool` takes `args.attendeeIds` from the model as given, so a guest the model leaves out ("dinner for my brother") is not filtered.
- Ruling: for this build the food paths filter by every stored rule of every subject, always. Nobody on the server knows who is at the table, and over-filtering is the safe error. One named constant, with a test, so that it is one line to change when attendees are resolved by code. The model's `attendeeIds` may add to the set and never narrows it.

**3. Medium, confirmed by a run. Pesto lists only pine nut.**
- File: `packages/core/src/food/ingredients.ts` line 69. Store-bought pesto often uses cashews or walnuts. With rules `egg` and `cashew` on `self`, `suggestFood` returns the pesto pasta and "basil pesto" goes on the card and the list.
- The same class, confirmed for sesame: bread (line 35) is tagged `wheat, yeast` only, and generic bread often holds milk, egg, soy or sesame. Flour tortillas and wheat pasta have the same exposure. Every `known:true` row claims a complete profile over all food codes (alcohol in soy sauce, dye in cheddar, sulphites), so those rules remove nothing.
- Ruling: a prepared food whose makeup varies by brand never claims a complete profile. It is tagged with the union of the allergens it commonly holds and marked so that any rule it cannot rule out removes it. Whole, single-ingredient foods keep `known:true`. After the change, the seeded persona with a shellfish rule, and with an egg rule, must still get three dinners. If the catalog runs short, add recipes made of whole ingredients.

**4. Medium, confirmed by a run. `isPlainYes` accepts hedges and deferrals.**
- File: `packages/core/src/patterns/offer.ts` lines 22 to 33. These return true: "Okay, I'll think about it", "Sure, tell me more first", "ok what are they", "Do it tomorrow", "Yeah right", "sure, after I check with Sam", "Yes. Actually, hmm". The yes is bound only to a `pendingId` the model supplies, not to the offer being the last thing asked, so a "yes" to a later question would write the hero's list.
- Ruling: a yes is one of a short closed list of whole utterances (an affirmative, with at most "please", "thanks" or "let's do it"), with nothing left over. The server records that the offer was presented in this session, and the yes must be the owner's next turn after that record. Anything else is not a yes, and Franki may ask again.

**5. Medium, by reading. `suggest` and `answer` are not offered to any model.** `packages/core/src/voice/machine.ts` offers recall and phone only, and `typed-reply.ts` phone only, so the filter is not on the path of what Franki says about food. Brief 030 wires this in its second phase. Nothing to do here but keep the handlers' names.

**6. Medium, by reading. The hero's rows are capped across all history.** `tool-food.ts` line 138: `MONEY_ROWS_MAX = 128` counts every bank, receipt or calendar row ever, and `EVIDENCE_SCAN_MAX = 2000` (line 99) every Evidence of any kind. Past 128 bank rows, `heroOffer` and `compareLoop` return null for good, so a real account loses "$71, down from $186".
- Fix: the caps apply after filtering to the window (plus the posting lag) and to the category.

**7. Low to medium, confirmed by a run.** A pending refund that later posts makes the result partial for good: `packages/core/src/patterns/spend.ts` lines 104 to 107 put a pending refund in `looseRefunds` even when a posted refund supersedes it. Fix: skip a superseded pending refund, as purchases already do.

**8. Low to medium, confirmed by a run.** An unlinked refund is dropped without a flag: `spend.ts` line 122 excludes a negative takeout row with `refundOfId:null`, and the result stays `eligible` at $186 while the net spend is $156. Ruling: a negative row in a counted category with no link makes the result partial. It is never silently left out.

**9. Low, by reading.** The offer ID (`offer.ts` lines 17 to 20) hashes neither the receipt IDs nor the association unit, the late count or `mostly`. A receipt arriving between the offer and the yes can change "days" to "nights" without making the offer stale. Fix: hash them.

**10. Low, by reading.** The card's sources are cut to 32 and `supportingIds` to 16 without saying so, so with many orders the cited rows are no longer one for one with the counted rows. Two rows for one evening meeting are both cited. The card's third line, "A pattern in your own records, not a cause", holds a word from the product's own list of causal words and is not passed through the guard.
- Fix: the card cites every counted row or says how many more there are, and the count it states matches. Meetings are cited once per provider key. The line is reworded with no causal word, and every card line passes the guard.

**11. Low, by reading.** The food paths do not read rule proposals (`tool-food.ts` lines 207 to 214): a late repair or backstop rule in `core/rules.proposals` is not applied. Fix: the rules the filter reads include every proposal's rules.

**What the oracle and the properties miss.** The allergen oracle reads the product's own ingredient table and catalog, so a mis-tagged ingredient is invisible to it. The property "zero hard-rule misses" tests only the pure `suggestFood`. The 40 moments list forbidden ingredients by hand, but none lists bread for sesame, milk or egg, or pesto for cashew, walnut or almond. Money property 1 checks only that the detector agrees with itself; property 2 asserts `orderCount <= keys.size`, not equality; the generators never produce a pending row with its posted row, a pending refund or an unlinked negative row; property 3 checks the spoken lines and not the card.

## New properties

In new files beside the existing ones:

1. **No allergen on the list, on the server path.** For any stored rules on any subjects (active, pending, proposed, unresolved), and any interleaving of a rule write with the yes: no dinner, no list line and no card line holds an ingredient that conflicts with any stored rule, and a list is written only inside an admitted turn. Its oracle is a hand-written table of prepared foods and what they commonly hold, kept in the test folder and independent of the product's ingredient table.
2. **The ingredient table is at least the oracle.** For every ingredient in the product's table that the hand-written oracle names, the product's tags are a superset of the oracle's.
3. **The detector against a reference.** A small, slow, obviously correct reference implementation in the test folder computes the orders, the totals and the late nights from the raw rows; the detector's cited set, counts and cents equal it, for generated rows that include pending rows with their posted rows, pending and posted refunds, unlinked negative rows and duplicates.
4. **Only a plain yes is a yes.** For any utterance outside the closed list, including any plain yes followed by more words, `isPlainYes` is false. A yes that is not the next turn after the offer was presented writes nothing.
5. **No causal word on any line.** Every spoken line and every card line of the offer, the comparison and the celebrate passes the guard, for any numbers.

## How to work

Core first, where no other lane is writing: findings 3, 4 (the closed list), 7, 8, 9 and the wording of 10, in `packages/core/src/food/**` and `packages/core/src/patterns/**`, with properties 2 to 5. For each: the failing test first (the reviewer's input, and the new property red with its seed and counterexample recorded), then the smallest fix, one finding per commit.

Then the server findings: 1, 2, 4 (the binding to the presented offer), 6, 10 (the sources) and 11, in `packages/server/src/routes/tool-food.ts` and `tool.ts`, with property 1. The wiring lane (brief 030) is editing `tool-food.ts` and `packages/core/src/patterns/offer.ts` (the hero's window) in its first phase. So before the server findings, merge `build/plan-stages` and look for the merge of `lane/wire` in its log ("Merge lane/wire"). If it is there, go on. If it is not, stop at that boundary with the tree green and everything committed, and report; the lead will send you on. In `offer.ts`, touch only `isPlainYes` and the offer ID's parts until then.

Where a fix changes a ruling of brief 022, add a numbered contract question at the end of the list in `docs/briefs/022-report.md`, saying what it amends and why.

## Hot files this lane may edit

`packages/core/src/food/**`, `packages/core/src/patterns/**`, and, after the merge described above, `packages/server/src/routes/tool-food.ts` and the food part of `routes/tool.ts`. Not `packages/core/src/writes/**`, not the voice machine, not the seed.

## Done

The fixes with their red-first tests, the five properties green, the checks of brief 016, and a section "Outcome" at the end of this file: per finding, the test, the commit and the ruling it changed; per property, the seed and counterexample.

## Outcome

Lane `fix6`, from `2bc146a`. `build/plan-stages` was merged at `fd55113`, after "Merge lane/wire" (`6266877`). Each property runs 1,000 times. Seeds are fast-check's random seeds from the red run.

### Findings

| # | Commit | Red-first test | Ruling of 022 it changed |
|---|---|---|---|
| 1 | `9c59a3e` | `routes/tool-food.review.test.ts` "finding 1" (2 cases), property 1 | H-173: the yes's check and write run inside the admission |
| 2 | `d72b48d` | review "finding 2" (3 cases) | H-166: every rule of every subject, `FILTER_EVERY_SUBJECT` |
| 3 | `6b9e475` (oracle `4a1eafa`) | `food/food.review.test.ts` (4 of 11 failed), property 2 | H-167: prepared foods are `varies` |
| 4, the closed list | `3e676dd` | `patterns/offer.test.ts` (the reviewer's seven utterances), property 4 | H-168 |
| 4, the binding | `cca492a` | review "finding 4": "never shown" and "not the next turn" failed | H-168, H-169 |
| 5 | none | by reading; handler names kept | none |
| 6 | `7dc9140` | review "finding 6": 130 older bank rows; 2,100 other Evidence | H-170 |
| 7 | `a015a52` | `patterns/spend.review.test.ts` "finding 7", property 3 | none (a bug fix) |
| 8 | `0f830fb` | spend.review "finding 8", property 3 | H-171 |
| 9 | `aa642be` | offer.test.ts: a receipt, the unit, the late count and `mostly` each change the ID | none |
| 10, wording and meetings | `1941922`, `877138c` | property 5; property 3 for meetings cited once per provider key | H-172 |
| 10, sources | `40c0541` | review "finding 10": past 32 sources the card says how many more, and the count matches | H-172 |
| 11 | `79f42b9` | review "finding 11": a backstop proposal's egg rule filters suggest | none (a bug fix) |

The seeded persona with a shellfish rule, and with an egg rule, still gets three quick dinners (`food.review.test.ts`). To keep that true, seven recipes made only of whole ingredients were added to `food/catalog.ts`.

### Properties

1. **No allergen on the list, on the server path** (`packages/server/src/routes/no-allergen-on-list.property.test.ts`). Red on the code before `9c59a3e`: seed -1038007055, path "3:0:0:0:0:0". Counterexample: no stored rules, an egg rule on `self` written between the read and the write, then the yes. The list held eggs. An earlier red run on the code before `cca492a` gave seed 1998625157, path "0:0:0:0:0:0", the same case. While writing `9c59a3e`, a later draft gave a second counterexample: a proposal landing between the reads put eggs on a suggest card. suggest got the same admission check. Green now, about 25 s.
2. **The ingredient table is at least the oracle** (`food/ingredients-cover-oracle.property.test.ts`). Seed -1285717440, path "1". Counterexample: pesto lacked cashew.
3. **The detector against a reference** (`patterns/detector-reference.property.test.ts`, reference in `patterns/testing/money-reference.ts`). Three red runs, one per fix:
   - Seed 2045054333, path "39:2:1:1:1:1:3:1:2:4". One $1 order at 18:00 and a meeting stored twice. The detector cited two meetings and the reference one. Fixed in `877138c`.
   - Seed -776295298, path "97:3:1:2:2:2:5:…:17" (41 steps, in `a015a52`'s message). Five orders, a pending refund that then posted, and one more order. The detector said partial and the reference eligible. Fixed by finding 7.
   - Seed 1952263913, path "403:4:3:3:3:5:…:17" (30 steps, in `0f830fb`'s message). Six orders and an unlinked negative row. The detector said eligible and the reference partial. Fixed by finding 8.
4. **Only a plain yes is a yes** (`patterns/plain-yes.property.test.ts`). Seed 1811585068, path "0:0:0:0:0:0". Counterexample: "yes tell". Also seed -810098560, path "21:3:3:2:4:5:3:3:4". Counterexample: "sure 0 ". The binding half of the property is the review's finding 4 cases on the server.
5. **No causal word on any line** (`patterns/no-causal-line.property.test.ts`). Seed 1607871651, path "1:1:0:0:0:1:1:1:1". Counterexample: an eligible, mostly pattern gave an offer line with a null card, because the old card line "A pattern in your own records, not a cause" failed the guard.

### What the oracle found

The oracle (`food/testing/prepared-foods-oracle.ts`, 55 foods) was written by a separate agent that never read `ingredients.ts`, and was committed before the comparison (`4a1eafa`).

Tags were missing on 18 rows:
- salmon: food_dye
- shrimp: sulphite
- pasta: egg
- rice noodles: corn
- tortillas: wheat
- flour tortillas: soy, milk
- bread: barley, milk, egg, soy, sesame
- canned tomatoes: garlic, onion
- soy sauce: alcohol, food_dye
- peanut butter: soy
- cheddar: food_dye
- butter: food_dye
- yogurt: gelatin
- coconut milk: sulphite
- curry paste: all eight
- fish sauce: fish, msg
- pesto: cashew, walnut, almond, citrus, sunflower
- mixed seafood: eleven codes

19 prepared foods claimed a complete profile, and the oracle marks them as varying by brand: tofu, black beans, chickpeas, pasta, rice noodles, both tortillas, bread, canned tomatoes, soy sauce, peanut butter, parmesan, cheddar, butter, yogurt, coconut milk, fish sauce, pesto and mixed seafood. All of these are now `varies`. Curry paste stays unknown.

### Existing tests changed

- `packages/server/src/routes/tool-food.test.ts`:
  - The setup now records the offer as shown before the turn (finding 4), with a 10 ms clock step.
  - One assertion now reads `again.result` instead of `again`, because `answerTool` returns a `FoodOutcome` (finding 1).
- `packages/server/src/scripts/beat3-hero.test.ts`: a setup step, `showOffer`, records the offer as shown before the owner's yes. It runs in the main path (`offerAfterBolt`) and in the Friday variant (`offer`). No assertion changed. Beat 3 is as green as before: 4 passed, 7 expected fail.
- `packages/core/src/patterns/offer.test.ts`: cases added only.

### Signature changes

- `suggestTool(ctx, stamp, args)`:
  - Before: `Promise<Result>`, with the stamp unused.
  - Now: `Promise<FoodOutcome>`, which is `{ result, write: FoodWrite | null }`.
- `answerTool(ctx, stamp, args, turn)`:
  - Before: `Promise<Result>`.
  - Now: `Promise<FoodOutcome>`.
- `heroOffer` and `compareLoop` keep their signatures.
- New exports:
  - from `tool-food.ts`: `FILTER_EVERY_SUBJECT`, `YES_LOOKBACK_TURNS`, `foodRulesOf`, `eatersOf`, `FoodWrite` and `FoodOutcome`. `EVIDENCE_SCAN_MAX` keeps its name, and its value is now 50,000;
  - from `words.ts`: `heroOfferCardLines` and `moreSourcesLine`;
  - from `offer.ts`: `PLAIN_YES_AFFIRMATIVES` and `PLAIN_YES_TAILS`.
- Outside the listed hot files: `packages/core/src/testing/index.ts` gained two export lines, for the two food oracles.

### Not verified

- No emulator, no live call, no client.
- Nothing sends `pendingRendered` for the hero offer yet, so in the real app every hero yes answers `clarify` until the wiring records the presentation (H-169).
- Finding 5 is unchanged: the voice machine still offers neither `suggest` nor `answer`.

### Checks

At `9c59a3e`, on the tree as committed:
- `npx vitest run --maxWorkers=3`: exit 0. 440 files; 3914 passed, 19 expected fail. Before the merge (at `2bc146a`) it was 428 files, 3844 passed and 34 expected fail. Just after the merge it was 438 files, 3899 passed and 19 expected fail.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
