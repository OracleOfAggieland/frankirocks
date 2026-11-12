# Brief 027: the visit, the time bolt, and the sheet on real data (lane `screen`, second stage)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This stage follows brief 020.

Brief 020 gave the jar, the Lab and the strip a real source. A visitor still has no way to get a seeded month, to move time, or to start over, and the "What I know" sheet and the receipt are not on the main screen. The seed lane builds the server routes (`POST /api/seed/reset` in brief 019, `POST /api/seed/advance` in brief 023). This brief builds the browser's half against the contract, and finishes the two surfaces brief 020 left out.

## Read first

- Spec §15 (lines 462 to 475): each visit clones the persona, jumps are labeled simulated, chips drive it with no microphone.
- Contracts: `POST /api/seed/reset` (line 745), `POST /api/seed/advance` (746), `open` with `visitId` (736), `core/state` (261), `GET /api/memory` (743), `Proactive` and `Card` in the wire types (690 to 708).
- `.kiro/specs/lab-ui-foundation/design.md` questions 7, 8 and 11.
- `docs/briefs/020-report.md`; `docs/briefs/019-design.md` and `019-report.md` if they are in your working copy after the merge (the seed lane may still be building; if they are absent, build to the contract and put every name you had to guess in one constants file).
- `apps/web/src/client/api.ts`, `typed-turns.ts`, `components/App.tsx`, `components/screen/MainScreen.tsx`, `components/surfaces/WhatIKnowSheet.tsx`, `Receipt.tsx`, `ui/receipt-from.ts`, `ui/copy.ts`.

## What to build

1. **Client calls** for `/api/seed/reset` and `/api/seed/advance`, exactly as the contract gives their requests and responses, in `client/api.ts`, tested against faked answers, including 423 under a barrier and a timeout.

2. **The visit.** A pure machine in `apps/web/src/ui/visit/`: no visit yet, cloning, ready, resetting, failed. On the first entry to the lab with no stored visit ID it makes one, calls reset once, and stores the ID so a reload keeps the same month. A failed clone shows a way to try again and never an empty lab that looks finished. It needs its `docs/machines/` page.

3. **The time bolt.** A control beside the lab that moves the visitor's world clock forward through `advance`: it offers the next few labeled targets computed from the world clock (for example "Thursday, 6 PM" and "Three weeks on"), never a free date field, never backwards. While the world clock differs from the real clock, a badge says the time shown is simulated (question 8). When `advance` returns a `proactive` line or a card, the screen shows it the same way a typed turn's reply is shown. Under a barrier the bolt is disabled and says it is waiting.

4. **Start over.** A control that resets the visit, with one confirmation. A reset during a call ends the call first; show that.

5. **The "What I know" sheet on real data,** from the `overview`, `item` and `why` views of `/api/memory`: what Franki knows, where each thing came from, and nothing it may not show. The receipt view from the `receipt` view.

6. **Specimens** for the visit states, the bolt (idle, waiting, simulated), and the sheet on fixture data.

Words go in `ui/copy.ts`. Use plain labels, such as "Start over" and "Simulated time".

## Properties, red first

- **The clock only goes forward:** for any sequence of bolt presses and answers, the client never asks for a time at or before the world clock it last saw.
- **One clone per visit:** for any order of loads, reloads and failures, reset is called at most once per stored visit ID unless the visitor asks to start over.
- **A simulated time is always labeled:** whenever the shown clock differs from the real one, the badge is present.
- **The sheet shows only what the route returned:** no row appears that is not in the response, for any response.

## Looking at it

As brief 020: a dev server on port 3210 only, `/specimens` only, no sign-in, stopped when you finish. Say what was seen and what was not.

## Hot files this lane may edit

`apps/web/src/components/screen/MainScreen.tsx`, `components/App.tsx`, `client/api.ts`, `ui/copy.ts`, and the barrels. Nothing under `packages/server` or `packages/core` except a wire type the contract already defines and the code lacks, added in its own block. Not `routes/**`.

## Done

The pieces above, the properties green, the checks of brief 016 with `npm run build`, and `docs/briefs/027-report.md`, which lists every name guessed ahead of the seed lane.
