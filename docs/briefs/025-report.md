# Brief 025 report: voice writes, waves C and D (lane `writes`)

Built by Claude Code from brief 025 and `012-design.md` section 9, not from a Kiro spec. No commit ends `Built-with: Kiro`. No live model call, push, deploy or emulator run was made. Per-task detail and seeds are in `012-report.md`, under "Wave C" and "Wave D".

## Built

W-187 (`3e06aeb`), C1 to C6 (`81bc7d2`, `330e386`, `c81234e`, `a7927f6`, `86862d8`, `7c800ea`) and D1 to D4 (`a358056`, `0588f64`, `afbac92`, this commit). Every task is built.

Checks at the tip:
- `npx vitest run --maxWorkers=3`: 443 files, 3,901 passed, 34 expected fail.
- `npm run lint`: 0 errors, 1 existing web warning.
- `npm run build`: exits 0.
- `npm run typecheck`: **fails on one line**, `packages/core/src/writes/transition-orders.property.test.ts:67`, which reads `value.code` on a `Value`. The file is a committed property, so it is left as committed. The fix is type-only: read the code from `pick(relCodes)` instead. That is the lead's call.

`apps/web` was not touched. No demo-script step changed state: beat 4's and beat 5's `waits` marks are about persona tuning, forget and the walked-in tap, which this brief doesn't reach.

## Rulings needed (each fails closed as built)

- **W-188.** `DENIAL_FORMS` and `CUE_NEGATION_REACH = 3` (W-187) are closed lists. A denial off the answering turn keeps a pending rule and asks `isAllergy` again.
- **W-189.** `ROUTE_ROWS_ROOT_AT_TURN_SLICE`: route rows are rooted at the covering turn slice, not the span slice. P8's root-key clause relies on it.
- **W-190.** The correct route acts only on targets that were in the packet. Those go in only when the route is known open at call start (RX6, or the parse was awaited). A parse-only correction on a turn whose FastSlots call already started is extraction's.
- **W-191.** A turn that opened only the correct or transition route plans no allergy rule and writes no hardRule `handled` entry (G38).
- **W-192.** Two speakable current names for one entity name nothing, so its old-name lines are left out.
- **W-193.** A `wrong` row with no `validTo` negates every later restatement of its value.
- **W-194.** An item meeting a later-asserted row is written `history` even when it is a correction.
- **W-195.** The worker reads all Memories on every job, since the rename index decides whose a name is. This is one more query per job.
- **W-196.** Truth-order targets are code's pick, at most `TRUTH_TARGETS_MAX = 48`, never shown to FastSlots. An active row on a new row's key that the plan didn't read defers the change.

## Contract questions

