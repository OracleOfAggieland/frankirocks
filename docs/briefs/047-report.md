# Report 047: forget, part two (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 047, on branch `lane/forget-b`. No commit ends `Built-with: Kiro`. This report is kept current as the work lands.

## Lane start

`npx vitest run --maxWorkers=3` at `8e7868c` (before any change): 601 files, 4,757 passed, 2 failed, 23 expected fail. The two failures were there before this lane touched anything: `packages/core/src/dates-period.property.test.ts` (property 2) and `packages/core/src/patterns/takeout-sources.property.test.ts` (property P1, 16 s, a timeout under load). Neither is this lane's.

## Red first

### No Resurrection (`packages/server/src/forget/no-resurrection.property.test.ts`)

Run against commit `36b0d11`, the red-run scaffold: install exactly as brief 021 left it, then a closure that does nothing, a resume that releases the barrier, and a purge that does nothing. Not a `NotBuilt` throw. 1,000 runs requested; it failed on the first.

- Seed: `-529705103`
- Path: `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`
- Shrunk counterexample, verbatim:

```
[{"sentences":[{"person":"Danny","food":"gumbo","text":"Danny loves gumbo."}],"turns":[{"sentences":[0],"mail":false,"allergy":false}],"memories":[{"turn":0,"sentence":0,"place":"meadow","parent":null,"context":null}],"effects":[],"target":0,"secondPick":0,"extractPick":0,"events":[],"fresh":{"person":"Danny","food":"ceviche","place":"boardwalk"}}]
```

```
after step 7: "gumbo" came back through earlierSafeTurns
turn 0: Danny loves gumbo.
memory 0 (target): "Danny likes gumbo at the meadow"
events: none
--- output ---
[{"turnId":"tnr-turn-0_________________________________","role":"user","text":"Danny loves gumbo.",...},{"turnId":"tnr-request-nr-1___________________________","role":"user","text":"Forget what I said about gumbo.",...}]
```

In plain words: the owner said "Danny loves gumbo." and asked to forget it; once the barrier was released, the turns a fresh call carries over (`earlierSafeTurns`) still held both the original sentence and the forget request itself, because install sanitizes the Evidence but leaves each Turn's own `text` and its link to the blocked Evidence in place.

A smoke copy of the same property (not committed) that counted hits instead of failing, 300 runs against the scaffold, found resurrection through two readers only: `earlierSafeTurns` (turn text) and `peopleRoster` (entity IDs of Memories that were never withdrawn). Every reader that goes through `eligible` showed nothing, because the epoch fence hides every row stored before the forget; the same runs fail the survivors clause, since nothing is restamped.

### The other five properties

Each is a new file under `packages/server/src/forget/`, driven through the executor on the same generated worlds (`forget/testing/world.ts`), and first run against the same scaffold (`36b0d11`), 150 runs each.

| Property | File | First run | Seed and path | Shrunk counterexample, and what failed |
|---|---|---|---|---|
| The barrier clears only when it may | `barrier-clears.property.test.ts` | red | `1162036081`, `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0` | One turn "Danny loves jambalaya.", one Memory on it, the target; no close answers scripted (all `closed`), no second forget. Once the barrier was down, the turn's Evidence was still at epoch 1 under epoch 2: the barrier cleared with a survivor not restamped. |
| Purge only removes | `purge-removes.property.test.ts` | red | `1381910281`, `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0` | One turn "Danny loves jambalaya.", one Memory, the target. At `done`, `cleanupCompleteAt` was still null. |
| Restraint survives closure | `restraint-closure.property.test.ts` | red | `-797424518`, `2:0:0:0:0:0:0:0:0:0:1:1:1:1:1:1:3:2:2:2:2:2:5:2:2:2:2:2:2:6:5:6:2:3:2:3:3:3:3` | One turn "Danny loves ceviche."; two Memories on it ("Danny likes ceviche at the orchard", "... at the vineyard"); an exclude premised on the first; the second is the target. The first withdrew by packet membership, and its exclude was still `active`, with no `withdrawnHold`. |
| Closure can be re-run | `closure-rerun.property.test.ts` | green | none | Green on its first run: against a closure that writes nothing, a lost step has nothing to change. It pins the re-run once closure writes. |
| A hard rule outlives closure and purge | `rule-outlives-closure.property.test.ts` | green | none | Green on its first run: install already re-anchors the rule (FP1), and the scaffold's closure and purge touch nothing. It pins that through `done` once they do. |

