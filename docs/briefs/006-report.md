# Brief 006 report: the judge spike

Items 1 to 5 are done, one commit each, after the brief's own commit. Nothing was measured yet: no command called OpenAI, and the harness never ran with `--live`. The live runs are yours, after review.

## What was built, and where

| Item | Where | What |
|---|---|---|
| 1 | `packages/core/src/voice/judge.ts` | `JUDGE_V1_INSTRUCTIONS` (the contracts §5 literal; a test compares it with the contract text and with a pinned copy), `judgeCreate` (the §5 `response.create`: one safe-context text item, then an `item_reference` per fragment in commit order; refuses more than 4 safe turns or 8 fragments rather than truncate) and `parseJudgeDone` (a verdict only for a completed response with one message whose trimmed text is `O`, `H` or `U`; anything else is `U` with a reason: `malformed`, `incomplete`, `severalMessages`, `otherOutput`, `empty` or `extraText`). Reasoning items are skipped and recorded. |
| 2 | `scripts/judge-spike/lines.json` | The 60 frozen lines: 30 control (5 each of forget, company, quiet, correction, hardRule, crisis, including negation, "Don't let me forget to…" and a request buried mid-sentence) and 30 ordinary (10 near-misses). The first 15 ordinary lines are the latency probes. `lines.test.ts` pins a hash of every ID, text, class, label and probe flag. |
| 3 | `scripts/judge-spike/synth.ts`, `apps/web/src/app/recorder/`, `apps/web/src/app/api/dev/takes/route.dev.ts`, `packages/server/src/dev/takes.ts`, `packages/core/src/audio/wav.ts` | Text-to-speech across six voices (`FRANKI_TTS_MODEL`, new in `apphosting.yaml` and `config/models.ts`), and the recorder page with its takes route. Both pieces are development-only through the `dev.tsx` and `dev.ts` page extensions. The post-build check (`scripts/specimens-absent.mjs`) now also fails on a `recorder` or `api/dev` route, or on the recorder's sentinel string. |
| 4 | `scripts/judge-spike/harness.ts`, `realtime.ts`, `summary.ts`, `fake-realtime.ts`, `virtual-clock.ts`, `clock.ts`, `cli.ts`, `run.mjs` | The harness, its fake transport, and the run file and Markdown summary. |
| 5 | This file, the README's Develop section, and design questions 46 to 49 | |

Supporting changes:

- The root `npm run typecheck` also checks `scripts/judge-spike`.
- The model-literal check and the clock check now scan `scripts/judge-spike`.
- `scripts/judge-spike/audio/` is gitignored. Dry runs write to `scripts/judge-spike/dist/dry-run/`, which is gitignored too. Live runs write to `scripts/judge-spike/results/`, which is committed.

### The harness in short

- **Session.** One WebSocket session per run of up to 30 lines, and the run file records which lines shared one. The `session.update` is contracts §6's: transcription model from `FRANKI_TRANSCRIBE_MODEL`, `server_vad` at 300 ms with `create_response:false` and `interrupt_response:false`, `audio/pcm` at 24 kHz in and out, voice `cedar`, `tools:[]` and a fixed one-sentence reply instruction. There is no Head and no Firestore.
- **Per line.** The WAV goes out in 20 ms chunks on an absolute schedule, then silence until the last speech start has a commit after it (3 s cap). The harness waits for `conversation.item.added`, sends `judgeCreate`, and parses the answer with `parseJudgeDone`.
  - A valid `O` with `response.done` within 600 ms of commit sends the reply (`conversation:"none"`, the item references, audio out), and cancels it at its first audio delta.
  - Anything else sends no reply. A late judge is still waited for up to 3 s, so its real time is known, and it counts as held. A judge with no `response.done` in 3 s is cancelled.
  - The next line starts only after the transcription arrives (10 s cap).
