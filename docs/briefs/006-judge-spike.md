# Brief 006: the judge spike (F2), measured on real audio

The voice path works end to end (brief 005). Every voice reply is still admitted by `devAdmit` as `slowOrdinary`, without a judge (`packages/core/src/admission.ts`, the "F2 restores it" deviation). Before the judge is wired into the Browser_Client, it has to be shown to work on real audio. This brief builds the pieces to measure it and nothing else.

Read first: `docs/design/memory-spec-v3.md` §3 (the life of a turn, the permits, the control turn), §13 (targets on real audio), §14 ("Most likely to blow up", item 1) and §17 (`S-Audio`); `docs/design/memory-contracts-v2.md` §5 `judge_v1` and §6 "Realtime" and the `judge_v1` row of the model table.

Do the items in order, one commit each, every message ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green at every commit. **Make no call to OpenAI or any other network service, and don't run anything with `--live`.** The live runs happen after review. Stop after item 5. Don't push or deploy.

## What is being measured

The spec's sequential floor: speech ends, the VAD waits 300 ms and commits, the judge answers `O`, `H` or `U`, and only after `O` is the reply sent. Budget 300 + 190 + 310 = 800 ms from the end of audible speech to the first audio.

The three questions, from spec §14:

1. Does the judge return a valid verdict on real audio at all?
2. Ordinary latency: the p50 of end of speech to first reply audio, sequential, over 15 probes. Over 850 ms stops the build.
3. Control recall: the share of control lines the judge holds (`H` or `U`). Under 90% stops the build.

Also record what `S-Audio` asks: whether the 16 output tokens include reasoning under `minimal`, whether the judge emits a preamble or anything besides one letter, and the false-hold rate on ordinary lines. Also record when the ASR transcript arrives, because the slow gate falls back to it after 600 ms.

## 1. judge_v1 in `packages/core`

- The `judge_v1` instruction literal, copied exactly from contracts §5. It is a constant, and a test asserts its text so nobody drifts it.
- A pure builder for the judge's `response.create` event, exactly as contracts §5 gives it: `conversation:"none"`, `output_modalities:["text"]`, `tools:[]`, `reasoning:{effort:"minimal"}`, `max_output_tokens:16`, the metadata, one user text item with the safe context and pending question, then an `item_reference` for every unadmitted committed audio fragment, in commit order.
- A pure verdict parser over a `response.done` event: a verdict exists only if the response completed with exactly one message whose trimmed text matches `^[OHU]$`. Anything else is `U`, and it never takes the first letter of a longer answer. It also returns why the verdict is `U` (incomplete, several messages, extra text, empty), so the spike can count preambles.
- Witnesses for each rule, including `"O."`, `" O "`, `"OH"`, `"Okay"`, an incomplete response, two messages and an empty one.

These are the pieces the Browser_Client will use later, so they belong in core, not in the spike.

## 2. The probe lines, frozen before any run

Write 60 lines to a committed file, each with an ID, the text, a class and the expected hold (`hold` or `ordinary`). Lines are what a person would really say to a friendly assistant, in one breath, under about 6 seconds.

- **30 control lines, 5 in each of six classes:** forget ("forget what I said about…", "delete that"), company ("my sister's here", "hang on, Alex just walked in"), quiet ("keep that between us", "don't bring that up again"), correction ("no, her name is Mara, not Maya"), hard rule ("I just found out I'm allergic to shellfish"), and crisis or life change ("my dad passed away last night", a line of real distress). Mix in the judge literal's own cases: negation, "don't let me forget to…" (an intention, so `hold`), and a control request buried mid-sentence.
- **30 ordinary lines** the judge should let through: small talk, questions, telling Franki an ordinary fact, asking what it remembers. Include at least 8 near-misses that use control words without making a control request, such as "I forgot my umbrella again", "my sister loved that movie" and "I'm allergic to Mondays". Use the `ordinary` label only for lines that make none of the requests the judge literal lists. Food advice and asking Franki to act count as `hold` under the literal, so they don't belong here.
- Mark the first 15 ordinary lines as the latency probes.

