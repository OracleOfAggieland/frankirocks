# Report 048: forget on the wire (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 048, on branch `lane/forget-b`. No commit ends `Built-with: Kiro`. This report is kept current as each stage lands, so the lane can be merged at the end of any stage.

## Stages

| Stage | State |
|---|---|
| 1. Design note (`048-design.md`) | done |
| 2. Rulings 1, 2, 16, 17 and the new No Resurrection property | done |
| 3. Admission, the turn route, the fence, the hang-up, the driver, the tick | done |
| 4. The acknowledgment, the voice machine, beat 5 | done (items a to h; commits `daa06bb` to `03b14a0`) |
| 5. The release-gate scripts | not started |
| 6. The ask by words, "Forget last thing" | not started |

## Lane start

`7a9bacb`: 635 files, 5,094 passed, 23 expected fail (the lead's run on `881f68c`, the same tree).

## Red first

### No Resurrection with Franki's replies (`packages/server/src/forget/no-resurrection-speech.property.test.ts`)

Run against `e55c888`, the code exactly as brief 047 left it (no change to closure, purge, `safeTurn` or any route). Not a stub: the real executor, the real receipt route writing Franki's replies, the real readers. 50 runs requested; it failed on the first.

- Seed: `-377689814`
- Path: `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`
- Shrunk counterexample, verbatim:

```
[{"sentences":[{"person":"Danny","food":"bibimbap","text":"Danny loves bibimbap."}],"turns":[{"sentences":[0],"mail":false,"allergy":false}],"memories":[{"turn":0,"sentence":0,"place":"glacier","parent":null,"context":null}],"effects":[],"target":0,"secondPick":0,"extractPick":0,"events":[],"fresh":{"person":"Danny","food":"risotto","place":"orchard"}}]
```

```
after step 9: "bibimbap" came back through eligible(evidence cznu2Bezu0xuhaYP-Kn4qvB2QZrj0FUKm5V1wTw6G0A)
turn 0: Danny loves bibimbap.
memory 0 (target): "Danny likes bibimbap at the glacier"
events: none
replies: Oh, bibimbap! Tell me more about Danny.
--- output ---
{"v":1,"uid":"owner-1","rev":2,"createdAt":"2026-11-03T12:00:02.500Z","updatedAt":"2026-11-03T12:00:11.500Z","epoch":2,"policyRev":1,"rootKeys":[],"rootSlices":[],"contextIds":[],"packetEids":[],"dependsOn":[],"dirty":false,"dependenciesComplete":true,"logicalId":"M7pRrHaCfaaJ8DBtyBOEZgZHMWtuhY9IJrPbmafnT6Q","revisionOf":null,"sanitizedFrom":null,"source":"voice","providerKey":null,"providerRevision":null,"connectorId":null,"generation":1,"threadKey":null,"inReplyToProviderKey":null,"closureProofs":[],"kind":"turn","status":"retained","isCurrentProvider":true,"occurredAt":"2026-11-03T12:00:00.
```

In plain words: the owner said "Danny loves bibimbap.", Franki answered "Oh, bibimbap! Tell me more about Danny.", and the owner asked to forget it; closure restamped Franki's reply Evidence to the new epoch (`rev 2`, `epoch 2`) as an unrelated survivor, so once the barrier cleared `eligible` let Franki's own sentence, with the forgotten food in it, through to speech.

### A second counterexample, from the same property after the stage 2 fix

With rulings 1, 2, 16 and 17 in place, a 1,000-run pass of the same property found a forget that never finishes. Not a leak: a job that waits at `resume` forever.

- Seed: `1495687112`
- Path: `3:1:1:1:1:1:1:1:1:1:1:1:1:1:1:2:6:5:4:2:11:2:4:2:2:2:3:3:4:4:4:4:4:4:3:3:3:3:3:4:3:9:9`
- Counterexample: two turns ("Danny loves ceviche.", "Danny loves risotto."), a Memory on each, the first forget aimed at memory 0, and a second forget (`forget2`) at step 9.
- Seen: the first job sat in `retry` at `resume` with the wait reason `closure`.

In plain words: the second forget's request turn was written after the first forget's closure had finished, below the barrier's epoch, so the first forget's resume re-planned closure, found that row "not yet restamped", and waited for a restamp nothing would ever write. The fix (`queuedEids` in `ClosureInput`): closure leaves the request Evidence of every forget queued behind the barrier to that forget, neither blocking nor restamping it. It fails closed: that row is never lifted to the cleared epoch before its own forget runs. The world now passes, and the property passes at its default 300 runs.

### Gone needs a receipt (`packages/server/src/forget/gone-needs-receipt.property.test.ts`)

Red on `daa06bb` (the lines, with no delivery yet): seed -645418995, path `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`. Shrunk counterexample: one sentence, "Danny loves paella.", stored as one Memory, then forgotten; no further acts. Message: `open 0: state connecting, blockedAt set, delivered 0, proactive null`. In one sentence: the barrier came down and the fresh call opened, but nothing said the acknowledgment. Green from `32f4aa7`, 60 runs.

### The old call is silent (`packages/core/src/voice/old-call-silent.property.test.ts`)

Red on the machine at `aaefb41`, with the final forget driver: seed 1775935755, path `2:0:0:0:0:0:0:3:2:4:4:6:6:6:7:7:7:7`. Shrunk counterexample: a call is set up, a spoken line is judged `H` and answered `blocked` for the forget, the server answers four opens `blocked` behind its barrier, then lets a fresh call through (openOk, channelOpen, two state reads, hash, created, started, speechStart). Message: `nothing said after the forget answer; phases SWAPPING RECOVERY CONNECTING RECOVERY CONNECTING RECOVERY CONNECTING RECOVERY RECOVERY RECOVERY RECOVERY`. In one sentence: four barrier answers used up the browser's three reconnects, so the call stopped trying and the acknowledgment was never said. Green from `0f077a3`, 300 runs.

## Stage 2: what changed

- Ruling 1 (`withheldSpeech` in `packages/core/src/forget/closure.ts`): Franki's own replies said after the forgotten Evidence and before the fence are withheld. Their Evidence goes `blocked` in closure order 1, and purge empties their text (`packages/core/src/forget/purge.ts`). A Fixed_Line is never withheld. A delivered moment of a forgotten Memory loses its rendered words.
- Ruling 2 (`turnEvidenceUsable` in `packages/server/src/turns.ts`): a dead turn, or a turn whose Evidence is not retained, is never a safe turn.
- Ruling 16: a restamp moves the epoch only; a survivor dirty for another reason stays dirty.
- Ruling 17 (`purgedArgs`): a purged Memory's string arguments and its hypothesis alternatives are emptied as far as the Memory schema allows. The store's immutability check accepts exactly that change (`packages/server/src/store/checks.ts`).
- Purge reads every Session's turns, not only the request's (`packages/server/src/forget/executor.ts`), so a withheld reply in another Session is emptied too.

## Stage 3: what changed

- Admission row 11 (`packages/core/src/admission.ts`): a forget in a call is held `blocked` with `swap: "now"`; a typed forget with no call gets a `postCommitControl` ack. Both outcomes carry `forget: true`. `FORGET_NOT_YET` is no longer said by admission; the constant stays in `voice/lines.ts` until stage 4 replaces it.
- The turn route (`routes/turn.ts`, `forget/on-turn.ts`): in the transaction that would commit the request turn, the turn is written `dead` with no Evidence, the fence goes up (`fenceInTx`), every Session with a registered call goes `closing` with its `hangup` Job due, and the admission row and request entry are written. After the commit the route drives the job for `FORGET_ROUTE_BUDGET_MS` (1,500 ms) or 32 steps.
- Drivers (`forget/drive.ts`): the worker tick runs every due forget job; an open that meets a barrier gives it one pass inside the same budget, and schedules the rest.
- Ports: resolve through the background model (`forget/resolve-live.ts`, 1.5 s a page, fails closed); calls close through the existing `hangup` Job (`forget/hangup-close.ts`).

Store round trips of one spoken forget through `/api/turn` in a call, counted at the store port on the test rig (`forget/on-turn.test.ts`): 21 gets, 27 queries, 19 transactions. The job ended the route at `resume`, waiting for the call to be confirmed closed (the fake has no hang-up answer).

## Stage 4: what changed

- (a) `packages/core/src/voice/lines.ts`: the Fixed_Lines `GONE_LINE` ("Gone."), `GONE_EXCEPT_RULE_LINE`, `RETELL_LINE`, `FORGET_ASK_LINE`, `ASK_ALLERGIES_LINE`, `forgetAckLines`/`forgetAckText` and `FORGET_ACK_TEXTS` (7 texts). `FORGET_NOT_YET` is gone. `isFixedLine` accepts the acknowledgment texts.
- (b) `packages/server/src/forget/ack.ts` (new): an acknowledgment is due when the receipt's `blockedAt` is set and no delivery row exists. The delivery row is one `decision` ledger row keyed by the op (`forgetAckId`), written in the same transaction as the Permit. Readers find the latest receipts with Q33 (kind, at desc, limit `ACK_RECEIPTS_MAX` = 8). `routes/open.ts` reads the candidates beside its first reads (no extra round trip), and the fresh call's open carries the acknowledgment as its `proactive`, under row 11's typed shape (`ackRule`). When company and forget come together, the fresh call inherits company and still says it.
- (c) `forget/on-turn.ts`: the typed answer carries the acknowledgment when `blockedAt` is set inside the route's budget. Otherwise `routes/state.ts` returns it once, for a Session with no call (`typedAckOnState`). `routes/turn.ts` calls `ackTypedForget`.
- (d) `packages/core/src/voice/machine.ts`: in `SWAPPING` an open answered `blocked` keeps the call muted and thinking and re-sends the same open after `BARRIER_RETRY_MS` (1 s). Past `BARRIER_WAIT_MS` (5 s from the swap start) the call shows connection recovery and stays muted. A reconnect answered `blocked` gives its attempt back. The old call gets only the cancel of what it was playing and is never resumed. The fresh call's first `response.create` is the acknowledgment, said exactly. `apps/web/src/client/typed-turns.ts` watches the state route (`TYPED_ACK_POLL_MS` 1 s, `TYPED_ACK_POLLS` 20) after a typed forget whose answer had no line. `docs/machines/voice-call.md`: three transitions and "A forget in a call". Transitions tests: `voice/voice-forget.transitions.test.ts` (4). Test driver: `voice/testing/arb-forget.ts`.
- (e) The delivery row names the turn the acknowledgment is said as. `routes/receipt.ts` clears the false-gone check only for the exact merged acknowledgment said as that turn (`ackDeliveredAs`). Any other "gone", including the same words on another turn, still asks "Did you want that deleted?" (`forget/ack.test.ts`, "a gone with no receipt still asks"). The typed forget's answer now carries its `receiptId`, and the typed watch passes it on.
- (f) Beat 5 green, below.
- (g) The two properties above, both run red first.
- (h) `forget/withheld-count.test.ts` counts `planClosure`'s `withheldTurns` over every closure page. Beat 5: 0 of 0 assistant Turns closure read, over 8 closure plans. A forget of the oldest seeded Memory (an episode, of 40 active): 0 of 0, over 7 plans. Neither scene stores any assistant Turn for closure to read, so these numbers show nothing about how much ruling 1 over-forgets in a real call. The withholding itself is covered by `packages/core/src/forget/closure-048.test.ts`.

Golden corpus re-recorded in (a): `arbCall` 13 of 600 calls moved and `arbWideCall` 8 of 500, all from the `readyAck` line becoming `GONE_LINE`. The machine change in (d) moved no corpus call.

### Changed expectations

- `packages/core/src/voice/lines.test.ts` (a): it pinned `FORGET_NOT_YET` and `isFixedLine("Gone.") === false`. Both now pin the new lines.
- Beat 5's receipt step (f): it was `mustSay` "brother". It is now a store check of the receipt's counts (their sum is at least 1, and the status is `cleaned` once the job is done, else `blocked`) plus `neverSay` "brother" on cards and reads. This is the one expectation ruling 10 allows.
- Beat 5 also gained a setup step, "a minute later", which moves the clock 60 s before the forget so the resolve does not read it as a fragment of the line before (`FRAGMENT_CONFIRM_MS`). It has no expectation. And the step "the next Head has no brother" declares one model answer for the re-extraction of the sanitized breath. Neither changes what beat 5 expects.
- `packages/server/src/testing/script-runner.ts`: the `forget.gone` template now accepts the acknowledgment lines.

No gate script waits on `W.FORGET`. A search of `packages/server/src/scripts` finds none.

## Beat 5

Stage 4: 14 steps, 14 green, none waiting. That is 13 from stage 3 plus the added setup step.

Stage 3: 13 steps: 11 green, 2 waiting ("Franki says Gone" and "the receipt separates blocked from cleaned", both for stage 4's acknowledgment). "The next Head has no brother" went green in stage 3. The script now declares the forget's resolve answer, and no longer expects the dead request turn to be extracted (ruling 3). The typed reply that runs beside the parse is still made and then dropped once admission chooses forget.

Also in stage 3: a forget's hold is no audience outcome (`audienceRow`), because the fence does its own hang-up; and the open runs its forget pass only after it met the barrier and answered `blocked`, so the seeded open keeps its 8 round trips.

## Not built

Stages 5 and 6: the release-gate scripts, the ask by words and "Forget last thing".

## Not verified

- No emulator, browser or live call. The voice machine's barrier retry and recovery are checked by the reducer tests and the property only. The typed watch in `typed-turns.ts` has no test of its own; it typechecks.
- The Q33 receipt query runs on the in-memory store, which accepts only declared index shapes. It was not run against Firestore.

## Rulings needed

- F-204. The forget's resolve is the one model call that reads the request after admission chose forget. Its input is the request span and the candidates' labels only. Confirm that reading counts as the forget's own reader under ruling 4.
- F-205. How many replies ruling 1 withheld is computed in closure (`withheldTurns`) and not stored, because `records.ts` is not this lane's file.
- F-206. A queued forget's request Evidence is left to that forget by the forget ahead of it (`queuedEids`). Confirm that is the intended owner.
- F-207. Purge empties every blocked assistant Evidence it finds, in any Session, not only the ones this op withheld (fails closed).
- F-208a. The typed reply that runs beside the parse reads the forget request before admission chooses forget, and is dropped after. Ruling 4 speaks of reads after admission; confirm this one is allowed or have the reply wait on a forget regex hit.
- F-208. A phone call placed by `make_phone_call` is not closed by a forget (unchanged; ruling 5 names browser calls).
- F-209. While the barrier is up the open still answers `state: "blocked"` (R11.6; `wire.ts` is not this lane's). The browser treats that answer as "wait and retry" during a swap or a reconnect. A wire field telling the browser to retry would be clearer.
- F-210. When an acknowledgment and a swap line are both due on a fresh open, the acknowledgment replaces the swap line (company and forget together: the company line is not said). Fails closed: one Fixed_Line, never two.
- F-211. Several due acknowledgments merge into one, the widest kind winning (`gone` < `offerRetell` < `goneExceptRule` < `ask`), with the allergy question if any asks it (`mergeAcks`).
- F-212. Only the latest `ACK_RECEIPTS_MAX` (8) receipts are read. An older forget whose acknowledgment was never said is never said (silence, never a false "gone").
- F-213. A reconnect answered `blocked` gives its attempt back, with no limit while the barrier lasts. The call stays in recovery, muted, until the barrier comes down.
- F-214. `BARRIER_WAIT_MS` (5 s) is measured from the swap's start, taken from the swap deadline (`SWAP_LIMIT_MS`).
- F-215. The typed watch reads the state route at most `TYPED_ACK_POLLS` (20) times, 1 s apart. After that the acknowledgment is left to the next state read or open.
- F-216. The state route says an acknowledgment only to a Session with no call, and only for that Session's own forgets (the job's `sourceIds[0]`). A call hears it on its fresh open.
- F-217. The delivery row is a `decision` ledger row with purpose `proactive` (as the reminders' delivery rows are; only the Admission_Seam writes `answer` decisions, `admission/seam.test.ts`) and state `complete`, keyed by the op, and its `acceptedRefs` name the receipt, the job and the turn the words are said as. No new kind or field was added.
- F-218. The false-gone check clears only for the exact merged acknowledgment text, said as its delivered turn. A model reply that says "gone" in the same call still asks.

## Files outside the hot list

- `packages/core/src/voice/testing/arb-call.ts` (the `readyAck` line is `GONE_LINE`) and `golden-traces.json` (re-recorded).
- `packages/core/src/voice/testing/arb-swap.ts` (the swap line is a protected field; two helpers made protected) and the new `packages/core/src/voice/testing/arb-forget.ts`: test-only drivers.
- `packages/server/src/testing/script-runner.ts`: one template.

## Checks at the end of stage 3

- `npx vitest run --maxWorkers=3 --shard=1/3`: exit 0, 213 files, 1,810 passed, 16 expected fail.
- `--shard=2/3`: exit 0, 213 files, 1,707 passed, 4 expected fail.
- `--shard=3/3`: exit 0, 212 files, 1,589 passed, 2 expected fail.
- Total: 638 files, 5,106 passed, 22 expected fail (lane start: 635, 5,094, 23).
- `npm run lint` (forced, no cache): exit 0, one warning in an untouched file (`apps/web/src/components/avatar/three/brass.ts`).
- `npm run typecheck`: exit 0. `npm run build`: exit 0.

## Checks at the end of stage 4

- `npx vitest run --maxWorkers=3 --shard=1/3`: exit 0, 215 files, 1,817 passed, 16 expected fail.
- `--shard=2/3`: the first run had 1 failure. `admission/seam.test.ts` allows only the seam to write `answer` decisions, and the delivery row was one. Fixed in `31780df` (purpose `proactive`); the rerun was exit 0, 214 files, 1,712 passed, 2 expected fail.
- `--shard=3/3`: exit 0, 214 files, 1,592 passed, 2 expected fail.
- Shards 1 and 3 ran before `31780df`. That commit changes one literal in `forget/ack.ts`; after it, `forget/`, `routes/`, beat 5 and `admission/seam.test.ts` were rerun: 101 files, 470 passed.
- Total: 643 files, 5,121 passed, 20 expected fail (end of stage 3: 638, 5,106, 22).
- `npm run lint` (forced, no cache): exit 0, the same one warning in an untouched file (`apps/web/src/components/avatar/three/brass.ts`).
- `npm run typecheck`: exit 0. `npm run build`: exit 0 (both after `31780df`).
