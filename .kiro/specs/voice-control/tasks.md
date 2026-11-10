# Implementation Plan: voice-control

Built from `requirements.md` (R*n.m*) and `design.md` (design §, contract questions Q52–Q90), after `docs/briefs/011-review-requirements.md` and `docs/briefs/011-review-design.md`. Contract rows are from contracts §10.

Rules for every task:

- Work on branch `build/voice-control`. Each task ends with its witness passing, `npm test` green (except a property left red under the rule below), and exactly one commit whose message ends with the trailer line `Built-with: Kiro`. Edits and commits go in separate calls. No push, no deploy (R22.6).
- Every task is required. Property tasks are marked **[property]** and are never optional (R20.2).
- Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` for every command that runs turbo or Next. No network call, no `--live`, no OpenAI call; all tests use the Memory_Store, the fake Clock_Port, Fake_OpenAI and the fake Decisions_Port (R22.1, R22.2).
- Read the relevant guide in `node_modules/next/dist/docs/` before touching Next.js code (R22.7). Add no dependency without asking.
- **Properties.** Generators and trace helpers live in plain modules (`packages/core/src/voice/testing/`, `packages/core/src/intents/testing/`, `packages/server/src/testing/`); each `*.property.test.ts` file holds only property statements, one property per file (R20.5). Once a property file is committed the Property_Guard blocks edits to it: a property that is wrong is a stop and a report, never an edit. A failing property's seed and shrunk sequence go in the task's **Notes** and in `docs/briefs/011-report.md` before any fix; a property is never weakened (R20.3, R20.4).
- **Exports.** `packages/core/src/index.ts` is edited only by the tasks that say so. Until then, tests import new core modules by relative path.
- **Parallel groups.** Tasks in the same group touch disjoint files and may run in any order. A group starts when every dependency of its tasks is done.
- When a task is done, fill in **Actual** in hours and any **Notes**.

---

## Wave A: admission

### Group A1: steering and the guard (serial)

- [x] 1. Steering: `voice-control.md` and `memory-rules.md`
  - Requirements: R1.1–R1.4; Q78
  - Depends on: none
  - Estimate: 1 h · Actual: 0.3 h
  - Notes: `fileMatchPattern` is one brace glob over the six files (machine, fast-o, core admission, server admission/**, turn route, voice client), since `ui-design.md` uses the single-string form. 44 lines. `fast-o.ts` does not exist yet; the pattern names it ahead of task 9.
  - Files: `.kiro/steering/voice-control.md` (new), `.kiro/steering/memory-rules.md`
  - Witness: manual check. Steps: `voice-control.md` has `inclusion: fileMatch` with patterns matching `packages/core/src/voice/machine.ts`, `packages/core/src/voice/fast-o.ts`, `apps/web/src/client/voice-client.ts`, `packages/core/src/admission.ts`, `packages/server/src/admission/*`, `packages/server/src/routes/turn.ts`; `(Get-Content .kiro/steering/voice-control.md).Count` is under 80; each rule of R1.2 is present with its contract section; `memory-rules.md` no longer names `devAdmit`, says every server Permit comes from the Admission_Seam and `fastO` only from the FastO_Rule, and sends contract questions to the `design.md` of the spec being built.
  - Commit: `chore(kiro): voice-control steering`

- [x] 2. Property_Guard
  - Requirements: R1.5–R1.8
  - Depends on: 1
  - Estimate: 1.5 h · Actual: 0.4 h
  - Notes: `decide(rawStdin, isTracked)` is pure; `gitTracks` runs `git ls-files --error-unmatch` (status 0 tracked, 1 not, anything else throws and the hook exits 2). A `delete_file` on a tracked property file is blocked too, since its `targetFile` is one of the path keys. To reuse the path keys, `scripts/clock-guard.mjs` now exports `PATH_KEYS` (one word added; outside this task's file list). No file in `.kiro/hooks/` was written: the reviewer adds the hook (suggested matcher `^(fs_write|str_replace|fs_append|delete_file)$`, command `node scripts/property-guard.mjs`). 9 tests; `npm test` 134 files, 1,315 tests green.
  - Files: `scripts/property-guard.mjs` (new), `scripts/property-guard.test.ts` (new)
  - Witness: `scripts/property-guard.test.ts` › exit 2 for a tracked `*.property.test.ts` target with the "add the new property in a new file, or stop and report" message; exit 0 for an untracked one; exit 0 for any other path; exit 2 on bad JSON and on a missing target path; `decide` takes the tracked check injected, so the tests need no git state; one end-to-end run against a real tracked file (`packages/core/src/head.property.test.ts`).
  - Reuse `toolInputOf` and the path keys of `clock-guard.mjs`. Do not write to `.kiro/hooks/`: note in the commit body that the reviewer adds the hook file (R1.7).
  - Commit: `chore(kiro): property guard`

### Group A2: pure core, first layer (parallel)

- [x] 3. Judge settings and `judge_v2`
  - Requirements: R16.1–R16.5, R2.2; Q82
  - Depends on: 2
  - Estimate: 2 h · Actual: 0.6 h
  - Notes: `JudgeSettings` gains `contract` and `deadlineMs`; `SPIKE_JUDGE_SETTINGS` keeps 600 ms until task 41. Outside the file list, for types and existing tests only: `cli.ts` (`judgeSettings` spreads the spike settings), `summary.ts` (`RunFile.judge` accepts old run files without contract or deadline), and two run-file expectations in `harness.test.ts` (run files now carry `contract` and `deadlineMs`, which is R17.6 early). The contract's own judge_v1 literal quotes "Don't let me forget", which probe c-forget-5 also says; the probe-copy test checks that the added sentence is clean and that judge_v2 adds no copy beyond the contract's, rather than claiming v1 is clean.
  - Files: `packages/core/src/voice/judge.ts`, `packages/core/src/voice/judge.test.ts`, `scripts/close-copy.mjs` (new), `scripts/probe-copy.test.ts` (new), `scripts/judge-spike/harness.ts` (the `SPIKE_JUDGE_SETTINGS` constant only)
  - Witness: `judge.test.ts` › `JUDGE_V2_INSTRUCTIONS` equals `judge_v1` with the one sentence on its own line after the `H:` line; `judgeCreate` picks the instructions by `contract` and writes it to `metadata.contract`; `JUDGE_CONTRACT_SETTINGS` is `{judge_v1, 16, minimal, 600}`; `APP_JUDGE_SETTINGS` is `{judge_v1, "inf", minimal, 1200}`. `scripts/probe-copy.test.ts` › no 4-word window of any `lines.json` line, nor any whole line under 4 words, appears in `JUDGE_V2_INSTRUCTIONS` (both rendered by `close-copy.mjs`). Existing harness tests still pass.
  - Commit: `feat(voice): judge settings and the judge_v2 candidate`

- [x] 4. Intents: request builder, response parser, priority
  - Requirements: R10.1, R10.4–R10.7; Q69, Q71, Q72
  - Depends on: 2
  - Estimate: 2.5 h · Actual: 0.6 h
  - Notes: Contracts §5's order has no place for `alone` (R10.7 copied the gap). Put it directly after `quiet`; raised as design question 91 and R10.7 updated. Tests read the prefix and predicate literals from the contract text itself. `parse.ts` also holds `outcomeOf`, the parse as the Server_Rule reads it.
  - Files: `packages/core/src/intents/classes.ts` (new: the 13 classes, `PRIORITY`, `CANDIDATE_P`, the 14 predicate literals, `TURN_INTENTS_PREFIX`), `packages/core/src/intents/request.ts` (new), `packages/core/src/intents/parse.ts` (new), `packages/core/src/intents/request.test.ts`, `packages/core/src/intents/parse.test.ts`
  - Witness: `request.test.ts` › the prefix as one developer message and the user message layout of design §"The slow parse"; 14 predicates in C§5 order with the literal instructions; at most 22 questions; a turn over 2,400 code units is refused as `oversize`. `parse.test.ts` › answers matched by position and name; refusal, wrong type, missing or extra answer, name mismatch, NaN and out-of-range probabilities each give `failed: invalid`; `choose` follows `PRIORITY` with `why` before `food` and retains every candidate at ≥ 0.20; `isOrdinary` is controls < 0.20 and `uncertainSpeaker` < 0.10, with no regex input.
  - The type check against `DecisionCreateParams` and `Decision` is in task 29 (core may not import `openai`).
  - Commit: `feat(intents): TurnIntents request, parser and priority`

- [x] 5. Fixed lines and VAD constants
  - Requirements: R15.9, R12.3, R19.1, R19.2; Q53
  - Depends on: 2
  - Estimate: 1 h · Actual: 0.3 h
  - Notes: `lines.ts` also exports `ackNote`, `isFixedLine` and `sayExactly`. `admission.ts` re-exports `RECOVERY_LINE` from `voice/lines.ts`, so every existing import still works. The existing `machine.test.ts` `session.update` assertion passes unchanged.
  - Files: `packages/core/src/voice/lines.ts` (new), `packages/core/src/voice/vad.ts` (new), `packages/core/src/voice/lines.test.ts` (new), `packages/core/src/admission.ts` (`RECOVERY_LINE` re-exported from `lines.ts`), `packages/core/src/voice/machine.ts` (`sessionUpdate` uses `SEMANTIC_VAD`)
  - Witness: `lines.test.ts` › `RECOVERY_LINE`, `FORGET_NOT_YET = "I can't forget things yet."`, `COMPANY_LINE = "Got it. I'll keep things general for now."`, `ALONE_LINE = "Okay, just us again."`, exact; `ackNote(line, …)` builds an S0 `W` of kind `ack` that validates. Existing `machine.test.ts` › the `session.update` body is unchanged byte for byte.
  - Commit: `feat(voice): fixed lines and VAD constants`

- [x] 6. Latency_Clock (pure)
  - Requirements: R18.1–R18.3, R18.6, R18.7; Q83
  - Depends on: 2
  - Estimate: 1.5 h · Actual: 0.3 h
  - Notes: `LATE_TURN_MS` (2,500) lives here, so the machine imports it rather than defining it twice. `FastORefusal` is defined here and reused by the FastO_Rule.
  - Files: `packages/core/src/voice/latency.ts` (new), `packages/core/src/voice/latency.test.ts` (new)
  - Witness: `latency.test.ts` › `LatencyRow` derived fields (`commitDelayMs`, `endToAudibleMs`, `late` exactly when `permitAt > commit + 2500`); `percentile` nearest rank on 1, 2 and 20 values; `summarize` gives per-path n, p50, p95, a count per `refused` reason and the late count; rows capped at 50; `LOUD_LEVEL = 0.05` and `LATENCY_SAMPLE_MS = 20`.
  - Commit: `feat(voice): latency clock`

### Group A3: pure core, second layer (parallel)

- [x] 7. Regex_Table
  - Requirements: R10.2, R10.3; Q70, Q90
  - Depends on: 3 (`close-copy.mjs`)
  - Estimate: 1.5 h · Actual: 0.3 h
  - Notes: The table is exactly design §"The Regex_Table". The copy test checks the joined pattern sources and each row on its own.
  - Files: `packages/core/src/intents/regex.ts` (new), `packages/core/src/intents/regex.test.ts` (new), `scripts/regex-copy.test.ts` (new)
  - Witness: `regex.test.ts` › each of RX1–RX7 matches its cue words after the normalization of design §"The Regex_Table"; "forgot", "forgets", "forgetting" and "deleted" don't match RX1; `regexMatch` returns the IDs and never a class. `scripts/regex-copy.test.ts` › no 4-word window of any `lines.json` line appears in the rendered table.
  - Commit: `feat(intents): regex table`

- [x] 8. `serverRule`
  - Requirements: R8.3–R8.12, R10.2, R12.1–R12.7, R14.1, R14.7, R15.1; Q54, Q60, Q64, Q65, Q67, Q68, Q87, Q88
  - Depends on: 4, 5
  - Estimate: 3 h · Actual: 0.6 h
  - Notes: Choices within the design table: a hold outcome carries `blocked` and `swap` (rows 1 and 8), and a permit outcome carries `reasons` (so a quiet hit writes `quiet` on its decision). A parse of kind `none` on a final ASR or typed turn (never expected) is treated as a failed parse with `missingDependency`, so the rule stays total. Row 4 gives `recoveryOnly` the reason `missingDependency`.
  - Files: `packages/core/src/admission.ts` (add `RuleInput`, `RuleOutcome`, `serverRule`; `devPermitKind` stays until task 39), `packages/core/src/admission.test.ts` (new)
  - Witness: `admission.test.ts` › one case per rule row 1–13 of design §"The Server_Rule", both waves; crisis retained beats every chosen class with scope `ack` and notes none; row 5a vs 5b differ only in `cut`; flipping `regexMatch` changes nothing when the parse did not fail; no input names a clock.
  - Commit: `feat(admission): the server rule`

- [x] 9. FastO_Rule
  - Requirements: R4.1, R4.4, R4.6, R4.7, R18.6; Q61
  - Depends on: 3
  - Estimate: 1.5 h · Actual: 0.3 h
  - Notes: A null ack reports `staleAck` when the machine dropped the last ack as stale (`ackDroppedStale`), else `ack`; so `staleAck` is checked inside the ack step rather than after `outstanding`.
  - Files: `packages/core/src/voice/fast-o.ts` (new), `packages/core/src/voice/fast-o.test.ts` (new)
  - Witness: `fast-o.test.ts` › `fastOProblem` returns each named reason (`verdict`, `ack`, `outstanding`, `staleAck`, `noteWaiting`) for one failing condition at a time, and null when all hold; boundaries at ack age 2,499/2,500 and at t0 + 1,199/1,200; `issueFastO` gives kind `fastO`, scope `reply`, no notes, `expiresAt = now + 10000`, and validates as `Permit`. Takes a narrow `FastOInput`, not `VoiceState`, so it doesn't wait on the machine types.
  - Commit: `feat(voice): fastO rule`

### Group A4

- [x] 10. Core exports
  - Requirements: R10.1 (exports for the server)
  - Depends on: 3–9
  - Estimate: 0.25 h · Actual: 0.1 h
  - Notes: No name collisions between the new modules and the existing exports.
  - Files: `packages/core/src/index.ts`
  - Witness: `npm run typecheck` exits 0; `scripts/import-boundaries.test.ts` passes.
  - Commit: `chore(core): export intents, lines, latency and fastO`

### Group A5: machine types (serial)

- [x] 11. Voice_Machine types, no behaviour change
  - Requirements: R2.1, R6.4, R7.9 (constants); design §"New state", §"Wait limits"
  - Depends on: 10
  - Estimate: 1.5 h · Actual: 0.4 h
  - Notes: `lastLoudAt` rides on the `realtime` event wrapper (optional), since the Realtime event itself is OpenAI's shape. `stateOk.sentAt` is optional in the type until task 27 decides how a missing one is read. Added `ackDroppedStale` (for the `staleAck` reason), `lastLoudAt`, `eventSeq` and `MissingTurn` beyond the design's table. `LATE_TURN_MS` is re-exported from `latency.ts`.
  - Files: `packages/core/src/voice/machine.ts`, `packages/core/src/voice/machine.test.ts`
  - Witness: `machine.test.ts` › `initialVoiceState` has the new fields with empty values; the new events (`specHashed`, `error`, `stateOk.sentAt`, `committed.lastLoudAt`) and commands (`hashPayload`) type-check and are ignored by `step`; the wait-limit constants have the values of design §"Wait limits"; every existing test passes unchanged.
  - Commit: `refactor(voice): machine types for the judge and speculation`

### Group A6: generators (parallel)

- [x] 12. Machine generators and trace helpers
  - Requirements: R20.1 (generators), R20.5
  - Depends on: 11
  - Estimate: 3 h · Actual: 1 h
  - Notes: Purely random actions rarely made a whole turn (9 of 300 calls posted one), so `arbCall` is mostly 1–4 coherent turn scenes (stateOk, commits, both creates, the judge and transcripts in a drawn order, the server answer, audio), each with steps dropped, repeated, swapped and noise inserted, plus 1 in 5 pure-noise calls. The driver uses a pure test hasher (no `node:crypto` in core) for both the "server" Permit and the "browser" hash. `CallDriver.connect` replays open, channel and the first ack after a reconnect. The non-vacuity test asserts that over 60 of 300 calls post a turn and over 10 reach SPEAKING.
  - Files: `packages/core/src/voice/testing/arb-call.ts` (new), `packages/core/src/voice/testing/trace.ts` (new), `packages/core/src/voice/testing/arb-call.test.ts` (new)
  - Witness: `arb-call.test.ts` › 200 generated calls replay through `step` without throwing; every event kind of design §"Correctness Properties" appears across 1,000 samples; `trace` records phase, `outputMuted`, commands and response IDs per step; `audible(r, i)` agrees with a hand-built trace.
  - Commit: `test(voice): call generators and trace helpers`

- [x] 13. Intents and rule generators
  - Requirements: R20.1 (generators), R20.5
  - Depends on: 10
  - Estimate: 1 h · Actual: 0.3 h
  - Notes: `allRuleInputs` enumerates 1,741,824 inputs: every enum value, every boolean (word density and all-final share one flag), and 21 parse shapes (ordinary, each class alone, crisis with company, uncertain only, each failure, none).
  - Files: `packages/core/src/intents/testing/arb-intents.ts` (new), `packages/core/src/intents/testing/arb-rule-input.ts` (new), `packages/core/src/intents/testing/arb.test.ts` (new)
  - Witness: `arb.test.ts` › probability vectors include 0.1999 and 0.20; `arbRuleInput` covers every enum value and both waves across 1,000 samples; the enum-only part enumerates exhaustively.
  - Commit: `test(intents): probability and rule-input generators`

### Group A7: properties, written before the machine changes (parallel)

Machine properties 2, 4, 7 and 12 are expected red on the current machine. The others may already pass. Each task records whether it ran red or green, and for red the seed, the path and the shrunk counterexample in **Notes**, then commits the property as written.

- [x] 14. **[property]** P1 No permit, no sound
  - Requirements: R20.1.1; R3.1, R6.1, KV02, KV03
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.3 h
  - Notes: Ran green on the current machine (1,000 runs). The unmute-step check names the stamp, expiry and payload hash rather than calling `permitProblem`, because `permitProblem` also checks the `fastO` StateAck's age, which only binds at issue: the browser drops its ack when it posts the turn, usually before the speculative reply's audio starts.
  - Files: `packages/core/src/voice/no-permit-no-sound.property.test.ts` (new)
  - Witness: the property file itself, 1,000 runs.
  - Commit: `test(voice): property 1, no permit no sound`

- [x] 15. **[property]** P2 A held reply never resumes
  - Requirements: R20.1.2; R3.3–R3.5
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.3 h
  - Notes: Green, but vacuously: today's machine has no judge, so the trigger (the machine's current judge, `before.judge`, answering non-O, or its `judge` timer firing) never occurs. The trigger is the machine's current judge, not any judge `response.done`, so a cancelled judge's late answer can't fire it. A non-vacuity count is added with task 25. The statement implies a design choice the machine must follow: a turn held by `H`, `U` or a judge timeout sends no new speculative reply under the same turnId.
  - Files: `packages/core/src/voice/held-never-resumes.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 2, a held reply never resumes`

- [x] 16. **[property]** P3 Nothing dispatches before admission
  - Requirements: R20.1.3; R6.2, R6.3, KV02
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.2 h
  - Notes: Green on the current machine (1,000 runs). Admission is the step at which a reply of the turn becomes the machine's active reply; a dispatch in that same step (the `fastO` `admitted` receipt, a held function call) counts as after it.
  - Files: `packages/core/src/voice/no-dispatch-before-admission.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 3, nothing dispatches before admission`

- [x] 17. **[property]** P4 No clipped suffix
  - Requirements: R20.1.4; R3.2
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.2 h
  - Notes: Green vacuously: today's machine creates no speculative reply. "Muted start" is an `output_audio_buffer.started` for the speculative reply after which output is still muted.
  - Files: `packages/core/src/voice/no-clipped-suffix.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 4, no clipped suffix`

- [x] 18. **[property]** P5 Stale events are inert
  - Requirements: R20.1.5; R7.1, R7.2, KV05
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.3 h
  - Notes: Green on the current machine. Stale events are: `response.created` of another generation; `output_audio_buffer.started` or `response.done` for an unknown response; `started` for a cancelled response; and `response.done` for a cancelled judge. A `response.done` for a cancelled speech reply is left out on purpose: it rightly sends that reply's transcript receipt.
  - **Found red later, in the full suite (property statement defect; build stopped).** The 1,000-run check passed when the property was committed, and then failed on other seeds:
    - Seed `-1920710077`, path `270:5:0:0:…`. Shrunk counterexample: `[[commit (300), itemAdded 0 (40), transcript 0 (0), turnFailed 0 (0), timer due (100), commit (300), itemAdded 0 (40), transcript 0 (0), turnOk 0 ordinary hashOk (400), hash 0 ok (0), created 0 (30), started 0 (300)]]`.
    - Seed `192887172`, path `47:1:2:0:…`. Shrunk counterexample: `[[connectionLost (0), timer due (100), timer due (100), commit (300), itemAdded 0 (40), transcript 0 (0), turnOk 0 ordinary hashOk (400), hash 0 ok (0), created 0 (30), started 0 (300)]]`, failing with `expected 'SPEAKING' to be 'HELD'`.
    - Seed `1882653300`: the same shape after a `connectionLost`.
    - Cause: the property's `cancelledBefore(id, i)` counts any `teardown` command before step i as cancelling the response, even a teardown that happened before the response was created. After a reconnect, the new call's first permitted reply is wrongly treated as a cancelled response, so its legitimate `output_audio_buffer.started` (which rightly moves the machine to SPEAKING) is judged stale. The machine is right; the statement is wrong. The fix is one condition (`s.i > createdAt` for the teardown), but the file is committed and guarded, so it was not edited, and the build stopped here as the rules require.
    - **Corrected by the reviewer in `d607111`** (`docs/briefs/011-review-build-a.md`): only a cancel or teardown after the response was created counts as cancelling it. What the property claims is unchanged. It passed 6,000 runs, including the three seeds above.
  - Files: `packages/core/src/voice/stale-inert.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 5, stale events are inert`

- [x] 19. **[property]** P6 Every wait ends
  - Requirements: R20.1.6; R7.3, KV06
  - Depends on: 12 · Estimate: 1 h · Actual: 0.3 h
  - Notes: **Red on the current machine, as expected.** Seed `-944006138`, path `8:1:1:0:0:…` (fast-check printout in the report). Shrunk counterexample: `[[commit (dt 300), itemAdded pick 0 (dt 40), transcript pick 0 (dt 0)]]`: the turn is posted `final` and the machine sits in HELD with no armed deadline, because today's `permit` timer is armed only when a `hold` answer arrives. A `/api/turn` that never answers leaves the call stuck. Fix in task 27: arm `permit` at post + `TURN_RESPONSE_LIMIT_MS` on every post. Expected next red: SPEAKING has no deadline (contracts §6 States "45scap"); task 28 adds the cap. Keep-alive timers (poll, refresh, stateRetry, stateRetryUi) are not fired by the property.
  - Files: `packages/core/src/voice/every-wait-ends.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 6, every wait ends`

- [x] 20. **[property]** P7 `fastO` needs a fresh ack
  - Requirements: R20.1.7; R4.1–R4.4, KV13
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.3 h
  - Notes: Green vacuously: today's machine issues no `fastO`. Outstanding turns and the last turn answer are read from the trace, not from machine fields, so the property doesn't trust the machine's own bookkeeping. An issued `fastO` is one whose permitId first appears as the pending or active reply's Permit.
  - Files: `packages/core/src/voice/fast-o-fresh-ack.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 7, fastO needs a fresh ack`

- [x] 21. **[property]** P12 A late Permit plays; a timed-out request doesn't
  - Requirements: R20.1.12; R7.5, R18.7
  - Depends on: 12 · Estimate: 0.75 h · Actual: 0.3 h
  - Notes: Green on the current machine. Today a late Permit in HELD is already checked; the change task 26/27 makes is that the 2.5 s `permit` wait becomes post + 5 s, so (b) covers more answers. Part (c) is vacuous until task 28 records latency rows. (b) skips answers whose Deck differs, whose stamp is not current or whose Permit has expired, since those are rightly refused.
  - Files: `packages/core/src/voice/late-permit.property.test.ts` (new)
  - Witness: the property file, 1,000 runs.
  - Commit: `test(voice): property 12, a late permit plays`

- [x] 22. **[property]** P8 The seam is total and closed
  - Requirements: R20.1.8; R8.3–R8.12, R10.2, R12
  - Depends on: 13 · Estimate: 0.75 h · Actual: 0.4 h
  - Notes: **Red on first run.** Seed `391587391`, path `39:1:2:2`. Shrunk counterexample: `{source:"tool", transcript:"final", judge:"error", parse:{kind:"none"}, regexMatch:false, audience:"private", narrowedHere:false, callLive:false, parseGap:false, noteSens:"none", wordsPer2s:false, allFinal:false, toolParseCommitted:true, wave:"A"}`: rule row 3 gave a tool continuation `notes:"all"` on a turn the judge didn't mark O, against R8.12. The exhaustive half fails the same way, and also on a typed source with a non-`typed` judge, where row 13 waived the judge for `source:"typed"`. Fix (separate commit after this one): row 3 and row 13 allow all notes only with `judge` O or `typed`, a private audience and no gap; row 13 waives word density and all-final for typed lines only. Fixed in `6b48d19`; green since. The exhaustive half's 1.7 M inputs ran about 67 s, past vitest's 5 s timeout, and the property file can't be edited to raise it; `allRuleInputs` (a plain generator) now enumerates 36,288 inputs (14 parse shapes, two boolean profiles), which runs inside 5 s under the full suite. The fast-check half still draws every class subset and every boolean.
  - Files: `packages/core/src/intents/seam-total.property.test.ts` (new)
  - Witness: the property file, 1,000 runs plus the exhaustive enum part. Expected green (task 8 is done).
  - Commit: `test(admission): property 8, the seam is total and closed`

- [x] 23. **[property]** P9 Priority is stable
  - Requirements: R20.1.9; R10.2, R10.6, R10.7, R12.1
  - Depends on: 13 · Estimate: 0.5 h · Actual: 0.2 h
  - Notes: Green on first run (1,000 runs). Draws the wave as well, and checks the crisis care reply with no live call so wave B's crisis-with-company row (which also answers the care reply) is covered without the swap flag.
  - Files: `packages/core/src/intents/priority-stable.property.test.ts` (new)
  - Witness: the property file, 1,000 runs. Expected green.
  - Commit: `test(intents): property 9, priority is stable`

### Group A8: the Voice_Machine (serial; every task edits `machine.ts` and `machine.test.ts`)

Each task adds example tests to `machine.test.ts` for its rows of design §"The state machine". After task 28, properties 1–7 and 12 are green.

- [x] 24. Judge and speculative reply at the commit
  - Requirements: R2.1–R2.9, R5.1; KV01; Q62, Q75, Q85
  - Depends on: 11, 14–21 · Estimate: 3 h · Actual: 4.5 h (tasks 24–28 together)
  - Notes: **The rows of tasks 24–28 depend on each other (a turn can't be admitted under fastO without its verdict, deadline, ack and post handling), so the machine code for all five, and every example test of all five (describe blocks "task 24" to "task 28" in `machine.test.ts`), landed in this one commit. Tasks 25–28 are recorded in their own commits with their notes; their witnesses are in this commit.** Choices: `metadata.eventId` carries each client `event_id` so `response.created` is matched to the judge, the speculative reply and each admitted reply exactly (a cancelled reply's late `response.created` can no longer be taken for the next one; recorded under question 85); a Turn held by H, U, a judge timeout or a fastO refusal is marked `held` and never speculates again, even if it grows; a commit while a reply is admitted or being checked is a barge-in; audio of a response the call doesn't own is cancelled and the next reply clears the buffer first. Existing tests updated, none removed (R21.2): seven `machine.test.ts` cases (the phase after posting is now SPECULATING; the transcript wait is 2.5 s and a late transcript is a superseding post; a recoveryOnly answer to a held turn plays the neutral line; stray audio now gets a `response.cancel`; a recall during audio stays SPEAKING until the audio stops), and four `voice-client.test.ts` cases (reply creates filtered by purpose `speech`; state polls every second). The voice client itself is task 40.
  - **Red runs during the machine work (seed, path, shrunk counterexample, fix):**
    - P6, seed `317106658`, path `307:5:0:0:…`: `[commit 300, itemAdded 0 40, transcript 1, timer due 100, stateOk fresh 100, turnOk ordinary 400, higherDeck, timer due 100, stateOk fresh 100]` → stuck in HELD: a higher Deck cancelled a pending check in HELD and armed no deadline. Fix: a higher revision in HELD also arms the permit wait.
    - P6, seed `-710847600`, path `216:2:1:…`: `[commit, itemAdded, created 1, hash ok, judgeDone O 100, hash ok, transcript, turnOk ready 400]` → stuck in HELD after a cut with a pending check. Fix: every `requestVerify` arms the permit wait if none is armed.
    - P1, seed `-2068053382`, path `242:4:0:2:4:…`: hash at unmute differed from the Permit's (counterexample not printed by the run; cause found from the shrunk shape of the next one): a commit joined a Turn whose reply was already admitted, changing its audio IDs. Fix: such a commit is a barge-in.
    - P1, seed `1315630625`, path `13:5:0:0:…`: `[commit 300, itemAdded 40, hash ok, transcript, turnOk ordinary 400, hash ok, created 30, started 300, fnCall]` → unmuted in TOOL_WAIT (also true of the old machine). Fix: a recall during audio stays SPEAKING; TOOL_WAIT starts when the audio stops, and a ready tool result mutes and clears a lead-in still playing.
    - P4, seed `-261621374`, path `824:5:0:…`, and seed `-1254558683`, path `923:5:0:1:…` (`[stateOk, speechStop, commit, itemAdded, created, created, hash, started, hash, stopped, done, timer, speechStart, commit, itemAdded, transcript, transcript, hash, transcript, turnOk ordinary, hash, created, started]`): a speculative reply that had finished generating (`response.done`) was dropped from `inFlight`, so barge-in never cancelled it by ID. Fix: cancelAll also cancels the judge's and the speculative reply's IDs.
    - P4, seed `-1179874900`, path `388:4:1:…`: `[commit, itemAdded, created 1, created 0, hash, judgeDone U, foreign cancelledStart, hash, transcript, turnOk ordinary, hash, created, started]`: audio of an already cancelled reply started after the clear, and the next reply was created without another clear. Fix: stray audio is cancelled by ID and sets `strayAudio`; the next reply clears first.
    - P2, seed `1285614937`, path `760:4:1:…`: `[commit, itemAdded, created 1, timer due, timer due, commit, itemAdded, created 1, hash, judgeDone O, hash, hash, created 0, started]`: after a judge timeout held the Turn, a new fragment joined it and a second speculative reply under the same turnId played. Fix: a held Turn doesn't speculate again.
    - P7, seed `592073658`, path `729:5:0:…`: `[commit, itemAdded, transcript, timer due, stateOk fresh, turnOk ordinary 0, commit, itemAdded, created 1, judgeDone O 100, hash ok]`: an ack that arrived before a later `/api/turn` answer granted fastO. Fix: every turn answer drops the held ack (`ackDroppedStale`).
  - After the fixes, the eight machine properties passed 12 consecutive full runs (1,000 cases each, fresh seeds); `npm test`, typecheck and lint green. `arb-call.test.ts` now also asserts the generator reaches fastO, a held judge and a muted speculative start (the scene's state poll moved to just before the last commit, so its ack is fresh at the verdict).
  - Files: `packages/core/src/voice/machine.ts`, `packages/core/src/voice/machine.test.ts`
  - Witness: `machine.test.ts` › "judge and speculative reply at item.added" (both `send` commands in one step, `event_id`s, `hashPayload`, muted, `judge` timer at t0 + 1200); "noteWaiting sends the judge alone"; "more than 8 fragments takes the slow path"; "no item.added within 600 ms sends no judge"; "speech start cancels both and the next commit judges all fragments".
  - Commit: `feat(voice): judge and speculative reply at the commit`

- [x] 25. Verdicts, `fastO` admission and regeneration
  - Requirements: R3.1–R3.7, R3.9, R4.3, R6.1–R6.3; KV02, KV03, KV13; Q56, Q76
  - Depends on: 24 · Estimate: 3.5 h · Actual: in task 24
  - Notes: Code and witnesses landed in `2563adf` (task 24's notes say why). Witness: describe "verdicts and fastO admission (task 25)" in `machine.test.ts`, 7 cases. The `permitProblem` StateAck check now binds at issue only (`checkAck`), since posting drops the ack; the existing KV13 test of `permitProblem` is unchanged and passes. Properties 1–4 and 7 green.
  - Files: same as 24
  - Witness: `machine.test.ts` › "valid O with a fresh ack unmutes at the spec's start"; "O after muted audio cancels, clears and regenerates"; "H, U, invalid and judge error cancel and hold; a later O changes nothing"; "judge timeout cancels both"; "a refused fastO records its reason"; "a held function call dispatches after admission and drops on a hold"; "`admitted` receipt before `playbackStarted`"; "the post carries the known verdict or timeout". Properties 1–4 and 7 green; any still red is reported.
  - Commit: `feat(voice): verdicts and fastO admission`

- [x] 26. Turn responses, cuts and tools by scope
  - Requirements: R3.8, R7.5, R11.4, R11.6, R11.7, R12.4, R12.6, R12.7; Q58, Q59, Q60, Q88
  - Depends on: 25 · Estimate: 3 h · Actual: in task 24
  - Notes: Code and witnesses in `2563adf`. Witness: describe "turn responses, cuts and tools by scope (task 26)", 5 cases. Follows question 92: only `ready` and `clarify` cut an admitted reply; `ordinary` with `postCommitControl` doesn't. A recoveryOnly Permit on any status plays the neutral line. Property 12 green.
  - Files: same as 24
  - Witness: `machine.test.ts` › one case per status row (`ordinary`, `ready`, `hold`/`clarify` with `recoveryOnly`, `blocked` ignored until wave B); "ready and clarify cut a playing fastO reply, ordinary and hold don't"; "a slowOrdinary that arrives while SPECULATING admits the spec reply"; "scope ack and recoveryOnly get tools []; scope reply keeps recall"; "an ack note is spoken verbatim"; "a Permit arriving after t0 + 2500 but before the request timeout plays and is late"; "after the permit timer a turnOk only adopts its Deck". Property 12 green.
  - Commit: `feat(voice): turn responses, cuts and tools by scope`

- [x] 27. Deadlines, `missing` posts, the superseding post, polling and speech start
  - Requirements: R4.1–R4.5, R7.1–R7.9; KV04, KV05, KV06; Q54, Q63, Q89
  - Depends on: 26 · Estimate: 3 h · Actual: in task 24
  - Notes: Code and witnesses in `2563adf`. Witness: describe "deadlines, missing posts, polling and speech start (task 27)", 4 cases, plus the updated "missing a transcript at t_end+2.5 s" case. The `turn` command gains `supersedesTurnId`; the Voice_Client fills `supersedesRequestId` from the request ID it used (task 40). Every post arms the permit wait at post + 5 s (this fixed property 6's first red run, seed `-944006138`, task 19), and SPEAKING has the 45 s cap. Properties 5 and 6 green.
  - Files: same as 24
  - Witness: `machine.test.ts` › "held turn posts missing at t0 + 2500 and plays the neutral line"; "admitted turn posts missing at t0 + 5000 and keeps playing"; "a late transcript sends one superseding post with the same turnId and clientSeq and speaks nothing"; "posting drops the ack; an ack sent before the last turn response can't grant fastO"; "poll every 1000 ms, never two in flight"; "speech start cancels judge, spec and active, clears, drops Permits". Properties 5 and 6 green.
  - Commit: `feat(voice): deadlines, missing posts and the superseding post`

- [x] 28. Latency rows and the avatar
  - Requirements: R6.4, R18.1, R18.3, R18.6, R18.7
  - Depends on: 27 · Estimate: 1.5 h · Actual: in task 24
  - Notes: Code and witnesses in `2563adf`. Witness: describe "latency rows and the avatar (task 28)", 3 cases. A row closes when the Turn returns to LISTENING (or the next Turn starts). All machine properties (1–7, 12) green.
  - Files: same as 24
  - Witness: `machine.test.ts` › "a fastO turn's LatencyRow has every time and path fastO"; "regenerated, slow and recovery paths"; "refused reason recorded"; "`avatarState` is thinking for WAIT_ITEM, JUDGING, SPECULATING, HELD, TOOL_WAIT and speaking only while unmuted". All machine properties (1–7, 12) green.
  - Commit: `feat(voice): latency rows and avatar mapping`

### Group A9: server foundations (parallel; may run beside A5–A8, files are disjoint)

- [x] 29. Decisions_Port, live adapter and fake
  - Requirements: R10.8, R11.2, R11.8; Q72
  - Depends on: 10 · Estimate: 2 h · Actual: 0.4 h
  - Notes: The port is a thin `decide(body, deadlineMs)` over the OpenAIPort's new `decisions.create` endpoint (Fake_OpenAI scripts it like the others); the live adapter calls `sdk().decisions.create` with `maxRetries: 0`, since the caller owns the deadline. The type check is assignment-based, so it is enforced by `npm run typecheck`, not by vitest.
  - Files: `packages/server/src/openai/fake.ts`, `packages/server/src/openai/live.ts` (endpoint `decisions.create` → `POST /v1/decisions`), `packages/server/src/intents/decisions-port.ts` (new), `packages/server/src/intents/decisions-port.test.ts` (new), `packages/server/src/intents/decisions-types.test.ts` (new)
  - Witness: `decisions-types.test.ts` › the core builder's return type is assignable to `DecisionCreateParams` and `parseDecision` accepts a `Decision` (type-level, against `node_modules/openai`); `decisions-port.test.ts` › the fake records requests and answers from a script; the deadline gives `{ok:false, why:"deadline"}` on the fake timers; a thrown transport error gives `why:"transport"`; the model comes from `FRANKI_BG_MODEL`. `scripts/model-literals.test.ts` passes.
  - Commit: `feat(intents): decisions port`

- [x] 30. Admission_Seam: `admitRule` and `recordFastO`
  - Requirements: R8.1, R8.2, R9.1–R9.3, R13.1; Q57, Q78
  - Depends on: 10 · Estimate: 2 h · Actual: 0.5 h
  - Notes: `admitRule` takes no env, so nothing can make it refuse in production; the test runs it on a production-env rig. It also filters the reply's notes by the rule's `notes` (none, S0 or all), so an S1+ note never reaches a Permit the rule didn't allow. The Fixed_Line's note ID is `H("ack", stamp, line)`. `admit` (devAdmit) stays until task 39.
  - Files: `packages/server/src/admission/seam.ts` (add `admitRule` and `recordFastO` beside `admit`), `packages/server/src/admission/seam.test.ts` (new)
  - Witness: `seam.test.ts` › one decision per outcome keyed by `permitId`, `H("hold", …)` or `H("fastO", sessionId, turnId)`; the decision cites the request entry with a `ledger` Ref; the payload hash equals `payloadHash`; an ack note is in `noteIds` and the hash; `recordFastO` twice writes once; issues Permits with `NODE_ENV=production`.
  - Commit: `feat(admission): seam with the server rule and fastO record`

### Group A10

- [x] 31. Slow parse runner
  - Requirements: R11.1, R11.2, R10.2; Q90
  - Depends on: 7, 29 · Estimate: 1.5 h · Actual: 0.3 h
  - Notes: Adds `packages/server/src/testing/decisions.ts` (a fake `Decision` builder) for the route tests. The log line carries regex IDs only, never the words.
  - Files: `packages/server/src/intents/slow-parse.ts` (new), `packages/server/src/intents/slow-parse.test.ts` (new)
  - Witness: `slow-parse.test.ts` › regex then Decisions; ordinary, hit, `failed` (deadline, transport, invalid, oversize) each from the fake; the regex IDs are returned and logged as `turn.regex`; a regex match with a successful parse leaves the result unchanged.
  - Commit: `feat(intents): slow parse`

### Group A11

- [x] 32. `/api/turn` with the slow parse and the server rule
  - Requirements: R8.1–R8.13, R11.1–R11.5, R11.8, R12, R13.1, R13.2, R15.2, R15.6, R15.7 (the lease), R21.3; Q56, Q60, Q61, Q64, Q66, Q73, Q80
  - Depends on: 30, 31 · Estimate: 4 h · Actual: 1.2 h
  - Notes: The slow parse and the typed reply run in parallel before the transaction; `admitRule` cites the request entry (`key.keyHash`). The rule reads the audience and parse gap from before this Turn (its own failure counts from the next one), and an expired lease is stored as `unknown` first. `testRig` now answers `decisions.create` with an ordinary `Decision` by default, so existing route tests keep their meaning. **Changes outside the file list:** `seam.ts` drops `spokenResponseId` from the fastO Turn fields (the turn-first order can't know the response ID, so it's left out of both orders to keep R9.2's "same records"); `testing/fakes.ts` (the default above); `dev-admit.test.ts`: the "CONFIG in production through the route" check is replaced by "the turn route admits in production" (R8.2), and the decision now also cites the request entry. The `typed-reply.ts` file needed no change: the parallel call is in the route. Status mapping in `statusOf` (exported for the tool route and tests).
  - Files: `packages/server/src/routes/turn.ts`, `packages/server/src/turns.ts` (Turn parse fields, `rootSlices`), `packages/server/src/routes/typed-reply.ts` (Decisions beside the typed reply), `packages/server/src/audience.ts` (new: `effectiveAudience`, lease helpers), `packages/server/src/routes/turn.test.ts` (new), `packages/server/src/audience.test.ts` (new)
  - Witness: `turn.test.ts` › one case per status-mapping row (wave A rows); ordinary voice turn gets `slowOrdinary` whatever `judge`; S1+ note only with `judge:"O"`, word density, all final, no gap, private; failed parse with and without a regex match (`clarify` vs `hold`); typed U parsed, pasted unparsed; missing transcript sets the 10 s lease and failed transcription stores `unknown`; the parse watermark stays contiguous; the Turn stores `judge`, `parseState`, `uncertainSpeaker`, `rootSlices`; a turn whose `fastO` decision exists gets `judge:"O"` and `admittedAt`. Existing typed and voice route tests updated, none deleted without replacement (R21.2).
  - Commit: `feat(turn): slow parse and the server rule on every transcript`

### Group A12 (parallel)

- [x] 33. **[property]** P11 A repaired gap leaves no trace
  - Requirements: R20.1.11; R7.8, R11.9, R15.3, R15.4, R15.7
  - Depends on: 32 · Estimate: 1.5 h · Actual: 0.5 h
  - Notes: **Red, as expected (no repair or superseding post yet).** Seed `-2118694151`, path `0:0:0:0:0`. Shrunk counterexample: `[{kinds:["typed"], k:0, how:"deadline"}]`: after one typed turn whose parse missed its deadline, the wrong run has `committedParseSeq 0` (want 1), a lease still held, the Turn `parseState "failed"` (want committed) and `uncertainSpeaker 0` (want 0.01). The first run (seed `249418788`) failed in the generator, not the property: it queried jobs with an undeclared index; `arb-turns.ts` now reads the job by its ID. 200 runs per check; the observed fields are design §11/11b's (Session audience, watermark, sequence numbers and lease; core policyRev; each Turn's parse state, uncertainSpeaker, state, text, Evidence text and Extract_Job; later turns' status and Permit kind; whether the state route grants an ack).
  - Files: `packages/server/src/testing/arb-turns.ts` (new), `packages/server/src/parse-gap.property.test.ts` (new)
  - Witness: the property file, 200 runs on the Memory_Store (both the repair and the superseded variant, design §"Correctness Properties" 11 and 11b). Expected red until tasks 37 and 38; record the seed and counterexample in **Notes**.
  - Commit: `test(turn): property 11, a repaired gap leaves no trace`

- [ ] 34. `/api/session/state`: `ack:null` and the write throttle
  - Requirements: R4.2, R4.5, R15.2, R23.3; Q61, Q84
  - Depends on: 32 · Estimate: 2 h · Actual:
  - Files: `packages/server/src/routes/state.ts`, `packages/server/src/routes/state.test.ts`
  - Witness: `state.test.ts` › `ack:null` with an S2 user turn among the last four, with a gap, with an active lease, after an expired unrepaired lease (which also stores `unknown`); an ack otherwise; 60 polls a minute write the Session at most twice when nothing changes; status and `browserState` changes still write.
  - Commit: `feat(state): ack refusal and write throttle`

- [ ] 35. `/api/receipt` records `fastO`
  - Requirements: R9.1, R9.2, R3.7
  - Depends on: 30, 32 · Estimate: 1 h · Actual:
  - Files: `packages/server/src/routes/receipt.ts`, `packages/server/src/routes/receipt.test.ts`
  - Witness: `receipt.test.ts` › an accepted `admitted` + `fastO` receipt writes the `fastO` decision once; receipt-then-turn and turn-then-receipt give the same Turn and ledger; a stale stamp writes nothing.
  - Commit: `feat(receipt): record fastO admissions`

- [ ] 36. `/api/tool` through the server rule
  - Requirements: R8.11, R12.7
  - Depends on: 30 · Estimate: 1 h · Actual:
  - Files: `packages/server/src/routes/tool.ts`, `packages/server/src/routes/tool.test.ts`
  - Witness: `tool.test.ts` › the continuation gets `slowOrdinary` after the parse commits, holds after 1.5 s without it, and carries only S0 notes while the Effective_Audience isn't private; existing recall tests pass.
  - Commit: `feat(tool): tool continuations through the server rule`

### Group A13 (serial; both edit `turn.ts`)

- [ ] 37. The Superseding_Post
  - Requirements: R7.8, R11.9, R15.7; Q89
  - Depends on: 32, 33 · Estimate: 2 h · Actual:
  - Files: `packages/server/src/routes/turn.ts`, `packages/server/src/routes/supersede.test.ts` (new)
  - Witness: `supersede.test.ts` › an ordinary late transcript commits the Turn, Evidence and Extract_Job, clears the lease and moves the watermark; a control hit runs the late-hit effects; no Permit and no decision; a request whose superseded entry is for another turn is PARSE; a Turn not in `transcriptMissing` is `stale` with no writes; a replay is a replay.
  - Commit: `feat(turn): superseding post for late transcripts`

- [ ] 38. The Parse_Repair
  - Requirements: R15.3–R15.6, R15.8; Q80
  - Depends on: 37 · Estimate: 2 h · Actual:
  - Files: `packages/server/src/intents/repair.ts` (new), `packages/server/src/intents/repair.test.ts` (new), `packages/server/src/routes/turn.ts` (schedule the repair)
  - Witness: `repair.test.ts` › scheduled only for deadline and transport failures; ordinary closes the gap with the stored audience untouched; a hit raises `policyRev`; a failure stores `unknown`; a stale lease token does nothing; `alone` never moves the watermark past a gap. Property 11 green.
  - Commit: `feat(intents): parse repair`

### Group A14 (parallel)

- [ ] 39. Server cleanup and the debug route
  - Requirements: R13.3–R13.5, R21.1, R21.2; Q57, Q58
  - Depends on: 32, 35, 36, 37, 38 · Estimate: 2.5 h · Actual:
  - Files: `packages/server/src/admission/seam.ts` (remove `admit`), `packages/server/src/admission/dev-admit.ts` (delete), `packages/server/src/admission/dev-admit.test.ts` (delete), `packages/server/src/routes/errors.ts` (drop the `DevAdmitRefusedError` mapping), `packages/core/src/admission.ts` (delete `devPermitKind`, `AdmissionTurn`), `packages/core/src/schema/wire.ts` (DebugPage issuer `"seam" | "browser"`), `packages/server/src/routes/debug-memory.ts`, `packages/server/src/routes/debug-memory.test.ts`
  - Witness: `debug-memory.test.ts` › permit kind from the cited request entry and `fastO` from its key; false hold derived; decisions grouped by turn; audience, "unknown (repair pending)", failed-parse count and "fastO off: parse gap" with its turn. `grep` finds no `devAdmit` or `devPermitKind` in source. `seam.test.ts` keeps every check `dev-admit.test.ts` had (R21.2), listed in the commit body.
  - Commit: `refactor(admission): remove devAdmit; debug route reads the seam's records`

- [ ] 40. Voice_Client
  - Requirements: R2.8, R3.7, R4.5, R7.5, R7.8, R18.1, R18.5; Q83, Q85
  - Depends on: 28, 32 · Estimate: 3 h · Actual:
  - Files: `apps/web/src/client/voice-client.ts`, `apps/web/src/client/voice-client.test.ts`
  - Witness: `voice-client.test.ts` (Memory_Store, Fake_OpenAI, fake clock) › an ordinary turn on `fastO`: judge and spec sent, `admitted` receipt, unmute at the spec's start, and the browser's hash equals the seam's; a false hold plays under `slowOrdinary` with matching hashes; `error` events with `event_id` reach the machine; `stateOk` carries `sentAt`; one poll a second, never two in flight; `lastLoudAt` from 20 ms samples at `LOUD_LEVEL`; `TURN_TIMEOUT_MS` is 5,000 and retries stop inside it; a superseding post goes to `/api/turn`.
  - Commit: `feat(web): voice client for the judge, speculation and polling`

- [ ] 41. Harness: `--judge` and the slow parse per line
  - Requirements: R17.1–R17.7; Q72, Q82
  - Depends on: 3, 4, 7 · Estimate: 3 h · Actual:
  - Files: `scripts/judge-spike/harness.ts`, `scripts/judge-spike/cli.ts`, `scripts/judge-spike/summary.ts`, `scripts/judge-spike/decisions.ts` (new: fake port, and a live adapter used only with `--live`), `scripts/judge-spike/harness.test.ts`
  - Witness: `harness.test.ts` (fake transport, fake Decisions, virtual clock) › `--judge judge_v2` sends the v2 instructions with `metadata.contract`; each row has `regex`, the probabilities, `ms` and `missedDeadline`; the summary prints per class judge recall, slow-parse recall, joint miss and false holds, and the share over 350 ms with p50 and p95; the run file records deadline and contract name; `lines.json` is unchanged (`git diff --exit-code scripts/judge-spike/lines.json`).
  - Commit: `feat(spike): judge_v2 option and slow-parse scoring`

- [ ] 42. Emulator timing test for the slow path
  - Requirements: R23.2
  - Depends on: 32 · Estimate: 1.5 h · Actual:
  - Files: `tests/firestore/slow-path-timing.test.ts` (new)
  - Witness: the test itself under `npm run test:emulator` (CI, Java 21), with 75 ms added per round trip and a fake Decisions answer at 350 ms: the `/api/turn` response for a held turn is ready within 2,500 ms of a commit 500 ms before the post, on 20 runs; the max and p95 are printed. Over 2.5 s is a stop and report (R23.2).
  - Commit: `test(firestore): slow path timing`

### Group A15

- [ ] 43. Debug_Panel
  - Requirements: R13.4, R13.5, R18.2, R18.6, R18.7
  - Depends on: 39, 40 · Estimate: 2.5 h · Actual:
  - Files: `apps/web/src/components/DebugPanel.tsx`, `apps/web/src/components/DebugPanel.test.tsx`, `apps/web/src/client/debug-panel.ts`
  - Witness: `DebugPanel.test.tsx` › the last LatencyRow with path and refused reason; per-path p50 and p95; counts per refused reason and late turns; audience and failed parses; "fastO off: parse gap" with the turn; decisions grouped by turn with the played one marked; no "devAdmit" text; all text escaped.
  - Commit: `feat(web): debug panel for latency, audience and admission`

### Group A16

- [ ] 44. Wave A checks and report
  - Requirements: R23.1–R23.5, R24.1–R24.3
  - Depends on: 1–43 · Estimate: 1.5 h · Actual:
  - Files: `docs/briefs/011-report.md` (new)
  - Witness: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` exit 0 (with the telemetry variables set); `npm run test:emulator` runs in CI and its result is in the report; no command called OpenAI. The report has what was built and where, Q52–Q90 with the ones marked Owner, the requirement changes, every red property's seed, sequence and fix, what couldn't be checked (the two-response concurrency on the data channel, live latency, the live Decisions deadline share), the local Decisions timing note of R23.5, and the live-check steps of R24.2: an ordinary question (path `fastO`, its LatencyRow), "forget what I said about…" (the Fixed_Line), a false hold, an interruption mid-reply, and two fragments said with a pause, each with what the Debug_Panel should show and what design §"If two out-of-band responses can't run at once" would look like.
  - Commit: `docs: brief 011 report, wave A`

**STOP. End of wave A.** The build stops here for the owner's live check. Wave B starts only after the owner has run it and answered the questions marked Owner (Q54, Q68, Q79).

---

## Wave B: audience

### Group B1 (parallel)

- [ ] 45. Head compile by audience
  - Requirements: R14.2
  - Depends on: 44 · Estimate: 1.5 h · Actual:
  - Files: `packages/core/src/head.ts`, `packages/core/src/head.test.ts`, `packages/server/src/head-build.ts`
  - Witness: `head.test.ts` › with audience `company` no line with `sens ≠ S0` appears, the rules section is unchanged, the Now line says `Audience: company.`; private is byte-identical to today. `head.property.test.ts` still passes untouched.
  - Commit: `feat(head): compile by audience`

- [ ] 46. **[property]** P10 Narrowing needs a closed call, with its generators
  - Requirements: R20.1.10; R14.1, R14.5, R14.7
  - Depends on: 44 · Estimate: 1.5 h · Actual:
  - Files: `packages/core/src/voice/testing/arb-swap.ts` (new), `packages/core/src/voice/narrowing.property.test.ts` (new)
  - Witness: the property file, 1,000 runs. Expected red until task 47; record the seed and counterexample.
  - Commit: `test(voice): property 10, narrowing needs a closed call`

### Group B2 (parallel)

- [ ] 47. Voice_Machine: SWAPPING
  - Requirements: R14.3–R14.7, R6.4; Q81, Q86
  - Depends on: 46 · Estimate: 3 h · Actual:
  - Files: `packages/core/src/voice/machine.ts`, `packages/core/src/voice/machine.test.ts`
  - Witness: `machine.test.ts` › `blocked` with no Permit tears down, opens with `previousSessionId`, posts no close, stays `thinking`; `blocked` with a care Permit plays it, then swaps after it ends or a barge-in; the swap line plays from `proactive` once the ack matches; a swap failure goes to connection recovery; a lost connection with an Outstanding_Turn waits for its response or deadline. Property 10 green; properties 1–7 and 12 still green.
  - Commit: `feat(voice): call swap for company and quiet`

- [ ] 48. `/api/turn`: company, quiet and the hang-up
  - Requirements: R14.1, R14.5, R14.7, R14.8; Q68, Q79, Q81
  - Depends on: 45 · Estimate: 3 h · Actual:
  - Files: `packages/server/src/routes/turn.ts`, `packages/server/src/audience.ts`, `packages/server/src/routes/turn-audience.test.ts` (new)
  - Witness: `turn-audience.test.ts` › a company or quiet hit with a live call stores `company` (with `reasonCodes:["quiet"]` for quiet), raises `policyRev`, sets `waitDeadline` +10 s, moves the Session to `closing`, writes the hangup Job and answers `blocked`; with crisis also a candidate it answers `blocked` with the care Permit, `waitDeadline` +60 s and no hang-up; every later turn on that Session answers `blocked` (property 10, server half).
  - Commit: `feat(turn): company and quiet narrow and hang up`

### Group B3 (parallel)

- [ ] 49. `/api/turn`: alone
  - Requirements: R15.1, R15.8
  - Depends on: 48 · Estimate: 2 h · Actual:
  - Files: `packages/server/src/routes/turn.ts`, `packages/server/src/routes/turn-alone.test.ts` (new)
  - Witness: `turn-alone.test.ts` › `alone` stores `private`, raises `policyRev`, compiles a full Head with `bundleRev + 1`, returns the new Deck and the ALONE ack note; no hang-up; a gap stays a gap.
  - Commit: `feat(turn): alone widens the session`

- [ ] 50. Open with the carried audience and the swap line
  - Requirements: R14.2, R14.3, R14.8; Q81
  - Depends on: 45, 48 · Estimate: 2.5 h · Actual:
  - Files: `packages/server/src/routes/open.ts`, `packages/server/src/routes/open-audience.test.ts` (new)
  - Witness: `open-audience.test.ts` › an open naming a narrowed Session within `waitDeadline` starts `company` with the narrow Head and a `proactive` `postCommitControl` carrying the COMPANY ack note; no line after a crisis; past `waitDeadline` or for another Owner's Session it starts `private`; the open stays inside its 3.5 s budget in `tests/firestore/open-retry.test.ts`.
  - Commit: `feat(open): carry a narrowed audience into the fresh call`

- [ ] 51. Close keeps a narrowed audience on an error close
  - Requirements: R14.6, R14.8; Q81
  - Depends on: 48 · Estimate: 0.5 h · Actual:
  - Files: `packages/server/src/routes/close.ts`, `packages/server/src/routes/close.test.ts`
  - Witness: `close.test.ts` › `reason:"error"` on a non-private Session sets `waitDeadline` +60 s; `reason:"user"` leaves it null.
  - Commit: `feat(close): keep a narrowed audience across a reconnect`

- [ ] 52. Voice_Client: the swap
  - Requirements: R14.3, R14.4, R14.6
  - Depends on: 47 · Estimate: 2 h · Actual:
  - Files: `apps/web/src/client/voice-client.ts`, `apps/web/src/client/voice-client.test.ts`
  - Witness: `voice-client.test.ts` › a company line ends in a fresh call whose first audio is the COMPANY line, with no `/api/session/close` from the browser, the call button in its hang-up form and the avatar `thinking` throughout; a failed swap shows recovery.
  - Commit: `feat(web): voice client swap`

### Group B4

- [ ] 53. Wave B checks and report
  - Requirements: R24.1, R24.3
  - Depends on: 45–52 · Estimate: 1.5 h · Actual:
  - Files: `docs/briefs/011-report.md`
  - Witness: the five checks of task 44; the report's wave B section with the same headings, and live-check steps for "my cousin just sat down" (swap, company line, narrow Head in the Debug_Panel), "keep that between us" (quiet as company), "okay, it's just us now" (alone line, full Head), and a crisis line said with someone present (care reply, then the swap, no company line).
  - Commit: `docs: brief 011 report, wave B`

**STOP. End of wave B.**

---

## Totals

| Wave | Tasks | Estimate |
|---|---:|---:|
| A | 44 | 75.75 h |
| B | 9 | 17.5 h |
| Both | 53 | 93.25 h |