- **W-197.** `HandledEntry.entries` is `arr(…, 3)` in the schema, while the design's `WorkJob.handled` says 8. The executor caps at 3 (one per route).
- **W-198.** P7's D includes the named targets only when the route applied them. P11 excludes the case where the old and new names are equal.
- **W-199.** A typed turn with no call that corrects gets the closed line "Corrected." The typed plan has no memory routes of its own.
- **W-200.** (Brief 041 G-A2 amends G34. This is the lead's ruling, for the owner to confirm.) G34 said a pasted line is T, so it writes nothing in `core/rules`. G-A2 keeps "never a rule", but a pasted line that the allergy cues match now writes one anonymous pending filter per named allergen, with no proof and the paste's Evidence as its only source, and plans one question. Two older tests that pinned G34 were changed to assert the exact filter: `routes/turn.rules.test.ts` and `apps/web/src/client/typed-paste.test.ts`.
- **W-201.** The pasted filter's subject is `null`, and `anonymous` is true, so every food path filters it for everyone. The rule gets no new schema field. `fromPaste` reads a paste filter as pending, with a null proof and non-empty root keys. The hard-rule route's rules always carry a proof or have no root keys.
- **W-202.** The question reads "You pasted something about an allergy to eggs. Is that you, or someone you eat with?" The brief's "an egg allergy" needs an adjective form that the code list doesn't have. The question goes in the Head as `Open question, ask it once: "…"`, but only while `rules.ask` is open on a paste filter. It is not a turn note.
- **W-203.** A pasted denial ("I'm not allergic to milk.") still writes a pending milk filter. RX4 matches it, and the cues can't tell a denial apart in third-party text, so it fails closed. The owner's answer clears the filter under W-187.
- **W-204.** A paste that names only allergens already filtered for everyone writes no filter. It still points the ask at the existing pending rule, but `rulesRev` doesn't move and the Head isn't recompiled, so the question may not show until the next compile.
- **W-205.** Part 1 changes two lines in `routes/turn.ts`: the call to `applyPastedAllergy`, and its name on the existing import line. The brief allowed one.
- **W-206.** Part 2 compares two roles by their code, and two `other` roles by their label as well. When a stated role conflicts with every stored person of the name, the new ID is `H("mention","person",name,"role",code,label-if-other)`. A stated role with no stored namesake keeps `H(name)`. Within one job, the first stated role keeps `H(name)` and a later conflicting role is salted.
- **W-207.** The "which Alex" question has its wording in code (`whichPersonQuestion`), but nothing delivers it. The worker runs after the reply, and no channel carries a worker's question into the next turn. The held item is kept as a ledger decision with reason `ambiguous`, and nothing replays it once the owner answers. Finding.
- **W-208.** Only extraction resolves names this way. The on-turn routes still derive by name through `mentionEid` in `writes/subject.ts`, which lane `fix8` owns. Finding.
- **W-209.** "A relation of one person never closes another's" holds through keys only, since keys now differ by person. A transition target that the model names can still close another person's relation. A guard against that was built and then dropped, because it changed what the committed extraction check expects for `x-correct-1` (`d12442b`).
- **W-210.** The rename index now answers only for a mention of type person whose stated role doesn't conflict. A mention of another type that uses a renamed name resolves by its own name.
- **W-211.** Part 3 exempts only `griefAsk`. Every other kind about someone recorded deceased is dropped, mustSay ones included (a commitment due within 24 hours, a reminder). This needs a ruling against spec §6's floors.
- **W-212.** For illness, part 3 suspends `wish` and `celebrate` (the spec's "celebrations"). A linked entity is one that shares an active row's subject or `entityIds` with the ill person, one hop, never `self`. The owner's own celebrations are not suspended.
- **W-213.** A moment dropped for a death, an illness or resolved care is closed as `cancelled` with reason `policy`, because `CANCEL_REASONS` has no life reason. `chooseNow` and admission skip it. The tick cancels it at its next pass over that moment (when the lease expires, or when a pending moment comes due).
- **W-214.** `momentVerdict` now reads every Memory (`readAllMemories`, paged by ID) on each call that reaches the life check. No declared index serves a read by predicate.
- **W-215.** FT16's "two separate people" step is green. Its "Franki asks which Alex" step still waits on the reminder action, which is not this brief.
- **W-216.** (Brief 043, finding 3.) A denial removes a pending allergy rule only when the owner's whole answer is one form of the closed list `WHOLE_DENIALS` (`writes/denial-words.ts`), after an optional lead from `DENIAL_LEADS`, with the asked allergen by its alias or a pointer from `DENIAL_POINTERS`. The list includes near forms the existing tests use ("No, nobody has that allergy.", "No, just a dislike.", "No, it's not an allergy."). A cue whose clause holds "it", "that" or "them", or names the asked allergen, always affirms.
- **W-217.** (Brief 043, finding 1.) The subject or counterpart of a life change must be a whole noun phrase of the owner's own in the span (`writes/life-subject.ts`: `OWNER_POSSESSIVES`, `OTHER_OWNERS`, `PHRASE_MODIFIERS`, `PHRASE_LINKS`, `CONTRACTION_NEXT`). A possessive before or after the name, "of", or another owner word defers. An `entityId` alone counts only where its name stands in the span. The same check skips a `person.life` Memory about someone else in extraction's `planItem` (`core/extract.ts`, a file outside the brief's hot list; `resolveMention` is untouched).
- **W-218.** (Brief 043, finding 2.) A typed turn with no call picks its one line in this order: a committed correction's closed line (W-199); the reply when its plan committed; the closed line for what committed; the reply as an ordinary one when nothing is claimed (a deferral); else the care line "I'm here with you." (`TYPED_LINES.care`), which claims nothing. The typed plan now runs the same memory plan (`planOnTurnMemory`), read outside the transaction, so its key matches the committed one.
- **W-219.** (Brief 043, finding 6.) The first-person check applies to illness and recovery only (`SELF_LIFE_KINDS`, forms in `SELF_LIFE_FORMS`). A job change, move or breakup marked `isSelf` reads as before.
- **W-220.** (Brief 043, finding 4.) A rename defers when its new name is negated in the span (`NAME_NEGATORS`: "not", "isn't", "instead of") or its old name is the asserted one (`NAME_ASSERTERS`: "name is", "called", "she's"). A deferral leaves the stored name active, so new property 4 is read as "the turn never renames to Y", not "Y is never active".
- **W-221.** (Brief 043, finding 5.) A null-replacement retraction needs a word from `RETRACT_NEGATIONS` (or one ending in "n't") within `RETRACT_REACH` = 3 words before the target's value or its entity's current name, in the same clause. Otherwise it defers.
- **W-222.** (Brief 043, finding 7; reverses W-194 for corrections.) In extraction's `later` branch a correction still marks wrong the rows it refuted: the earlier-asserted rows on its key that were current when it was said (active, or closed after it) and its named targets asserted before it. Only the later row is spared; the correction's own value is written `history`. `extract.past-never-demotes.property.test.ts` passes unchanged, so its allowed edit was not used.
- **W-223.** (Brief 043, property 6.) When the correction's job runs before the refuted value was ever saved, code has no row to mark, and the refuted value's own job later writes it; it is not marked `wrong`. Not fixed. Property 6 leaves that order out (its file header calls this "W-215", the number it had before the merge with brief 041).
- **W-224.** (Brief 043, finding 8.) A transition that writes nothing is `deferred`, and a deferred entry never carries keys or refs. Also (commit `4578e5a`, found while writing property 1): a correction or transition item whose writes land on a row this turn already wrote is deferred with no refs, because the store refuses one record written twice in a transaction and the turn answered 400.
- **W-225.** (Brief 043, finding 9.) A transition-only write under fastO marks the bundle dirty without raising the Deck; the next turn recompiles and raises the Deck at its own boundary. The seam is one call in `routes/turn.ts` (`refreshDirtyTurn`) beside the proposals block, outside "the typed-reply plan" the brief allowed. A dirty bundle on a turn that is itself fastO stays dirty until a later one.
- **W-226.** (Brief 043, finding 11.) The memory routes take an entry cap (`HANDLED_ENTRIES_MAX` less the hard-rule entry when that route is open) and plan life changes before corrections; an item past the cap writes nothing on the turn, gets no entry, and is left whole to extraction.
- **W-227.** (Brief 043, finding 12, no change.) "No, her name is Mara, not Maya, and she's allergic to peanuts.": the hard-rule route starts at arrival with no targets, so the correction is extraction's and this turn's reply still says Maya (W-190). Known limit.

## Changed assertions in existing tests

- `writes/hard-rule.test.ts`, `writes/hard-rule.review.test.ts`, `routes/turn.rules.test.ts` (W-187): a certain denial off an answering turn keeps the pending rule and asks again.
- `worker/extract.fixture-clock.test.ts` (C5, by design): `assertedAt` and `validFrom` come from the root Evidence. The owner's world clock is checked through `nextReviewAt`, and the test title changed to match.

## Seams left for the lead

- Delivery (`moments/**`, `time/**`, whispers) doesn't yet check `person.life = deceased` or resolved care before raising something about a person. The record holds both.
- `routes/turn.ts`: one call changed, at line 310 (`executeOnTurn` with `fastO`).
- Repair and supersede still call `executeHardRule` without memory routes, so corrections on those paths are extraction's.
- The typecheck line above.

## Hot files touched

`server/onturn/{execute,route,context,trigger,memory-route}.ts`, `server/routes/turn.ts` (one line), `server/worker/extract.ts`, `core/extract.ts`, `core/head.ts`, `core/recall.ts`, `core/writes/{hard-rule,types,denial-words,entities,renames,index}.ts`.
