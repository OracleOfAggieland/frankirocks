# Brief 014: the state machines, named and pinned

Franki's code holds a lot of state that moves between named states: the voice call, its posts and waits, the typed line, the tick, Jobs, Sessions, the forget barrier, the avatar's timed events. Some of it is one pure function over a closed union. Much of it is spread over fields and records that several functions write. This brief names every one of them in one index, writes down what each decides and what always holds, pins today's behaviour in tests, and adds a wider voice test rig, before any of that code is changed.

This work is built by Claude Code agents from this brief, not from a Kiro spec. The branch is `build/state-machines`, cut from `6882856`. Tasks A1, A2, A3, T1 and T2 change no runtime file. The tasks after them wait for a live check or for another branch to merge, and each gets its own brief section when it starts.

**Status, Nov 11.** The work stops part done, on `build/next` (where `build/state-machines`, brief 012's wave A and brief 013 were joined). Built: A1, A2, A3, T1, T2, V1 step 1 (the reducer's rails, no behaviour change), B3, and the first part of S6 (a stored Memory is no longer compared against `policyRev`). Not built: V1 steps 2 to 5, B1, B2, B4, B5, V2, V3, the rest of S1 to S8, U1 to U3 and W1. No live check was run, so B3 and the first part of S6 landed without one. What each built task delivered, every red case still open and what was not verified are in `docs/briefs/014-report.md`.

Read first:

- `docs/machines/README.md` and the page for the machine you are in.
- `.kiro/steering/state-machines.md`: the four shapes and the eight rules.
- `.kiro/steering/voice-control.md` and `.kiro/specs/voice-control/design.md` for any voice file.
- `packages/core/src/voice/machine.ts`, `packages/core/src/voice/testing/arb-call.ts` and the nine `*.property.test.ts` files beside them.

## How the work runs

1. **Baseline.** Lint, typecheck, test (files and tests), build and the emulator suite are run on `6882856` and written down in `docs/briefs/014-report.md`. They are the bar for every later task.
2. **Now:** A1, A2, A3, T1 and T2, in any order. None of them changes a non-test file under `apps/`, `packages/` or `functions/`. The check is `git diff --stat 6882856 -- apps packages functions` showing only test files and files under `testing/`.
3. **After a live check:** the call-path tasks. A live call in Chrome is run by the owner before and after each group, and what happened at each step goes in the report. A step that already behaves correctly live drops its change.
4. **After a merge:** the tasks in files another branch is editing start only after that branch lands, and re-read their notes against the merged code first.

## Scope: now

### A1. The map and the rules (built)

- `docs/machines/README.md`: one row per machine by `area.thing` name, with its status (`explicit`, `table`, `view`, `documented` or `planned`), what it alone decides, its home file and its page.
- One page per area under `docs/machines/`: a block per machine (status, file, deciding functions, state and event types, tests), a `stateDiagram-v2` whose states equal the union it names, what always holds, and a neutral "Not modelled" line where a path is not described.
- `.kiro/steering/state-machines.md`, `inclusion: fileMatch` over the home files.
- `.kiro/steering/voice-control.md`: the pattern covers `packages/core/src/voice/**`, so a new file in that folder loads the voice rules.
- `scripts/machines-index.test.ts` keeps the index and the pages true against the code. `scripts/state-machines-steering.test.ts` checks the steering file's front matter, length and pattern.
- Machines on other branches are `planned` rows, so their merges keep the index test green.

### A2. Pins in new test files (built)

New test files only: `packages/server/src/worker/tick.test.ts`, `apps/web/src/client/api.token.test.ts`, `apps/web/src/client/voice-client.mic.test.ts`, `apps/web/src/client/typed-replay.test.ts`, `scripts/deadline-ladder.test.ts`. They pin today's behaviour of the tick's gate and order, the API client's token step, the mic prompt and a refused mic, a typed retry on an advancing clock, and the order of the limits in `machine.ts`, `voice-client.ts` and `tool.ts`. Where today's behaviour differs from the spec, the case is `it.fails`, run once without `.fails`, and its failure message goes in the report.

### A3. The voice test rig (built)

