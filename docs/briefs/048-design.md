# Design 048: forget on the wire (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 048. No commit ends `Built-with: Kiro`. This note is the plan the stages follow; where the build found a gap, the answer taken is named here and listed again under "Rulings needed" in `048-report.md`.

## The wire, step by step

### 1. A spoken forget (a call is open)

1. The browser posts the turn (`/api/turn`, judge `H`, final transcript). The speculative reply is already muted and cancelled by the voice machine when the judge said `H` (spec §3 control turn); nothing new is needed there.
2. The route parses as today. `serverRule` row 11 (ruling 3) now answers, for a fired forget with a call live, the same shape as row 8 (a company hit): `hold`, `blocked: true`, `swap: "now"`, with the reason `blocked` (a reason code that already exists). The route answers status `blocked` with no Permit, no Deck and no notes.
3. In the same transaction that would have committed the turn, the route fences (ruling 4). `fenceForget` is split: `fenceInTx(tx, ...)` does the writes inside a caller's transaction, and `fenceForget` keeps its own transaction around it for the tests that call it. The turn route, when admission chooses forget, writes:
   - the request Turn, `state: "dead"`, `text: null`, `evidenceId: null`, so its words reach no safe turn and no reader at all;
   - **no** Evidence, **no** Extract_Job, no chunk, and no typed-reply note (the typed reply computed beside the parse is dropped);
   - the Session update (`nextClientSeq`, `deadItemIds`);
   - the fence: epoch raised, barrier, burned bundle, the forget job and the pending receipt;
   - a `hangup` Job for every Session with a registered call (ruling 5), through `ensureHangupJob`, the company hit's own writer;
   - the admission decision row and the request entry, as every turn writes them.
   The request text the resolve step needs is kept **only** on the forget job (`requestText` is not a field of `ForgetJob`, and `records.ts` is not this lane's). So the text goes where the job already looks for it: the job's resolve reads the request turns' text. The request turn is therefore written with its text and `state: "dead"` and **no Evidence**; ruling 2 and the dead state keep every reader off it (safe turns skip dead turns and turns with no Evidence; the resolve reads dead request turns only by ID; closure unlinks; purge nulls the text). Fails closed: the words live in one row that no reader returns, and purge empties it.
4. After the commit, inside one named budget (`FORGET_ROUTE_BUDGET_MS`), the route drives the hangup Jobs and `advanceForget` with the real `CallClosePort` (ruling 6). The budget runs out without harm: the job is left `queued`/`retry` for the tick.
5. The voice machine gets `blocked` and runs the existing call swap (`startSwap`): mute, close the old call, open a fresh one naming the old Session. Nothing goes out on the old call: no Permit was issued, and the machine drops anything stale by generation.
6. The fresh open meets the barrier: the open gives the tick one pass (`forget` is now a job kind the tick runs), and if the barrier is still up answers `state: "blocked"`. In SWAPPING a blocked open goes to the existing connection recovery, whose reconnect (1, 2, 5 s) is the wait (ruling 7). The old call is never resumed.
7. The first open after `blockedAt` is set carries the acknowledgment as its `proactive`: a synthetic turn, a `postCommitControl` Permit of scope `ack`, one `ack` note with the Fixed_Line chosen from the job's `ack`. A ledger row records the delivery, so the acknowledgment is delivered once (a second open finds the row and says nothing).

### 2. A typed forget with no call open (ruling 8)

Steps 2 to 4 as above, except row 11 answers, with no call live, `permit postCommitControl`, scope `ack`, notes `none`, no line: there is nothing to hang up and nothing to swap. After the drive, if `blockedAt` is set the route answers with the acknowledgment note (one more transaction: the ack ledger row and the request entry's response). If not, the answer carries no line, and the state route returns it once when it is ready.

### 3. "Forget last thing" (ruling 12)

A new route, `POST /api/control` with `uiControl.verb = "forget"`, `source: "trustedTap"`: no model call, the target is the last admitted owner turn of the Session (its Evidence is the `requestEids`-like target: the job is fenced with `targetTurnIds`), the same fence and the same job. Built in stage 6.

## Rulings 1 and 2, 16 and 17 (stage 2)

- **Ruling 2:** `safeTurn` gives null when the Evidence is `blocked` or `purged` (and when the Turn is `dead`). One small function, `turnEvidenceUsable`.
- **Ruling 1:** `planClosure` gains `withheldSpeech(i)`: every assistant Turn (and its Evidence) in any Session whose Evidence `createdAt` is at or after the earliest forgotten Evidence's `createdAt` and whose epoch is below the barrier's. "Forgotten Evidence" is the Evidence this op blocked and the root Evidence of every derivative Memory (fails closed: the earliest of them). The Evidence goes `blocked` in closure (order 1), so the restamp skips it and every reader denies it; purge then empties it (text fields null, `purged`) and nulls the assistant Turn's text. Moments: a derivative's moment loses `rendered` whatever its status, a delivered one included. The receipt has no field for the count (`records.ts` is not this lane's), so `planClosure` returns `withheldTurnIds` and the report gives the number from tests.
- **Ruling 16:** a survivor's restamp keeps its own `dirty`; only a `codeSurvivor` is set clean. The restamp condition becomes `memory.epoch < stamps.epoch` alone.
- **Ruling 17:** `planPurge` also empties a Memory's string `args` (to `""`, keyed values kept so the predicate's keys stay present) and `hypothesis.alternatives` (to `[]`).

## The new property (stage 2)

`no-resurrection-speech.property.test.ts`, beside the first, which is not edited. Its world is the first's (`nrWorldArb`) plus, built by the test:
- an assistant turn after every user turn, written through `postReceipt` (the receipt route), whose text repeats that turn's root food ("I'm glad about the gumbo.");
- one delivered moment on a Memory, with a `rendered` line that names the Memory's place;
- a whisper note on a Deck: the Deck's `turns` read through `safeTurnsOf`, and the stored bundle's Head.

Readers: every reader of the first property, plus the assistant turns through `earlierSafeTurns` (the fresh call's carry), the stored moments' `rendered` text (delivery's `chooseNow` reads moments; on this branch the moment row's `rendered` is what a whisper re-says), and the state route's Deck turns. The oracle is the first one's plus: every assistant turn written at or after the first forgotten root's turn repeats a forgotten word only if its user turn's food is forgotten; the test plants the marker and searches for it, so the check is on the output.

## Admission, the route, the job's driver, the tick (stage 3)

- `FORGET_NOT_YET` is removed once row 11 no longer answers with it (its committed tests that pin it move to the new answer in the commit that changes the code).
- `FORGET_ROUTE_BUDGET_MS = 1_500` (contracts §8 step 2's fence budget). The route drives steps until the job is done, waits, or the budget is spent.
- The real `CallClosePort` (`hangupClosePort`) reads the Session's `hangup` Job: `complete` with no registered call left is `closed`; `retry` after its first attempt is `failed`; anything else is no answer. It drives one attempt first.
- The tick's Q17 runs due `forget` jobs after the hangup jobs, one `advanceForget` each, bounded by `FORGET_TICK_STEPS`.
- The open, meeting a barrier, runs one pass of due forget jobs before it answers.

## The acknowledgment (stage 4)

Fixed_Lines in `voice/lines.ts`: `GONE_LINE = "Gone."`, `GONE_EXCEPT_RULE_LINE = "Gone, except one safety rule. It's on your screen."`, `RETELL_LINE` (one sentence offering to hear again what went with it), `FORGET_ASK_LINE` (ruling 9), `ASK_ALLERGIES_LINE = "Any allergies I should know?"`. The ack note's text is the lines joined with a space. The delivery row is a `decision` ledger entry written by the Admission_Seam with a deterministic ID from the op, so the second open finds it.

## Gaps and the answers taken

1. `records.ts`, `wire.ts`, `samples.ts`, `paths.ts`, `eligible.ts`, `head.ts` and `head-build.ts` are not this lane's. No new stored field is added. Where the brief wants a stored number (the withheld count) it is computed and reported, not stored.
2. There is no `pending` collection schema on this branch. Ruling 9's held candidates live on the forget job (`candidateRefs`, `scopePendingId`), which already holds them.
3. A phone call placed by `make_phone_call` is not a registered browser call and is left alone (ruling 5).
4. The judge's `H` mute and cancel are the voice machine's today; the server sends nothing to an old call because it issues no Permit on a forget.
