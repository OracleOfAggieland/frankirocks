# Report 020: the screen on real data, and the readout (lane `screen`)

Built by Claude Code from brief 020, on `lane/screen`. No commit here ends `Built-with: Kiro`.

## Built, by task

1. **`GET /api/memory`**: `packages/server/src/routes/memory.ts`, route file `apps/web/src/app/api/memory/route.ts`. Views `overview`, `item`, `why`, `receipt`, `lab`, `strip`. The route only reads rows; the pure views in `packages/core/src/memory-views.ts` decide what crosses. One test decides what is shown, `shown()`: `spokenGrade` (which runs the one `eligible`) plus the audience ceiling. Before the core documents exist every view is zeros and empty lists, and nothing is written. Under a barrier: `BARRIER`. Tests: `memory.test.ts` (7).
2. **`snapshot()`**: in `memory-views.ts`. 50 cards a page over a floor of 200, topic counts, guesses and private things as counts only, two recent told lines (class U or C, newest first). `overview` returns it.
3. **The readout (F5)**: `readout()` and `readoutFromPages()` read every snapshot page, told lines first, each row once, capped at `READOUT_MAX_LINES = 200`. The recall tool's `inspect` purpose now answers from `snapshot()` with its two told lines and no model call (`routes/recall-inspect.ts`). When the turn's admission allows S0 notes only, `limitSnapshot` takes S1 cards and lines out too. `RECALL_DEADLINE_MS` was already one named constant at the measured 2.5 s (first-spoken-call question 36 measured 2.6 s p50 at effort low and 1.7 s at effort none, against 1.5 s assumed). I left it alone. The floor's one tool-less read over all eligible lines, capped at 200, was already `recallLines` plus RecallAllV1.
4. **Surfaces mounted**: `ui/memory-screen.ts` (pure view-model), `client/memory-model.ts` (reads through `readMemory` in `client/api.ts`), and the `MainScreen` slots for the strip, chips, jar and Lab with its receipt slip. App reads on sign-in and after each typed reply, and clears on sign-out and after a forget. The jar and the chip open the readout card. No sample data reaches `/lab`.
5. **Chip**: "What do you know about me?" (`MAIN_CHIPS`). `TypedTurns.sendLine` sends it down the typed path and leaves the box alone. In a call it goes over the call's typed line. End-to-end test against the real routes: `client/chip-to-server.test.ts`.
6. **False "gone" check**: `packages/core/src/false-gone.ts` (`claimsGone`, `falseGone`), run on each typed reply against the turn's `receiptId`. The ask card says "Did you want that deleted?" with Yes and No. **The control is a seam**: `MemoryModel` takes a `goneControl` callback, which nothing passes in this build (forget lane).
7. **Specimen**: `/specimens`, section "Main screen on memory data". Fixture answers go through the same view-model.

## Not built, and why

- Jar rule motes: hard rules live in `core/rules`, which no view reads.
- Strip money figure: the comparison numbers live in rollups, which no view reads. The last terminal says "Compared".
- Lab `steered`, `declined`, `falseHolds`, `overForget`, `foodWithoutSuggest`: no ledger source yet. They are 0 on the wire and named `uncounted:<field>` in `limits`. The screen shows only the three spec §15 counters.
- The "What I know" sheet is not mounted, because `KnownItem.area` has no predicate-to-area source.
- The false "gone" check runs only on the typed path. The voice transcript check needs `routes/receipt.ts` or `core/voice/**`, which are not this lane's files.
- `S2taplogged`: no view returns S2, so nothing is logged.

## Red first

Each property ran against a stub that showed and counted every row:

| Property | Seed | Counterexample |
|---|---|---|
| `memory-views.shown` | 785157020 | one active U S0 open Memory whose Evidence is purged: shown, not spoken-grade |
| `memory-views.lab-counts` | 134330680 | one complete decision read twice: delivered 2, expected 1 |
| `memory-views.readout-spoken` | -1970899796 | one active U S0 Memory on blocked Evidence: said |
| `memory-views.readout-cap` | 55375120 (path 8) | 244 lines > 200. Run with `endOnFailure`, unshrunk: shrinking a 120-to-260-row store did not finish in 10 min |

All four are green at 1,000 runs. The cap property takes about 20 s and has a 120 s test timeout.

## Contract questions

- **S-163.** InspectItem has no count fields. The `receipt` view puts the JSON of `{retainedRules, scopePending, withdrawnCount, touched}` in `body`. Proposal: add a `receipt` field to the MemoryResponse.
- **S-164.** `/api/turn` refuses `source:"chip"` (PARSE, `turn.ts`, not this lane's file). Chips are sent as `source:"typed"`. Proposal: accept `chip` as a typed source.
- **S-165.** LabView has no "not counted" value. I used `limits` codes `uncounted:<field>`.
- **S-166.** StripView step labels are server strings. They carry the step kind, and the browser words them.

## Rulings needed (each one named constant or function)

- `shownCeiling`: private shows S1, company and unknown show S0.
- `callerAudience` in `memory.ts`: no active Session means private.
- `GONE_WORDS`: past forms only (gone, forgot, forgotten, deleted, removed, erased, wiped). Offers like "want me to remove it" don't trigger.
- `limitSnapshot` drops topic counts when it removes cards.
- `stripView`: a loop's existence completes noticed through accepted.
- Lab `readEmails` counts retained `message` Evidence only. `LAB_READ_CAP` is 2,000 rows, past which coverage is partial.

## Hot files touched

`MainScreen.tsx` (four props and slot children), `App.tsx` (memory wiring, chip, cards, surfaces; the early return also checks `controllers`), `client/api.ts` (`readMemory`, appended), `ui/copy.ts` (`memory` block), `routes/tool.ts` (the recall handler: `inspect` branch and the S0 filter line), `schema/wire.ts` (its own block at the end), and both barrels (one block each).

## Checks

- `npx vitest run --maxWorkers=3`: 292 files, 3,229 passed, 20 expected fail, exit 0.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- The voice lane's `admitted-turn-posted.property.test.ts` failed once at the lane start (seed -617582968) and passed when run alone. It is not this lane's file.

## Seen and not seen

**Seen:** `/specimens` on port 3210 in the built-in browser, read through the DOM. The jar, the Lab (128 / 3 / 0) with its receipt slip, the strip at 4 of 5, and the chip all rendered. The chip opened the readout card with told lines first, the gone toggle showed the ask, and the console had no errors. The pane was hidden, so no screenshot was taken.

**Not tested:** `/lab` signed in against a real store, the voice `inspect` path in a live call, and the route's 3 s budget on Firestore.