- **Per row.** The times are stream start, end of speech, commit, item added, judge sent, judge first delta, judge done, reply sent, first reply audio and transcription done. End of speech is the send time of the chunk holding the sample at `speech_stopped.audio_end_ms`. The row also keeps the verdict and its reason, the raw text, `status` and `status_details`, the usage object, any reasoning-token count found in it, and the transcript.
- **Derived times.** Judge is commit to judge done. Ordinary latency is end of speech to first reply audio; the summary notes that browser playback adds about 60 ms. ASR is commit to transcription done, and the summary counts how many transcripts arrived within 600 ms.
- **Summary.**
  - The judge numbers: valid-verdict rate, recall overall and per class, false holds, timeouts, invalid reasons and reasoning tokens.
  - p50 and p95 of each derived time, and the probe p50.
  - One line per §14 stop rule. `within` appears only when every number the rule needs is present. With a number missing, the line reads `not measured`, or `over the line` if the rule fails even with every missing number at its best.
- **Cost guard.** Before connecting, the harness prints the line count and the audio seconds. It refuses more than 70 lines. A live run also refuses missing or wrong-format audio, and a `lines.json` with uncommitted changes.
- **Event names.** The harness accepts the GA event names and the beta ones (`conversation.item.created`, `response.text.delta`, `response.audio.delta`). The run file lists the names the server actually sent.
- **Transport.** Node 24's built-in WebSocket takes a `headers` option, so the key goes in `Authorization` and no dependency was added. I checked on loopback (a local `http` server on 127.0.0.1) that the header is sent. The key is never logged.
- **Clock.** `scripts/judge-spike/clock.ts` holds `performance.now()` for all instants and one `new Date()` for the run date. It is the fourth file on `scripts/clock-allowlist.json`, and the clock check now scans the spike folder, so no other spike file may read the clock. The fake transport runs on a virtual clock, so a 60-line dry run finishes in under a second.

## How to make the audio and run the harness

All commands run from the repo root on PowerShell 5.1, one per line. The `--env-file` flags load the plain Model_Config values and the local secrets into the process, without printing them.

First, refresh the synced env file so it holds `FRANKI_TTS_MODEL`:

```powershell
node scripts/sync-local-env.mjs
```

**Synthetic audio.** It costs one text-to-speech request per line, 60 lines and 2,532 characters:

```powershell
node scripts/judge-spike/run.mjs synth
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs synth --live
```

The first command is a dry run that lists each line's voice. The second writes `scripts/judge-spike/audio/synthetic/<id>.wav` and a `manifest.json` of voices. Add `--lines o-01,c-forget-1` for a subset.

**Your own takes.** Start `npm run dev`, open `http://localhost:3000/recorder`, and use Record, Stop, Play back and Next. Each Stop saves `scripts/judge-spike/audio/owner/<id>.wav` and overwrites a retake. The page shows how many lines have a take. Record as many as you like.

**The harness.** Dry run first, on the fake transport. The owner dry run needs at least one recorded take:

```powershell
node scripts/judge-spike/run.mjs harness
node scripts/judge-spike/run.mjs harness --source owner
```

Live, synthetic, all 60 lines in two sessions:

```powershell
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --live
```

Live, your takes. Without `--lines` it runs every line you recorded:

```powershell
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --source owner --live
```

A live run uses `FRANKI_VOICE_MODEL` and `FRANKI_TRANSCRIBE_MODEL`: every line's audio as input (the harness prints the total seconds before it connects), one judge per line, and a reply on each `O`, cut at its first audio. It writes `<date>-<source>.json` and `.md` to `scripts/judge-spike/results/`. Runs on your takes keep no transcripts.

## Contract questions raised

These are added to `.kiro/specs/first-spoken-call/design.md` under "Contract questions" as 46 to 49:

- **46.** Contracts §5 don't say how the judge's safe-context and pending-question item is written. I chose a plain rendering (`judgeContextText`).
- **47.** The 800 ms budget assumes `server_vad` at 300 ms, which the spike measures. Since Nov 6 the app runs `semantic_vad`, so the spike's latency doesn't cover what the app ships. You pick the VAD for F2.
- **48.** Spec §13 (≥99%, p50 ≤800 ms, two misses stop) and §14 (90%, 850 ms) give different stop rules. The summary prints §14's, as the brief asks, and the run file has the rows for both. You say which decides F2.
- **49.** The takes route has no Firebase sign-in, a deviation from KV10. It is development-only, same-origin, known line IDs only, and overwrites on a retake.

