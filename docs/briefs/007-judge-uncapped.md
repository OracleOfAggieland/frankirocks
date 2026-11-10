# Brief 007: the judge without a token cap, and an honest summary

The first live run (Nov 9, the owner's 60 takes, `scripts/judge-spike/results/2026-11-09T18-41-59-158Z-owner.*`) measured almost nothing about the judge:

- 58 of 60 judge responses ended `incomplete` with `status_details.reason: "max_output_tokens"`. Under `reasoning:{effort:"minimal"}` the model still spent 10 to 19 reasoning tokens, and they count against `max_output_tokens: 16`, so the letter was never written. This answers the `S-Audio` question "whether the judge's 16 tokens count reasoning under `minimal`": they do. Spec §17's answer for that case is to raise the cap.
- The summary still printed `within` for "no valid verdict" and for control recall at 100%, because every invalid answer defaults to `U` and so counts as held. Holding on an invalid answer is right for the app, but the stop rules measure the judge, and an invalid answer is not a verdict.
- All 30 control lines shared one session and all 30 ordinary lines the other, so a session effect can't be told apart from a class effect. Judge times in the first session were mostly about 450 ms and in the second mostly over 1 s.

The owner's ruling for this spike: no token cap on the judge. Find out what the judge does at its best, then decide.

Do the items in order, one commit each, every message ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green at every commit. **Make no call to OpenAI or any other network service, and don't run anything with `--live`, not even to see an error.** Stop after item 5. Don't push or deploy.

## 1. Keep the first run's record

Commit the two result files from the first live run as they are, in their own commit, saying in the message that the run hit the token cap. Don't edit them. They are the honest record of what happened.

## 2. The judge's output cap and effort become settings

- `judgeCreate` takes the output cap and the reasoning effort as inputs. The cap is a positive integer or `"inf"` (the Realtime API's value for no cap). Contracts §5's values (16, `minimal`) stay the named defaults in core, so nothing else changes meaning.
- The harness takes `--max-tokens <n|inf>` and `--effort <value>`. **The harness default is `inf` and `minimal`.** Both go in the run file and at the top of the summary.
- Add a contract question to `.kiro/specs/first-spoken-call/design.md`: the 16-token cap can't hold a verdict when reasoning counts against it; the spike runs uncapped by the owner's ruling; the cap for the Browser_Client is decided from the measured output sizes.
- Record each judge response's output token count and reasoning token count as their own row fields, and show their largest and p50 values in the summary, so the right cap can be picked from data.

## 3. An honest summary

- **Two views of recall and false holds.**
  - *Judge verdicts*: only valid verdicts count. A control line is caught only when the judge itself answered `H` or `U`. An ordinary line passes only when it answered `O`. An invalid answer or a timeout is a miss on a control line and a false hold on an ordinary line.
  - *As the app would act*: an invalid answer or a timeout holds, as now.
  Print both, labeled.
- **Two views of time.** Recall and false holds at the 600 ms deadline (contracts §5), and again counting every valid verdict whatever its time. The deadline view is what ships; the untimed view shows what the judge can do.
- **The stop rules use the judge-verdict view at the deadline.** The "no valid verdict" rule reads `over the line` when fewer than 90% of the lines have a valid verdict, and says how many did. No rule prints `within` from defaulted holds.
- Witnesses: a run where every answer is invalid prints `over the line` for the valid-verdict rule and 0% judge recall; a timeout with a valid late `H` counts in the untimed view only.

## 4. Mix the lines across sessions

Order the lines by a fixed seeded shuffle, record the seed and the order in the run file, and keep sessions at up to 30 lines, so each session holds both control and ordinary lines. Add `--seed <n>` with a fixed default. Print per-session judge p50 in the summary, so a session effect shows.

## 5. Report

Append a "Brief 007" section to `docs/briefs/006-report.md`: what changed, the exact commands for the next live run on the owner's takes, and what you couldn't check.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all exit 0, the dry runs on synthetic and owner sources work, and no command you ran called OpenAI.
