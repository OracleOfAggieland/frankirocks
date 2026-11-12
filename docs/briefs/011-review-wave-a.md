# Review of wave A, before the live check

Wave A is accepted as built: 44 tasks, the report, and every check. The reviewer reran `npm test` (161 files, 1,464 tests), typecheck and lint, and ran `npm run test:emulator` (4 files, 42 tests, including the slow-path timing test). So R23.2 holds on the emulator.

Two independent read-only reviews of the diff, and the reviewer's own, found the defects below. None lets a reply play without a checked Permit, and none resumes a held reply. Several would make the live check useless, so they are fixed first.

Work on `build/voice-control`. One commit per numbered item, each ending with the trailer line `Built-with: Kiro`. For every item, write a test that fails on today's code first, then fix. Where a machine property should have caught the defect, extend the generators in the plain `testing/` modules, or add a new property in a new file. No guarded property file needs an edit for this list; if you find one that does, stop and report. Same rules as the build: edits and commits in separate calls, the telemetry variables, no network call, nothing with `--live`.

## Part 1: the fast path, as it would behave on a real call

### 1. A turn's own post must not refuse its own `fastO`

Posting a turn drops the held ack and adds the turn to `outstanding`, and `fastOProblem` refuses on either. Run (c) measured the transcript at p50 517 ms after the commit and the judge at p50 718 ms. So on most turns the transcript arrives first, the turn is posted, and its own post refuses its own `fastO`. The reply then waits for the server, by which time the speculative audio has usually begun muted, so it is cancelled and regenerated. That is slower than the code before this spec.

This came from the requirements review, which accepted "the browser drops its ack whenever it posts a turn". That was wrong. What the ack vouches for is every earlier turn.

- Posting a turn doesn't drop the ack.
- `outstanding` refuses `fastO` only for another turn's post. The turn's own post doesn't count.
- Unchanged: every `/api/turn` answer drops the held ack, and an ack whose request went out before the last answer can't grant `fastO`.
- Update R4, design §"The FastO_Rule" and question 61.
- The reviewer changed property 7 to match, in its own commit: condition (c) now reads "no outstanding `/api/turn` of another Turn". The other four conditions are unchanged.

### 2. The Deck from the state poll must carry the safe turns

`/api/session/state` issues its Deck with `turns: []` (`routes/state.ts`, `issueDeck(stamp, head, ops)`), and `adoptDeck` replaces the held Deck with it. Within a second of every turn answer, the browser's Deck has no safe turns. The judge then sees "Recent turns: none", and the speculative reply is created from this turn's audio alone. Replies are `conversation:"none"`, so the safe turns are the only memory of the call a reply has: "yes please" would be answered without Franki's own question. The server's `slowOrdinary` hash also can't match the speculative reply's.

- The state route issues its Deck with the Session's current safe turns, computed as the turn route computes them. Use the rows it already reads for the S2 check where it can, add no index, and restate the request budget in the design.
- With this, the poll is how the browser learns Franki's last reply: the assistant turn stored from the transcript receipt reaches the next reply's context within a second.
- Add a machine example test and a route test: after a turn answer and a poll, the next commit's judge and speculative reply carry the earlier user turn and Franki's reply.

## Part 2: the Voice_Machine and the Voice_Client

