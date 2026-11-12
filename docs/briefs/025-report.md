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
- **W-211.** Part 3 exempts `griefAsk` from the death rule. A must-say about someone recorded deceased is ruled by W-228.
- **W-212.** For illness, part 3 suspends `wish` and `celebrate` (the spec's "celebrations"). A linked entity is one that shares an active row's subject or `entityIds` with the ill person, one hop, never `self`. The owner's own celebrations are not suspended.
- **W-213.** A moment dropped for a death, an illness or resolved care is closed as `cancelled` with reason `policy`, because `CANCEL_REASONS` has no life reason. `chooseNow` and admission skip it. The tick cancels it at its next pass over that moment (when the lease expires, or when a pending moment comes due).
- **W-214.** The life check reads the Memories through a scan, because no declared index selects by predicate. Its cost is W-229.
- **W-215.** FT16's "two separate people" step is green. Its "Franki asks which Alex" step still waits on the reminder action, which is not this brief.
- **W-228.** (The lead's provisional ruling on W-211, for the owner.) A must-say moment about someone recorded deceased plays only when the owner confirmed it strictly after the death was recorded: the reminder's `makeReminder` action `createdAt` against the `person.life = deceased` row's `createdAt`, both on the ops clock. Equal times, a missing time, or a confirmation before the death mean it is never chosen or admitted, and the tick closes it as `cancelled`, reason `policy`. Its action row stays in the ledger. A reminder is about the rows its action depends on, so "pick up Mom's ashes" is about Mom. Every other kind about the deceased is dropped whenever it was made, and `griefAsk` is exempt.
- **W-229.** The life check now reads what it needs once per Reader: a view of the deceased with when, of people with open care at gravity 3 and anyone one hop from them, of people whose care is all resolved, and of each row's entities. It is memoized per Reader object (`time/verdict.ts`), so no caller changed. In one delivery pass (`time/life-cost.test.ts`): on the seeded persona, 36 store calls before and 36 after, with 0 Memory scans before and 2 after (the per-moment source read became the view); with three wishes about Mom, 44 calls and 4 scans before, and 38 calls and 2 scans after, only 1 of them in `chooseNow`. The second scan is the render's own transaction (`time/proactive.ts:137`, the wire lane's), which is a new Reader. One read per pass would need the render to skip the life check (admission rereads it) or to reuse the choice's reader. Finding for the wire lane. A composite index on (`predicate`, `status`) would let the view read only the `person.life` and `care` rows.

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
