# Design note 021: forget, part one (F4, steps 2, 4 and 5)

Built by Claude Code from brief 021, not from a Kiro spec. Sources: spec §8 (lines 259 to 285), contracts §1 (effects, blocks, overlays, `forgetReceipt`, `QueuedControl`, `ForgetJob`, `core/epoch`), §4 (`eligible`, registry), §5 (`ForgetResolveV1`), §7 (`reanchorRule`), §8 (forget protocol).

## 1. What this part builds, and what it holds back

Built: the fence (step 2), resolve (step 4, floor), install (step 5, floor), `reanchorRule`, what withdrawal keeps, the receipt and scope card data, block and overlay clauses in `eligible`, and a `forget` job the worker can lease and advance phase by phase.

Held back, on purpose (brief 021): closure (step 6, the `dependsOn` walk), resume (step 7, clearing the barrier, "Gone"), purge (step 8), and the No Resurrection property. The executor stops after install with the job in phase `closure` and status `blocked`. The barrier stays up, so every `eligible` read stays denied, and the receipt's `blockedAt` stays null. No route calls this code, and admission rule 11 is unchanged.

## 2. Write sets, step by step

| Step | Writes (one transaction unless paged) | Source |
|---|---|---|
| Fence, new op (no barrier) | `core/epoch`: `epoch+1` (contracts also say `policyRev+1`; held back, see gap 15), `barrier={opId, phase:"close", startedAt, deadline, queuedOps:[]}`; `core/bundle`: burned (`head`, `headHash` null, `selectedRefs` empty, `bundleRev+1`, state by `bundleAfter`); `jobs/{jobId}`: ForgetJob at phase `close`, stamped with the new epoch; `ledger/{receiptId}`: `forgetReceipt`, state `pending`; the request turns: state `dead`; the Session: request item IDs added to `deadItemIds` | C§8 step 2; C§1 core/epoch |
| Fence, barrier up | `core/epoch.barrier.queuedOps` gains one `QueuedControl` with the epoch and policyRev it found; the request turns dead-marked. Nothing else; the barrier is never overwritten | C§8 step 2 |
| Fence, retry of a known op | Nothing. The answer is the op's existing job and captured stamps | C§8 "Preserve captured stamps on retry" |
| Fence, queue full | Nothing; refused `BARRIER` (423) | C§1 core/epoch |
| Close | The job's `closeCalls` lists every Session with a registered call (`pending`) | C§8 step 3 (see ruling F-4) |
| Resolve | The job's `candidateRefs`, `scopePending`, `scopePendingId`, `manifestComplete`; phase `install` | C§8 step 4 |
| Install, page 1..n | `blocks/*` (root, semantic, provider) and `overlays/*` (redact, withhold) first; then target Memories to `blocked`, effects premised on a target to `retracted`; then sanitized Evidence revisions (new eid), the old Evidence to `blocked`, and `core/rules` re-anchored; the job's `cursor`, `blockedKeys`, `stagedSanitizedEids` | C§8 step 5; C§4 registry `forget` column |
| Install, last page | the receipt's counts; the job to phase `closure`, status `blocked` | brief 021 |

Each page is at most `FORGET_PAGE_DOCS` (50) documents. A write that is already in place (same ID, same state) is skipped, so a page can be re-run after a lost lease.

## 3. Gaps, ambiguities and conflicts, with the answer taken

