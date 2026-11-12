# Brief 041: a pasted allergy, two people with one name, and what delivery says after a death (lane `writes`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This follows brief 025 in the same lane and worktree. Three things other work found and nobody owns yet. Each is its own part, in this order, one part's work never mixed into another's commits.

## Part 1: a pasted allergy line filters, and asks (finding G-A2)

`docs/briefs/034-report.md`, finding A2, and food moment F11 in `packages/server/src/scripts/gate-food.ts`: the owner pastes "I'm allergic to eggs." into the typed box. A pasted line is third-party text, so it writes no rule and opens no route, by design. Nothing else filters it, and the omelet is offered. The release gate is zero hard-rule misses in 40 food moments; this is the last one.

Ruling of the lead, for the owner to confirm:

- **A paste still writes no rule.** Spec §4 stands: third-party text never writes a rule, a preference, identity or `life`.
- **A paste can subtract.** When the code-visible allergy cues that wave B reads match a pasted line, the turn writes one pending filter per named allergen, with the paste as its source and its class as third-party, in the same pending shape the hard-rule route already writes for an unclear statement (brief 032, question W-187), so every food path that reads pending rules filters it with no change of its own. At most `PASTE_FILTERS_MAX` (3) per paste and `PASTE_FILTERS_OPEN_MAX` (6) open at once per owner; past either cap, no further filter is written and the ask below still goes out.
- **It asks once.** One question per paste, by code template, naming the allergen by its label from the code list and nothing else from the pasted text: "You pasted something about an egg allergy. Is that you, or someone you eat with?" The owner's own answer, spoken or typed, goes through the normal hard-rule route: a yes writes the rule from the owner's words; a denial removes the pending filter only under W-187's conditions.
- **It is never a rule anywhere else.** It is not in the Head as a rule, not in recall as a fact about the owner, and never said as one. If the Head must mention it, it is as the open question.

Properties, new files, red first, 1,000 runs:
1. **A paste never writes a rule.** For any pasted text, no active or confirmed rule exists afterward that did not exist before, and no Memory about the owner changes.
2. **A pasted allergen is never offered.** For any pasted line the cues match, and any food path that follows before the owner answers, nothing offered or listed holds that allergen.
3. **The caps hold.** For any sequence of pastes, the open pending filters from pastes never exceed the cap, and nothing in a pending filter or its question carries a token of the pasted text other than the allergen's own label from the code list.

F11 turns green in the gate scripts, with its wait and the `PASTE` count in `gates.summary.test.ts` removed in that commit.

## Part 2: two people with one name are two people (finding G-FT16)

`docs/briefs/034-report.md`, FT16: `packages/core/src/extract.ts` `resolveMention` gives a new mention an entity ID that is a hash of its type and name. "Alex from work" and "my neighbor Alex" become one entity, and the neighbor's single-valued relation closes the colleague's as history. Spec: Friend Test 16 and addition 8 (roles, anchors, referents). Build only what FT16 needs; `referents` in full is not this brief.

Ruling of the lead, for the owner to confirm, and it fails closed toward two people and a question:

- A new mention joins an existing entity by name only when nothing stated about it conflicts with what is stored: the same relation or role, or no relation stated at all and exactly one entity of that name. A conflicting single-valued relation or role means a new entity, whose ID takes the stated role or anchor into the hash, never the name alone.
- A bare name that fits two stored entities attaches to neither. It opens the question "Which Alex, the one from work or your neighbor?", worded by code from the two stored roles, and what was said about "Alex" in that turn waits on the answer.
- A relation of one person never closes a relation of another.
- Existing entity IDs do not change: a tenant with one Alex keeps that ID.

Properties, new files, red first, 1,000 runs:
4. **A name alone never merges two people.** For any two mentions with one name and conflicting roles, in any order and across any turns, two entities exist, and each keeps its own rows current.
5. **An ambiguous name writes about nobody.** For any bare mention that fits two entities, no row about either changes until the owner answers.

FT16 turns green in `packages/server/src/scripts/gate-friend.ts`, with its wait and the summary's count removed in that commit.

## Part 3: after a death, delivery is quiet about that person (a seam of brief 025)

Wave D records `person.life = deceased` and resolved care, and the Head honours it. Delivery does not read it yet (`packages/core/src/moments/**`, `packages/server/src/time/**`): a wish, a check-in or a celebrate planned before the news can still be chosen. Spec §7, the life-change table (the rows for death and for illness), and §6 "Floors".

Build, inside the functions that exist, with no change to any signature (another lane is calling `chooseNow`, `admitMoments` and `proactiveOf` right now):

