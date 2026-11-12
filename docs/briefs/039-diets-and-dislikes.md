# Brief 039: food reads diets and dislikes, and a month ends (lane `fix6`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This follows brief 037 in the same lane and worktree.

The release-gate scripts of brief 034 found two things food does not do yet (finding G-FT02 in `docs/briefs/034-report.md`, Friend Tests 2 and 11):

- `suggest(food)` reads only the allergy rules. A vegetarian is offered chicken quesadillas, and "I hate mushrooms" still gets the mushroom omelet.
- "I'm vegetarian this month" stores a diet with no end, because `packages/core/src/dates.ts` resolves days only. So the spec's question, "Still vegetarian, or was November it?", can never be asked.

Spec: §12 "Food" (line 303), Friend Test 2 (line 326) and Friend Test 11. Allergies stay exactly as brief 037 left them: hard rules, every subject, failing closed. Nothing here may loosen that path.

## What to build

**1. A period has an end.** The pure resolver gains a closed list of period phrases and returns the last instant of the period in the owner's zone on the world clock: "this week", "this month", "this year", "for <month>", "in <month>", "until <a day the resolver already reads>", "for N days" and "for N weeks". A phrase outside the list gives no end, as today. A diet or a preference stated with one of these phrases is stored with that `validTo`. Find the one place the write path resolves dates for a stated diet and call the resolver there; if that place is in `packages/core/src/writes/**`, keep the edit to a few lines, because another lane is working in that folder.

**2. The owner's diet removes what breaks it.** A closed list of diets known by code: vegetarian, vegan, pescatarian. Each ingredient carries what it is (meat, poultry, fish, shellfish, dairy, egg, honey, or none), from a second independent table in `packages/core/src/testing/`, written before the product's tags are compared with it, as brief 037 did for allergens. A recipe holding an ingredient whose kind is unknown, or a `varies` food, is removed under any diet. A stored diet that is not on the list removes nothing and opens the question below instead; never guess what an unknown diet excludes.

**3. A diet past its end asks, and stays neutral until answered.** At a food moment, when the owner's diet has a `validTo` before the world time and no later statement settles it, `suggest` returns the open question first ("Still vegetarian, or was November it?", worded by a code template from the stored diet and the period it ended) and offers only dinners that are right both ways, which means the diet still filters. "Yes, still" extends it with no end; "no, that was November" closes it as history. Both answers are the owner's words in a committed turn, read by code from a closed list, never the model's reading.

**4. The owner's dislikes remove what holds them.** A stated food dislike (S0, class U or C) that names an ingredient in the table removes every recipe holding it. A dislike that names nothing in the table removes nothing. If fewer than three dinners are left, offer fewer; never put a disliked or diet-breaking dinner back to reach three.

**5. Whose diet.** Ruling of the lead, for the owner to confirm: the owner's own diets and dislikes always apply. Another person's diet or dislike applies only when the owner's words in this turn name that person, matched by code against that person's stored aliases. The model's attendee list can add a person and never remove one. This is narrower than the allergy rule on purpose: an allergy is a hard rule and filters for everyone until attendees are resolved; a diet is a preference.

**6. Why a dinner is missing is never said.** A removed dinner is simply absent. The reason goes to the card's detail as a code (`diet`, `dislike`), never into a prompt or a spoken line, and never names a person other than the owner.

## Properties, in new files, red first, 1,000 runs

