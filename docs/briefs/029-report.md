# Report 029: the script runner, and the demo as scripts (lane `scripts`, F9 part one)

Built by Claude Code from briefs 016 and 029, on `lane/scripts`. No commit ends `Built-with: Kiro`. No feature code was added.

## Built

1. **The runner:** `packages/server/src/testing/script-runner.ts`. The scripts are in `packages/server/src/scripts/`. They are not in `tests/scripts/`, because `vitest.config.ts` only includes `packages/*/src/**`, `tests/setup` and a few others, and this lane may not edit that file. `tests/` could import the code, but `npx vitest run` would never run it.
   - **What it drives:** the real route functions (`open`, `close`, `turn`, `tool`, `memory`, `seed/reset`) through `runRoute`, over the in-memory store, with the fake ports and the fixture clock. It starts no server and makes no network call.
   - **Steps:**
     - `seed`, `open`, `close`, `type`, `chip`, `say` (an ASR turn), `tap` (a trusted tap), and `tool`.
     - `advance` moves the world clock to a labeled time.
     - Limb events: `mail`, `bank` and `calendar`. They build their rows with the seed's own builder.
     - `work` runs the worker until it is idle, and `read` calls the screen's read route.
     - `check` adds assertions on an earlier step's output.
     - `probe` calls a function that is built but that no route calls yet.
     - `setup` stands in for a missing writer. Every `probe` and `setup` is listed below.
   - **Model answers:** each step declares the answers it assumes, in plain words: `reply`, `parse`, `extract`, and `slots` for FastSlots. The runner fails a step whose calls to OpenAI or FastSlots differ in number from what it declared.
   - **Assertions:**
     - `mustSay` matches a template ID or fixed tokens. The template's patterns come from `patterns/words.ts` and 024's `checkIn` whisper. A template the build has no wording for yet is `null`, and asking for it fails.
     - `neverSay` takes tokens or memory selectors, per step or per script. It covers notes, cards, proactive lines, tool results, read answers, the Head and, when asked, model inputs.
     - The rest are `mustUse`, `mayUse`, store checks, Lab counts and status.
     - A failure prints the script, the step, what was expected, and what was said or stored. For an HTTP failure it also prints the request.
   - **Expected-fail:** a step marked `waits` gets its own `it.fails`. That test runs the script through the step and fails only at that step. If an earlier step breaks, the test turns red. `runner.test.ts` covers the refusals.
2. **The demo** as beats 1 to 5 (beat 6 has no script). Beat 3 has three variants.
3. **Five poison scripts:** `poison.test.ts`.
4. **Memory-off controls** for beats 2 and 3.

## Beats and steps

G is green. W is expected-fail, followed by what the step waits for.

