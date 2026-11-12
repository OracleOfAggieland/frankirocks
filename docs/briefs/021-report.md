# Report 021: forget, part one (lane `forget`, F4)

Built by Claude Code from briefs 016 and 021, on branch `lane/forget`. No commit ends `Built-with: Kiro`. Design note: `docs/briefs/021-design.md`.

## Built, by piece

| Piece | Files | Tests |
|---|---|---|
| Records | `Effect`, `Block`, `Overlay` in `packages/core/src/schema/records.ts`; samples; the `blocks`, `overlays`, `effects` collections in `store/paths.ts` and `store/checks.ts` | `forget/install.test.ts` validates every written record |
| Eligibility | Clause 10b in `eligible.ts` calls `forgetDenies` (`forget/blocks.ts`): root, provider, semantic and topic blocks (`active` or `review`) and overlays deny the row they name. Under a barrier every read is still denied | `forget/blocks.test.ts` (13), FP5, FP6 |
| Fence | `planFence`, `releaseBarrier` (`forget/fence.ts`); `fenceForget` (`server/forget/fence.ts`): epoch and policyRev raised, barrier set or op queued, bundle burned, job at `close`, pending receipt, request turns `dead` and their items in `deadItemIds` | FP4, `server/forget/executor.test.ts` |
| Resolve | `resolveInput`, `checkResolve` (`forget/resolve.ts`); `ForgetResolvePort` and `fakeForgetResolve` (`server/forget/resolve-port.ts`) | `forget/resolve.test.ts` (12) |
| Install | `planInstall`, `installPages` (`forget/install.ts`); `sanitizeText` (`forget/sanitize.ts`) | FP1, FP2, FP3, FP6, `install.test.ts`, `sanitize.test.ts` |
| `reanchorRule` | `forget/reanchor.ts` | FP1, `reanchor.test.ts` (5) |
| What withdrawal keeps | `planWithdrawal`, `withdrawnHold` (`forget/withdraw.ts`); not called outside tests | FP3 |
| Receipt and scope card data | `receiptPayload`, `receiptSummary`, `ScopeCard` (`forget/receipt.ts`) | executor test |
| The job | `forgetJob` (`worker/jobs.ts`); `advanceForget` (`server/forget/executor.ts`); the `forget.job` table (`forget/forget-phase.ts`, page `docs/machines/forget.md`) | `forget-phase.transitions.test.ts`, executor test (5) |

## Reserved

