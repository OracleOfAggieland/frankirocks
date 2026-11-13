# Brief 047: forget, part two (lane `forget-b`, F4)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here, with two changes: your working copy is `C:\Users\albeavi\Documents\Coding\frankirocks-lanes\forget` on branch `lane/forget-b`, and contract questions are numbered `F-200` onward.

Brief 021 built forget's fence, resolve and install, and stopped there on purpose. The executor leaves every job `blocked` in phase `closure` with the barrier up, so no forget can complete. This brief builds the rest of the job: closure (spec §8 step 6), resume (step 7, the store half), purge (step 8), and the No Resurrection property that tests them. It is built by Claude Code agents from this brief, not from a Kiro spec, and no commit ends `Built-with: Kiro`.

It builds no route. Nothing built here hangs up a call, speaks, or puts "Gone" on a wire or a screen. Brief 048 wires this into `/api/turn`, the worker and the call.

## Read first

- `docs/briefs/021-design.md` (all, and section 6 above all) and `021-report.md` (rulings F-1 to F-18, questions F-163 to F-168).
- Spec §8 (lines 259 to 285) in full, and §13 line 361, which states No Resurrection.
- Contracts §8 (lines 878 to 891), the registry and its `forget` column (400 to 431), `eligible` (380 to 397), `ForgetJob` (194), the barrier (247), effects (119 to 125), `forgetReceipt` (162), Q19 (941).
- `docs/briefs/012-design.md` question 162: a row below the current epoch is denied. That is the owner's ruling and it stands.
- `packages/core/src/forget/**`, `packages/server/src/forget/**`, `packages/core/src/eligible.ts`, and `packages/core/src/forget/testing/arb-forget.ts`.

## The lead's rulings for this brief

1. **Survivors are restamped (answers F-163).** The fence raises the epoch and `eligible` denies any row below it. So closure restamps every surviving Memory and Evidence row to the barrier's epoch, `dirty: false`, in pages, before resume. The committed properties `eligible.row-epoch` and `eligible.row-stamp` are not edited and `eligible`'s clause 5 is not changed. Report how many pages and document writes one forget costs on the seeded persona (brief 019's seed), because the acknowledgment has a time target.
2. **The fence still raises the epoch only** (F-18 stands). Do not add a third `policyRev` raise site.
3. **Maintenance never goes through `eligible`** (F-1 stands). Closure, resume and purge read the store directly under the job's lease and publish nothing.
4. **The floor has no re-extraction and no `ruleSalvage`** (spec line 273). Code survivors stay: a hard rule that `reanchorRule` verifies, and a typed value code can verify on the sanitized text with an independent subject. Everything else in a dirty packet withdraws, keeps its restraint through `planWithdrawal`, and is counted on the receipt.
5. **A packet is dirty whether or not an output cited the input.** Every output of a packet that read a forgotten input withdraws, by packet membership (`packetEids`) as well as by `dependsOn`. The walk over `dependsOn` is transitive.
6. **Resume clears the barrier only when all of these hold:** the barrier is this op's, every entry in `closeCalls` is `closed`, closure finished its last page, every survivor is restamped, and the queue is empty. With a queued op it promotes that op and the barrier stays up. Any other case leaves the job where it is. There is no path that clears a barrier on a timeout.
7. **Closing calls is a port here.** Add a `CallClosePort` with a fake that can answer `closed`, `failed` or nothing. The executor's close phase calls it and records the answer. A call it cannot confirm closed is retried and blocks completion (this replaces ruling F-4's "hangs nothing up"). The real hang-up is brief 048's.
8. **Resume produces acknowledgment data, not words.** One closed value says which line a fresh call owes: gone; gone, except one safety rule on the screen; an ask for an ambiguous or vague cue; or an offer to retell when something that was not the target withdrew. Store it where brief 048 can read it. No template text and no `copy.ts` entry in this brief.
9. **Purge at the floor** deletes the text of blocked Evidence and its chunks, the text of the dead request turns, the values and lines of blocked or withdrawn Memories, and the prose of retracted effects. It keeps blocks, overlays, content-free holds, every rule in `core/rules`, the receipt's counts, and row IDs with their states. It runs in pages with a persisted cursor, only ever removes, and sets `cleanupCompleteAt` after its last page. A retry of a purge page may cross an epoch; it never publishes anything.

Where the contracts and these rulings leave a gap, take the answer that fails closed, name it as one constant or one small function, and list it under "Rulings needed".

## No Resurrection, written first and run red

Spec line 361: under any interleaving of named phases, after a forget, no moment, Head, whisper or tool result contains the target or a derivative, except from a new statement by the owner. Survivors stay usable.

Write it before any closure code, in a new file, `packages/server/src/forget/no-resurrection.property.test.ts`, with its generators beside `arb-forget.ts` in a new file.