## What I couldn't check

- **Anything against the real API.** That covers whether `reasoning:{effort:"minimal"}`, `max_output_tokens`, `output_modalities` and `item_reference` input are accepted on an out-of-band Realtime `response.create`, and the exact event and usage field names. It also covers whether the speech endpoint's `pcm` output is 24 kHz as I expect. The harness records `status_details`, the usage object and the event names, so the first live run will show these.
- **`npm run test:emulator`. I did not run it.** Java 21 is installed, but the Firebase CLI on this machine has usage reporting turned on (`usage` in its configstore), so running it would send analytics to Google. I didn't change your CLI settings. No Firestore code changed in this brief. To run it yourself: `npm run test:emulator`.
- **The recorder in a browser.** I didn't start `next dev` or open the page, so the microphone, the decode to 24 kHz and the save are not checked by hand. I did confirm offline, with Next's own route discovery (`getPageFromPath`), that `route.dev.ts` maps to `/api/dev/takes` under the dev extensions and to nothing in a build. The route's logic is unit-tested.
- **Network use by the build tools.** The first `npm run build` and the turbo runs in items 1 to 3 ran with Next.js and Turborepo anonymous telemetry on (both report `Enabled`), so they may have sent telemetry. From item 4 on, I set `NEXT_TELEMETRY_DISABLED` and `TURBO_TELEMETRY_DISABLED` in the shell. `next/font/google` (Geist, in `layout.tsx`) can fetch from Google Fonts during a build when the font isn't cached. None of this was a call to OpenAI.
- **One slip, with no call made.** In item 3, I ran `run.mjs synth --live --lines o-01` once without the `--env-file` flags. It stopped at the missing `FRANKI_TTS_MODEL` before any request, as the code orders it, so nothing was sent. I didn't run `--live` again.

## Checks at the last commit

`npm test` (132 files, 1,267 tests), `npm run lint`, `npm run typecheck` and `npm run build` exit 0. The post-build check prints "no Specimens_Page, recorder page or /api/dev route in the build." `npm run test:emulator` was not run (see above).

## Brief 007: the judge without a token cap

Items 1 to 5 are done, one commit each, after the brief's own commit. No command called OpenAI, and nothing ran with `--live`. The network did not stay fully clean, though: see "What I couldn't check".

### What changed

| Item | Where | What |
|---|---|---|
| 1 | `scripts/judge-spike/results/2026-11-09T18-41-59-158Z-owner.*` | The Nov 9 run on your 60 takes, committed unedited. It hit the token cap. |
| 2 | `packages/core/src/voice/judge.ts`, `scripts/judge-spike/harness.ts`, `cli.ts`, `summary.ts`, design question 50 | `judgeCreate(req, settings)` takes the output cap (a positive integer or `"inf"`) and the reasoning effort (`none`, `minimal`, `low`, `medium` or `high`). Contracts §5's values stay the defaults in core as `JUDGE_CONTRACT_SETTINGS` (16, `minimal`), so a call without settings builds the same event as before. The harness takes `--max-tokens <n\|inf>` and `--effort <value>`, defaulting to `inf` and `minimal` (`SPIKE_JUDGE_SETTINGS`). Both go into the run file and onto the summary's first lines. Each row now has `outputTokens` (`usage.output_tokens`, reasoning included) next to `reasoningTokens`, and the summary prints the largest and p50 values of each. The run file version is now `judge-spike-run-2`. |
| 3 | `scripts/judge-spike/summary.ts` | Recall and false holds in two views. In the *judge verdicts* view, a control line is caught only by the judge's own valid `H` or `U`, and an ordinary line passes only on its `O`. In the *as the app would act* view, an invalid answer or a timeout holds. Each view is printed within 600 ms and again at any time, with recall per control class. False holds are the same in both views, because an ordinary line passes only on a valid `O` either way. The stop rules read the judge-verdict view at the deadline. The valid-verdict rule is `over the line` when fewer than 90% of the lines have a valid verdict within 600 ms, and it prints the count. A test checks that the committed Nov 9 run now reads `over the line` on the valid-verdict and recall rules. |
| 4 | `scripts/judge-spike/harness.ts`, `cli.ts`, `fake-realtime.ts`, `summary.ts` | The lines run in a fixed seeded shuffle (`shuffleLines`, mulberry32 with Fisher-Yates), up to 30 per session. `--seed <n>` picks the order (default 7, which puts 15 control and 15 ordinary lines in each session of the full set). The run file records `seed` and `order`. The summary has a per-session table with the line mix and the judge p50. The fake transport's judge script now gets the turn ID, so a dry run still answers each line by its own label. |
| 5 | This section | |

