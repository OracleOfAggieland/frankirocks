# Report 028: review fixes for the screen and forget lanes (briefs 020 and 021)

Built by Claude Code on `lane/fix1`, from an independent code review of the code briefs 020 and 021 built. Brief 016's rules apply. No commit ends `Built-with: Kiro`. Brief 021's held-back work is still held back: no closure walk over `dependsOn`, no resume, nothing says or shows "Gone", and no property states that nothing derived from a forgotten input stays eligible.

Each finding is given as the review gave it, then what was done. Every fix has its red test first, and its own commit.

## HIGH

**1. Sanitize keeps half of a removed sentence.** `packages/core/src/forget/sanitize.ts` (around line 48). The splitter ends a sentence at any ".", "!" or "?" followed by whitespace. "My brother relapsed at 3 a.m. and he might lose custody." with "relapsed" removed splits after "a.m.", drops only the first piece and keeps "and he might lose custody." "Dr.", "e.g." and "St." do the same. Fix: do not split on "." when the next character is lowercase or the token is a short known abbreviation; when unsure, fail closed by dropping up to the next line break. The committed property FP2 cannot catch this. Add a new property file whose generator makes abbreviation sentences and whose oracle is independent of `sentenceRanges`.

- Confirmed. Red: new property FP2b, `forget/sentence-abbrev.property.test.ts`, seed 83399140. Counterexample: two copies of the sentence above on two lines, removed range `[0,1)`: "and he might lose custody." was kept. Its fixed case failed the same way.
- Fix: a "." ends a sentence only when the next word does not start lowercase or with a digit, and the token before it is not a single letter, not a dotted token ("a.m", "U.S", "e.g") and not in `NON_FINAL_ABBREVIATIONS` (one named set). Otherwise the sentence runs on to the next sure end or line break, so a hit drops more, never less. "!" and "?" split as before. The oracle uses only the generator's offsets: no kept character of a hit sentence, and every sentence on an untouched line kept whole.
- Commit `cd81036`.

**2. The tool's S0 limit leaks topic counts of S1 rows.** `packages/core/src/memory-views.ts` (around line 238). `topics` counts every shown row up to the 200-row floor, but `limitSnapshot` drops it only when a card on the current page was removed. Fix: build the inspect snapshot with the permit's ceiling from the start; at the least, `limitSnapshot` returns `topics: []` when the ceiling is S0. Add a property: for any store and ceiling, nothing in the limited snapshot is derived from a row above the ceiling.

- Confirmed: the tool route builds the inspect snapshot at the private ceiling (S1, from `foregroundEC`) and limits it afterwards.
- Red: new property `memory-views.limit.property.test.ts`, seed 1720463962. Shrunk counterexample: the cursor named an S1 row (`tm8…`), a second leak the review did not name. Its fixed case (50 S0 cards on page 1, three S1 rows sorting later) showed the topic leak: count 60 for 57 S0 rows.
- Fix, the "at the least" version: under any ceiling below S1 the topics are dropped, and the cursor names the last card kept (or null when none was kept). Building the snapshot at the ceiling would mean editing `routes/tool.ts` or `recall-inspect.ts`, which are not on this fix's file list.
- Not covered by the property on purpose: `heldPrivate`. It is the designed count of what is held back, with no content. `truncated` still reflects S1 rows past the floor (a yes/no at 200 rows); a question for the lead if that matters.
- Commit `ae1869e`.

## MEDIUM

**3. Production snapshots carry no blocks or overlays.** `packages/server/src/head-build.ts` (around line 91) hardcodes `blocks: []` and never adds `overlays` rows, so `forgetDenies` denies nothing outside tests. Fix: load the owner's blocks and overlays in `snapshotFor` (and anywhere else a production Snapshot is built), in their own block of the file. Add a new property that checks a row that was NOT named as a target but shares a blocked root is denied through a production-built snapshot.

- Confirmed. Red: new property `server/forget/production-blocks.property.test.ts`, seed -1392027935. Counterexample: m0 on root B is the target, m1 on roots B and D was allowed.
- Fix: new module `server/forget/snapshot-rows.ts` (`forgetRowsFor`) reads blocks and overlays by Q28 pages. `head-build.ts` gains one import and one block before the return, and the return's `refs`, `rows`, `blocks` and `complete` use it. Past 128 blocks (the Snapshot's own limit) or 1,024 overlays, the Snapshot is not complete, so `eligible` denies every read. Covers the Head build, the recall tool and `/api/memory`.
- **Not fixed:** `routes/tool-food.ts` (`readMoneyRows`) builds its own Snapshot with `blocks: []`. It is not on this fix's file list. It should call `forgetRowsFor` the same way.
- Commit `4b7aaba`.

**4. Resolve answers "exact" after dropping spans it could not verify.** `packages/core/src/forget/resolve.ts` (around line 177). Fix: if any named removal was dropped by verification, return the pending/invalid result that holds and asks.

- Confirmed. Red: new `forget/resolve-dropped.test.ts`; one candidate plus a misquoted session span, and one plus a span from outside the session, both came back `exact`.
- Fix: one line in `checkResolve`: when fewer spans verify than were named, `scopePending` with reason `invalid`.
- The committed `resolve.test.ts` case "keeps only removal spans whose quote verifies" pinned the old behavior. It now checks both halves: all spans verified goes exact, one dropped holds. Stricter, not weaker.
- Not changed: an unknown candidate ID named next to a known one is still dropped silently, the same way. Failing closed there too would be one more line. Ruling for the lead.
- Commit `e74b463`.

