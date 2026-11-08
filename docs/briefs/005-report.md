# Brief 005 report: fixes after the first voice call

Built with Kiro on Nov 8, 2026, branch `build/lab-ui`. Nothing was pushed or deployed. Commits, in order:

1. `docs: brief 005, fixes after the first voice call`
2. `server: log the code and a capped message for dependency failures` (item 1)
3. `server: one budget for session open, and a lock-free Head read` (item 2)
4. `docs: live check result` (item 3)
5. This report.

## Checks

At commits 2–4, `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all exited 0. `npm run test:emulator` ran locally (Java 21 is installed on this machine) and exited 0 with 3 files and 41 tests.

| Check | Result |
|---|---|
| `npm test` | 126 files, 1,192 tests passed |
| `npm run lint`, `npm run typecheck`, `npm run build` | exit 0 |
| `npx tsc --noEmit -p tests` (the emulator tests, which no workspace typecheck covers) | exit 0 |
| `npm run test:emulator` | 41 tests passed: rules, Store_Port conformance (now with a snapshot case), and the new `open-retry.test.ts` |

## 1. What the dependency failure was

`runRoute` now logs `route.dependency` with the route, the error's `name`, its `code` when it has one, and the first 200 characters of its message. gRPC numbers become names (10 → `ABORTED`), because Firestore errors carry the number and are all named `Error`. A string code is kept only when it looks like an identifier (`auth/internal-error`, `rate_limit_exceeded`). A non-Error throw logs only `error:"unknown"`.

Two error types log their code and no message, with a comment in `routes/errors.ts`:

- **OpenAI API errors.** A 400 message can quote the rejected input, which can be transcript or Memory text.
- **SyntaxError.** Node's `JSON.parse` message quotes the start of the text it failed on, which can be model output.

Witnesses are in `packages/server/src/routes/runtime.test.ts`: a Firestore-style error with code 10, an Admin SDK string code, a plain `TypeError`, two non-Error throws, a 400-character message cut to 200, an OpenAI `APIError`, a `SyntaxError`, and a code that is not an identifier.

## 2. Session open budget and the lost-answer retry

**Phase log.** Each open logs one `open.phases` line with `guardMs`, `coreMs`, `ledgerMs`, `tickMs`, `drainMs`, `txMs` and `priorMs`, plus `drainLimitMs`, `hangupBudgetMs`, `drainWon`, `totalMs` and the outcome. It holds times only.

**Budget.** Session open has one server budget, `OPEN_BUDGET_MS = 3,500`, counted from the first line of `runRoute`, so it covers the token check. The fixed 3,000 ms drain race (`OPEN_DRAIN_LIMIT_MS`) is gone. The drain now gets whatever is left after reserving 1,400 ms (`OPEN_TAIL_RESERVE_MS`). The prior Session's hangups get whatever is left after reserving 700 ms (`PRIOR_CLOSE_RESERVE_MS`), and never more than the existing 1,000 ms. When a hangup runs out of time, the prior Session is still marked closed and its `hangup` Job is written, as before. The Job is now also driven through `schedule`, as close does.

Where the numbers come from. I measured on the emulator with 75 ms added to every Firestore read and commit, since the code's comments put a laptop-to-us-central1 round trip at about 75 ms:

- Core documents plus the ledger entry: about 400 ms.
- The expiry tick, in the minute it runs: about 410 ms.
- The open transaction: 520–650 ms.
- The prior close's own transaction plus its Extract_Jobs: 500–550 ms.

The two reserves are those last two numbers with some margin. The 3,500 ms budget leaves 1.5 s of the browser's 5 s. That 1.5 s covers the network, Next.js, and a cold process's first token check and first Firestore connection. The live log suggests those are not small: the cold open spent 4.6 s in application code. Across every open in the new emulator test, answer times ranged from 0.36 s to 3.35 s. The browser's 5 s limit is unchanged.

**The lost-answer retry.** `tests/firestore/open-retry.test.ts` runs the live sequence against the emulator with live timers and the live Clock_Port:

1. A prior Session has a registered call, and a queued Extract_Job is waiting.
2. The first open commits, and its answer is treated as lost. Its drain has claimed the job and is still running through `schedule`.
3. A second open arrives with a new `requestId`.

The test checks that the second open answers 200 within 3,500 ms, that the first Session is `closed`, that exactly one Session is live, that `core/epoch.activeSessionId` names the new Session, and that the job finishes afterwards. It runs five scenarios: extraction at 1.5 s and 8 s, 75 ms round trips with a 1.5 s hangup, and two "collide" cases where the Extract_Job's commit runs inside the retry's transaction.

**What failed on the emulator, and the fix.** Before the fix, the collide case failed every time. A fixed extraction delay of 5 s also failed by chance. In both, the retry's open transaction and the Extract_Job's commit transaction waited on each other:

- The commit had read `core/epoch` and was creating a Memory inside the Memory range the open had read.
- The open was trying to write `core/epoch`.

After a 2.2 s lock wait, the emulator aborted the open with `10 ABORTED: Transaction lock timeout`, which the store maps to 409 `STALE`. The retry took 5 s. The trace showed this. When I put the old read back temporarily, the collide witness failed with 409. With the fix, it passes.

The fix is in the open itself. It now reads the Memories and their Evidence through a read-only Firestore transaction. That gives one consistent view and takes no locks. It is a new optional `snapshot` method on the Store_Port, implemented by both stores and covered by a new conformance case. The open's single write transaction is otherwise unchanged, so a failure still commits nothing (R26.11). The cost is that a Memory committed after the snapshot reaches the Head at the next open, which is already what happens to a Memory written mid-call.

This changes design fix 6, which read the Memories inside the transaction. `.kiro/specs/first-spoken-call/design.md` (Session open, Extraction worker, test table, question 6) is updated, and contract question 45 records the change. `docs/design/` was not touched.

**What I found the 503's cause to be.** I can't say for certain. The emulator reproduces a failure in the same sequence and the same window: the Extract_Job left running by the first open collides with the retry's transaction. That is now fixed. But the emulator reports the collision as `ABORTED`, and the store maps `ABORTED` to 409 `STALE`. The live run logged 503 `DEPENDENCY` with `"error":"Error"`. That means the live error had a code other than 10 (ABORTED) or 6 (ALREADY_EXISTS), or no code at all. One possibility is that production Firestore reports this kind of contention under another code. Another is that the error came from something else, such as a cold gRPC channel's `UNAVAILABLE` or `DEADLINE_EXCEEDED`. If it happens again, item 1's log line will name the code and message.

## 3. The live check

`docs/briefs/001-report.md` and `.kiro/specs/first-spoken-call/tasks.md` now record task 35 as done on Nov 8, 2026, with these details:

- The results of each step.
- Step 2 (the Debug_Panel) was not watched.
- The cold-open timeout and the 503.
- Chrome and microphone access.
- The real OpenAI calls.
- The warm server times, as observed numbers.
- The task's final message: run commands from a fresh clone, owner actions and OpenAI calls.

The report's status line no longer says no WebRTC call has been made. Tasks 13, 25 and 33 stay unticked.

## What I couldn't check

- **Live numbers.** All my timings come from the emulator plus an artificial 75 ms delay. These need a live check on `npm run dev` against real Firestore, reading the `open.phases` lines:
  - a cold first open (guard, core documents and transaction on a fresh process);
  - a warm open;
  - an open whose prior Session still has a live call, where the hangup now gets only what is left of the budget;
  - whether 3,500 ms of server time plus the browser's overhead fits inside 5 s.
- **The live 503's code.** Production Firestore could not be exercised. The next `route.dependency` line will show it.
- **Production lock behavior.** The emulator's lock timeout may not match production Firestore. The fix removes the shared Memory reads, so the two transactions no longer wait on each other either way, but this was not seen on production.
- **Hangup cut short.** When the drain takes its full share and the prior Session has a call, the prior hangup gets about 100 ms. The hangup keeps running in the background and the `hangup` Job retries it. Whether the old call ends quickly enough on the live API was not checked.
- **CI.** It has not run, because nothing was pushed.
