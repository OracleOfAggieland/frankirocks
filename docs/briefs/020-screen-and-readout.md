# Brief 020: the screen on real data, and the readout (lane `screen`, F10 and F5)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Brief 015 built the surfaces: the jar, the Lab, the strip, the receipt, the chips and the "What I know" sheet. They are on screen at the front door and on `/specimens`, on sample data. On `/lab` the main screen still leaves the jar and Lab slots empty (`MainScreen.tsx`, the `data-slot="jar"` and `"lab"` elements), and nothing reads a memory or a count from the store. This brief gives the surfaces a real source, mounts them, wires the chip text path, and builds the readout behind "What do you know about me?".

## Read first

- Spec §15 (lines 462 to 475), §11 (311 to 317, the floor's one read), §6 lines 196 to 241 as far as it says what may be shown or said, and lines 54, 75 and 261.
- Contracts: `GET /api/memory` (line 743), `InspectItem`, `LabView`, `StripView` (704 to 706), `Card` (693), `SnapshotView` (808 to 809), `snapshot()` (821, 838), the recall readers (659 to 677), `RecallAllV1` (452), the typed and chip rules and the Lab's counting rule (line 749), `forgetReceipt` (162), and KV10, KC06, KC09.
- `.kiro/specs/lab-ui-foundation/design.md` contract questions 1, 7, 8, 10 and 11.
- `apps/web/src/components/surfaces/`, `apps/web/src/ui/surface-props.ts`, `ui/receipt-from.ts`, `ui/landing/sample.ts`, `components/screen/MainScreen.tsx`, `components/App.tsx`, `client/api.ts`, `client/typed-turns.ts`; `packages/server/src/routes/debug-memory.ts` (the model for a read route), `head-build.ts`, `routes/tool.ts`, `packages/core/src/recall.ts`, `eligible.ts`.

## What to build

1. **`GET /api/memory`** as the contract gives it, in a new `packages/server/src/routes/memory.ts` with its thin route file: the views `overview`, `item`, `why`, `receipt`, `lab` and `strip`. Every row it returns passes the one `eligible` function for the caller's audience. The Lab's numbers are counts of real rows and distinct decisions, as contracts line 749 says: nothing is estimated and nothing is hard-coded. A view with no data returns zeros and empty lists, not samples.

2. **`snapshot()`** as contracts lines 821 and 838 give it, pure, in `packages/core`: what Franki knows, grouped for a person to read, spoken-grade only. `overview` returns it.

3. **The readout (F5).** The floor's recall: one tool-less read over all eligible lines, capped at 200, as spec §11's last paragraph says. Make `RecallAllV1`'s deadline one named constant (first-spoken-call question 36 measured 2.5 s against 1.5 s assumed; keep the measured value and say so in the report). "What do you know about me?" reads `snapshot()` and adds two recent told lines.

4. **Mount the surfaces on the main screen.** The jar, the Lab, the strip and the receipt take their props from `/api/memory` through `client/api.ts` and a small pure view-model in `apps/web/src/ui/`. Keep the surfaces' props as they are where you can; where a prop has no real source yet, say so in the report and leave that part of the surface out of the main screen. No sample data on `/lab`.

5. **Chips.** The chip "What do you know about me?" on the main screen. A chip's text goes down the typed path and counts as the owner's words (spec §15). No microphone is needed for it.

6. **The false "gone" check** (spec line 54, contracts line 749): if Franki's transcript says gone, forgot, deleted or removed with no receipt behind it, the control runs and the question "Did you want that deleted?" is shown. Build the pure detection and the card; the control it calls is the forget lane's, so leave the call as a seam and say so.

7. **A specimen** on `/specimens` that shows the main screen with these surfaces filled from a fixture that goes through the same view-model.

## Properties, red first

- **Nothing ineligible is shown:** for any store contents and audience, every row any view returns passes `eligible`, and a row marked forgotten, blocked or wrong never appears.
- **Lab counts are real:** each Lab number equals the count of the rows it names, for any store contents.
- **The readout is spoken-grade:** for any memory set, every line `snapshot()` and the readout return passes `spokenGrade` for the audience.
- **The cap holds:** the readout never returns more than 200 lines.

## Looking at it

This lane may run a dev server, on port 3210 only (`npx next dev -p 3210` from `apps/web`), and may open `http://localhost:3210/specimens` in the built-in browser to check its work. Do not sign in anywhere, and do not open any other site. Stop the server when you finish. The report says what was seen and what was not.

## Hot files this lane may edit

`apps/web/src/components/screen/MainScreen.tsx`, `components/App.tsx`, `client/api.ts`, `ui/copy.ts`, `packages/core/src/recall.ts`, `packages/server/src/routes/tool.ts` (the recall handler only), `head-build.ts` (read helpers only), and the barrels. Additions to `schema/wire.ts` in their own block. Not `routes/turn.ts`, `open.ts`, `admission.ts`, `head.ts`, `eligible.ts` (call it, do not change it), `records.ts` or `packages/core/src/voice/**`.

## Done

The route with its views, `snapshot()`, the readout, the surfaces mounted, the chip, the false-"gone" check, the specimen, the properties green, the checks of brief 016 with `npm run build`, and `docs/briefs/020-report.md`.
