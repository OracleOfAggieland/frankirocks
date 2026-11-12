# Brief 030 design note: the seams, in order

Lane `wire`, branch `lane/wire`, from `47e4705`. Built by Claude Code. This is the task list of brief 030, made from the reports it names (017 to 029, and 028's review). Where a report and the brief disagree, the report wins, and the row says so.

Base: 408 test files, 3,772 passed, 34 expected-fail (all in `packages/server/src/scripts/`).

## Already wired before this lane (no commit needed)

| Seam | Where it already is | Note |
|---|---|---|
| The tick on open | `routes/open.ts` calls `startTick`, which schedules `memoryTick` after the jobs (023 put it in `worker/tick.ts`) | The open does not wait for `memoryTick`. Phase two needs the open's moment read to come after it; see P2-1. |
| The tick from the state route, at most once an ops minute | `routes/state.ts` calls `scheduleTick`; `takeTickSlot` is the once-a-minute gate | |
| The tick on a jump | `routes/seed-advance.ts` forces `memoryTick` | |
| The hero's result as an `insight` moment | `time/tick.ts` `derivePlans` calls `heroOffer` and `derivePattern` (023) | The report table of brief 030 item 3 asks for this; 023 already built it. What is missing is the window after a jump (P1-1). |
| The loop's `celebrate` moment at `checkAt` | `deriveLoop`; `moveMoment` runs `compareLoop` and stores before, after and delta on the leased moment | What is missing is the loop's own state (P1-3). |

## Phase one: nothing new on the wire

One seam per commit, the test first. "Witness" is the test that shows it.

| # | Seam | File and function that makes the call | Witness | Order |
|---|---|---|---|---|
| P1-1 | The hero window after the bolt (029 finding 3, X-165). Ruling: the offer's window is anchored at its live `insight` moment (its `occurrenceKey` is the window's last date), and at yesterday only when no insight moment is live. | New `time/hero-anchor.ts` (`heroAnchor`); `routes/tool-food.ts` `readMoneyRows`/`patternFor` take the anchor, so `heroOffer`, `answerTool` and the tick all read one window | Beat 3 "past the seed mismatches": "probe: the offer after the bolt still says $186" loses `waits`; a route test that the offer is the same before and after a jump | 1 |
| P1-2 | The loop's lineage (029 finding 4, X-166). Ruling: a cited row's root Slice is its first text Slice with a range; the lineage check stays as it is. A cited row with no checkable Slice makes the yes `stale`, with nothing written. | `routes/tool-food.ts` `loopMemory` | Beat 3: "Franki writes the list and the loop", "the strip after the yes", "probe: the comparison three weeks on" (both variants that reach them) | 2 |
| P1-3 | The loop's check at `checkAt`, stored. When the tick leases or closes a `celebrate` moment, the loop Memory's `loop.state` moves by `loopStateAfter`. Nothing is said. | `time/tick.ts` `moveMoment`, the logic in new `time/loop-check.ts` | A tick test: three weeks on, the loop is `eligible`, the moment carries $186, $71 and $115 | 3 |
| P1-4 | The strip's money figure from the loop. The comparison step's label is the hero lane's `hero.less` line, read from the loop's leased or delivered `celebrate` moment, only while the loop is `eligible` or `celebrated`. The browser shows it in place of "Compared". | `routes/memory.ts` (strip view input), `core/memory-views.ts` `stripView`, `apps/web/src/ui/memory-screen.ts` `stripProps` | Beat 3 "the strip fills: $115 less" (variant "past the seed mismatches" and "yes on Friday") | 4 |
| P1-5 | The Lab's count of guesses (029 finding 5, X-167). Ruling: a guess is counted while `active` or `alleged`, and still only when `eligible`. | `core/memory-views.ts` `labView` | Beat 4 "the Lab: 3 private guesses" | 5 |
| P1-6 | The receipt route's moment seams (023 table): `admitted` admits each named moment, `transcript` sets `said` only on a match (`recordSaid`), `pendingRendered` records the render. | `routes/receipt.ts`, logic in `time/said.ts` (`admitMoments`, which carries the day's counters across two moments in one response) | Receipt route tests: a leased moment admitted, a matching transcript sets `saidAt` and one `delivery` row, a non-matching one sets nothing | 6 |
| P1-7 | The false "gone" check on spoken transcripts (020). The receipt answers `controlCheck: "pending"` for an assistant transcript that claims gone with no forget receipt (forget is unwired, so no receipt exists), and the voice client tells the screen, which shows the same ask as the typed path. | `routes/receipt.ts`; `apps/web/src/client/voice-client.ts` (`onControlCheck`); `App.tsx` | Receipt route test; voice client test | 7 |
| P1-8 | The visit on open (019, 027 S-168). `open` compares the request's `visitId` with `core/state.visitId`: a different visit is `STALE`, so a tab from an old visit can't open on a new clone. Null is accepted, because the voice machine (core, not this lane's in phase one) still sends null. The typed path sends the stored visit. | `routes/open.ts`, logic in new `routes/open-visit.ts`; `apps/web/src/client/typed-turns.ts` | Open route tests | 8 |
| P1-9 | `tool-food.ts` snapshots carry the owner's blocks and overlays (028 finding 3). | `routes/tool-food.ts` `readMoneyRows` calls `forgetRowsFor` | A blocked bank row is not counted by the offer | 9 |
| P1-10 | One wire type for the reset request: `ResetRequest` becomes the one exported name, `SeedResetRequest` is removed, and its users import `ResetRequest`. | `core/schema/wire.ts` | typecheck; the existing reset tests | 10 |
| P1-11 | Rule motes in the jar (020). The `overview` view carries the count of active hard rules from `core/rules`, as a count only. | `routes/memory.ts`, `core/memory-views.ts`, `wire.ts` (one field), `ui/memory-screen.ts` `jarMotes` | Memory route test; `memory-screen.test.ts` | 11 |
| P1-12 | A `proactive` returned by `open` is shown, as one from `advance` is (027). | `apps/web/src/client/typed-turns.ts` and `App.tsx` | Client test | 12 |
| P1-13 | The seed lane's five properties at 1,000 runs, by making each case cheaper. | The five `seed/*.property.test.ts`, run count and set-up only | The suite's time | last; only if the cases can be made cheap without checking less |

Held for a later stage of this lane, and why:
- **W-166 ledger rows of the hard-rule route** (item 9): brief 032's "Outcome" section does not exist yet, and its files (`onturn/**`) are another lane's.
- **The pasted line in a call** (item 9): phase two by the brief; it is in `core/voice/**`.

## Phase two: words on the wire (waits for 031 and 033 "Outcome")

Every row passes the Gate before anything reaches the wire, in the same commit that first puts it there.

| # | Seam | Where | Witness |
|---|---|---|---|
| P2-1 | Delivery's choice as the `Proactive` on open and state: `chooseNow`, then the Gate with the session's audience and moment (`opener` or `idle`), then `proactiveOf` only on `say`; the open awaits `memoryTick` first | `routes/open.ts`, `routes/state.ts` | Beat 1 wish steps; beat 2 check-in steps |
| P2-2 | Whispers on the Deck from Gate-approved candidates only; `withWhispers` with the audience | `deck.ts` callers | 024 seams |
| P2-3 | `compileHead`'s third-party labels through `safeName` | `head.ts` | Head test |
| P2-4 | The hero offer and `celebrate` said through P2-1; `markCelebrated` after a matching `said` | `time/said.ts` | Beat 3 "the offer plays", "Franki speaks first" |
| P2-5 | `writeSaid` computes its own match (033 finding 12) | `ledger/said.ts` | Ledger test |
| P2-6 | Ledger rows: said, held, steered, declined, blocked; the Lab's five uncounted counts | `turn.ts`, `tool.ts`, `receipt.ts`, `memory-views.ts` | Lab test |
| P2-7 | `suggest` and `answer` in the call's tool list; golden corpus re-recorded | `core/voice/**` | Voice tests |
| P2-8 | The pasted line in a call (W-179) | `core/voice/**` | Voice tests |
| P2-9 | `offerReminder` and `confirmReminder` from the tool route | `routes/tool.ts` | Tool route test |
| P2-10 | W-166 rows, if brief 032's Outcome lists them | per 032 | per 032 |

## Not in this brief

Forget: no route calls the forget code; beat 5's forget steps stay expected-fail. Corrections and life changes (025). Tuning against a live model.