Under `packages/core/src/voice/testing/`: a golden corpus over `arbCall` as it is (fixed seeds, at least 500 calls, a hash of every step's commands and outward views); `arbCallWide`, a generator that reaches call start, reconnects with a new Session and generation, late answers from an earlier Session, mute, higher Decks at each point of a Turn, and hold answers, with a self-test that counts how often each is reached; and `turnMode` and `replyStage`, two views used only by tests, each with a property that no illegal mode is produced. Transition tests go in `voice-*.transitions.test.ts`. Cases where today's reducer differs from the spec are `it.fails`, each with its seed or exact sequence. The nine tracked property files and `arbCall`'s output do not change; the only edit allowed in `arb-call.ts` is an `export` keyword.

### T1. Secret scan (built; never run, since it needs a push)

`.github/workflows/ci.yml` loses its gitleaks-action step; the key grep checks each directory exists and fails on grep exit 0 or 2; `cancel-in-progress` applies only to pull requests. A new `.github/workflows/secret-scan.yml` runs on every push and pull request, scans the full history with `gitleaks git --redact`, and pins the CLI by version and checksum. The lint, typecheck, test, build and emulator steps stay byte-identical. Nothing runs until a push, and a push needs the owner's yes.

### T2. Guard cases (built)

`scripts/property-guard.mjs` and its test: a case-variant path and a path through `../frankirocks/` are refused like the plain path, and the message says "tracked (staged or committed)". Every existing guard test stays as it is.

## Scope: later, one line each

- **B1** (not built) `api.call` always resolves, including when the token step rejects. Waits for the first live check.
- **B2** (not built) The tick never fails an open. Waits for the first live check.
- **B3** (built, without the live check) The call button's ring spark as `ui/ring-spark.ts`, giving its Electricity grant back on every exit. Waits for the first live check.
- **B4** (not built) A typed line keeps its body and identity across retries. Waits for the first live check.
- **B5** (not built) Background task failures reach the JSON log. Waits for the first live check.
- **V1** (step 1 built: the `satisfies never` defaults, the timer and reset tables, the `@machine` header and the `AudioLike` comment, with no behaviour change; steps 2 to 5 not built) Call start, mute and connection recovery in the reducer. Waits for the first live check and A1, A3.
- **V2** (not built) Turn end, the answer wait, posts, `voice/turn-answer.ts` and the open attempt. Waits for the second live check.
- **V3** (not built) Small reducer rules, one commit each. Waits for the third live check.
- **S1 to S8** (S6's first part built: `eligible` compares a stored row on its epoch only; the rest not built) Routes and Session lifecycle, recall, the worker, the Debug panel, server config, the memory read side, the judge spike, the typed line. Each waits for the voice-writes branch to merge.
- **U1 to U3** (not built) Electricity grants, avatar events, level taps. Each waits for the avatar branch to merge.
- **W1** (not built) App wiring: `client/auth-session.ts`, Call during a typed open, the page hiding. Waits for both branches to merge.

## Rules that apply here

- The rules in `.kiro/steering/state-machines.md` apply to every task.
- Each commit is one kind: a pin, a refactor, a fix, a generator change, a property-file edit, docs, a guard, or CI. Its message names brief 014 and the task. Stage by explicit path.
- These commits are Claude's and never carry `Built-with: Kiro`.
- Existing tests are not edited, renamed or deleted, except where a later task names the one test it changes.
- A committed `*.property.test.ts` file is never edited to make it pass.
- A fix starts as an `it.fails` case on today's code; the fix commit removes `.fails` and names the tests it flips.
- A refactor leaves the golden corpus equal.
- No network call from a test and nothing with `--live`. No new dependency. No push or deploy without the owner's yes.
- New server tests build route deps only through `packages/server/src/testing/fakes.ts`.
- `docs/design/` is read-only.

## Out of scope

A state-machine library or a generic machine type. Reshaping `VoiceState` or splitting `machine.ts`. A throwing exhaustiveness helper or an assert inside `step`. Widening `arbCall` in place or moving the nine tracked properties to the wide generator. A reducer for linear code: the open route, the turn route, the tick, CI, the deploy order, the judge spike, the Recorder. A schema migration framework, a time-driven runner, cross-tab locking.

## Contract questions

Each has the default that holds until it is answered. Memory questions go to the voice-writes branch's design note too.

- **Q-SM1.** Is `policyRev` on a Memory row a freshness test, or only the counter that cuts speech and Decks? Default: only the counter; stop comparing it on Memory rows, and forget still fences by epoch. Checked against `memory-contracts-v2.md` by the voice-writes branch before any write there raises `policyRev`, and before the company, quiet and alone routes are switched on. Answered by the owner on Nov 11 as the default: CQ 162 in `docs/briefs/012-design.md`, built as the first part of S6.
- **Q-SM2.** After a higher Deck cuts an admitted reply, may that Turn's later ordinary Permit play? Default: leave today's behaviour, where a `ready` answer for such a Turn plays.
- **Q-SM3.** Does a mute survive a reconnect? Default: yes.
- **Q-SM4.** Does a mic track that ends mid-call start connection recovery? Default: yes.
- **Q-SM5.** Should turn answers from an earlier Session stop dating the new Session's StateAck? Default: leave; only the narrow change ships.
- **Q-SM6.** A typed line while a voice Turn is kept: refuse it with a reason, or post the kept Turn first? Default: refuse with a reason, in W1. No change before then.
- **Q-SM7.** A kept Turn that has its transcript at hang-up: post it before the close? Default: leave; it is not posted.
- **Q-SM8.** After a cut with nothing outstanding, skip the thinking wait and recovery? Default: leave, as `machine.test.ts` pins it.
- **Q-SM9.** How does a Session leave audience `unknown`, and should the repair lease be shorter than its deadline? Default: leave.
- **Q-SM10.** `fastO` with a recall tool call: queue the tool call in the browser or wait on the server, and what is said when an answer is withheld? Default: no change until a recorded trace is in hand.
- **Q-SM11.** Should the assistant Turn record words the owner never heard? Default: no change; `said` comes from the transcript.
- **Q-SM12.** `dependsOn`: premise edges against context edges. Default: the voice-writes branch decides.
- **Q-SM13.** A newer tab takes the Session from an older one. Default: documented as it is, no lock.
- **Q-SM14.** Should a server with some of its variables missing refuse calls, with `/api/health` driven by the same check? Default: no change until the owner says yes, since `/api/health` output stays unchanged.
- **Q-SM15.** A stored record shape change: fill defaults on read, or reseed? Default: fill defaults on read, with a test over a record written before the change.
- **Q-SM16.** Should the API timeout start before the token step? Default: no, unless a live call shows the token step hanging.
- **Q-SM17.** A time-driven runner that closes Sessions left open. Default: none; cut.

## Report

`docs/briefs/014-report.md`: the baseline numbers, each live check's notes, every `it.fails` case with its seed or sequence and failure message, every property that ran red with its seed and shrunk counterexample, and what could not be checked.

## Checks before a task is done

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0. Server tasks also pass `npm run test:emulator`. No command made a network call. `git status --short` is empty.