### The next live run on your takes

Run these from the repo root, one per line. Dry run first, on the fake transport:

```powershell
node scripts/judge-spike/run.mjs harness --source owner
```

Live, every line you recorded, uncapped, effort `minimal`, seed 7. These are the defaults, written out here so the command says what it does:

```powershell
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --source owner --live --max-tokens inf --effort minimal --seed 7
```

The run prints the judge settings and the seed before it connects. It writes `<date>-owner.json` and `.md` to `scripts/judge-spike/results/`. To pick a cap afterwards, read "Output tokens per judge response" in the summary.

### A timing problem to fix before that run

In the Nov 9 run, the judge time is inflated by the harness itself, not by the judge. The harness sends the judge only after the whole WAV has streamed. Many of your takes end with more than 300 ms of silence, so the server VAD commits while the tail is still streaming. Time from commit to judge send was over 300 ms on 34 of 60 lines, and up to 1,281 ms (`c-forget-2`). Measured from the send, the judge took a p50 of 431 ms in session 1 and 455 ms in session 2. Measured from the commit, as the summary does, the p50s were 474 ms and 1,088 ms. Most of the "session effect" in brief 007 is this wait: the takes in session 2 had longer tails.

The harness has not changed here, so the next live run will repeat the problem. Many lines will time out at 600 ms because of the harness's own wait. The owner dry run already shows it on the fake transport: 28 of 60 lines have a valid verdict within 600 ms, though the fake judge answers in 180 ms. A fix would be to send the judge at the commit, as the Browser_Client would, and keep streaming the tail. Another would be to trim each take's trailing silence before streaming. I haven't made either change, because the brief ends at item 5. I'd make one before the live run.

### What I couldn't check

- **Whether the Realtime API accepts the new settings.** I haven't checked that an out-of-band `response.create` takes `max_output_tokens:"inf"`, or any effort other than `minimal`. The first live run will show it in `status` and `status_details`. The Nov 9 usage objects also reported up to 19 output tokens with the cap at 16, so the reported count can exceed the cap.
- **Build-tool telemetry. My commands may have reached the network.** In this brief I ran `npm run lint`, `npm run typecheck` and `npm run build` (Turborepo, and `next build` for `apps/web`) without setting `TURBO_TELEMETRY_DISABLED` and `NEXT_TELEMETRY_DISABLED`, as I had from brief 006 item 4 on. Turborepo's local config on this machine has `telemetry_enabled: true`. So these runs may have sent anonymous usage data to Vercel, and `next/font/google` may have fetched fonts if they weren't cached. Neither was a call to OpenAI. After I noticed, I set both variables for every command that ran turbo or Next.
- **`npm run test:emulator`.** I didn't run it, for the same reason as in brief 006. No Firestore code changed.
- **The judge itself.** No live run, so no numbers on uncapped output sizes, recall or time.

### Checks at the last commit

`npm test` (132 files, 1,277 tests), `npm run lint`, `npm run typecheck` and `npm run build` exit 0. The dry runs on synthetic and owner audio both finish and write their files to `scripts/judge-spike/dist/dry-run/`.