Once this file is committed, no line's label changes because of a result (spec §13: a miss is never relabeled a pass). If a label is wrong, it gets fixed in its own commit that says why, before the run it affects.

## 3. Audio for the lines

Two sources, both written as 24 kHz mono 16-bit PCM WAV, named by line ID, into a gitignored folder.

- **Synthetic:** a script that turns each line into speech with OpenAI's text-to-speech, spread across at least four voices. The TTS model ID comes from Model_Config like the others (`packages/server/src/config/models.ts`, `apps/web/apphosting.yaml`, the local env sync), so the model-literal check stays green. Build it, test it against a fake, and don't run it.
- **The owner's voice:** a dev-only page, using the same mechanism that keeps the Specimens_Page out of production builds, that shows one line at a time with Record, Stop, Play back and Next. It saves each take through a dev-only route into the owner folder, overwriting a retake. The route accepts only known line IDs and WAV bodies under 2 MB, and it isn't in the production build (extend the post-build check to prove it). The page shows how many lines are recorded. The owner may record any subset.

## 4. The harness

A script that runs the lines through a real Realtime session over a WebSocket, one at a time, and writes the numbers down. It refuses to connect without `--live`, and without it, it runs the whole flow against a fake transport. It reads `OPENAI_API_KEY` and the model IDs from the environment, never logs the key, and is run with Node's `--env-file` pointed at the local env files. Use Node 24's built-in WebSocket if it can send the auth header; add a dependency only if it can't, and say why.

- **Session:** the contracts §6 `session.update` with the transcription model from Model_Config, `server_vad` with 300 ms silence, `create_response:false` and `interrupt_response:false`, 16-bit PCM at 24 kHz in and out, voice `cedar`, and a short fixed instruction for the spike's reply. No Head, no Firestore.
- **Per line:** stream the WAV in 20 ms chunks at real time, then silence until the VAD commits. Wait for `conversation.item.added` for the committed item (contracts §6), send the judge, and parse its verdict with item 1's parser. On `O`, send a reply `response.create` (`conversation:"none"`, `input` = the item reference, audio out) and cancel it at its first audio delta, to save cost. On `H` or `U`, send no reply. A judge with no `response.done` in 600 ms is recorded as a timeout and treated as held; keep waiting up to 3 s so its real time is known. Wait for the line's transcription before starting the next line.
- **Record per line, on one clock** (the harness's own monotonic clock; this is a tool outside the app, so say how it's allowlisted for the clock guard): the end of audible speech (the send time of the sample at `speech_stopped.audio_end_ms`), commit, item added, judge sent, judge first delta, judge done, the verdict and why, the judge's raw text, its usage (including any reasoning tokens), reply sent, first reply audio, transcription done, and the transcript.
- **Derived:** judge time (commit to judge done), ordinary latency (end of speech to first reply audio; playback adds about 60 ms in the browser, so say that next to it), and ASR time (commit to transcription done).
- **Output:** one JSON file per run with every row, the line set's commit hash, the audio source, the model IDs and the date. Also a short Markdown summary: valid-verdict rate, control recall overall and per class, false holds, p50 and p95 of each derived time, p50 ordinary latency over the 15 probes, invalid-verdict reasons, reasoning tokens seen, and a line for each spec §14 stop rule saying `over the line`, `within` or `not measured`. Never write `within` when a number is missing. Results go in a folder that is committed (no audio in it, and no transcript of the owner's own takes).
- **Cost guard:** print the line count and total audio seconds before connecting, and refuse more than 70 lines in one run. One session per run of up to 30 lines, then a fresh session, and record which lines shared a session.

Witnesses against the fake transport: a full `O` line, an `H` line that sends no reply, an invalid verdict counted as `U` with its reason, a judge timeout, a summary with a missing number that doesn't say `within`, and the refusal without `--live`.

## 5. Report

Write `docs/briefs/006-report.md`: what you built and where, how to make the audio and run the harness (commands for synthetic and for the owner's takes), any contract question you raised, and what you couldn't check. Add a line about the dev page to the README's local run section.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` all exit 0, the build's post-build check proves the recorder page and route are absent, and no command you ran called OpenAI.
