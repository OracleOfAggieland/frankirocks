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