Closure (spec §8 step 6, the walk over `dependsOn`), resume (step 7: clearing the barrier, the receipt's `blockedAt`, the fresh call, "Gone"), purge (step 8) and the No Resurrection property are **not built**. No property here states that nothing derived from a forgotten input stays ineligible. The executor stops after install: the job is `blocked` in phase `closure`, the barrier stays up at `closure`, and the receipt stays `pending` with `blockedAt` and `cleanupCompleteAt` null. **No forget can complete**, nothing says or shows "Gone", admission rule 11 is unchanged, and no route calls this code. `releaseBarrier` and `planWithdrawal` exist for the reserved work and are called only by tests. What that work needs from this code is in the design note, section 6.

## Red first

| Property | File | Red seed | Counterexample |
|---|---|---|---|
| FP1 a hard rule outlives any forget | `forget/rule-survives.property.test.ts` | -713797846 | "I'm allergic to shellfish.", no target: `planInstall` NotBuilt |
| FP2 a sentence never loses half its meaning | `forget/sentence-whole.property.test.ts` | -965756729 | "Danny relapsed.", no ranges: `sanitizeText` NotBuilt |
| FP3 restraint survives (install) | `forget/restraint-survives.property.test.ts` | -1414721074 | `planInstall` NotBuilt |
| FP3 restraint survives (withdrawal) | same file | -1879565151 | "Danny relapsed.": `planWithdrawal` NotBuilt |
| FP4 the fence is one-way and the queue drains | `forget/fence-one-way.property.test.ts` | 540164081 | `[forget op0]`: `planFence` NotBuilt |
| FP5 under a barrier nothing is read | `forget/barrier-reads-nothing.property.test.ts` | none | Green on its first run: `eligible`'s barrier clause already denied. It pins that, now with recall and maintenance contexts |
| FP6 a direct target is ineligible after install | `forget/target-ineligible.property.test.ts` | 1614544288 | `planInstall` NotBuilt |

After the code, FP3's withdrawal half failed once at 215 runs: two care holds on the same target and scope with different sensitivity gave two holds, and the property found the lower one. The fix merges them into one hold at the higher sensitivity (ruling F-11). The property file was not edited.

## Rulings needed

Each is one constant or one small function.

- **F-1** `eligible` allows nothing under a barrier, maintenance included; resolve and install read the store directly under the job's lease and publish nothing.
- **F-2** A semantic block matches subject, predicate and the Memory's slot key (`block.key`), not subject and predicate alone.
- **F-3** The model's candidate label is the first 80 UTF-16 units of the Memory's line; what the user sees is typed data (ordinal, kind, date), no words.
- **F-4** Close records registered calls as `pending` and hangs nothing up.
- **F-5** A vague cue: more than one candidate where one shares no word of 3+ letters (`NAMED_WORD_MIN`, stop list) with the request. `none`, `needsMore`, a fragment under 1 s, an incomplete scan or an invalid answer also ask.
- **F-6** The model sees one page of 64 candidates, current-session first, then by word overlap; the scan is complete at 200 Memories or fewer.
- **F-7** The resolve writes a redact overlay for each verified range, and install reads those overlays as its manifest (ForgetJob has no field for ranges).
- **F-8** No entity store yet, so the roster is empty: a rule about someone other than the owner that a forget touches goes `pending`.
- **F-9** Sessions, overlays and effects are read by Q28 pages filtered in code; no index is added.
- **F-10** The stop is phase `closure`, job status `blocked` (`FORGET_STOP_PHASE`).
- **F-11** Withdrawn holds merge per kind, target and scope at the higher sensitivity.
- **F-12** When the owner releases, the next queued op is promoted with epoch and policyRev raised again; a retry of it keeps the stamps it was queued with.
- **F-13** A non-request turn still uncommitted at the fence clears `noneConfirmed` for everyone.
- **F-14** The fence writes the job at `close`.
- **F-15** More than 1,000 active effects (`FORGET_EFFECTS_MAX`), or a sanitize page over 50 documents, leaves the job `blocked` with `LIMIT`.
- **F-16** Kept pieces are joined by one space (`SANITIZE_SEPARATOR`); line breaks between them are not kept.
- **F-18** The fence raises the epoch only, not policyRev. Contracts §8 step 2 raise both, but the committed guard `scripts/policy-rev-raises.test.ts` allows exactly two raise sites, and a third would loosen it. The epoch alone already cancels earlier Decks (the stamp carries it), fails in-flight extraction `STALE` and denies older contexts. The lead decides whether the guard gains the fence as a site, and then the raise goes back in `planFence` and `releaseBarrier`.
- **F-17** A field that can't be rewritten in code (object content, typed fields, a map over 128 entries) gets no sanitized revision: the Evidence is blocked whole and its rules go pending.

## Contract questions

- **F-163** The epoch fence hides every survivor after a forget (CQ 162's open half). Kept as it is; closure must restamp survivors, or the owner rules otherwise.
- **F-164** Contracts §4's maintenance branch of `eligible` versus the committed `eligible.test.ts` (ruling F-1).
- **F-165** The Snapshot has no overlays field; overlays ride in `rows` by collection.
- **F-166** A semantic block's scope (ruling F-2).
- **F-167** Moments and anchors have no schema, so install writes a withhold overlay for an anchor but can't cancel moments. FP3 doesn't generate cancelled moments.
- **F-168** ForgetJob has nowhere to keep the resolve's removal ranges (ruling F-7).

## Disputes

- `packages/core/src/voice/testing/arb-call.ts`'s `testHasher` gives a 65-character digest for empty input (a signed FNV seed). The forget copy masks it (`forget/testing/arb-forget.ts`); the voice copy is not this lane's to change.

## Hot files touched

- `packages/core/src/eligible.ts`: imports, `ROW_SCHEMAS` gains overlays, `SnapshotRow`, the `Snapshot` type's `blocks`, block validation, the non-row guard, clause 10b. No clause was reordered.
- `packages/core/src/schema/records.ts`: one block at the end (effects, blocks, overlays).
- `packages/core/src/testing/samples.ts`: one import, three builders at the end.
- `packages/server/src/store/paths.ts`: three collections, three path builders.
- `packages/server/src/worker/jobs.ts`: `forgetJob` at the end.
- Barrels: `packages/core/src/index.ts` and `packages/server/src/index.ts`, one block each at the end.
- Also `packages/server/src/store/checks.ts` (three schema cases), `docs/machines/README.md` and `memory.md`, and `.kiro/steering/state-machines.md` (one path added to its pattern).
- One of this lane's own committed tests changed with its code: `server/forget/executor.test.ts` now expects policyRev unchanged at the fence (ruling F-18).

## Checks

- `npm run typecheck`: exit 0, 4 of 4 tasks.
- `npm run lint`: exit 0, 0 errors, 1 warning that was there before (`apps/web/src/components/avatar/three/brass.ts`; replayed from the shared turbo cache).
- `npx vitest run --maxWorkers=3`: 293 files, 3,243 passed, 1 failed, 20 expected fail (20 at the start of the lane: unchanged). The failure is `packages/core/src/voice/admitted-turn-posted.property.test.ts` (Property 13), seed -723746813, a voice reducer property this lane does not touch; rerun alone it passed 3 of 3 times. It looks like a rare generator case, not load (it failed on an assertion, not a timeout). Reported, not fixed: the voice corpus and reducer are the voice lane's. The run before the last two commits had 2 other failures, both fixed: the policyRev raise-site guard (ruling F-18) and the state-machine steering pattern, which now names `packages/core/src/forget/forget-phase.ts`.
- `npm run build`: not run; nothing under `apps/web` changed.
- Lane start: `git merge build/plan-stages` then the full suite green, 280 files, 3,186 passed, 20 expected fail.

## Not tested

No live model (the resolve port has only the fake), no Firestore emulator (the Q28 scans, the new collections and the fence transaction ran on the Memory_Store only), no hangup, no route, no browser. Nothing calls the executor in the app.