### Against the real closure

All six properties pass against the real closure, resume and purge. No Resurrection passed 1,000 runs on a fresh seed after the executor landed (97 s), and again in the final full run (see Checks). No second counterexample has come up.

Two of the newer properties each failed once, against a draft of the executor that was never committed. Both times the code was fixed and the property was left as it was:

- **The barrier clears only when it may.**
  - Seed `396522700`, path `5:1:1:1:1:1:1:1:1:1:1:1:3:3:2:4:2:2:4:7:2:3:6:2:2:4:4:4:4:4:4:4:4:4:4:4:7:7`.
  - The world: two turns, "Danny loves paella." and "Danny loves tamales.", with one Memory on each. The paella Memory is the target. The first close answer was `failed`, and a second forget was queued at step 0.
  - What happened: closure handed the barrier to the queued op, and the first job moved on with its own call still `failed`. When the second op cleared the barrier, a job's call had never been confirmed closed.
  - The fix: a job that handed the barrier over still waits at resume until its own calls are confirmed closed.
- **Purge only removes.**
  - Seed `-2115539829`, path `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`.
  - The world: "Danny loves risotto.", with one Memory, the target.
  - What happened: at `done`, the request Evidence still held "Forget what I said about risotto.". Closure unlinks the request turn from that Evidence, and the Evidence names no Session, so purge could no longer find it.
  - The fix: closure keeps the request Evidence IDs in the job (`requestEids`) from its first step on.

## Built, by piece

- **Closure, pure** (`packages/core/src/forget/closure.ts`):
  - `walkDerivatives` walks the lineage transitively and ignores status, so a re-run walks the same set. It reads:
    - packet membership (`packetEids[0]`, ruling 5);
    - `dependsOn` (both `e:` and `m:` entries), `contextIds`, `supportingIds` and hypothesis premises;
    - blocked root keys.
  - `codeSurvivor` applies ruling 4. A row survives only when all of these hold:
    - it is a typed value (number, boolean, enum or money) about `self`;
    - it has one slice, mapped whole into one kept piece of the sanitized Evidence, with the same quote there;
    - the quote contains a first-person word;
    - it has no other dependency.
  - `planClosure` makes the writes:
    - every other derivative withdraws through `planWithdrawal`, and holds on the same thing merge at the higher sensitivity;
    - the moments of every derivative are cancelled with `forgotten`;
    - the request turns' Evidence is blocked;
    - turns are re-pointed: request turns lose their Evidence, and turns on blocked Evidence take the sanitized text and Evidence, or none;
    - opened topics and grants on a derivative's topics are cleared;
    - survivors below the epoch are restamped with `dirty: false` (ruling 1), except Evidence that a provider block denies.
  - `closurePages` builds pages of whole groups, at most 50 writes each, one order per page.
- **Closure, executor** (`runClosure` in `packages/server/src/forget/executor.ts`):
  - Each step re-reads the store as maintenance, never through `eligible` (ruling 3).
  - It re-plans, drops the writes already in place, and commits the next page.
  - If a row moved since the read, the step commits nothing and retries.
  - On the step with nothing left, it records the withdrawn count and promotes a queued op through `releaseBarrier` in the same transaction. That writes the op's job, receipt and burned bundle, and sets `handedTo`.
  - Re-planning and skipping what is already in place make a page re-run after a lost lease write the same thing. The persisted cursor names the last write committed.
- **Resume**:
  - `resumeDecision` (ruling 6) and `forgetAck` (ruling 8) are in `packages/core/src/forget/resume.ts`.
  - `runResume` clears the barrier only when all of these hold: the barrier is this op's, every call is confirmed closed, the re-planned closure has nothing left, the survivors are restamped, and the queue is empty.
  - With a queued op it promotes that op instead. Otherwise the job waits as `retry`, with no timeout.
  - It sets the receipt's `blockedAt` and stores the ack and up to four carried turn IDs.
  - On a clear it writes `core/bundle`, compiled again by `buildHead` at the cleared epoch (`compileCleared`).
  - `CallClosePort` (`close-port.ts`) has a fake that answers closed, failed or nothing. A call that is not confirmed closed is asked again on each attempt.
