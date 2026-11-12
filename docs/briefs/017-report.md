# Brief 017 report: the call-path fixes, then the call swap (lane `voice`)

Built by Claude Code on `lane/voice`. No commit ends `Built-with: Kiro`. Nothing here was tried on a live call, in a browser or with the owner.

## Part 1: the fixes with a failing test

All seven rows are built. The suite has no `it.fails` test left (it had 20). "Golden" counts calls whose digest moved when `golden-traces.json` was recorded again in the same commit: `a` is the 600-call `arbCall` corpus and `w` is the 500-call `arbCallWide` corpus.

| Fix | Commit | What changed in behaviour | Golden moved | What a live call would still need to show |
|---|---|---|---|---|
| B1 | `5ac6fd9` | When the token step rejects, the API call resolves `{ok:false, kind:"network"}` instead of throwing, so the machine sees a failure event, not a hung promise. | none (client only) | Signing out in the middle of a call, or a token refresh that fails, ends in recovery or the signed-out screen, not a stuck call. |
| B2 | `b0ebf7d` | In the tick's session expiry, a begin-close that loses its race logs `tick.lostRace` and the run goes on. It no longer fails, and so it can't fail the open that won. | none (server only) | An open made at the same moment as a tick sweep opens. That needs the emulator, which the lead runs after merging. |
| B4 | `134a993`, `d9ec7a6` | A typed line keeps its body, including `utteredWorldAt` (read once), and its request identity across retries. A retry is the same request. | none (client only) | A typed line sent on a flaky network is stored once. |
| V1 step 3 | `91df2b5` | A reconnect keeps the Owner's mute. `startOpen` keeps `micMuted` when it is retrying. | 43 w: wide calls that mute and then lose the connection now stay muted. | The mic track stays disabled after a real reconnect, and the mute button still shows muted. |
| V1 step 4 | `b8d4c7e` | Connection recovery clears `stateFailures` and `stateRetryVisible`, so a "Try again" shown during a state outage is never a dead button. Wide situation 17 kept its count of 72 (floor 25) under a clearer name. | 40 w: recovery that starts in a state outage no longer carries the retry flag. | A drop during a state outage shows one working "Try again". |
| V1 step 5 | `d9d84ed` | In setup, an ack dropped as stale (asked before a turn answer landed) asks for state once more, instead of waiting out the ack limit. | 2 a and 44 w: setup ends sooner after a late turn answer. | Setup after a reconnect with a turn in flight reaches listening without a 1.5 s stall. |
| V2 | `48bee00`, `7d821f8`, `54e0782`, `5c9d636`, `cac725b` | An admitted voice Turn is always posted, even when its reply is cut or refused. Its heldBack timer is parked at `tEnd + ADMITTED_TRANSCRIPT_LIMIT_MS`. A stale answer's resend gets the full answer wait. A Permit that arrives inside that wait finishes its check (`checkUntil`). A hold with a retry hint is resent while the Turn's own reply plays. A stale Superseding_Post is resent once and never reconnects the call. | 12 w (steps 2 and 3), 3 a and 33 w (step 4), 11 w (step 5), 1 a and 14 w (step 6), 48 w (step 7). Each moved because posts and resends now go out where the call used to drop them. | Barge-in on a fast reply, then the transcript arrives late: the Turn is in Firestore and in the Debug_Panel. |

**Property 13 (an admitted Turn is always posted, Q-SM18):** after V2, I ran `admitted-turn-posted.property.test.ts` 30 times on fresh seeds. **0 of 30 failed.** Before V2 it failed about 1 run in 30.

## Part 2: the call swap

- **Task 46** (`b5969f2`): `voice/testing/arb-swap.ts` (`SwapDriver`, `arbSwapCall`, `runSwapCall`, `swapCalls`) and `narrowing.property.test.ts`, at 1,000 runs. `arb-swap.test.ts` holds the reach floors. The measured counts are blocked 278, care 159, while playing 59, in recovery 139, care reply heard 49, and swap line heard 77. To export its generators, `arb-call-wide.ts` gained exports.
  - **Red first:** seeds `-1912302561` and `2093769423`. The shrunk counterexample: a fastO reply is playing, its Turn is posted, and the post is answered `blocked` with no care Permit at step 17. Response `…21` of the narrowed call is still heard at step 31.
- **Task 47** (`54c3006`): `SWAPPING` in `machine.ts`, with `SWAP_LIMIT_MS = 12_000` and the state fields `proactive` and `narrowedFrom`.
  - A `blocked` answer mutes, tears down, posts no close, and opens with `previousSessionId`. The avatar shows thinking and the call button shows hang up.
  - A care Permit plays first, and the swap follows when it ends or is cut by a barge-in.
  - The swap line from `proactive` plays first once the ack matches.
  - A failed open or the swap timer goes to connection recovery.
  - Property 10 is green, and no golden call moved. The witnesses are 8 cases in `voice-swap.transitions.test.ts`, not in `machine.test.ts`. `docs/machines/voice-call.md` is updated.
- **Task 52** (`10d20e0`): two cases in `voice-client.test.ts`, run against the real routes.
  - **Swap:** the first audio of the fresh call is the COMPANY line. No `/api/session/close` is sent, and hang up and thinking show throughout.
  - **Failed swap:** recovery shows, and the reconnect names the narrowed Session.
  - `voice-client.ts` needed no change. The `blocked` answer and the open's `proactive` are faked until tasks 48 and 50 are built.
- Tasks are ticked in `e93de2c`. The "Actual" times come from commit times, which understate the work.

## Contract questions

- **V-163 (R14.6 against brief 014's tests).** Task 47 says a lost connection with an Outstanding_Turn waits for its answer or deadline. Brief 014's setup and late-answer tests expect recovery to go on at once. I built a version that doesn't block: recovery goes on, and a `blocked` answer for the lost Session turns the reconnect into the swap. The open in flight is kept as the swap's open.
- **V-164.** Committed property headers still describe their tests as `it.fails`: `narrowing`, `mic-muted-by-owner` and `admitted-turn-posted-wide`. Committed property files may not be edited, so they are left as they are.

## Rulings needed

- Every `blocked` answer while a call is up swaps, whatever Session it names. The exceptions are the Session already swapped away from (`narrowedFrom`) and the care path. This fails closed (`onBlocked`).
- `proactive` plays at the end of any setup, not only a swap's (Q81).
- A Superseding_Post that fails, or is stale twice, is dropped without a reconnect.
- V2 step 6 gap: if a reply ends before its retry hint, the resend is lost (`turnRetry`).
- Q-SM18 stays open: an empty transcript after admission ends the Turn without a post, as `machine.test` item 9 requires.
- Q79, Q68 and Q54 are taken as briefed. Every deadline is a named constant at the design's value.

## Hot files touched

`packages/server/src/worker/tick.ts` (one helper, `lostRaceAsNull`, at the expiry seam), `apps/web/src/client/api.ts`, `typed-turns.ts`, and `packages/core/src/voice/**` (machine, testing, golden). No schema file, route file or barrel was touched.

## Checks

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=3` | exit 0, 283 files, 3,215 passed, 0 expected fail (was 20). No timeout reruns were needed. |
| `npm run lint` | exit 0. One warning, in `components/avatar/three/brass.ts`, which this lane didn't touch. |
| `npm run typecheck` | exit 0 |
| `npm run build` (run alone) | exit 0 |

## Not tested

There was no live call, browser, emulator or real Realtime session. Nothing here proves the swap on real audio, a second microphone grant, the timing on a real network, or the server half (tasks 45, 48 to 51).