## Brief 008: the harness's own wait

The brief and the change went in as one commit, `spike: trim take tails so the judge is sent at the commit`, and this section as a second. No command called OpenAI or any other network service, and nothing ran with `--live`. I set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that ran turbo or Next.

### What changed

| Where | What |
|---|---|
| `scripts/judge-spike/trim.ts` | `trimTail` finds the last 20 ms frame whose RMS is above `SPEECH_RMS_THRESHOLD` (400), keeps 100 ms after it and drops the rest. Leading silence and pauses inside the line are untouched. A take with no frame above 400 gives `null`. The comment above the constant gives the measurements behind 400. |
| `scripts/judge-spike/harness.ts` | `runLine` streams the trimmed take, then silence until the commit, as before. `runHarness` refuses the run before opening any session if a take has no speech (`silentTakes`). Each row now has `takeMs` (the length before the trim), `trimmedMs`, and `derived.commitToJudgeSentMs`. `audioMs` is the streamed length. The run file version is `judge-spike-run-3`. |
| `scripts/judge-spike/cli.ts` | The cost guard prints the trimmed audio seconds and how much tail was cut. A silent take is refused before connecting, on a dry run and a live run alike. |
| `scripts/judge-spike/summary.ts` | The Times section prints the p50 and largest commit-to-judge-sent gap and names every line over 50 ms. It reads the gap from the two instants, so older run files get the same line. On the Nov 9 run it reports a largest gap of 1,281 ms (`c-forget-2`) and 34 lines over 300 ms, which a test pins. |
| `trim.test.ts`, `harness.test.ts` | The witnesses: a 2 s tail is cut to 100 ms after the last loud frame, and the judge goes out at the commit; a pause inside the line is streamed as recorded (two fragments); an all-silent take is refused with no session opened, both in `runHarness` and in the CLI; the summary flags a gap over 50 ms. There is also a fast-check property over random loud and quiet runs. |

### Why 400

All audio is 24 kHz mono 16-bit, the owner's takes and the synthetic files alike. On the owner's 60 takes, measured locally from the WAV files:

- Room tone after the last word stays under 250. The noisiest rooms, `o-29` and `o-30`, sit at 50 to 180.
- Words reach 1,000 and more on every take.
- `c-crisis-1`, `-2` and `-5` end with a small click (323 to 367) after 0.7 to 1.4 s of quiet. At 400 the click goes with the tail. At 300 it would stay, and so would the quiet before it, which is the wait this change removes. In the Nov 9 run, `c-crisis-2` and `-5` waited 832 ms and 504 ms.
- The cost: the quietest take, `c-crisis-4`, loses the last 100 ms of its final word's fade (RMS 180 to 340).

No synthetic takes exist on this machine, so 400 is not measured on text-to-speech audio. I expect its silence to be near zero.

### Trimmed tails on your takes

Over the 60 takes, the trim cuts 0 to 1,640 ms, 35.6 s in total, with a p50 of 700 ms. All 30 ordinary takes and all 5 crisis takes lose 260 to 1,640 ms. The other 25 control takes (company, correction, forget, hardRule and quiet) lose 0 to 20 ms.

