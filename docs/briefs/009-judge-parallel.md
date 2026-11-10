# Brief 009: the judge and the reply in parallel

The uncapped run (Nov 9, `scripts/judge-spike/results/2026-11-09T19-19-59-517Z-owner.*`) gave a valid verdict on all 60 of the owner's takes. In sequence it is too slow: from send, the judge took a p50 of 571 ms and the reply a p50 of 731 ms to first audio, so end of speech to first audio was a p50 of about 1.3 s against the 800 ms target. Spec §3 and §14 (addition 13, the stagger) plan for this: the reply is generated muted while the judge listens, and it becomes audible only on `O`.

The owner's ruling: measure the parallel path, and keep the judge's reasoning as it is (uncapped, effort `minimal`).

Do the items in order, one commit each, every message ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green. **Make no call to OpenAI or any other network service, and don't run anything with `--live`.** Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next. Don't push or deploy.

## 1. Keep the uncapped run's record

Commit the two result files from the uncapped run as they are, in their own commit.

## 2. A parallel mode

Add `--mode sequential|parallel` to the harness. **The default becomes `parallel`.** `sequential` stays exactly as it is now.

In `parallel` mode, per line:

- At `conversation.item.added` for the last committed fragment, send the judge, and send the reply `--stagger-ms` later (default 0; spec §3's stagger sends it at `min(verdict O, t0+120 ms)`, so the flag lets that be measured too). Both are out-of-band (`conversation:"none"`) and reference the same audio items. Tag each with its own metadata (`purpose: "judge"` and `purpose: "speculative"`, contracts §6), and match every server event to its response by response ID, never by arrival order.
- The reply's audio is never "played"; the harness only notes the time of its first audio delta.
- **Audible time** is the later of the judge's `O` (its `response.done`) and the reply's first audio delta. That is when the browser would unmute.
- On `H` or `U`, or an invalid answer, cancel the reply at once and record whether any reply audio had already arrived (it would have stayed muted). On `O`, cancel the reply once both the verdict and its first audio delta are in.
- If the server refuses two responses at once, or errors, record the error event in full on the row and treat the line as held. Don't retry in sequence. Whether two out-of-band responses can run at once is one of the `S-Audio` questions, so say plainly in the summary whether they did.

## 3. A truer end of speech

The uncapped run shows commit about 30 ms after the harness's "end of speech", which suggests `speech_stopped.audio_end_ms` already includes the VAD's 300 ms of silence. Add a second measure: the send time of the chunk holding the take's last loud frame (the one `trimTail` found). Report ordinary latency from both, labeled, and use the last-loud-frame measure for the stop rule, since spec §13 measures from the end of audible speech. Print the p50 gap between the two so the question about `audio_end_ms` is answered from data.

## 4. Summary

- The run's mode and stagger go at the top.
- In parallel mode, add: judge time and reply time, both from send; how often the reply's first audio came before the verdict; reply audio received on held lines (count, muted); and any concurrency errors.
- The stop rules work as now, with ordinary latency meaning end of audible speech to audible time.
- Witnesses on the fake transport: an `O` line where the reply is first, so audible time is the verdict; an `O` line where the verdict is first, so audible time is the first audio; an `H` line whose reply is cancelled after some audio arrived, counted as muted; a refusal of the second response, recorded and held; and events from the two responses interleaved, matched by ID.

## 5. Report

Append a "Brief 009" section to `docs/briefs/006-report.md` with what changed, the live command for a parallel run on the owner's takes, and what you couldn't check.