**5. The `why` view quotes Evidence that never went through `eligible`.** `packages/server/src/routes/memory.ts` (around line 145) and `memory-views.ts` (around line 279). Fix: run `eligible` on each Evidence row before quoting it, with those rows in the snapshot. Add a test with a provider-blocked root Evidence of a shown Memory: its quote must not be returned.

- Confirmed. Red: new `memory-views.why-eligible.test.ts`; with a provider block on the root's provider key, the view still returned the quote.
- Fix: `whyView` runs `eligible` on each root Evidence. The route adds the Evidence it reads directly to a copy of the Snapshot first (refs and rows, the 4,096 cap marking it not complete).
- Commit `6159d5e`.

**6. Resolve reads only the session's first 100 turns.** `packages/server/src/forget/executor.ts` (around line 179). Fix: read newest first (or page through), and mark the manifest not complete when the read is capped.

- Confirmed. Red: `server/forget/executor-review.test.ts`, 150 turns before the request: the resolver got an empty request quote.
- Fix: `readSession` pages through the Session, up to `TURNS_READ_MAX` (1,000). It pages ascending because the declared turns index (Q14) is ascending only, and `store/indexes.ts` is not on this fix's file list. A capped read sets the manifest not complete, so the answer holds and asks, and install treats an unread turn as possibly uncommitted.
- Commit `22fa705`.

## LOW

**7. A hard rule added mid-install would be lost.** `executor.ts` (around line 297) reads `core/rules` outside the transaction and then overwrites the stored rules from that stale copy. Fix: check `rulesRev` inside the page transaction and retry on mismatch.

- Confirmed. The Memory_Store's revision check did not catch it, because the page reread the rules inside the transaction and wrote the stale plan over the new revision. Red: `executor-review.test.ts`, a peanut rule written right after install's read: the stored rules came out with the shellfish rule only.
- Fix: the page that writes `core/rules` rereads it in the transaction. If `rulesRev` moved and the stored rules are not already this plan's, the page throws, commits nothing, and the job retries from fresh rules.
- Commit `24b8e21`.

**8. A retry after the evidence page commits loses data.** The plan is rebuilt from the now-blocked Evidence, so `stagedSanitizedEids` and the receipt counts come out empty. Fix: carry them over from the committed writes.

- Confirmed. Red: `executor-review.test.ts`, the stop's transaction failed once after the evidence page: `stagedSanitizedEids` came out empty.
- Fix, slightly different from the suggestion: the stop (receipt, `stagedSanitizedEids`, phase) now commits in the last page's transaction. The evidence-and-rules page is always the last one, since a larger one already stops with `LIMIT`. So there is no window between them. Each page also adds the writes it really made to the receipt's `touched`, so a retry after an earlier page still counts what that page committed.
- Commit `512f3a9`.

**9. User-facing words in core.** `memory-views.ts` (around line 258) holds `EVIDENCE_LABEL` ("You said", "An email"...). Send a kind code over the wire and put the words in `apps/web/src/ui/copy.ts`.

- Confirmed. Red: new `memory-views.why-kind.test.ts` (got "You said" for `turn`) and `apps/web/src/ui/memory-source.test.ts` (no `sourceLabel`).
- Fix: a `why` root's `label` is its Evidence kind code. The words are in `COPY.memory.sources`, read by `sourceLabel` in `ui/memory-screen.ts`, with a neutral "A source" for an unknown code. `wire.ts` was not needed. No screen renders the `why` view yet, so nothing else changed.
- Commit `1c8ca58`.

**10. No code: the request turn's own Evidence is never blocked or sanitized; only the turn is marked dead.** Check what the contracts (lines 878 to 891) and spec section 8 step 2 require, and write the answer down as a contract question.

- Confirmed. `fenceForget` marks the request turns `dead` and their items in `deadItemIds`. It never reads or writes their Evidence.
- **Contract question R-169** (for whoever builds closure and purge). Contracts §8 step 2 says the forget request's audio and text "never enters safe turns/extract/chunks/U-retelling exemption; purge it". Spec §8 step 2 says "The request turn dies here: no safe turn, no extraction, no chunk". A committed request turn has a `turn` Evidence holding the words ("Forget that Danny relapsed"). Nothing blocks it, so it stays `retained` and `eligible`, and the `why` view or a later reader could quote the forgotten name back. Neither text says when "purge it" happens (at the fence, or in step 8) or what keeps the Evidence ineligible until then. Proposed answer: the fence adds a withhold overlay (or blocks the Evidence) for each request turn's `evidenceId` in its own transaction, so `eligible` denies it at once, and purge (step 8) deletes its body. An overlay is the smaller change: the fence already owns a transaction, and it denies through the one `eligible` function. Not built here.

## Files

Only the review's list: `packages/core/src/forget/**`, `memory-views.ts`, `packages/server/src/forget/**`, `routes/memory.ts`, `head-build.ts` (finding 3, one import and one block), `apps/web/src/ui/copy.ts` and `ui/memory-screen.ts`, and new test files. No committed `*.property.test.ts` was edited. One committed unit test was made stricter (finding 4).

## Checks

- `npx vitest run --maxWorkers=3`: exit 0. 324 files, 3,426 passed, 20 expected fail (unchanged), 0 failed. The known flaky voice property did not fail this run.
- `npm run lint`: exit 0, 0 errors, 1 warning that was there before (`apps/web/src/components/avatar/three/brass.ts`).
- `npm run typecheck`: exit 0, 4 of 4 tasks.
- `npm run build`: exit 0.
- `node scripts/copy-check.mjs`: exit 0.

## Not tested

These ran only on the Memory_Store, not on Firestore: the new block and overlay reads in every Snapshot, the Session paging, and the retry paths. Not measured: the latency the two extra Q28 reads add to the Head build and the recall tool. No browser, no live model.