Those 25 takes end with a click: 40 to 100 ms of sound after 0.6 to 1.6 s of quiet, peaking at RMS 580 to 1,800. It is probably the Stop press. Its level overlaps quiet speech (`c-company-5`'s last word is about 1,250), so no fixed threshold can drop it without cutting words, and the trim keeps it as the brief specifies. In the Nov 9 run, the server VAD heard most of these clicks as a separate fragment and committed after them, so the wait was short. Where it didn't hear the click, the wait was long: `c-forget-1`, `c-forget-2`, `c-forget-3`, `c-hardrule-3` and `c-quiet-1` waited 518 to 1,281 ms. **The trim does not fix those lines.** They will likely show up again in the summary's over-50 ms list. Two options, your call:

- Re-record those 25 takes and trim or avoid the Stop click.
- Add a rule that drops a short burst after a long quiet at the very end of a take. That goes beyond what brief 008 specifies.

On the fake transport, the owner dry run now has 60 of 60 valid verdicts within 600 ms (28 of 60 before), with a commit-to-send gap of 30 ms on every line. The fake VAD is a plain energy gate, so this checks the flow and not the server's VAD.

### The live run on your takes

From the repo root, one per line. Dry run first:

```powershell
node scripts/judge-spike/run.mjs harness --source owner
```

Live, every line you recorded, uncapped, effort `minimal`, seed 7:

```powershell
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --source owner --live --max-tokens inf --effort minimal --seed 7
```

Before connecting, it prints the trimmed audio seconds (223.3 s) and the tail it cut (35.6 s). In the summary, read "Commit to judge sent" first. The judge times are fair only for lines that are not named there.

### What I couldn't check

- **The server VAD on trimmed audio.** I expect the commit about 300 ms after the last speech, but only a live run shows it.
- **Synthetic audio.** There are no synthetic takes here, so the threshold is untested on them.
- **`npm run test:emulator`.** I didn't run it, for the same reason as in brief 006. No Firestore code changed.

### Checks at the last commit

`npm test` (133 files, 1,290 tests), `npm run lint`, `npm run typecheck` and `npm run build` exit 0. Turbo served lint and build from its cache, since no workspace package changed. Dry runs on both sources finish and write to `scripts/judge-spike/dist/dry-run/`.

## Brief 009: the judge and the reply in parallel

The brief went in on its own commit, then items 1 to 4 one commit each, and this section as item 5. No command called OpenAI or any other network service, and nothing ran with `--live`. I set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that ran turbo or Next.

### What changed

| Item | Where | What |
|---|---|---|
| 1 | `scripts/judge-spike/results/2026-11-09T19-19-59-517Z-owner.*` | The uncapped run on your 60 takes, committed unedited. |
| 2 | `harness.ts`, `realtime.ts`, `fake-realtime.ts`, `cli.ts`, `summary.ts` | `--mode sequential\|parallel`, default `parallel`, and `--stagger-ms <n>` (default 0, at most 600, parallel only). The sequential path is unchanged; it moved its judge parsing into a shared helper and nothing else. Parallel mode is described below. The run file records the mode and stagger under `run`, and its version is now `judge-spike-run-4`. |
| 3 | `trim.ts`, `harness.ts`, `summary.ts` | `trimTail` also returns where the last loud frame starts. Each row has `t.lastLoudSent`, the send time of the chunk holding that frame. Ordinary latency is reported two ways, labeled: from the last loud frame and from `speech_stopped.audio_end_ms`. The latency stop rule reads the last-loud-frame measure. The summary prints the p50 and p95 of `audio_end_ms`'s end of speech minus the last loud frame, which answers whether `audio_end_ms` includes the VAD's 300 ms of silence. |
| 4 | `summary.ts`, `harness.test.ts` | The mode and stagger are on the summary's first lines, and the latency rule is labeled with the mode. A parallel run gets a "Parallel" section, described below. The witnesses are listed below. |

### Parallel mode, per line

- At `conversation.item.added` for the last committed fragment, the harness sends the judge. It sends the reply (`purpose: "speculative"`) right after, or `--stagger-ms` later. Both are `conversation:"none"` and reference the same audio items.
- I read the stagger as spec §3 writes it, `min(verdict O, t0 + stagger)`, with t0 the judge's send. A valid `O` before the stagger ends sends the reply at once. A hold before it ends means no reply is sent. At stagger 0 none of this applies.
- The harness reads server events one at a time, in arrival order, and matches each one to a response by its response ID. It learns the two IDs from the `response.created` events by their metadata (`purpose` and `turnId`).
- On a valid `O` within 600 ms of commit, the reply is cancelled once both the verdict and its first audio delta are in. Audible time is the later of the two.
- On `H`, `U` or an invalid answer, the reply is cancelled when the verdict arrives. A judge with no `response.done` by commit + 600 ms holds the line, and its reply is cancelled at that moment. The judge itself is still waited for up to 3 s, as before. `mutedReplyAudio` records whether any reply audio had arrived first.
- Every `error` event from the judge's send to the end of both responses is kept in full in `concurrencyErrors`, and so is a reply `response.done` with status `failed`. Any entry holds the line. Nothing is retried in sequence.

### The Parallel section of the summary

- Judge time (judge sent to judge done) and reply time (reply sent to first reply audio), as p50, p95 and n.
- How many lines had reply audio before the verdict. Held lines count too.
- How many held lines whose reply went out got audio before the cancel. That audio would have stayed muted.
- Each line with an error event, with the error's code and message.
- One bold line on whether two out-of-band responses ran at once: **yes**, **no**, **not always**, or **not measured**. It counts the lines where the reply went out while the judge was still running, and whether the server created both with no error event.

### Witnesses on the fake transport

- An `O` line where the reply's audio comes first: audible time is the verdict.
- An `O` line where the verdict comes first: audible time is the first audio delta.
- An `H` line whose reply is cancelled after audio arrived: counted as muted.
- A refused second response (`concurrent: "refuse"` on the fake): the error event is kept in full, the line is held, only two `response.create` events go out, and the summary says **no**.
- Interleaved events: the reply's `response.created` arrives before the judge's, its audio before the judge's text, and its own `response.done` before the judge's. The verdict, the judge's times and the reply's times all come from the right response.
- The fake transport gained three options for these: `concurrent`, `createdDelayMs` per purpose, and `replyDoneMs` (a reply that finishes by itself).

### The live parallel run on your takes

From the repo root, one per line. Dry run first:

```powershell
node scripts/judge-spike/run.mjs harness --source owner
```

Live, every line you recorded, parallel, no stagger, uncapped, effort `minimal`, seed 7. These are the defaults, written out:

```powershell
node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs harness --source owner --live --mode parallel --stagger-ms 0 --max-tokens inf --effort minimal --seed 7
```

For the spec §3 stagger, run it again with `--stagger-ms 120`. A parallel run costs more than a sequential one, because every line sends a speculative reply, control lines included. Each reply is cancelled at the verdict or at its first audio, and the CLI says so before it connects. In the summary, read the bold "ran at once" line in the Parallel section first. If it does not say **yes**, the latency numbers are not the parallel path.

### What I couldn't check

- **Whether the Realtime API allows two out-of-band responses at once.** This is the `S-Audio` question, and only the live run answers it. The fake's refusal (`FAKE_REFUSAL`, code `conversation_already_has_active_response`) is my guess at the shape of the error. The harness records whatever the server sends in full.
- **A cancel race.** If a reply finishes by itself just before the harness cancels it, the server may answer the cancel with an error event, and that event would hold the line. I expect this to be rare, since the reply is cancelled at its first audio or at the verdict. Lines it affects would show up in the error list.
- **Older run files.** They have no last-loud-frame time, so their latency rule now reads `not measured`. The uncapped Nov 9 run was `over the line` before. Its ordinary latency from `audio_end_ms` still prints (p50 1,325 ms), and a test pins it.
- **The `audio_end_ms` question on real audio.** On the fake transport the gap is 20 ms, because the fake VAD reports the end of speech exactly. Only the live run measures the server's gap.
- **Lint on the spike.** `npm run lint` runs ESLint on `apps/web` only, so it doesn't cover `scripts/judge-spike`. That was already the case before this brief. `npm run typecheck` does check the spike.
- **`npm run test:emulator`.** I didn't run it, for the same reason as in brief 006. No Firestore code changed.

### Checks at the last commit

`npm test` (133 files, 1,306 tests), `npm run lint`, `npm run typecheck` and `npm run build` exit 0. Turbo served lint, build and the workspace typechecks from its cache, since no workspace package changed. The owner dry run finishes in parallel mode and writes to `scripts/judge-spike/dist/dry-run/`.
