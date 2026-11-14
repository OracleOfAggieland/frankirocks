# Brief 049: the demo beats, playable on a live call (lane `demo`)

Read `docs/briefs/016-plan-stages.md` first, with two changes: your working copy is `C:\Users\albeavi\Documents\Coding\frankirocks-lanes\demo` on the new branch `lane/demo`, cut from `build/plan-stages` at `28226f8`, and your contract questions use the prefix `D-`, starting at `D-257`.

Spec §15 has five demo beats. Beat 5 (forget) plays end to end since brief 048. Beats 1 to 3 do not, and their scripts say why in their `waits` markers:

- **Beat 1** (`beat1-speaks-first.test.ts`): the wish plays on open, but it names the occasion only ("Good luck at 2: {occasion}."). Nothing joins Tuesday's gap-year answer to it, and no route returns its card about the move from yesterday.
- **Beat 2** (`beat2-biscuit.test.ts`): the check-in never plays. "Surgery" makes Biscuit's surgery S2 (`core/lexicon.ts`). A told S2 check-in is a +200 path (`core/gate/ceiling.ts` `PLUS200_PATHS`), and the unprompted Gate context always says `build: "floor"` (`server/src/time/gate-candidate.ts:169`), so the Gate holds it. Its words would be "How did it go: …?" (`core/moments/words.ts` `checkInLine`), not the spec's form.
- **Beat 3** (`beat3-hero.test.ts`): the offer plays on a call, and "yes" writes the list and the loop. But no route returns the offer's card with its sources (`open.ts:231` and `:239` send `cards: []`). The three weeks of bank rows after the yes exist only as test setup (`AFTER`, `coveredThrough`), so "$71, down from $186" and "$115 less" cannot be reached on a seeded visit.

This brief makes beats 1 to 3 play on a live call on the seeded visit, in the demo's order, with beat 5 still green. It is built by Claude Code agents from this brief, not from a Kiro spec, and no commit ends `Built-with: Kiro`.

## Read first

- Spec §5 (the Occasion row, line 176), §6 in full (the ceiling table, audience, line 218, and Forms on line 222), §9 line 299 (seeded `texture`), §10 (the hero), §13 (release gates), §15.
- Contracts §6: the seed routes (line 747) and the `advance` route.
- `packages/core/src/gate/gate.ts` (`tryPath`, `S2_SCREEN_ASK_BUILT`), `gate/ceiling.ts`, `core/lexicon.ts`, `core/moments/words.ts` and the moments derive code, `packages/server/src/time/gate-candidate.ts`, `time/proactive.ts`, `routes/open.ts`, `routes/delivery-wire.ts`, `routes/tool-food.ts` (`heroOffer`, `compareLoop`), `routes/seed-advance.ts`, `seed/persona/turns.ts`, `seed/build.ts`, `apps/web/src/client/call-cards.ts`, `client/proactive-shown.ts`, `apps/web/src/ui/visit/bolt-targets.ts`, and the three beat scripts above with `beat5-shellfish-brother.test.ts` and `testing/script-runner.ts`.

## The lead's rulings for this brief

