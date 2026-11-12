# Brief 031: review of the call-path fixes and the swap, and its fixes (lane `voice`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the voice lane's work (brief 017, commits `03fe2f6..12d5120`) path by path. It ran no tests. Its findings are below as it gave them. This brief fixes them. The code runs a live call and has not been tried on one, so each fix is pinned by a test that fails first.

Line numbers are for `packages/core/src/voice/machine.ts` at `12d5120` unless another file is named.

## Findings

**1. Medium-high. The swap can adopt an open the narrowing never reached (ruling V-163 of brief 017).** In `startSwap` (line 1306), when `awaitingOpen` is true, the open already in flight becomes the swap's open.
- Sequence: a post on Session A is outstanding. `connectionLost` starts recovery, and the reconnect sends `open{prev:A}` after 1 s. The server handles that open before it commits A's narrowing, so it returns Session B with A's old audience and `proactive: null`. A's `blocked` answer arrives while the open is still in flight, so the machine enters SWAPPING and keeps that open. Its `openOk` is adopted (`onOpen`, line 945, keeps the SWAPPING phase). B's old `deck.head.text` is used as the instructions, the ack matches, and the call goes to LISTENING. No swap line plays, and `fastO` can speak from B's old Head. `narrowedFrom = A`, so no later answer corrects it.
- Property 10 cannot see this: `swapCalls` (`arb-swap.ts`, line 140) counts a call as new at its `connect` command, and B's `connect` comes after the `blocked` answer; SwapDriver decides `proactive` when it answers the open (line 59), which models only the safe server order.
- Fix: in `startSwap`, never reuse an open in flight. Mark it to be closed when it answers (`onOpen` already closes an unawaited open), then push a fresh `open{prev:from}`. That also fixes a second problem: `deadlines: {}` drops the kept open's `openWait`; if that open never answers, the `swap` timer starts recovery while `awaitingOpen` is still true, and the reconnect sends a second open.
- The property that pins it goes in a new file, with a driver that can answer an open before the narrowing commits.

**2. Medium. An admitted Turn can still be lost (the "V2 step 6 gap" brief 017 ruled on).**
- Sequence: a `fastO` reply plays and the Turn is posted. The answer is `hold` with `retryAfterMs`, which arms `turnRetry` (`onTurn`, line 1503). The reply ends first, so `toListening` (line 1556) disarms `turnRetry` and drops the Turn: `unpostedAdmitted` needs `posted === null`. The server recorded nothing, so the Turn is never stored. Short replies make this likely.
- Fix: in `toListening`, when `turnRetry` is armed and `turn.posted` is set, keep the body in a small `retryPost` field and let `turnRetry` push it whatever `turn` is.

**3. Medium-low. A second `blocked` restarts or cuts the care reply.** The care path (`onBlocked`, line 1203) sets `afterReply` but not `narrowedFrom`, so another `blocked` for A gets past the guard at line 1197. A stale resend of the same Turn takes the care path again: `cancelAll` cuts the care reply that is playing, and it is checked and played again. A post of a different Turn on A swaps at once and cuts the care reply.
- Fix: at the top of `onBlocked`, return when `afterReply === "swap"` and the answer is for the current Session.

**4. Low-medium. Answers are matched to posts by order** (`answerOf`, line 1444). The voice client retries a Superseding_Post that arrives early until its `missing` post commits. If the `missing` post's HTTP answer lands after the Superseding_Post's, the Superseding_Post's answer is matched to the `missing` post's entry. If that answer is `stale`, the `!current` branch (line 1481) reconnects, which V2 step 7 removed; the real `missing` answer is then handled as the Superseding_Post's. `turnFailed` (line 878) has the same race.
- Fix: `apps/web/src/client/voice-client.ts` already knows `supersedesTurnId`. Put a `supersede` flag on `turnOk` and `turnFailed` and match on it.

**5. Low.**
- After a care reply, a commit while no reply is pending or active starts a new Turn on the narrowed call. It still ends in the swap.
- A swap timeout after Session B opened reconnects naming B, not A, and the swap line in B's open answer is lost.
- `narrowedFrom` holds one Session, so a late `blocked` from two swaps back swaps again and names the older Session. A set would fix it.
- A muted owner cannot unmute in RECOVERY, CONNECTING or CONFIGURING: the mute stays on but `mutePressed` is ignored there.
- A token that always fails now shows as reconnects, not as signed out (`apps/web/src/client/api.ts`).

**Found clean:** the golden re-records (each move sits in its fix commit and the counts match the messages), the changed tests, mute across a reconnect, the setup re-ask, the answer wait, hang-up during a swap, `typed-turns.ts`, and `tick.ts`.

## What to do

Fix findings 1 to 4, each in its own commit: a failing test first (a transitions case titled `FROM + event -> TO (why)`, or a new property file; never an edit to a committed property file), then the fix, then the golden corpus re-recorded in that same commit if digests moved, with the count and the reason in the message. Of the low items, fix the unmute one and the `narrowedFrom` set if they are small; write the others down as open.

With finding 1 fixed, ruling V-163 is replaced: after a drop with an outstanding answer, recovery may go on, but a swap never adopts an open that was sent before the `blocked` answer arrived.

Update `docs/machines/` where a transition changed. Property 10 and properties 1 to 7, 12 and 13 stay green and untouched.

## Hot files this lane may edit

`packages/core/src/voice/**` (and the golden corpus), `apps/web/src/client/voice-client.ts` and `api.ts`. Nothing else.

## Done

The four fixes with their red-first tests, the checks of brief 016 with `npm run build`, and a section "Outcome" added at the end of this file: per finding, the test, the commit, and how many golden calls moved.