- A candidate whose subject, or any entity in its roots, is recorded deceased is never chosen and never admitted, except the grief forms the spec names. It is reread at admission, as brief 036 rereads a corrected source.
- While a linked person's illness is active at gravity 3, celebrations for linked entities are suspended, as the spec's illness row says.
- A check-in about care that is recorded resolved is dropped.
- A moment dropped this way is closed with a reason code, never left to fire later.

Property, new file, red first, 1,000 runs:
6. **Nothing cheerful about the dead.** For any plan of moments and any life change committed at any point before, during or after the choice, no wish, check-in, celebrate or insight naming or rooted in a deceased person is chosen or admitted after the change commits.

## Hot files this lane may edit

Part 1 and 2: `packages/core/src/writes/**`, `packages/server/src/onturn/**`, `packages/core/src/extract.ts`, `packages/server/src/worker/extract.ts`, `packages/core/src/head.ts` (the open question only), the two gate scripts and the summary test named above. Part 3: `packages/core/src/moments/**` and `packages/server/src/time/**`, additions inside existing functions only.

Leave alone: `packages/server/src/routes/**` except a single line in `turn.ts` if part 1 cannot do without it (say so in the report), `packages/core/src/voice/**`, `gate/**`, `whisper/**`, `packages/server/src/food/**` and `routes/tool-food.ts` (two lanes are in them; if part 1 needs the food path to change, the pending shape is wrong, so stop and write it as a finding), `seed/**`, `apps/web/**`.

## Done

The three parts with their red-first tests, the six properties with seeds and counterexamples recorded, F11 and FT16 green, the checks of brief 016 with `npm run build`, and a section "Outcome" at the end of this file: per part, each change with its commit, each ruling as a numbered question at the end of the list in `docs/briefs/025-report.md` (W-200 on), every existing assertion changed and why, and what is not verified. Merge `build/plan-stages` before the final checks, and run the full suite, lint and typecheck after that merge.

## Outcome

Built by Claude on lane `writes`, with no Kiro run. Rulings W-200 to W-215 are in `docs/briefs/025-report.md`.

Before the parts, the lead asked for one fix to the merge of brief 025. Commit `60a1517` makes a typed life change or correction with no call open start one reply, not two (G17). RX6 and RX7 open their routes at arrival, but `turn.ts` skipped the ordinary reply only for RX4. The failing test came first: `routes/turn.typed-memory.test.ts`. `gate-friend.ts` now declares the transition route's FastSlots answer for the death, breakup and diagnosis lines. Only those three lines carry a life-change or correction cue in `scripts/` or `routes/`.

### Part 1: a pasted allergy line filters, and asks (`d40eaa8`)

- `core/writes/paste.ts` (new): `pastedFilters`, `pastedAllergens`, `pasteQuestion`, `fromPaste`, `PASTE_FILTERS_MAX` (3) and `PASTE_FILTERS_OPEN_MAX` (6).
- `server/onturn/execute.ts`: `applyPastedAllergy` writes the filters and the ask, and recompiles the bundle from a context read in the same transaction.
- `routes/turn.ts`: one call line, plus the name on the import line (W-205).
- `core/head.ts`: the open question, by code template (W-202).
- F11 is green. Its wait and the `PASTE` count in `gates.summary.test.ts` are gone (FOOD: 40 green, 0 waiting), and its note now describes the new behaviour.
- The food path is unchanged: the pending shape is the hard-rule route's, and it filters as it is.

### Part 2: two people with one name (`8f72860`, `d12442b`)

- `core/writes/people.ts` (new): the roster of stored people and their relations, `sameRole`, `personWithRole`, `whichPersonQuestion`.
- `core/extract.ts`: `chooseMention` and `statedPeople`. `resolveMention` gains an optional `people` parameter. `planItem` holds an item as `ambiguous` when one of its mentions fits two people.
- `worker/extract.ts`: three lines in the plan context (not the `later` branch).
- The review finding on the rename index is in the same change (W-210). Its failing tests are `worker/extract.people.test.ts`, "after the sister is renamed Mara…", and property 4's second case.
- `d12442b` drops a cross-person target guard that changed the committed extraction check (W-209).
- FT16's "two separate people" step is green. Its wait and the `G_FT16` count are gone. Its second step still waits (W-215).

### Part 3: after a death, delivery is quiet about that person (`1c0c1aa`)

