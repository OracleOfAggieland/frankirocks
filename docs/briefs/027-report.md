# Report 027: the visit, the time bolt, and the sheet on real data (lane `screen`, second stage)

Built by Claude Code from brief 027, on `lane/screen2`. No commit here ends `Built-with: Kiro`. The seed lane's routes were not in this working copy, so everything here is built to the contract and tested against faked answers.

## Built, by task

1. **Client calls.** `resetVisit` and `advanceVisit` in `apps/web/src/client/api.ts` post the contract's requests and validate the closed responses. A 423, or a `BARRIER` code under any status, is its own answer with the retry hint; a timeout, a network error or an answer outside the closed shape is a failure; a request the contract would refuse is never sent. The request types (`ResetRequest`, `AdvanceRequest`) and the existing responses are exported from `wire.ts` in their own block. Tests: `client/api.seed.test.ts` (13), including 423 and a timeout for both routes.
2. **The visit.** Machine `ui.visit` in `apps/web/src/ui/visit/visit-machine.ts`, page `docs/machines/visit.md`, index row added. States `none`, `cloning`, `ready`, `resetting`, `failed`. First entry stores a new visit ID, then calls reset once. A reload with a stored month is ready and sends nothing. A reload that finds an ID whose reset never answered shows "Try again" and sends nothing until pressed. A failed clone is `failed`, never an empty lab. The shell is `client/visit-model.ts` (localStorage, one entry per user).
3. **The time bolt.** `ui/visit/bolt-targets.ts` offers the next 6 PM, tomorrow at 9 AM, the next Thursday at 6 PM, and "Three weeks on". No date field, and no time at or before the world clock. `VisitBar` draws them beside the Lab. Under a barrier the targets are disabled and say "Waiting for Franki to finish". The Time_Badge fills the header slot whenever the shown clock differs from the real one. A proactive line from `advance` shows on the Reply_Line, as a typed reply does, and its cards go into the dock as read cards (`ui/visit/proactive-view.ts`, `client/proactive-shelf.ts`).
4. **Start over.** One confirmation. During a call it shows "Ending the call first", hangs up, and waits for the call to close before it sends the reset. A reset clears the typed Session, the lines on screen, the sheet and the memory surfaces, then reads the memory surfaces again.
5. **The sheet on real data.** `client/sheet-model.ts` reads every `overview` page, then each row's `why`. `openItem` reads one row through `item`. The pure `ui/known-items.ts` keeps only what the route returned. The jar now opens the sheet, read-only, with the receipt slip (from the `receipt` view) at its foot.
6. **Specimens.** `/specimens`, section "The visit, the time bolt and the sheet": every visit and bolt state, the badge (simulated and absent), the sheet on fixture rows, and a live tile that runs the real machine on answers made up on the page.

## Not built, and why

- The sheet's Wrong, Forget and Don't bring it up buttons: no control route reaches the browser yet (forget lane). The sheet is read-only (`readOnly`), so it shows no button that does nothing.
- Areas, guesses and hard rules in the sheet: no view returns them. Every row shows under "Other things", guesses stay counts on the jar, and no rule rows appear.
- `openItem` (the `item` view) is built and tested, but nothing on the main screen opens it yet.
- `open` still sends `visitId: null` (see S-168).

## Red first

Each property ran against a stub first.

| Property | File | Seed | Counterexample |
|---|---|---|---|
| The clock only goes forward | `ui/visit/clock-forward.property.test.ts` | 1043495490 | `[pressAt 1700000000000]`: the stub sent advance before it had seen any world clock |
| One clone per visit (at most once) | `ui/visit/one-clone.property.test.ts` | 1485153385 | `[reload]`: the stub reused the stored ID and reset again |
| One clone per visit (stored first) | same file | 290914555 | `[]`: the stub sent reset before it stored the ID |
| A simulated time is always labeled | `ui/visit/simulated-label.property.test.ts` | 50761730 | `[pressAt 1700000000000, answerAdvance ok]`, real 1700000000001: the stub labeled phase `ready` only |
| The sheet shows only what the route returned | `ui/known-items.property.test.ts` | -1510343080 | one card, no why read: the stub's row had an empty "from", and it also listed why rows as items |

