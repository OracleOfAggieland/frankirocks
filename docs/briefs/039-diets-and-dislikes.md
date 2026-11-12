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