1. **Turn on one +200 path: the told S2 check-in.** Only `checkIn`. `door`, `ownRootedDoor` and `oLogistics` stay off. Name the paths that are on in one constant (for example `PLUS200_ON = new Set(["checkIn"])`) and read it where `tryPath` reads `build`. That is the only change to `gate.ts`. Every condition of spec §6's S2/Told cell still holds: told (`U` or `C`), volunteered within `CHECK_IN_WINDOW_MS`, a private audience, said once, with a ledger row. Company, quiet, `unknown` and crisis still hold it, and so does a "don't bring it up".
2. **The check-in uses the spec's forms** (§6, Forms). A told S2 occasion gets the named check-in, "How's {name} doing?", so Biscuit's reads "How's Biscuit doing?". It names who, never the S2 detail: "surgery" is not said. Any other occasion gets the item form, "How'd {occasion} go?", in place of "How did it go: …?". Code words both, from fixed slots.
3. **Line 218's "Here, or on screen?" ask does not apply to this check-in,** because the line carries no S2 detail. `S2_SCREEN_ASK_BUILT` stays `false`. Record this as a contract question.
4. **The wish carries its seeded texture.** The seed links Tuesday's gap-year episode (`turn-gap-answer` in `seed/persona/turns.ts`, which has `occasionRef: null` today) to the interview occasion as its `texture`. Spec §9 says the floor build has seeded texture. The wish then reads "Good luck at 2. If the gap year comes up, you had a good answer Tuesday." Code words it from fixed slots: the topic, and the day it was told as a day word from the clock port. The texture is gated like any told note. If the Gate holds it, or an occasion has no texture, the wish stays as it is today.
5. **A proactive brings its card.** The open and the idle whisper fill `cards` (at most 2) with the card the moment owns: the occasion's "moved from yesterday" card (template `occasion.moved`, from the calendar's two revisions), and the hero offer's card ("Takeout and late meetings", its 10 sources from `heroOffer`). A card passes the Gate like its line. A held line sends no card, and a line the Gate lowers to card-only sends the card alone. If the hero card meets the `S2_SCREEN_ASK_BUILT` lowering, file a contract question and do not change the constant.
6. **The three weeks after the yes arrive with the clock, as a bank sync would bring them.** The persona fixture holds the after-yes lines, the six in `beat3-hero.test.ts` `AFTER` (takeout $25 + $22 + $24 = $71), each dated as an offset from the yes. When `/api/seed/advance` moves the world clock and the visit's hero loop is `waiting`, it writes each line dated at or before the new clock, idempotently, and moves `core/state.coverage` to the new clock. A line is never written before the clock reaches its date. Nothing is written for a visit with no yes. These are persona rows: `read_money` never reads them, and the hero never reads Plaid rows. This changes what the advance route writes, so it goes in the design note and in a contract question. Contracts line 747 ("no arbitrary write") is about `seed/event` and stays true.
7. **One script walks the demo in order, on a live call.** Add `demo-walk.test.ts`, using the `call`, `callQuiet`, `callType` and `hangUp` steps as `beat3OnCall` does, on one seeded visit:
   1. **Friday 08:40, call.** The wish with its texture and the moved card.
   2. **Still on Friday's call, two turns, then hang up.** "Biscuit has surgery Thursday." Then "I'm allergic to shellfish, and my brother's in trouble again."
   3. **Bolt to Thursday 6 PM, call.** "How's Biscuit doing?" Then an answer.
   4. **The hero offer with its card.** Take the shortest honest path, whether an idle whisper after `CHECK_IN_QUIET_TURNS` or the next bolt. "Yes" writes the list, and the Strip shows four of five. Hang up.
   5. **Bolt three weeks on, call.** "$71, down from $186 over the same three weeks." The Strip reads $115 less.
   6. **The forget.** "Forget what I said about my brother." A fresh call says "Gone.", and the shellfish rule is still there.

   Never loosen a Gate rule or a quiet-turn count to shorten the walk. The report lists the walk's exact steps, each turn's words and each bolt, so the demo can be run by hand from it.
8. **A "Sample visit" label on `/lab`** while a seeded visit is loaded, worded in `copy.ts`. Build it only if the lead confirms before stage 7.

Where the contracts and these rulings leave a gap, take the answer that fails closed, name it as one constant or one small function, and list it under "Rulings needed".

## Properties, red first

- **One check-in, private only:** for any order of turns, audiences, modifiers, bolts and opens, the told S2 check-in is said at most once per occasion. It is never said in company, quiet, `unknown` or crisis, never after the 7-day window, never for a `T` or `M` source, and never with the S2 detail's words.
- **Nothing after the yes arrives early:** for any order of yeses, bolts and resets, no after-yes row is stored before the world clock reaches its date. None is stored for a visit with no yes. A row is never stored twice, and none is ever read by `read_money`.
- **A card follows its line:** for any proactive candidate and Gate context, the open and the whisper send a card only when the Gate says or cards that line, and never a card for a held one.
- **The wish names its texture only when the texture passes the Gate.**

