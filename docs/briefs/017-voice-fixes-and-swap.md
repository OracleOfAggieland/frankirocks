# Brief 017: the call-path fixes, then the call swap (lane `voice`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Brief 014 studied the call path as state machines and left a list of fixes, each pinned by an expected-fail test: 20 `it.fails` tests today. Part 1 of this brief builds those fixes. Part 2 builds the machine and client halves of the call swap, which are tasks 46, 47 and 52 of the `voice-control` spec. Kiro wrote that spec and its tasks; this lane's code is written by Claude Code, and the tasks are ticked with that note.

## Read first

- `docs/briefs/014-report.md`: the section listing the fixes that were not built, with their steps and tests. `docs/machines/` for the machine pages.
- `.kiro/specs/voice-control/tasks.md` lines 443 to 515, `requirements.md` R14 and R20.1.10, and `design.md` questions 79, 81 and 86.
- `packages/core/src/voice/machine.ts` and the transitions tests beside it; `apps/web/src/client/voice-client.ts`, `api.ts`, `typed-turns.ts`; `packages/server/src/worker/tick.ts`.

## Part 1: the fixes with a failing test

Build each fix that has an expected-fail test, in the order the 014 report gives them. One commit per fix: the code, `.fails` removed, the paired "today:" pin deleted.

| Fix | What changes | Expected-fail tests |
|---|---|---|
| B1 | A token step that rejects still resolves the API call | `apps/web/src/client/api.token.test.ts` |
| B2 | The tick never fails an open | `packages/server/src/worker/tick.test.ts` |
| B4 | A typed line keeps its body and identity across retries | `apps/web/src/client/typed-replay.test.ts` |
| V1 step 3 | Mute is kept across a reconnect | `voice-recovery.transitions.test.ts`, `mic-muted-by-owner.property.test.ts` |
| V1 step 4 | "Try again" is never dead | `voice-recovery.transitions.test.ts` |
| V1 step 5 | Setup asks once more | `voice-setup.transitions.test.ts` |
| V2 | Turn posts and the answer wait | `voice-turn.transitions.test.ts`, `voice-posts.transitions.test.ts`, `admitted-turn-posted-wide.property.test.ts` |

The voice tests are in `packages/core/src/voice/`. Done for part 1 means the suite has no expected-fail test left for these rows. If a fix cannot be built without a decision the report leaves to the owner, leave its test as it is and say so.

The tracked property that fails about 1 run in 30 (an admitted turn is always posted, question Q-SM18) is the bug V2 fixes. After V2, run that property 30 times with fresh seeds and report the count.

The fixes with no failing test (B5, V1 step 2, V3, the S, U and W rows) are out of scope.

## Part 2: the call swap, machine and client

Tasks 46, 47 and 52, in that order, exactly as `tasks.md` gives their files and witnesses:

- **46** Property 10, "narrowing needs a closed call", with its generators in `voice/testing/arb-swap.ts`. New files. Red until 47; record the seed and counterexample.
- **47** `SWAPPING` in the Voice_Machine.
- **52** The swap in the Voice_Client.

Tasks 45, 48, 49, 50, 51 and 53 (the server half of the audience wave) are not in this lane. They are built in a later brief on top of the writes lane's changes to `/api/turn`. Build 47 and 52 against the wire shapes the spec and contracts already define (`blocked`, the care Permit, `previousSessionId`, `waitDeadline`), with the server answers faked in tests.

Rulings for this build, for the owner to confirm:
- **Question 79 (quiet is recorded as company):** taken as the spec proposes it.
- **Question 68 (crisis always takes the reply):** taken as the spec proposes it.
- **Question 54 (deadlines):** every deadline stays a named constant at the value the design gives.

Tick tasks 46, 47 and 52 in `tasks.md` when their witnesses pass, with the actual time, and add "Built by Claude Code (brief 017)" on the task's Actual line.

## Hot files this lane may edit

`packages/core/src/voice/**` (this lane owns it, and the golden corpus), `apps/web/src/client/voice-client.ts`, `api.ts`, `typed-turns.ts`, `packages/server/src/worker/tick.ts`, and the barrels. Not `routes/turn.ts`, `open.ts`, `close.ts`, `head.ts` or the schema files. If a fix needs one of those, stop that fix and report it.

A new or changed machine needs its `docs/machines/` page and index row updated.

## Done

Part 1's rows fixed or reported, tasks 46, 47 and 52 green, the checks of brief 016, and `docs/briefs/017-report.md`. The report says for each fix what changed in behaviour, how many golden calls moved and why, and what a live call would still need to show.
