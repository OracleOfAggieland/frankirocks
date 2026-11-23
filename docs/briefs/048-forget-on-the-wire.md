# Brief 048: forget on the wire (lane `forget-b`, F4)

Read `docs/briefs/016-plan-stages.md` first, with the same two changes as the forget brief numbered 047 (`047-forget-part-two.md`; the radio's brief shares that number): your working copy is its own worktree on branch `lane/forget-b`, and contract questions continue from `F-204`. Then read `047-forget-part-two.md` and `047-report.md`.

After that brief the forget job runs from the fence to `done` on the store, one step per `advanceForget` call, with a fake for the resolve model and a fake `CallClosePort`. Resume leaves the acknowledgment as data on the job (`ack`: `gone`, `goneExceptRule`, `offerRetell` or `ask`, with `askAllergies`) and names the turns a fresh call carries (`carryTurnIds`). No route calls any of it, and admission rule 11 still answers "I can't forget things yet."

This brief makes a forget happen from a spoken request, a typed request and the "Forget last thing" control's route, through to the acknowledgment, and turns demo beat 5 green. It is built by Claude Code agents from this brief, not from a Kiro spec, and no commit ends `Built-with: Kiro`.

## Read first

- Spec §3 lines 77 to 93 (the control turn; the Forget row hangs up every registered call), §8 in full, §13 (the release gates "old speech after forget" and "a forget leak").
- Contracts §8 steps 1, 2, 3 and 7, and the routes and states in §6.
- `packages/core/src/admission.ts` (rule 11), `packages/server/src/audience-swap.ts` and `worker/hangup.ts` (how a company hit hangs up and a fresh call takes over), `routes/turn.ts`, `open.ts`, `state.ts`, `receipt.ts`, `turns.ts`, `worker/tick.ts`, `packages/core/src/voice/machine.ts` and `voice/lines.ts`, `packages/server/src/scripts/beat5-shellfish-brother.test.ts`, `gate-kit.ts`, `testing/script-runner.ts`.

## The lead's rulings for this brief

1. **Franki's own words are withheld, because code cannot search them.** Once something forgotten was stored, any reply Franki made afterwards may repeat it ("I'm sorry about your brother."). So closure withholds, and purge empties, every piece of Franki's free speech written at or after the earliest forgotten Evidence was stored and before the fence: assistant turns and their Evidence, and any stored copy of what was spoken. A line that code worded (a Fixed_Line, a wish, the hero's lines) keeps its text only when every row it was worded from survives; one worded from a forgotten row or a derivative loses its text whenever it was written, a delivered moment's `rendered` line included. Rows, IDs, states and counts stay. The receipt counts these as a number, and the report gives that number for beat 5 and for a forget of the oldest Memory in the seeded persona, so the owner can see what this over-forgets.
2. **A reader never trusts a turn's own text** (answers F-200). `safeTurn` gives nothing for a turn whose Evidence is `blocked` or `purged`, whatever `Turn.text` holds.
3. **A forget that fires hangs up and says nothing from the old call.** Rule 11 no longer answers `FORGET_NOT_YET`. The speculative reply is cancelled and never resumed, and no reply permit, note or tool goes out on a call opened before the fence. Reuse the company hit's hang-up and swap (row 8 in `audience-swap.ts`) wherever the wire allows; the design note says what was reused and what could not be. Remove `FORGET_NOT_YET` once nothing answers with it.
4. **The request turn dies at the fence.** `/api/turn` calls `fenceForget` in the transaction that would have committed the turn. The request's words reach no safe turn, no extraction job, no chunk, no typed-reply note and no model after admission chooses forget.
5. **Every registered call closes,** on every device, through the existing hangup Job. The real `CallClosePort` reads that Job's result. A call that cannot be confirmed closed blocks completion. A phone call placed by `make_phone_call` is not a registered browser call: leave it, and list it under "not built".
6. **Who drives the job.** The turn route drives `advanceForget` after the fence commits, inside one named budget. After that the worker tick continues it (`forget` becomes a job kind the tick runs), and an open that meets the barrier gives the tick one pass before it answers. On the seeded persona one forget is 16 steps and about 200 document writes (`047-report.md`); give the same count through the route, in store round trips, in your report.
7. **Only a fresh call acknowledges.** While the barrier is up an open answers `BARRIER` with a retry hint, and the browser's retry is the wait. The first open after the receipt's `blockedAt` is set carries the acknowledgment as a `postCommitControl` ack note, said exactly, chosen from the job's `ack`: "Gone." for `gone`; "Gone, except one safety rule. It's on your screen." for `goneExceptRule`; for `offerRetell`, "Gone." and one more Fixed_Line that offers to hear again what went with it; for `ask`, ruling 9's line. `askAllergies` adds "Any allergies I should know?". These are Fixed_Lines in `voice/lines.ts`. The acknowledgment is delivered once, and a ledger row records it. After 5 seconds with no ready fresh call the browser shows its recovery state and stays muted; it never resumes the old call.
8. **Typed, with no call open.** There is nothing to hang up. If `blockedAt` is set before the route answers, the answer carries the same acknowledgment as a note. If not, the answer carries no line and the state route returns it once when it is ready. Nothing says gone before `blockedAt`.
9. **An ambiguous or vague cue asks, and only words answer it in this brief.** The job holds every candidate under review blocks, finishes, and clears the barrier. The acknowledgment is one Fixed_Line that says Franki is not sure which one and asks the owner to say a bit more. A `pending` document of kind `control` records the held candidates with neutral typed labels. While it is open, the owner's next turn is read by code: a forget with a cue resolves among the held candidates first (an exact match is forgotten and the rest are released; still ambiguous asks again); a whole closed denial ("never mind", "none of them", "no") releases every hold and forgets nothing; anything else leaves the holds and the pending as they are. Expiry asks again and never releases. The card and its taps are a later brief.
10. **The receipt view gives counts and typed labels only** (kind, civil date, ordinal), never words from what was forgotten (ruling F-3; contracts step 8, "receipt counts only"). Beat 5's step "the receipt separates blocked from cleaned" expects the card to hold "brother", which contradicts that. Change that one expectation: the card holds a blocked count of at least 1, says cleanup is not yet complete until purge ends, and never holds "brother". Name the change in the report. No other expectation in a committed script changes.
11. **The false-"gone" check stays.** Franki saying gone with no receipt in that turn still asks "Did you want that deleted?"
12. **"Forget last thing"** gets a route: a trusted tap, no model call, the target is the last admitted owner turn of the Session, the same fence and job. Putting the button on the main screen is a later brief.
13. **Company and forget together:** the fresh call inherits the narrowed audience as any swap does, and the acknowledgment still plays, since it carries no content.
14. **The voice reducer's golden corpus:** for this brief this lane is the voice lane, and may re-record it under brief 016's rule.
15. **List rows and ledger action rows stay as they are** (F-201 is the owner's). Do not add a lineage field to them here; list in the report which of them a forget cannot reach.
16. **A restamp never cleans a row (corrects ruling 1 of the forget brief 047).** `planClosure` restamps an unrelated survivor with `dirty: false`, so a row that was dirty for another reason would come out of a forget clean. No writer sets `dirty` today, so nothing reaches this yet. Restamp the epoch only and keep the survivor's own `dirty`; only a code survivor that closure re-anchors is set clean. Write the failing test first.

17. **Purge empties every field that can hold the owner's words.** `planPurge` clears a Memory's value, texture, `sayAs`, watch tokens and embedding. It leaves the strings in `args` (a label such as "brother") and `hypothesis.alternatives`. Empty those too, keeping the row valid for its predicate; if a predicate's `args` cannot be emptied and stay valid, say which in the report. The new property's world plants its marker word in these fields as well as in the value.

Where the contracts and these rulings leave a gap, take the answer that fails closed, name it as one constant or one small function, and list it under "Rulings needed".

## Properties, red first

- **No Resurrection, with Franki's replies in the world.** A new file beside the first one, which is not edited. Its world adds what the first lacks: assistant turns written through the receipt route that repeat a root's marker word, a line recorded as said, a moment's rendered line, and a whisper note on a Deck. Its readers add delivery's `chooseNow`, the whisper notes, and the route-level readers below. Run it red against the code as it stands at the start of this brief, and record the seed, the path, the shrunk counterexample verbatim, and one plain sentence on what came back through which reader. The same oracle rule holds: it computes what should be gone from the generated world, never from the code under test.
- **No Resurrection on the routes:** the same claim read through the open's Head and its first line, the state route's idle line, every tool result, typed-reply notes, the "why did you bring that up" read, and the memory views.
- **The request's words go nowhere:** for any order of turns, superseding posts and parse repairs around a forget, the request's text is in no model call made after admission, no safe turn, no extraction job, no chunk and no carried turn.
- **The old call is silent:** after a forget answer, the voice machine sends nothing to a call opened before the fence, and the first thing a fresh call says is the acknowledgment.
- **Gone needs a receipt:** for any interleaving of job steps and opens, an open carries the acknowledgment exactly when `blockedAt` is set, and at most once.
- **Every route waits:** while the barrier is up, turn, tool, state, memory, receipt, tap, advance and open answer `BARRIER`, and a forget during a reset is refused.
- **A hold is released only by an answer:** for any order of asks, answers, other turns, expiries and retries, a held candidate becomes usable again only after a release, and is never forgotten without an exact match.

## Scripts

- Beat 5: every step green, no `waits` left.
- Any gate script waiting on `W.FORGET` goes green.
- New release-gate scripts for "old speech after forget" and "a forget leak" (spec §13), at least these: a forget in the middle of a reply; a forget with a whisper pending; a forget, then the moment that was due about the forgotten thing; a forget, then a recall that asks about it; a forget, then "why did you bring that up?" about a line that named it; a forget of a guess read from mail, then the same mail synced again; and "Don't let me forget to call my brother", which is not a forget.

## Build in this order

Each stage ends with its tests green and its work committed, so the lane can be merged at the end of any stage.

1. The design note, `docs/briefs/048-design.md`: the wire step by step, every gap and the answer taken.
2. Rulings 1 and 2 with the first property, red first.
3. Admission, the turn route, the fence, the hang-up, the job's driver and the tick (rulings 3 to 6).
4. The acknowledgment on a fresh call and on a typed answer, the voice machine, and beat 5 (rulings 7, 8, 10, 11, 13).
5. The release-gate scripts.
6. The ask and its answer by words (ruling 9), and the "Forget last thing" route (ruling 12).

## Hot files this lane may edit

`packages/core/src/admission.ts`, `packages/core/src/voice/**` and its corpus, `packages/core/src/forget/**`, `packages/server/src/forget/**`, `packages/server/src/turns.ts`, `routes/turn.ts`, `open.ts`, `state.ts`, `receipt.ts`, `memory.ts` and a new route file for the control, `worker/tick.ts` and `jobs.ts`, `packages/server/src/scripts/**` and `testing/script-runner.ts`, `apps/web/src/client/**` except `memory-model.ts`, the route handler files under `apps/web/src/app/api/`, `docs/machines/**`.

Not these, because another change is in flight in them: `apps/web/src/ui/memory-screen.ts`, `apps/web/src/client/memory-model.ts`, `apps/web/src/components/**`, `apps/web/src/ui/surface-props.ts`, `apps/web/src/ui/copy.ts`, `apps/web/src/app/specimens/**`. Spoken lines live in `voice/lines.ts`, not `copy.ts`.

## Not in this brief

The button, the receipt card, the scope card and the jar's "blocked now, cleaned later" on the screen. Re-extraction and `ruleSalvage`. Phone calls in progress. Lineage on list and action rows.

## Done

The stages above, the checks of brief 016 including `npm run build`, and `docs/briefs/048-report.md`, kept current from the first stage on. The full suite takes about 14 minutes, longer than one foreground command may run, and the last builder stopped while waiting on a background run of it. So run it in the foreground in shards (`npx vitest run --maxWorkers=3 --shard=1/3`, then `2/3`, then `3/3`) and read each result before going on. The report says what could not be checked without the emulator, a browser or a live call.