All are green at 1,000 runs.

## Names guessed ahead of the seed lane

All in `apps/web/src/client/seed-guesses.ts`: `RESET_PATH`, `ADVANCE_PATH`, `PERSONA_FIXTURE_ID` (`persona` padded to the 43-character ID shape), `VISIT_STORAGE_PREFIX` (`franki.visit.`), `RESET_TIMEOUT_MS` 8 s, `ADVANCE_TIMEOUT_MS` 4 s, and `BARRIER_STATUS` 423.

## Contract questions

- **S-167.** `fixtureId` has no named value in the contracts. The client sends `PERSONA_FIXTURE_ID`, so the seed lane's name has to match it.
- **S-168.** `open` carries `visitId`, but the server ignores it, and both the voice machine (core) and the typed path send null. This lane may not edit core. Proposal: `open` reads the visit from `core/state`, or the client passes the stored ID.
- **S-169.** The `sessionId` in the reset response has no stated meaning. The client ignores it.
- **S-170.** The client ignores `advance`'s `deck`. A proactive line shown as text sends no receipt, so `said` stays null (no claim). Proposal: add a receipt kind for a line shown as text.
- **S-171.** It isn't stated whether the fixture world clock runs between jumps or stays put. The client shows the last world clock it was given, unchanged.

## Rulings needed (each one named constant or function)

- `BARRIER_WAIT_MS` 2 s, used when a barrier answer has no `retryAfterMs`.
- `BOLT_TARGETS_MAX` 4 and the target set, with "Three weeks on" always kept.
- `CALL_END_LIMIT_MS` 5 s: if the call has not closed by then, the reset goes anyway, since the reset closes calls itself.
- A reload mid-clone waits for "Try again" and never resets on its own. Try again and Start over both reuse the same visit ID. Start over marks the stored visit unconfirmed before its reset goes out.
- `visitBadge`: any difference between the shown and real clocks shows the badge (no tolerance).
- The sheet is read-only, and rows with no area go under "Other things". `SHEET_WHY_MAX` 50, `SHEET_WHY_CONCURRENCY` 4. A failed why read keeps the row as "a source I can't show right now". A why answer without the row drops it.
- The jar opens the sheet, not the readout. The chip still opens the readout.
- Proactive cards show as read cards with no actions. Unreadable storage counts as no visit stored.

## Hot files touched

`schema/wire.ts` (one block at the end), `client/api.ts` (the import line and one appended block), `ui/copy.ts` (`visit` and `sheetData` blocks), `MainScreen.tsx` (three optional props and the `visit`, `timeBadge` and `sheet` slots), and `App.tsx` (uid on tokens, one shared clock, the visit effect, and the bar, badge, sheet and proactive wiring). No barrel was edited (`wire.ts` is already exported with `*`). Also changed: `app-controllers.ts`, `WhatIKnowSheet.tsx` (an "Other things" group, `readOnly`, `footer`), and `surface-props.ts` (`area: Area | null`, `readOnly`).

## Checks

- `npx vitest run --maxWorkers=3`: 318 files, 3,353 passed, 20 expected fail (unchanged), exit 0.
- `npm run lint`: exit 0, with one warning that was already there (`avatar/three/brass.ts`), not this lane's.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.

## Seen and not seen

**Seen:** `/specimens` on port 3210 in the built-in browser, read through the DOM. Every visit and bolt state rendered. In the live tile: entering showed the badge "Simulated: Fri 2:40 AM". Pressing "Thursday, 6 PM" moved the badge to Thu 6:00 PM and showed "How'd Biscuit do?". Start over asked once, then went back to Friday. The read-only sheet showed four rows with their sources and the receipt at its foot. The console had no errors. The pane was hidden, so no screenshot was taken. The server was stopped afterwards.

**Not tested:** the real seed routes, which don't exist in this working copy; `/lab` signed in; a reset during a real call; a reload in a real browser.
