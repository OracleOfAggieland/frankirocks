# Brief 010: record the owner's F2 decision

Three live runs on the owner's 60 takes answered the judge spike's questions (`scripts/judge-spike/results/`, Nov 9):

| Run | What it showed |
|---|---|
| 18:41, sequential, cap 16 | Reasoning counts against the cap: 58 of 60 judge answers were cut off before the letter. |
| 19:19, sequential, uncapped | 60 of 60 valid verdicts. Judge p50 571 ms from send; reply p50 731 ms to first audio. End of audible speech to first audio about 1.75 s once `audio_end_ms` is corrected (see the next run). |
| 19:44, parallel, uncapped | Two out-of-band responses ran at once on all 58 lines where they overlapped, with no errors. On every ordinary `O` line the judge answered before the reply's first audio, so the judge added no audible delay. End of audible speech (last loud frame) to audible time: p50 1,317 ms. Of that, about 485 ms is the VAD (last loud frame to commit) and about 800 ms the reply. `speech_stopped.audio_end_ms` lands about 450 ms after the last loud frame, so it includes the VAD's silence. Judge p50 718 ms from send, p95 1,103 ms, so only 16 of 60 verdicts beat the 600 ms deadline. Recall at any time: forget, quiet, hard rule and crisis 5 of 5 each, correction 4 of 5, company 1 of 5. False holds 1 of 30. |

On Nov 9 the owner decided, with these numbers:

1. **The judge runs in parallel.** The speculative reply is sent beside the judge at the commit (stagger 0), muted until a valid `O`. Spec addition 13 moves up to right after F2, as the spec says it does when F2 measures a miss.
2. **The judge is uncapped,** `max_output_tokens:"inf"`, effort `minimal`. Reasoning is not reduced. Observed output was at most 61 tokens.
3. **The judge's deadline follows the reply, not 600 ms.** It becomes 1,200 ms from the commit, which covers the measured p95. A valid `O` that arrives after the muted reply's audio began cancels and regenerates, as spec §3 already says; it never exposes a clipped suffix. The 1.5 s neutral line stays.
4. **The ordinary latency target is about 1.3 s,** p50 from the end of audible speech to audible time, which is what this voice model measures with or without a judge. The 800 ms target can't be met on this model. The acceptance stop line becomes a p50 over 1.5 s.
5. **The company miss stays open.** Next comes a decision on clearer judge instructions for another person being present, the transcript check, or both. Until then, company relies on the slow gate, and company and quiet always hang up.

One commit for items 1 and 2, then one for item 3, each message ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. **Make no call to OpenAI or any other network service, and don't run anything with `--live`.** Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next. Don't push or deploy. Change no code.

## 1. Keep the parallel run's record

Commit the two result files from the 19:44 parallel run as they are.

## 2. Record the decision

- Add contract question 51 to `.kiro/specs/first-spoken-call/design.md`: the owner's F2 decision, the five points above, the numbers behind them, and the runs they come from. Mark questions 47 (VAD), 48 (which stop rule) and 50 (the cap) as answered by it where they are: 48 by points 3 and 4, 50 by point 2. Question 47 stays open: the spike measured `server_vad`; the app runs `semantic_vad`, and F2's build measures that.
- `docs/design/` stays read-only. The contract changes (judge cap, effort, deadline, the latency target) are recorded as proposals for contracts v3 in question 51, not edited into the design docs.

## 3. Close the spike report

Add a "Decision" section to the end of `docs/briefs/006-report.md` that points to question 51 and summarizes the three runs in a short table, as above.
