# Review of the voice-control design

The design is sound and the five requirement fixes you found while designing are accepted. Apply the changes below to `design.md` and `requirements.md`, commit, then write `tasks.md`. The eight points you were unsure of are answered at the end.

## Must change

### 1. Regex holds; it doesn't overrule a parse that succeeded

In the design, a regex match with every class under 0.20 makes the turn a hit with `chosen:null`, which answers `ready` and cuts a playing reply. "I walked in the park today" (RX3), "my grandmother died ten years ago" (RX7) and "I'm allergic to Mondays" (RX4) would each start a reply, cut it and start another. The second reply protects nothing the first didn't: same call, same Head, and no route runs on regex alone.

- `isOrdinary = no candidate && p.uncertainSpeaker < 0.10`. A regex match doesn't enter it. This is contracts §5's own definition ("Ordinary=controls<.20,speaker<.10").
- A regex match is still recorded on the Turn and in the Harness row, so the summary can show what the regex caught that the parse missed.
- **Where regex decides:** when the parse failed. A failed parse with a regex match answers `hold` with `recoveryOnly` **and cuts a playing reply**. A failed parse with no regex match lets a playing `fastO` reply finish, as designed.
- Update rule rows 5 and 12, the status table, property 9 and question 70. In question 70, note that a regex-only allergy cue will need its own answer when the hard-rule route is built, because allergies fail closed.

### 2. Deadlines, from the measured transcript times

Run (c) measured the transcript at p50 517 ms and **p95 1,899 ms** after the commit. A 1.5 s wait would turn about 1 held turn in 12 into "Sorry, say that again?" while its transcript was on the way, and, on `fastO` turns, would post about 1 turn in 12 as `missing` and leave a parse gap that turns `fastO` off for the rest of the call.

Row 13 also compares the server's clock with a browser timestamp (`audioEndOpsAt`). The two clocks aren't the same clock, so that rule can't be trusted. Remove row 13 and the `late` input.

The rules, all from the commit t0 on the browser opsClock, each a named constant:

| Wait | Limit | Then |
|---|---|---|
| Judge | 1,200 ms | cancel judge and speculative reply; slow path |
| Transcript, turn held | 2,500 ms | post `missing`; the server answers `recoveryOnly`; the Neutral_Line plays |
| Transcript, reply admitted under `fastO` | 5,000 ms | post `missing`; the reply is untouched |
| `/api/turn` response | 5,000 ms from the post (the request's own timeout) | RECOVERY, as a failed request does today |

- **A server Permit that arrives before the request times out is played**, even after t0 + 2,500 ms. A late real answer is better than asking the owner to repeat. Speech start still cancels it, as it cancels everything.
- The Latency_Clock marks a turn `late` when its Permit arrived after t0 + 2,500 ms, and the Debug_Panel counts late turns. The 2.5 s line stays as the stop line of R23.2 and as a number to report. It is no longer a cut-off.
- **A transcript that arrives after its turn was posted `missing` repairs the gap.** The browser posts the turn again with `transcriptState:"final"` and `supersedesRequestId` naming the first request. The server parses it and commits the parse on the existing Turn. An ordinary result closes the gap exactly as the Parse_Repair does; a control hit is a late hit; no reply is spoken for a superseding post. If `/api/turn` can't take a superseding request within the closed contract, raise a contract question and say what's missing.
- Rewrite question 54 with these rules and keep it marked for the owner. It changes two things the owner ruled on: the 1.5 s neutral line becomes 2.5 s for a held turn, and a late Permit plays.

Add to property 11's family: a turn posted `missing` and then superseded with an ordinary final transcript leaves the same Session state as a run where the transcript arrived in time.

### 3. Unhandled control classes keep the `recall` tool

Question 87 gives every `postCommitControl` reply `tools:[]`. `food` and `action` are control classes, so "what should I cook tonight?" and "remind me what I said about Ana's birthday" would lose `recall`, which they have today. That is a step back for ordinary assistant requests, and `recall` only reads.

- `tools:[]` for: the crisis care reply, every Fixed_Line, and `recoveryOnly`.
- The other wave A classes (`correct`, `transition`, `hardRule`, `food`, `action`, `why`, `answer`, `rushed`, an `uncertainSpeaker` hold, and `company`, `quiet` and `alone` until wave B) keep the tools a speech reply has today. Their tool continuation follows row 3, with notes limited to S0 when the audience isn't `private`.

### 4. Say why `fastO` was refused

Add `fastOProblem`'s result to the LatencyRow (`refused: null | "verdict" | "ack" | "outstanding" | "staleAck" | "noteWaiting" | "hash"`), and show it in the Debug_Panel's last-turn row with a count per reason for the Session. The live check and the VAD tuning both need to know why a turn took the slow path.

### 5. Keep generators out of the guarded files

The Property_Guard blocks edits to tracked `*.property.test.ts` files. Put `arbCall` and every other generator and trace helper in plain modules under `packages/core/src/voice/testing/` (and the server's equivalent), and keep only the property statements in the `*.property.test.ts` files. Fixing a generator is then an ordinary edit; changing what a property claims still needs a stop and a report.

## Your eight points

1. **Control class in the ledger.** Accepted as designed: cite the request entry, show the class as "not recorded", question 57 stands.
2. **Regex false holds.** Answered by change 1.
3. **A missing transcript turns `fastO` off for the Session.** Change 2 removes most of these: the waits are longer and a late transcript repairs the gap. A transcription that truly fails keeps the gap, as the contract says. The Debug_Panel shows "fastO off: parse gap" with the turn, and the report gives the rate from the live check.
4. **`waitDeadline` for the carried audience, and the line repeating after a reconnect.** Accepted for this spec; question 81 stands.
5. **A late hit found by a repair is cut through the next state poll.** Accepted.
6. **Slow-path timing is an estimate.** The emulator timing test decides it, as you say.
7. **A late `H` or `U` never reaches the server.** Accepted; question 56 stands.
8. **The app's latency numbers aren't the spike's.** Accepted; question 83 stands.

## Tasks phase

Write `tasks.md` in two waves, as the brief says. Within wave A, order the work so that each layer is tested before the next one uses it:

1. Steering (R1), then the Property_Guard.
2. Pure core: judge settings and `judge_v2`, intents (regex, request, parser, priority), `serverRule`, `fast-o`, lines, VAD constants, latency.
3. The generators, then the machine properties, written before the machine changes and expected red. Record each red run's seed in the task's notes.
4. The Voice_Machine changes, until the properties are green.
5. Server: the Decisions port and fake, the slow parse, the seam, `/api/turn`, the repair and the superseding post, state, receipt, tool.
6. Voice_Client, then the Debug_Panel.
7. Harness.
8. Emulator timing test, the full checks, the wave A report.

Every task names its requirements, dependencies, estimate and test witness. Every property task is required. No two tasks in a parallel group touch the same file. Mark the end of wave A clearly: the build stops there for the live check.

Stop after `tasks.md`. Change no code. Make no network call.