- **Purge**:
  - `planPurge` (`packages/core/src/forget/purge.ts`) removes, in this order:
    - the text of the Evidence this op blocked: text fields to null, `recipient` to empty, `observation` to none, and status `purged`;
    - from the Memories this op blocked or withdrew: the value to content-free, and `texture`, `sayAs`, `watchTokens`, `watches` and `embedding` cleared;
    - the request turns' text and Evidence link.
  - `runPurge` pages after its cursor, which only advances. On the last step it sets `cleanupCompleteAt` and completes the receipt and the job.
  - The store allows these in-place removals and nothing more (`checkImmutable`, tested in `store/checks-purge.test.ts`).
- **Schema:** `ForgetJob` gains `handedTo`, `ack`, `carryTurnIds` and `requestEids`. `withForgetJobDefaults` fills them for older jobs.
- **Machine:** `forgetPhaseRuns`, a new test file `forget-runs.transitions.test.ts`, and a rewritten `docs/machines/forget.md`.
- **The moments gap (F-167):** moments exist on this branch and closure cancels them. There is no anchors collection.
- **Unit tests:** `closure.test.ts` covers `codeSurvivor`, `forgetAck`, `resumeDecision` and `planPurge`. `closure-seed.test.ts` produces the ruling 1 counts.

## Ruling 1 on the seeded persona

`closure-seed.test.ts` loads brief 019's persona through `resetAs` (43 Memories), forgets one active Memory, and counts in the in-memory store:

- Closure took 5 pages, plus one empty step that moves the job to resume.
- It wrote 202 documents:
  - 42 Memories restamped;
  - 158 Evidence restamped;
  - 1 request Evidence blocked;
  - 1 request turn unlinked.
- The whole job took 16 steps: close 1, resolve 1, install 4, closure 6, resume 1 and purge 2, plus the end.

Firestore timing is not tested.

## Not built, and why

- **Collections this branch does not have.** Aliases, entities and entity edges, chunks, lexDf, pending cards, rollups, candidates, referents and anchors do not exist here, and doors have no store, so there is nothing to clear.
- **List and ledger action rows.** They have no lineage field (F-201).
- **Any route.** No route calls this code. The ack's words belong to the fresh call (brief 048).

## Readers No Resurrection covers, and the ones it does not

- **Covered every step:**
  - `eligible` over every Memory and Evidence;
  - `recallLines`;
  - `buildHead`;
  - the stored `core/bundle`;
  - `readFoodPrefs`;
  - `heroOffer`.
- **Covered only when no barrier is up:**
  - `getMemory` (overview, item, why and lab);
  - `earlierSafeTurns`;
  - `peopleRoster`;
  - the job's carried turns.
- **Covered only vacuously:** `heroOffer` and `readFoodPrefs`. The world has no takeout or food rows.
- **Not covered:**
  - delivery's `chooseNow`;
  - whisper notes;
  - a real mail sync. There is none on this branch, so the re-sync is simulated.

## Contract questions

- **F-200.** `safeTurnsOf` (`routes/turn.ts`) reads `Turn.text` and never checks the Evidence's status, so closure must unlink and rewrite turns. Should the route also refuse `blocked` Evidence? Routes are outside this lane.
- **F-201.** Ledger action and list rows have no lineage field. Should forget reach them?
- **F-202.** A promoted op's job is stamped with the epoch `releaseBarrier` raised, not its `capturedEpoch`, so its restamp reaches the current epoch. Is that contracts §8's intent?
- **F-203.** `walkDerivatives` treats `packetEids[0]` as the packet, which is one turn in the floor. A packet spanning several turns would need its own field.

## Rulings needed

Each of these was taken the fail-closed way, without asking:

