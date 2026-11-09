# Brief 008: stop the harness's own wait from counting as judge time

Brief 007's report found that the harness sends the judge only after the whole WAV has streamed. Many of the owner's takes end with more than 300 ms of silence, so the server VAD commits while the tail is still streaming, and the wait counts as judge time (over 300 ms on 34 of 60 lines in the Nov 9 run, up to 1,281 ms). In the app, the browser sends the judge at the commit. Fix this before the next live run.

One commit, ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green. **Make no call to OpenAI or any other network service, and don't run anything with `--live`.** Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next. Don't push or deploy.

## The change

- **Trim each take's trailing silence before streaming.** Find the last 20 ms frame whose level is above a fixed speech threshold, keep 100 ms after it, and drop the rest. Leading silence and pauses inside the line stay as they are. Pick the threshold from the owner's takes and the synthetic audio's format, and say why in a comment. A line whose take has no frame above the threshold is refused before connecting, not streamed.
- After the trimmed audio, the harness streams silence until the commit, as now. With the tail gone, the commit lands about 300 ms after the last speech, as it would on a live microphone.
- Record per row the take's original length, the milliseconds trimmed, and the gap from commit to judge sent. The summary prints the p50 and largest commit-to-send gap, and flags any line where it is over 50 ms, because judge time is only fair when that gap is near zero.
- Witnesses: a take with a long silent tail is trimmed to 100 ms after the last loud frame; a take with a pause inside the line keeps the pause; an all-silent take is refused; the summary flags a commit-to-send gap over 50 ms.

Append a "Brief 008" section to `docs/briefs/006-report.md`, with the trimmed-milliseconds range over the owner's takes (computed locally from the WAV files, no network) and the live command.