- Additions inside `momentVerdict` (`server/time/verdict.ts`) only. No signature changed.
- The check is reread wherever the verdict is: the tick, `chooseNow`, the render in `proactiveOf`, and `admitMoments`.
- It drops a death (W-211), suspends a celebration during an illness at gravity 3 (W-212), and drops a check-in about resolved care. Each dropped moment is closed with a reason code (W-213).
- The failing tests came first: `server/time/life-041.test.ts`, eight cases, five of them red before the change.

### Properties (1,000 runs each)

| # | File | Red seed and counterexample |
|---|---|---|
| 1 | `server/onturn/paste-never-rules.property.test.ts` | Mutant run, with filters written `active`: seed -1607539268, `["none", ["I'm allergic to milk, milk."]]`: milk became an active rule. It is green without the change, because before part 1 a paste wrote nothing at all. |
| 2 | `server/onturn/paste-never-offered.property.test.ts` | Without the `turn.ts` call: seed 617779427, `["I'm not allergic to milk.", []]`: `veggie_omelet` was offered with milk in it. |
| 3 | `server/onturn/paste-caps.property.test.ts` | Mutant run, with the caps removed: seed -1556811752, `["I'm not allergic to milk. I'm allergic to almond, cashew, tree nut."]`: one paste wrote 4. |
| 4 | `server/worker/people-name-never-merges.property.test.ts` | Seed -1700768392, `["Alex", colleague, neighbor, two turns]`: one relation was left. Rename case: seed -1632489640, `["Alex", colleague]`: the sister's relation was closed. |
| 5 | `server/worker/people-ambiguous-writes-nobody.property.test.ts` | Seed -675248167, `["Alex", colleague, neighbor, "is coming to dinner"]`: a Memory was written. |
| 6 | `server/time/nothing-cheerful-about-the-dead.property.test.ts` | Seed -2025127645, Chicago, an occasion at 09:00 about Mom, world 08:00, death before the tick: the wish was chosen. |

### Existing assertions changed

- `packages/server/src/routes/turn.rules.test.ts`, "a pasted one-line allergy…": the test title, and the rules assertion is now `expectPasteFilters`, an exact check. By ruling G-A2, which amends G34 (W-200). The FastSlots, decisions and call-open assertions are as they were. The comment above the `describe` still cites G34 alone.
- `apps/web/src/client/typed-paste.test.ts`, the same test: the title, and the rules assertion is now `expectPasteFilters`, plus no active rule. Same ruling. The file's header comment still says a paste "writes nothing in `core/rules`".
- `packages/server/src/scripts/gates.summary.test.ts`: the FOOD and FRIEND counts, as above. After the merge, FRIEND is 9 green, 11 waiting, 12 waiting steps.
- `packages/server/src/scripts/gate-food.ts`: F11's wait was removed and its note rewritten.
- `packages/server/src/scripts/gate-friend.ts`: FT16's first wait was removed, and three lines gained the FastSlots answers they now need (`60a1517`).

### Not verified

- No real model ran. The question in the Head has never been put to `gpt-realtime-2.1`, and FT16 ran only on scripted extraction.
- Nobody delivers the "which Alex" question, and nothing replays a held item (W-207).
- The cost of `momentVerdict` reading every Memory on a large tenant (W-214).
- Pending deliveries the tick hasn't reached yet stay `pending` or `leased` until their next pass (W-213).

### Follow-ups (W-216, W-217)

- W-216: a must-say about someone recorded deceased plays only if the owner confirmed it strictly after the death was recorded (`fb3629b`). Tests come first in `time/life-041.test.ts`. Property `time/must-say-after-death.property.test.ts`, red seed -1080007604, gap 0 (confirmed at the instant of the death): the reminder stayed leased.
- W-217: the life facts are read once per Reader, not on every moment (`a1a1348`). On three wishes about Mom, one pass makes 38 store calls and 2 scans, down from 44 calls and 4 scans. The seeded persona stays at 36 calls (`time/life-cost.test.ts`).
- The render's reread in `time/proactive.ts:137` is a second Reader, so a pass still reads the view twice. Making it one is the wire lane's call (W-217).
- Not changed: W-207, W-208 and W-215 go to the owner's list as not started.

### Checks after the merges

Merged `build/plan-stages` twice: `b78ae7f`, then `bae159f`, because the branch moved meanwhile. The first merge had one conflict, in the FRIEND summary counts. After `bae159f`:

- Full suite (`npx vitest run --maxWorkers=3`): 516 files, 4,320 passed, 24 expected fail.
- Typecheck: 4 of 4. Build: 2 of 2.
- Lint: 0 errors and 1 warning, in `apps/web/src/components/avatar/three/brass.ts:113`. The warning was there before this lane.