## Scripts

- Beats 1, 2 and 3, every variant including "as merged" and the live-call ones: no `waits` left. Add a beat 3 variant that reaches the payoff with no `do: "bank"` and no `coveredThrough` setup, through the advance alone. Leave the existing variants' setup steps as they are.
- `demo-walk.test.ts`: green.
- Beat 5 and every memory-off control: still green.

## Build in this order

Each stage ends with its tests green and its work committed, so the lane can be merged at the end of any stage.

1. The design note, `docs/briefs/049-design.md`: each gap above, the seam it changes and the answer taken.
2. Rulings 1 to 3 with the first property, red first. Beat 2 goes green.
3. Ruling 4. Beat 1's texture step goes green.
4. Ruling 6 with its property. The new beat 3 variant goes green.
5. Ruling 5 on the server, with its property. The card steps of beats 1 and 3 go green.
6. Ruling 7, the demo walk.
7. On screen: the cards of a proactive join the Card_Dock that a tool answer's cards use (`client/call-cards.ts`), and ruling 8 if confirmed. This stage needs files that are in flight. Start it only when the lead says the main checkout's readout-card change is committed, then merge `build/plan-stages` first.

## Hot files this lane may edit

- **Core:** `packages/core/src/gate/gate.ts` (ruling 1's one read only), `gate/ceiling.ts`, `packages/core/src/moments/**`, `packages/core/src/schema/wire.ts` (only if a card shape needs it, as an addition).
- **Server:** `packages/server/src/time/**`, `packages/server/src/seed/**`, and these routes: `routes/open.ts` (one call at the seam), `routes/delivery-wire.ts`, `routes/tool-food.ts`, `routes/seed-advance.ts`.
- **Scripts and tests:** `packages/server/src/scripts/**`, `testing/script-runner.ts`.
- **Web, stage 7 only:** `apps/web/src/client/**` except `memory-model.ts`, and the route handler under `apps/web/src/app/api/seed/advance/`.
- **Machines:** `docs/machines/**`, if a machine changes.

Not these, because a change to them is uncommitted in the main checkout:
- `apps/web/src/components/App.tsx`, `components/surfaces/Card.tsx`
- `apps/web/src/ui/copy.ts`, `ui/memory-screen.ts`, `ui/surface-props.ts`
- `apps/web/src/client/memory-model.ts`
- `apps/web/src/app/specimens/_sections/MemoryScreenSection.tsx`

Stage 7 may touch them only after the lead's go.

Also not these:
- `packages/*/src/forget/**`, `packages/server/src/bank/**`, `phone/**`, `apps/web/src/ui/radio/**`, `components/radio/**`.
- The voice reducer's golden corpus: this is not the voice lane.
- Any committed `*.property.test.ts`, `seed-advance.property.test.ts` included.

## Not in this brief

- **Beat 4:** the warmth floor and the Jordan line.
- **Screen extras:** the chips and the "Someone walked in" tap.
- **Other +200 paths:** the doors, `ownRootedDoor` and `oLogistics`.
- **The on-screen ask:** "Here, or on screen?"
- **The typed path:** showing a proactive that asks a question (`client/proactive-shown.ts:21`). The demo runs on a call.
- **A real bank in the hero.**

## Done

The stages above, the checks of brief 016 including `npm run build`, and `docs/briefs/049-report.md`, kept current from the first stage on.

Run the full suite in the foreground in shards (`npx vitest run --maxWorkers=3 --shard=1/3`, then `2/3`, then `3/3`) and read each result before going on.

The report gives:
- the demo walk step by step;
- each red-first seed and counterexample;
- what could not be checked without the emulator, a browser or a live call.
