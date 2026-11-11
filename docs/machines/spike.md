# Judge spike and the probe recorder

Development tools under `scripts/judge-spike/` and `apps/web/src/app/recorder/`. None of them runs in the app. The spike measures the judge on recorded probe lines; the recorder records those lines.

### `spike.session`

| Field | Value |
|---|---|
| Status | documented |
| File | `scripts/judge-spike/harness.ts` |
| Tests | `scripts/judge-spike/harness.test.ts` |

`runHarness` refuses more than `MAX_RUN_LINES` lines and any take with no speech, shuffles the lines with the run's seed, and runs them in groups of `SESSION_LINES`, a fresh Realtime session per group. `openSession` waits for `session.created` and `session.updated` (each within `SESSION_WAIT_MS`) and throws otherwise. `runLine` never throws for a line-level failure; it records it in the row's errors. A session that closes during a group ends the run with an error; the transport is closed in a `finally`.

`SpikeSession` holds every received event with its time on the harness clock. `waitFor` answers the first matching event already received or arriving within its limit, and null once the session has closed. The run's mode is `sequential` or `parallel` (`RunMode`): sequential sends the reply only after a valid `O`; parallel sends the judge and the speculative reply together, `staggerMs` apart, and never plays the reply.

### `spike.fakeRealtime`

| Field | Value |
|---|---|
| Status | documented |
| File | `scripts/judge-spike/fake-realtime.ts` |
| Tests | `scripts/judge-spike/harness.test.ts` |

`fakeConnect` speaks the events the harness reads, on the harness's clock, with no network. Its VAD is an energy threshold over 20 ms chunks; 300 ms of silence after speech commits and adds the item. Each judge call follows a script (`FakeJudgeScript`): its message text, its delay to `response.done`, or no `response.done` at all.

### `spike.runFile`

| Field | Value |
|---|---|
| Status | documented |
| File | `scripts/judge-spike/summary.ts` |
| Tests | `scripts/judge-spike/harness.test.ts` |

A run is saved as a `RunFile` with `version: "judge-spike-run-4"`, the seed, the order the lines ran in, the lines of each session, and one row per line. Several `RunMeta` fields are optional because older runs lack them: `run` (all older runs were sequential), `decisions`, `predicates`, and the judge's `contract` and `deadlineMs`.

### `dev.recorder`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/app/recorder/_recorder/Recorder.tsx` |

A development-only page that shows one probe line at a time. Its `Status` is `idle`, `recording`, `saving`, `saved` (with the take's length) or `error`. A take is recorded, resampled to 24 kHz mono 16-bit WAV and saved through `PUT /api/dev/takes`, which overwrites a retake. The production build is checked for a marker string so the page never ships.