| Script | Step | State |
|---|---|---|
| Beat 1 | The seeded interview moved from yesterday 14:00 to today 14:00 | G |
| | The Head at open holds the interview and Tuesday's gap-year answer | G |
| | The wish at 2 is said first, on `proactive` | W: 023 derive and delivery. `open.ts:177` always sends `proactive: null` |
| | The wish carries the gap-year texture | W: same |
| | The card shows the move from yesterday | W: 023 and 027 (no card on open) |
| | The next open does not wish again | W: 023 `said`. No wish template yet |
| Beat 2 | Typed line and reply | G |
| | Extraction: one active U event on Thursday (the resolver's civil date) | G |
| | Jump to Thursday 18:00 (through the `setWorldClock` seam), then the worker | G |
| | "How's Biscuit doing?" on open, said once | W: 023, and a route calling the 024 Gate and whispers |
| | The check-in is about their own words | W: same |
| | The next open does not ask again | G, but only because nothing is said yet |
| Beat 2, memory off | Nothing about Biscuit after the jump | G |
| Beat 3, as merged | No offer before the bolt | G |
| | Every step from the offer on | W: finding 1 |
| Beat 3, past the seed mismatches (`setup` rewrites bank rows) | Probe: the Friday offer says $186, with 10 sources | G |
| | Probe: the offer after the bolt still says $186 | W: finding 3 |
| | The offer plays after the bolt, and its card | W: 023 and 024. Nothing calls `heroOffer` |
| | The yes, the strip after it, the comparison, "$71, down from $186", the strip at $115 less | W: finding 3 |
| Beat 3, yes on Friday | The yes writes the list and the loop, and the strip and comparison after it | W: finding 4 |
| | "Franki speaks first" and "$115 less" | W: finding 4 (then 023 and the 020 strip money figure) |
| Beat 3, memory off | No $186, $71, $115 or "takeout" anywhere | G |
| Beat 4 | Reply | G |
| | Care first | W: persona tuning and the warmth floor (024 not built) |
| | Hedged extraction, job Memories unchanged, nothing written as a change | G |
| | The Jordan line | W: addition 1, and a route calling whispers |
| | The Lab: 90 emails read, 0 guess lines said | G |
| | The Lab: 3 private guesses | W: finding 5 |
| | The walked-in tap | W: addition 4. `turn.ts:76` refuses trustedTap |
| | No guess anywhere, Head included | G |
| Beat 5 | No brother fact in the seed; both halves answered; the brother line stored | G |
| | The shellfish rule is active, stays after the forget request, and is in the next Head | G (flipped after the 018 merge) |
| | "Gone"; the receipt; no brother in the next Head | W: 021's closure and resume. No route calls `fenceForget` or `advanceForget` |
| Poison a to e | The email is stored as T; no Memory or rule changes; no action or phoneCall; its words reach no output, Head or model input; with (e), food still leaves out shellfish | G (5 of 5) |

The poison scripts hold today because no path reads mail into a turn. They will start to test something once one does.

## Findings: merged pieces that do not fit

1. **Purchase sign.**
   - The seed writes a purchase as a negative amount (`seed/build.ts:605`, `amountCents: -line.amountCents`).
   - The detector counts only positive amounts (`core/src/patterns/spend.ts:122`) and reads a negative one as a refund (`:104`).
   - So the seeded hero is `insufficient`, with 0 orders.
2. **The pending decoy.**
   - The seed's pending takeout row (`seed/persona/bank.ts:29`) is meant to be ignored.
   - `spendRows` counts it as unsettled (`spend.ts:127`, `:168`), so the pattern is `partial`.
3. **The window after the bolt.**
   - `heroWindow` ends the day before the world's today (`core/src/patterns/offer.ts:12`).
   - Seed coverage ends at the clone's start (`seed/load.ts:94`).
   - After the jump to Thursday the window has 5 orders and 15 covered dates, so it is `insufficient`. The spec puts the offer after the bolt.
4. **The loop's lineage.**
   - `loopMemory` picks the typed Slices `bank.amount` and `calendar.time` as roots (`routes/tool-food.ts:258`).
   - W-LINEAGE fails every Slice with a null range (`core/src/lineage.ts:84-87`, `core/src/evidence.ts:23-25`).
   - So the yes's write is refused. The StoreError comes back as **400 PARSE**, which is misleading. 022's tests passed because their rows carried text Slices only.
5. **The Lab's guesses.**
   - The seed's guesses are `alleged` (`seed/build.ts:415`).
   - `labView` counts a guess only when `counted`, and `counted` needs status `active` (`core/src/memory-views.ts:93`). So privateGuesses is 0, not 3.
6. **Built but not called:**
   - `heroOffer`, `compareLoop` and `markCelebrated` (022).
   - The forget executor (021).
   - The Gate and whispers (024).
   - `setWorldClock` (019). The advance route is 023's.
7. **Note.** "Biscuit has surgery Thursday" is stored S2 (the root Slice is S2). The check-in will be held on any non-private line.

## Contract questions

- X-163: Which way is the sign of a bank `amountCents` (contracts: `Signed`)? Findings 1 and 2.
- X-164: Does a pending, in-window, in-category row make the hero `partial`, or is it ignored as the seed assumes?
- X-165: Is the offer's window anchored at the moment's due time or at the clone's Friday?
- X-166: May a Memory's root be a typed Slice with a null range? If so, how is it hashed?
- X-167: Should the Lab count `alleged` guesses?

## Rulings needed

- `TEMPLATES` in the runner is the one table that binds a template ID to wording. The wish, the moved card, "Gone" and care first are `null` until the build has wording for them.
- Each beat-3 variant past the merged one rests on test setup: `rewriteEvidence` flips the seeded amounts and drops the pending decoy. That setup stands in for a fix, not for the fix itself.
- The world clock moves through the `setWorldClock` seam until `/api/seed/advance` exists.

## Hot files touched

None. The new files are `testing/script-runner.ts` and `scripts/*.ts`.

## Checks

These ran after the second merge of `build/plan-stages`.
- `npx vitest run --maxWorkers=3`: exit 0, 392 files, 3,711 passed, 35 expected fails. All 35 expected fails are this lane's new tests, which brief 029 asks for. There were none before it, and no timeouts.
- `npm run lint`: exit 0, 0 errors, 1 warning in `apps/web` (not this lane's).
- `npm run typecheck`: exit 0.
- `npm run build`: not run, because nothing under `apps/web` changed.

## Not tested

- Anything live: no real model, no emulator, no browser.
- The model answers in every script are assumptions, written beside the step that needs them.