1. **No dinner breaks a live diet.** For any stored diets, dislikes, rules and any world time, no offered dinner holds an ingredient the independent table says the owner's live diet excludes, or an ingredient the owner dislikes.
2. **A period's end is the period's last instant.** For any world time and any zone, each listed phrase resolves to an instant inside the same local week, month or year, and the next millisecond is outside it.
3. **Allergies are untouched.** For any inputs, the set of dinners removed for an allergy is the same with and without diets and dislikes stored. (Brief 037's properties stay green and unedited.)
4. **An ended diet is asked about once per food moment and never assumed over.** Until the owner answers, every offered dinner is right under the diet, and the question is first in the result.

## Hot files this lane may edit

`packages/core/src/dates.ts` (additions only), `packages/core/src/food/**`, `packages/server/src/food/**`, `packages/server/src/routes/tool-food.ts`, the food words in `packages/core/src/patterns/words.ts`, `packages/core/src/testing/**` (new files and export lines), and the steps of `packages/server/src/scripts/gate-friend.ts` and `gates.summary.test.ts` that wait on `G_FT02` (drop the wait in the commit that turns the step green, and move the summary's counts in the same commit). A few lines in `packages/core/src/writes/**` or `extract.ts` for the `validTo`, and nothing else there.

Another lane is wiring `packages/server/src/routes/tool.ts` and the ledger. Leave `tool.ts` alone; if this work needs it to change, write that as a finding.

## Done

Friend Tests 2 and 11 green in the gate scripts with their waits removed, the four properties green with seeds and counterexamples recorded, the checks of brief 016 with `npm run build`, and a section "Outcome" at the end of this file: each change with its commit, each property with its seed, every ruling taken as a numbered question (H-174 on, at the end of the list in `docs/briefs/022-report.md`), and what is not verified.

## Outcome

Lane `fix6`, from `e3d964f`. `build/plan-stages` was merged again at `a23af3c` (tip `367a571` then, with `eef2b14`'s F24, F34 and F35 fixes). Each property runs 1,000 times. Seeds are fast-check's random seeds from the red run.

### Changes

| Change | Commit | Tests |
|---|---|---|
| 1. A period has an end: `resolvePeriod` in `core/dates.ts` (additions only) | `5c7679d` | property 2 |
| 1. The write: an extracted preference whose time applies to `valid_to` gets `validTo` (five lines in `core/extract.ts`) | `4f7b17a` | Friend Test 2, "a diet with an end is stored", wait dropped |
| 2. The second kinds table, by a separate reader that never opened the product's table | `a8e8234` | none |
| 2 to 4. The pure half: ingredient kinds, `DIETS`, `core/food/prefs.ts`, `suggestFood` reading prefs after the allergy filter | `015a873` | properties 1, 3, 4; `prefs.test.ts`; `kinds-cover-oracle.test.ts` |
| 2 to 6. The server: `server/food/prefs-read.ts`; suggest, the hero's yes and the diet answer in `routes/tool-food.ts` | `e22883b` | `server/food/diet-dislike.test.ts`; Friend Test 2 (both suggest steps) and Friend Test 11 green, waits dropped |
| The hero card's title counts its dinners | `b5fee0f` | `diet-dislike.test.ts` |

Friend Tests 2 and 11 are green, with every wait removed. The Friend Test summary moved from 7 green, 13 waiting and 17 waiting steps to 9 green, 11 waiting and 13 waiting steps. `G_FT02` is gone from `byWait`, and `other` went from 9 to 8. `W.G_FT02` is still defined in `gate-kit.ts`, which this lane may not edit, but nothing uses it.

`routes/tool.ts` was not touched. Nothing needed it: the diet answer runs inside `answerTool`, and its write goes through the same `FoodWrite` in the admission.

### Properties

1. **No dinner breaks a live diet** (`core/food/no-diet-break.property.test.ts`). Red on `suggestFood` before it read preferences: seed 328080552, path "2:0:0:2:1:2:2:2:2:2". Counterexample: no diets and one S0 owner dislike of chicken breast; the chicken quesadillas were offered.
2. **A period's end is its last instant** (`core/dates-period.property.test.ts`). Red against a resolver that read no period: seed 86905066, path "0:0:0:0:0:0". Counterexample: 1990-01-01 00:00 UTC, "for 1 day", no end.
3. **Allergies are untouched** (`core/food/allergies-untouched.property.test.ts`). Never red. It was green on its first run, when the preferences were still ignored, and it stayed green after. By construction, diets and dislikes only filter what the allergy filter kept.
4. **An ended diet is asked about and never assumed over** (`core/food/ended-diet-asks.property.test.ts`). Red before the question existed: seed 196236935, path "8:36:0:1:1:2:1:1:2:2:2:2". Counterexample: an active vegetarian diet on self that ended 2026-11-08, at world time 2026-11-13; no question.

Brief 037's properties are unedited and green.

### Rulings

Rulings H-174 to H-185 are at the end of the list in `docs/briefs/022-report.md`:
- H-174: `validTo` is end-exclusive.
- H-175: how the period phrases read.
- H-176: rennet and gelatin count as meat, and the product's kinds agree with the oracle by construction.
- H-177: an unknown diet asks, and `pescatarian` is missing from the predicate's codes.
- H-178: which question is asked, and that it overlaps with `expiryAsk`.
- H-179: the closed answer list and its writes, with no ledger row and no `pendingRendered`.
- H-180: what a dislike is.
- H-181: whose diet applies, as built.
- H-182: there's no card detail field, so the reasons go to the log as counts.
- H-183: a failed read offers nothing.
- H-184: the hero's yes reads diets and dislikes too.
- H-185: this conflicts with `softEffectAt`'s comment.

### Not verified

- No emulator, no live call, no client.
- No model offers `suggest` or `answer` yet (brief 030's second phase), so in the app nothing reaches these paths.
- The diet question's answer has no presentation record, and nothing tests it end to end through a voice call.
- A pescatarian diet can't be stored by extraction (H-177).
- The seeded persona has no diet or dislike, so its demo dinners are unchanged. Beat 3 is as green as before.

### Checks

At `a23af3c`, after the merge:
- `npx vitest run --maxWorkers=3`: exit 0. 467 files; 4145 passed, 35 expected fail.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.

`b5fee0f` changes only the hero card's title and adds one test. Its focused run passed: 40 passed, 7 expected fail.

`build/plan-stages` was merged a third time at `e585235` (tip `a56aa39`, with lane/writes merged). There was one conflict in `core/extract.ts`: lane/writes changed `validFrom` to `saidAt`. Both changes are kept: `saidAt` and this brief's `validTo`. At that merge:
- `npx vitest run --maxWorkers=3`: exit 1. 482 files; 4200 passed, 34 expected fail, 4 failed.
- `npm run lint`, `npm run typecheck` and `npm run build`: all exit 0.

The 4 failures are Friend Tests 3, 8 and 10 in `gate-friend.test.ts`. Each makes 2 `responses.create` calls where 1 is declared. They fail the same way with this lane's `extract.ts`, `tool-food.ts` and `suggest.ts` set back to `build/plan-stages`'s versions, and this lane's other changes don't touch those tests. So they come from the merged base, not from this brief, and they are left for the lane that owns them.
