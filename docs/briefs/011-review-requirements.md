# Review of voice-control requirements

The requirements are faithful to the brief and the contracts, and the list of 32 gaps is the right list. Apply the answers below to `.kiro/specs/voice-control/requirements.md`, remove every `[To confirm]` marker and the "Points to confirm in review" section, commit, then write the design. Each answer that departs from or fills a gap in the contracts becomes a contract question in `design.md`, numbered on from 52, with a proposal for contracts v3.

Add a `.config.kiro` for this spec, like the other two specs have.

## Accepted as you recommended

Items 1 to 8, 10 to 14, 16 to 25 and 28 to 32 of your list. Notes on a few of them:

- **1 (`judge` on an early post).** `judge` is the verdict known when the request is sent, and `timeout` when none has arrived. The contract question proposes a `pending` value for v3.
- **6 (`fastO` and what the browser can't see).** The server answers `/api/session/state` with `ack:null` while an S2 turn is among the last four or a parse gap exists, and the browser drops its ack whenever it posts a turn. Add a criterion: an ack obtained before an outstanding `/api/turn` response arrives can't grant `fastO` (this is "no control hit pending", item 8).
- **17 (the regex table).** A small closed table in `packages/core`, hold-only, listed in full in the design. Its patterns are general cue words. No sentence from `scripts/judge-spike/lines.json`, and no close copy of one, appears in it; a test asserts that, as for `judge_v2`.
- **19 (Decisions).** The harness summary also reports the share of parses that miss the 350 ms deadline, and its p50 and p95. That number decides whether 350 ms stands.
- **28 (who starts the swap).** The server hangs up when the control commits. The connection can drop before the `/api/turn` response arrives, so a connection lost while a turn response is outstanding waits for that response, up to its deadline, before the browser chooses between the swap and the recovery screen.

## Decided differently

**9. Deadlines.** Build decision 7 as written: commit-based, 1.5 s with no transcript, 2.5 s with a transcript. It stays marked as needing the owner's confirmation in the contract question. It needs no marker in the requirements.

**15. Crisis always takes the reply.** When `crisis` is a retained candidate at 0.20 or above, the reply is the crisis care reply with `tools:[]`, whichever class wins the priority order. In wave B, if `company` or `quiet` is also a candidate, the audience is still recorded and `policyRev` still rises, but the hang-up and the swap wait until the care reply has finished playing or been interrupted, and the company line is not spoken on that turn. A person in distress never hears "Got it. I'll keep things general for now." Mark this as needing the owner's confirmation in the contract question.

**26. Quiet.** Record it as you recommend: the Session's audience becomes `company`, with `reasonCodes:["quiet"]`, and `alone` restores `private`. A new Session starts `private`. Mark as needing the owner's confirmation.

**27. `unknown` does not swap and says nothing.** Contracts §6 says a failed sequence means "unknownaudience/S1helduntilrepair/newcleanSession". So:

- While the audience is `unknown`: no S1+ note, no `fastO`, and every reply takes the slow path. No hang-up, no fixed line.
- **Repair.** A parse that failed on its deadline or on a transport error is retried once after the turn's response has been sent, through the same port, with a 2 s deadline. If the retry commits an ordinary parse, the gap closes and the audience returns to the value it had before. If it commits a control hit, that route runs as a late hit. If it fails, the audience stays `unknown` until a parsed `alone`, and the gap stays for the Session.
- A missing or failed transcript can't be repaired this way; it sets `unknown` as item 10 says.
- The Debug_Panel shows the audience and the count of failed parses in the Session.

Update Requirement 15 criteria 2 to 4 to say this, and add the repair to the properties: after a repaired gap, the Session's state equals the state of a run in which the first parse had succeeded.

## Add

**A. Property guard.** Add a wave A task, right after the steering task: `scripts/property-guard.mjs`, in the style of `scripts/clock-guard.mjs`, with tests. It reads a PreToolUse hook event on stdin and exits 2 when an agent write targets a `*.property.test.ts` file that is already tracked by git, with a message that says to add the new property in a new file or to stop and report. New property files are always allowed. The hook file itself is written by the reviewer between runs; don't write to `.kiro/hooks/`. From then on, new properties in this spec go in new files.

**B. A stop line for the slow parse.** Add to Requirement 23: if more than 1 in 10 Decisions calls misses 350 ms on the fake-free dry numbers you can measure locally, say so in the report. The live number comes from the harness run after wave A.

**C. Live-check steps.** In Requirement 24, the wave A live check covers at least: an ordinary question (path `fastO`, with its latency row), a line that holds ("forget what I said about…", expecting the fixed line), a false hold, an interruption mid-reply, and two fragments said with a pause between them.

## Design phase

Write `design.md` with:

- The state machine as a table of state, event, guard, next state and commands, for the new and changed states only.
- A sequence diagram (Mermaid) for each of: an ordinary turn on `fastO`; `O` after muted audio began; `H` then a control route; a judge timeout then `slowOrdinary`; a late control hit that cuts audio; the company swap (wave B).
- A "Correctness Properties" section: each property from Requirement 20 (and the repair property above) stated formally, with its generator strategy and the requirement criteria it validates.
- The regex table in full.
- The request budget for a call: how many `/api/session/state` requests and Firestore reads per minute the ack polling costs, and the Decisions calls per turn.
- "Contract questions", numbered from 52.
- What the wave A live check will show if two out-of-band responses can't run at once on the data channel.

Stop after the design. Don't write `tasks.md`. Change no code. Make no network call.