1. **Promotion before this op's calls close.** At closure's end, promotion can come before this op's calls are confirmed closed. The barrier stays up for the promoted op, and the handed-over job still waits for its own calls at resume.
2. **A queued op with no `requestRef`** runs against the promoting op's Session. Its resolve then finds no request and asks.
3. **`UNKNOWN_SCOPE_REASON` is `ambiguous`.**
4. **`noneCleared` is recomputed at resume**, the same way install computed it.
5. **A withdrawn hold keeps its first `createdAt`**, and the higher `minSens` of any rewrite.
6. **An effect whose premise survives but whose target withdrew is left as it is.**
7. **Request turns and their Evidence.** Closure blocks the request Evidence and unlinks the request turns; purge then sets their text to null. Assistant turns are not sanitized.
8. **Purge keeps some values.** Numbers and money go to zero and text goes to "". Enum codes, booleans and entity refs are kept.
9. **Read limits.** These stop the job `blocked` with `LIMIT`:
   - a read over `FORGET_READ_MAX` (10,000 rows per collection);
   - more than 256 Sessions;
   - more than 1,000 turns in one Session.
10. **The withdrawn count** counts withdrawn derivatives other than the targets, including rows already retracted.
11. **Carried turns** are user turns only, on retained Evidence, never class T.
12. **Request Evidence that names no Session** is found by its turn ID.
13. **A blocked, retracted or wrong Memory on purged Evidence** skips the slice-hash lineage check, so its state can still move.
14. **A bundle resume cannot compile stays burned**, and the next open compiles it. That covers a fixture clock with no world time and a Head over the cap.

## Hot files touched

- `packages/core/src/schema/records.ts`: the ForgetJob fields and `withForgetJobDefaults`.
- `packages/server/src/worker/jobs.ts`: the new fields in the `forgetJob` builder.
- `packages/server/src/store/checks.ts`: the purge exception in `checkImmutable` and in `lineageFailures`.
- `packages/core/src/testing/index.ts`: one export line.
- Everything under `packages/core/src/forget/**` and `packages/server/src/forget/**`.

`eligible.ts`, `paths.ts`, `samples.ts` and every file this lane may not edit are untouched.

The two executor test files changed only in their stop-at-closure assertions, in `36b0d11`, the commit that changed the code:

- **`executor.test.ts` and `executor-review.test.ts`:**
  - the calls gained `{ until: "closure" }`;
  - `stopped` became `paused`;
  - `blocked` became `queued`.
- **`executor-review.test.ts` only:** "never leased again" became "paused at resume".

## Not tested

- Firestore, since no emulator was run.
- A live call through a real `CallClosePort`.
- Any route.
- Wall time per page.
- A real mail re-sync.

## Checks

The builder's own final run never reported back, so the lead ran these on `881f68c` (this lane with `build/plan-stages` at `a484140` merged in) and filled this section in.

- `npm run typecheck`: exit 0, 4 of 4 tasks.
- `npm run lint`: exit 0, 0 errors, 1 warning that was there before (`apps/web/src/components/avatar/three/brass.ts`).
- `npx vitest run --maxWorkers=3`: exit 0. 635 files, 5,094 passed, 23 expected fail (23 at the start of the lane: unchanged), 0 failed. It took 837 s, which is longer than one foreground command may run here; run it in shards.
- The forget and store tests alone (`packages/core/src/forget`, `packages/server/src/forget`, `packages/server/src/store`): 29 files, 134 passed, 131 s.
- `npm run build`: not run; nothing under `apps/web` changed.
- The red run, replayed by the lead: at `8471069` the No Resurrection property fails on its first case on a fresh seed (`-684645562`, path `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`): "Danny loves ceviche." came back through `earlierSafeTurns`.

## The lead's review

Three findings, each a ruling in `048-forget-on-the-wire.md`:

- Franki's own replies are not in the property's world, and nothing withholds them after a forget (048 ruling 1).
- `planClosure` restamps an unrelated survivor with `dirty: false`. No writer sets `dirty` today, so nothing reaches it yet (048 ruling 16).
- `planPurge` leaves the strings in a Memory's `args` and `hypothesis.alternatives` (048 ruling 17).

The radio's brief is also numbered 047 (`047-radio.md`). This report and `047-forget-part-two.md` are the forget lane's.