- **Its oracle is its own.** The set of derivatives is computed from the generated store's lineage by the test: the transitive closure over `dependsOn`, every output of a packet that read the target, and every row sharing a blocked root key or provider key. It does not call the closure code, `planWithdrawal` or `planInstall` to decide what should be gone. "Contains" is checked on the output itself: each generated root carries a marker word that appears nowhere else, each derivative's text carries its root's marker, and the property searches every output string for the markers of forgotten roots.
- **It reads through the real readers.** Before writing it, list every function that turns stored rows into words for a model prompt, a wire or a screen (grep the routes and `head-build.ts`; at least `eligible`, recall, the Head and bundle compile, delivery's `chooseNow`, whisper notes, the food tool's snapshot, the memory screen's snapshot, the hero's pattern and rollups, the people list, and the turns a fresh call carries over). The property reads through each one after every step. A reader the lane cannot drive is listed in the report as not covered; it is never skipped silently.
- **It interleaves.** Steps of the forget job (each install, closure and purge page, resume) are interleaved with: an extraction commit from a packet captured before the fence; a mail re-sync that brings back a blocked provider ID; a page re-run after a lost lease; a second forget that queues; a clock advance (refused while fenced); and a new statement by the owner about the same thing, which must land on its own roots, be readable, and leave the old roots blocked.
- **Survivors.** After resume, every row the oracle calls unrelated is allowed by `eligible` in a fresh context at the new epoch, and every committed hard rule is still in `core/rules`, `active` or `pending`.
- **The generator writes plain sentences** from a small pool of people, foods and events, so a shrunk counterexample can be read by a person.
- **Red must be real.** The first run is against a closure that does nothing and a resume that releases the barrier: that is, install as it stands today, then release. A `NotBuilt` throw does not count as the red run. Record in the report, verbatim: the seed, the path, the shrunk counterexample, and one sentence in plain words saying what came back and through which reader. Commit the property and that record before the first line of closure code.
- If the property later fails on a fresh seed against your closure, that is a second real counterexample. Record it the same way and fix the code, not the property.

Run it at 1,000 cases.

## What to build

- **Closure** (step 6), as pure planners in `packages/core/src/forget/` and paged store work in the executor: the transitive walk and the packet rule above; the registry's `forget` column applied to every collection that exists on this branch (say which exist and which do not); aliases, entity edges, doors, opened topics, grants, referents, pending cards, list rows, rollups and candidates that name a forgotten row are cleared or withdrawn; non-target withdrawals go through `planWithdrawal`; survivors restamped. Every page is at most `FORGET_PAGE_DOCS` documents, has a persisted cursor, and can be re-run after a lost lease with the same result. An unfinished closure holds the fence.
- **Queue promotion:** when the closure's last page commits and an op is queued, promote it in the same transaction through `releaseBarrier`, and the job for that op runs next. The barrier is never null between two ops.
- **Resume** (step 7, store half): ruling 6, then the receipt's `blockedAt`, the bundle compiled again from eligible rows only (call the existing compile; do not edit `head-build.ts`), the acknowledgment data of ruling 8, and at most four eligible sanitized turns named for a fresh call to carry.
- **Purge** (step 8): ruling 9.
- **The machine:** `forget.job` runs `closure → resume → purge → done`. Update `forget-phase.ts`, its transition test file by a new test file if the old one is committed, and `docs/machines/forget.md`.
- **The moments gap** (F-167): if moments and anchors now have schemas on this branch (brief 023 built one-shot time), cancel a forgotten Memory's moments and keep its anchor as busy time. If they still do not, say so.

## More properties, red first

- **Closure can be re-run:** for any forget and any page re-run after a lost lease, the store ends the same.
- **The barrier clears only when it may:** for any order of close answers, closure pages, queued forgets and retries, the barrier is null only when ruling 6 holds, and it is never null between a promoted op and its job.
- **Purge only removes:** nothing purged returns, the cursor only advances, `cleanupCompleteAt` is set only after the last page, and everything ruling 9 keeps is still there.
- **A hard rule outlives closure and purge too:** FP1's claim, through to `done`. A new file; `rule-survives.property.test.ts` is not edited.
- **Restraint survives closure:** FP3's claim for every row closure withdraws. A new file.

## Hot files this lane may edit

`packages/core/src/forget/**` and `packages/server/src/forget/**` (this lane owns both), additions to `packages/server/src/worker/jobs.ts`, `schema/records.ts`, `testing/samples.ts`, `store/paths.ts`, `store/checks.ts` and the barrels. `packages/core/src/eligible.ts` only if a clause is missing, by adding, with the reason in the report. Not `routes/**`, `admission.ts`, `head.ts`, `head-build.ts`, `worker/tick.ts`, `packages/core/src/voice/**`, `packages/server/src/scripts/**` or anything under `apps/web`.

The five committed forget property files and `forget-phase.transitions.test.ts` are not edited. `server/forget/executor.test.ts` asserts the stop at `closure`; where the executor now goes further, change only those assertions, in the commit that changes the code, and name them in the report.

## Done

Commit as you go, one kind of change per commit, so that a successor could pick the work up from `git log` and the report. Then the checks of brief 016, and `docs/briefs/047-report.md` with: what was built by piece; what was not built and why; the red-first record for each property; the readers the No Resurrection property covers and the ones it does not; the page and write counts of ruling 1; contract questions; rulings needed; hot files touched; and what could not be tested without a route, the emulator or a live call.