3. **A typed line during a call gets no reply.** `postTurn("final")` from LISTENING no longer enters HELD, so the Permit that comes back is rejected with `stamp` and Franki says nothing. Enter HELD after a final post from LISTENING, as before.
4. **Speech start while HELD with nothing in flight cancels nothing.** After `H`, with the turn posted, the owner starts talking again. `busy` is false, so there's no barge-in; the Permit then arrives and plays over the owner, and the owner's commit is dropped in SPEAKING. Speech start drops `pending` and the wait for the posted turn's Permit (KV04). The same in RECOVERY while waiting for the Neutral_Line.
5. **A new turn inherits the old turn's deadlines.** `permit` and `turnRetry` stay armed when a commit starts a new turn, and neither handler checks which turn it belongs to. An old `permit` deadline can send the new turn to RECOVERY and null it, so its transcript is dropped. Bind each deadline to its turnId, or disarm both when a new turn starts.
6. **A failed or `stale` post of a turn that is no longer current is ignored**, so `nextClientSeq` runs ahead of the server and every later turn gets `hold` for the rest of the call. Any unrecorded post of this Session, current or not, resyncs or reconnects. Also: the `permit` deadline and the request's own 5,000 ms timeout fire within a millisecond of each other; make the order not matter. A non-current turn's answer adopts a higher Deck, as the design row says.
7. **An admitted turn that hasn't been posted yet is discarded.** `fastO` admits before the transcript; a short reply ends; `toListening` nulls the turn and disarms `transcript`; the transcript arrives and is dropped. Franki answered but `/api/turn` is never sent: no Evidence, and no slow parse, which is the second net for a judge miss. Keep the unposted turn and its t0 + 5,000 wait until it is posted `final` or `missing` (R7.6). Write a property for this in a new file: every turn whose reply was admitted is posted exactly once as `final` or `missing`, or superseded.
8. **Barge-in keeps an unposted turn but leaves its `transcript` and `item` deadlines armed**, and `postTurn` runs from LISTENING. The Neutral_Line can then play mid-sentence. After a barge-in, disarm both for the kept turn and don't post from LISTENING; the next commit judges all of it.
9. **An empty transcript ends the turn through `toListening` while its reply is playing**: muted mid-word, with no cancel, no clear and no receipt, and the response keeps generating. Leave an admitted reply alone, or end it through `cancelAll`.
10. **Two state requests in flight.** `refresh`, `stateRetry` and the retry button call `postState` without the in-flight check `poll` has. One check for all four.
11. **A timer tick that arrives early is lost.** The reducer ignores a tick with `now < at` and nothing re-arms it. Re-arm the same deadline when a tick is early.
12. **Stray audio is cleared only on the regenerate branch.** After `strayAudio` is set, a valid `O` on the next turn takes the "fits" branch with no clear, and what is left of the cancelled reply in the output buffer could be heard. Honour `strayAudio` on that branch (clear and regenerate), and clear in `rejectReply`.
13. **An empty hash matches an empty hash.** Both hash commands answer `""` on failure, so a `fastO` check would pass if hashing itself failed. An empty hash never matches.
14. **A Realtime `error` for the admitted reply's own `response.create` is ignored**, and the machine waits in HELD for the 45 s cap. Treat it as a failed reply: recovery, as for a failed slow reply.
15. **Count Realtime `error` events** in machine state and show the count on the Debug_Panel, as the design asked. The live check reads the data-channel stop condition from it.

## Part 3: the server

16. **A late hit strands extraction.** A Parse_Repair hit or a superseding hit raises `policyRev`. The extraction worker marks any job with an older `policyRev` `failed`/`STALE` and writes no Memory, and `ensureExtractJobs` never recreates it. "I'm allergic to shellfish" said on a slow parse would never be saved, and neither would any other queued turn. A `policyRev` rise must never lose an extraction: a job that finds a newer `policyRev` at commit runs again at the new one. Raise a contract question for KS06 with the mechanism you choose. This matters more in wave B, where every company, quiet and alone hit raises `policyRev`.
17. **A typed line with no call open gets no reply** on any control hit except `forget`, and on any failed parse. That includes a crisis line. This is a gap in the brief, not in the build. With no call open:
    - The Decisions deadline is 2,000 ms, not 350 ms. The typed reply's own call takes longer than that, so the short deadline bought nothing.
    - The typed reply is shown for every class except those with a Fixed_Line (`forget` now; company, quiet and alone in wave B), which show their line. A crisis line shows the typed reply; the Head's crisis instruction governs it.
    - A failed parse shows the Neutral_Line as text.
    - The typed client renders whatever note the Permit carries.
18. **The Parse_Repair's transaction is never retried.** One concurrent write (a receipt, the next turn) throws `staleRevision`, the repair is lost, and the Session stays `unknown` with `ack:null` for the rest of the call. Retry it as the routes do, re-checking the lease each time.
19. **A Superseding_Post that arrives before its `missing` post has completed is rejected for good** (PARSE), and the browser treats that as a failed turn. Answer a retryable `hold` while the named request is pending or not yet visible.
20. **A late parse that chooses `alone` leaves a permanent gap.** The turn is committed and the lease cleared, but the watermark stays behind, and nothing later can move it. A turn's own committed parse advances the contiguous watermark. R15.8 only says `alone` doesn't close another turn's gap.
21. **A pasted (T) turn's tool continuation can carry S1+ notes.** Its stored `judge` is null and it has no items, so the tool route reads it as `typed` and row 3 allows all notes. A T-class turn limits its tool output to S0.
22. **A `decision` is written outside the seam**, in `intents/repair.ts`. Move it into a seam function, with the Effective_Audience.
23. **Start the Decisions call beside `ensureCoreDocs` and `beginRequest`**, as the design says, not after them. It is the slow path's longest wait.

## Report

Append a "Wave A fixes" section to `docs/briefs/011-report.md`: each item, its commit, the test that failed first, any item you disagree with and why, and any property that ran red with its seed and shrunk counterexample. Then update the live-check steps: step 1 should now read path `fastO` with the earlier turns in context, and add a step that asks a follow-up ("What did I just ask you?") to show the context arriving.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0, and the twelve wave A properties pass five full runs in a row. Stop there. Don't start wave B.