1. **CQ 162, the epoch half (left for F4 by brief 012).** The fence raises the epoch, and `eligible` denies a row below the current epoch, so after any forget every row stored before it is hidden until something restamps it. This part keeps that, because it fails closed and because `eligible.row-epoch.property.test.ts` and `eligible.row-stamp.property.test.ts` (committed) pin it. It costs nothing yet: the barrier stays up, so everything is denied anyway. The reserved closure must restamp each survivor to the new epoch (with `dirty:false`) before resume clears the barrier, or the owner rules that a committed row is compared by its lineage and blocks rather than its epoch. Contract question F-163.
2. **Maintenance reads under the barrier.** The contract lets `eligible` allow in-scope maintenance reads (resolve, sanitize, purge) of the barrier's own op. The committed `eligible.test.ts` denies a matching maintenance read at `read`, `toolReturn` and `speech`. Answer: `eligible` allows nothing while a barrier is up. Resolve and install read the store directly, as maintenance, under the job's lease, and publish nothing. One function still decides what is usable, and under a barrier the answer is always no. Ruling F-1.
3. **Overlays in the Snapshot.** The Snapshot has `blocks` but no overlays. Answer: overlays travel as rows with DocRef collection `overlays`, which the Snapshot's `rows` already allows by collection. `eligible` denies a Memory or Evidence row with an active or materialized overlay naming it. It reads no overlay on a dependency (that is closure).
4. **Semantic block scope.** A semantic block keyed on subject and predicate alone would hide every `fact` about Danny when one fact was forgotten. Answer: a semantic block also carries the Memory's slot key in `key` and matches only rows with that subject, predicate and key. Ruling F-2.
5. **"A new non-control U/C row on unblocked roots passes semantic/topic."** Answer: a Memory of class U or C, created after the block, none of whose root keys carries an active root block, passes semantic and topic blocks.
6. **Block `review` state.** Both `active` and `review` deny (C§4). Ambiguous candidates get `review` root blocks, so they stay unusable while the user is asked.
7. **The fence writes the job at phase `close`.** The fence itself commits in the transaction that writes the job, so the job never needs to run a fence phase. `fence` stays in the phase union for a job written by a later route that fences separately.
8. **The resolve label.** `ForgetResolveV1.candidates[].label` is model input; it is the first 80 UTF-16 units of the Memory's line text, cut at a character boundary. Labels the user sees (scope card, receipt) are typed data only: an option's ordinal, kind and civil date. Words live in `copy.ts` when the screen work lands. Ruling F-3.
9. **A vague cue.** Code decides it: more than one candidate where some candidate's label shares no word of three letters or more with the request (outside a stop list), or the last fragment arrived under one second before, or `needsMore`, or a manifest that is not complete, or `resolution:"none"`. Each of these goes `scopePending` and asks; none removes anything. A `none` result asking rather than finishing is a fail-closed choice. Ruling F-5.
10. **Close.** The executor records every registered call as `pending` in `closeCalls` and goes on to resolve; it does not hang up. Uncertain closure means no completion, and nothing completes in this part. Ruling F-4. The hangup itself belongs with the route wiring.
11. **Moments and anchors.** Neither collection has a schema on this branch. A forgotten Memory's anchor gets a `withhold` overlay (busy only, no moments, `minSens` at least the Memory's sensitivity), written now; cancelling its moments waits for the moments schema (reported).
12. **Uncommitted turns at the fence (spec line 273).** A non-request turn of the Session whose parse is still `pending` at install, with no salvage in the floor, clears `noneConfirmed` for everyone (the attendee can't be named by code) and leaves committed rules as they are. The ask "Any allergies I should know?" is card data for the resume step.
13. **A pending re-anchored rule** is `state:"pending"`, `anonymous:true`, `subjectId:null`, `proof:null`, empty roots and `dependsOn`: the food filter applies as if anyone attends, and no erased root or name stays on it.
14. **"Subject literal in the span."** For `self`, a first-person word (`FIRST_PERSON` or "my"); for another entity, a whole-word roster label or alias of that entity; for an anonymous rule, nothing is needed. A gazetteer check: `lookupAllergen(quote)` must contain the rule's code.

15. **The fence and policyRev (found at the end of the build).** Contracts §8 step 2 raises `policyRev` with the epoch. The committed guard `scripts/policy-rev-raises.test.ts` (brief 014) allows exactly two raise sites, and adding a third would loosen it. The fence raises the epoch only. Nothing is lost today: the Session stamp carries the epoch, so every Deck and reply issued before the fence is cancelled; `eligible` denies a context at the old epoch; an Extract_Job fails `STALE` on the epoch. Ruling F-18; the lead decides whether the guard gains the fence as a third site.

## 4. Correctness properties

Each is a new file, red first against a stub that throws `NotBuilt`, then green.

| ID | File | States |
|---|---|---|
| FP1 | `forget/rule-survives.property.test.ts` | A hard rule outlives any forget: every committed rule is still in `core/rules` afterwards, `active` or `pending`; a re-anchored rule's proof quote equals the sanitized text at its span |
| FP2 | `forget/sentence-whole.property.test.ts` | For any text and removed ranges, no sanitized segment comes from a sentence that overlapped a range, except a verified rule span disjoint from every range |
| FP3 | `forget/restraint-survives.property.test.ts` | Every exclude, quiet or care hold, `wrong` mark, negative assertion and cancelled moment that is not the target still restrains what it restrained, both under install and under `planWithdrawal` |
| FP4 | `forget/fence-one-way.property.test.ts` | For any order of forgets, retries and releases, epoch and policyRev never fall, a retry keeps its captured stamps, and the barrier is null exactly when the queue is empty and the owner released |
| FP5 | `forget/barrier-reads-nothing.property.test.ts` | Under a barrier, `eligible` denies every row in every context, and `recallLines` returns no line |
| FP6 | `forget/target-ineligible.property.test.ts` | After install, every row the resolve named is denied by `eligible` in every context (named targets only) |

## 5. File plan

| File | What |
|---|---|
| `packages/core/src/schema/records.ts` (additions) | `Effect`, `Block`, `Overlay` |
| `packages/core/src/testing/samples.ts` (additions) | `sampleEffect`, `sampleBlock`, `sampleOverlay` |
| `packages/core/src/eligible.ts` | Block and overlay clauses (one block of code, clause 10b) |
| `packages/core/src/forget/fence.ts` | `planFence`, `releaseBarrier` (pure) |
| `packages/core/src/forget/forget-phase.ts` | `@machine forget.job`: the phase table and `nextForgetPhase` |
| `packages/core/src/forget/resolve.ts` | `resolveInput`, `checkResolve` (pure), the `ForgetResolveV1` shapes |
| `packages/core/src/forget/sanitize.ts` | `sanitizeText` (pure) |
| `packages/core/src/forget/reanchor.ts` | `reanchorRule` (pure) |
| `packages/core/src/forget/withdraw.ts` | `planWithdrawal` (pure, for closure to call) |
| `packages/core/src/forget/install.ts` | `planInstall` (pure, paged) |
| `packages/core/src/forget/receipt.ts` | `receiptCounts`, `scopeCard` (pure) |
| `packages/server/src/store/paths.ts`, `store/checks.ts` (additions) | `blocks`, `overlays`, `effects` collections |
| `packages/server/src/worker/jobs.ts` (addition) | `forgetJob` builder |
| `packages/server/src/forget/fence.ts` | `fenceForget` (one transaction) |
| `packages/server/src/forget/resolve-port.ts` | `ForgetResolvePort` and `fakeForgetResolve` |
| `packages/server/src/forget/executor.ts` | `advanceForget`: lease, one phase step, commit, stop at `closure` |
| `docs/machines/forget.md`, index row | the `forget.job` machine |

## 6. What the reserved work needs from this code

- **Closure** starts from a job with `payload.phase === "closure"` and `status === "blocked"` (`FORGET_STOP_PHASE`). It finds the manifest in `candidateRefs`, the installed block keys in `blockedKeys` and the sanitized evidence in `stagedSanitizedEids`. It calls `planWithdrawal` for each non-target output it withdraws, restamps survivors to the barrier's epoch (question F-163), then sets the phase to `resume` through `nextForgetPhase`.
- **Resume** calls `releaseBarrier(epoch, opId)`, which clears the barrier only when its queue is empty and otherwise promotes the next queued op (raising epoch and policyRev again). It sets the receipt's `blockedAt`. It needs `closeCalls` all `closed`.
- **No Resurrection** can drive `planInstall` and the reserved closure over the same generated stores that FP6 uses (`forget/testing/arb-forget.ts`).

## 7. Contract questions

- **F-163.** The epoch fence and survivors (above, gap 1). Proposal for v3: closure restamps every survivor to the new epoch, or `eligible` stops comparing a committed row's epoch once closure exists.
- **F-164.** `eligible` and maintenance (gap 2). Proposal: maintenance reads never go through `eligible`; contracts §4's maintenance branch moves to the forget executor.
- **F-165.** `Snapshot` has no overlays field (gap 3). Proposal: overlays are rows by collection, as built.
- **F-166.** A semantic block's scope (gap 4). Proposal: semantic blocks carry the slot key.
- **F-167.** Moments and anchors have no schema yet (gap 11), so install cannot cancel moments.
