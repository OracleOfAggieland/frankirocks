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

## Outcome

Built by Claude Code on `lane/fix2`. No commit ends `Built-with: Kiro`. Nothing here was tried on a live call or in a browser. "Golden" counts calls whose digest moved: `a` is the 600-call `arbCall` corpus, `w` the 500-call wide corpus.

| Finding | Red-first test | Commit | Golden moved |
|---|---|---|---|
| 1. The swap adopted an open the narrowing never reached | New `swap-fresh-open.property.test.ts` (1,000 runs over the new `arbEarlyOpenCall`), and `voice-swap.transitions.test.ts` > `SWAPPING + openOk for the open sent before the blocked answer -> SWAPPING (closed, never adopted; the swap's own open follows)` | `681c36e` | none: neither corpus reaches a `blocked` answer |
| 2. An admitted Turn lost when its reply ended before the retry hint | `voice-posts.transitions.test.ts` > `SPEAKING + output stopped before a hold's retry hint -> LISTENING (...)` | `959377f` | 1 a (seed 505, call 25), 0 w: a slow-path Turn answered `hold` with a hint reached LISTENING before the hint and now arms `retryPost` |
| 3. A second `blocked` cut or restarted the care reply | `voice-swap.transitions.test.ts` > the two `SPEAKING (care reply) + turnOk blocked ...` cases | `8cc1dc9` | none |
| 4. Answers matched to posts by order | `voice-posts.transitions.test.ts` > `LISTENING + turnOk stale for a Superseding_Post answered before its missing post ...` and `LISTENING + turnFailed for a Superseding_Post before its missing post's answer ...` | `c71b5a2` | none: the drivers send no flag |
| 5, `narrowedFrom` as a set | `voice-swap.transitions.test.ts` > `SWAPPING + turnOk blocked for a Session swapped away from two swaps back -> SWAPPING (nothing happens)` | `707761a` | none |

**What changed, per finding.**

1. `startSwap` never reuses an open in flight. It marks it `staleOpen` and keeps that open's own `openWait`; the swap's own open (`previousSessionId` the narrowed Session) goes out only when the stale one answers, so one open is in flight at a time and answers are never misattributed. The stale answer is closed if it created a Session and is never adopted (`dropStaleOpen`). If the stale open never answers, its `openWait` ends the swap in connection recovery, which also fixes the second problem the review named (no second open while the first is untracked). Ruling V-163 is replaced as this brief says. The transitions case that pinned V-163 (`CONNECTING (reconnect) + turnOk blocked for the lost Session -> SWAPPING`) was rewritten to the new ruling; it asserts more than before (the stale Session closed, never connected, the open wait kept).
   - Red: seed `913073197` (and `1749594897` on the first draft). Shrunk: setup, a typed post, `connectionLost`, the reconnect's open, the post answered `blocked` at step 7, that open answered early (`openEarly`), and a reply on that Session heard at step 22.
   - The driver now answers an open only inside the Voice_Client's own open timeout (`openTimeoutMs`, used by `runEarlyOpenCall` only). Without it the generator produced answers that arrive after the machine's `openWait` gave up, which the browser cannot produce: `postOpen` times out at the same 5 s and dispatches `openFailed`. A hanging `getToken` (B1's open pin) is the one way it could, and is not modelled.
   - A reach test in `arb-swap.test.ts` counts the early-open situations (132 and 120 of 500 at seed 2026; floors 65 and 60). Property 10's own reach moved `lineHeard` from 77 to 71 (floor 35), because a `droppedBack` lead's first `openOk` now answers the stale open.
2. `toListening` keeps the post of a Turn leaving `turn` with `turnRetry` armed as `retryPost`, armed at the same deadline under a new timer, `retryPost`. Ruling: its own timer rather than `turnRetry`, because a new commit, a barge-in or a higher Deck disarm `turnRetry` for the current Turn, which would drop the resend again. Another `hold` with a hint for it waits again; any other answer clears it and is read as an answer for a Turn no longer current (so `stale` or an error reconnects, as before for such a post). A second one arriving while one waits sends the older one at once.
3. `onBlocked` returns when `afterReply` is `"swap"` and the answer names the current Session, before it adopts the answer's Deck.
4. `turnOk` and `turnFailed` carry an optional `supersede`, which `voice-client.ts` always sets from the request it answered. `answerOf` matches the post of that kind only. Ruling (fails closed): a flagged Superseding_Post answer with no entry left gives its Deck only and never reconnects. An answer without the flag (the test drivers) is matched by order, as before, which is why no golden call moved.

**Low items.**
- `narrowedFrom` as a set: fixed (`swappedFrom`).
- Unmute in RECOVERY, CONNECTING and CONFIGURING: not fixed. The mute control is hidden there (`muteVisible` follows `avatarState`, and `CallScreen.tsx` reads it), so no press reaches the reducer. A fix means showing the control while muted in those phases: a UI change in a file this lane may not edit, and a change to an outward view that moves golden digests, on a path no live call has tried. Left open; the mute is kept and the control returns at LISTENING.
- Open, as the review wrote them: a commit after a care reply, with no reply pending or active, starts a new Turn on the narrowed call (it still ends in the swap); a swap timeout after the fresh Session opened reconnects naming that Session, not the narrowed one, and the swap line in its open answer is lost; a token that always fails shows as reconnects, not as signed out (`api.ts`).

**Questions and things seen on the way.**
- **V-165. Property 10 fails on some seeds, before and after this brief.** Seed `1176707969` (path `932:0:0:0:0:0:2:2:2:2:2:1:2:2:2:3:3:3:6:4:7:7:7:7`) fails at the base commit too: a second `blocked` for the Session already swapped away from (which does nothing, correctly) is read by the property as a new narrowing, and the swap line on the fresh call, opened before that answer, counts as heard from an old call. It failed about 2 runs in 70 on fresh seeds here. The property file is committed, so it was not edited; its rule should skip a `blocked` for a Session already narrowed.
- `docs/machines/voice-call.md` said the `swap` timer and `afterReply` do nothing on this branch; that sentence was wrong and is removed.

**Checks** (after the last code commit):

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=3` | exit 0: 376 files, 3,665 passed, 0 expected fail |
| `npm run lint` | exit 0; one warning, in `components/avatar/three/brass.ts`, not touched here |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |

**Not tested:** no live call, browser, emulator or real Realtime session. Nothing here shows the swap's stale open closed on a real network, the `retryPost` resend against the real route, or the `supersede` flag against real answer orderings.
