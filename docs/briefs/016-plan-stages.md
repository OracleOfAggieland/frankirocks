# Brief 016: the remaining plan stages, built in lanes

The build plan is spec §14 (`docs/design/memory-spec-v3.md`, lines 393 to 460). F0 to F2 are built, and so is wave A of F3. This brief starts the rest: F3 waves B to D, F4, F5, F6, F7, F8, F10, F11 and the open voice work.

Every lane in this brief is built by Claude Code agents from a brief, not from a Kiro spec. Where a lane builds tasks that a Kiro spec wrote (the `voice-control` wave B tasks), the brief says so, and the task is ticked with a note of who built it. No commit made under this brief ends `Built-with: Kiro`.

Each lane has its own brief (017 onward), its own branch and its own working copy. This file holds the rules every lane shares. Read it first, then your lane's brief.

## Lanes

| Lane | Brief | Branch | Stage |
|---|---|---|---|
| voice | 017 | `lane/voice` | The call-path fixes left by brief 014, then the call swap in the machine and the client (`voice-control` tasks 46, 47, 52) |
| writes | 018 | `lane/writes` | F3 wave B: allergies and hard rules on the turn |
| seed | 019 | `lane/seed` | F8: the persona, clone and reset, and the fixture clock |
| screen | 020 | `lane/screen` | F10 and F5: the jar, Lab, strip, receipt and chips on real data, and the readout |
| forget | 021 | `lane/forget` | F4, part 1: the design note, No Resurrection red first, the planners and the executor |
| hero | 022 | `lane/hero` | F7: the pattern detector, the loop, and the food filter |

Later briefs (023 onward) cover F3 waves C and D, the server half of the audience wave, F6, F11, and wiring forget into the routes.

## Rules for every lane

**Where you work.** Only in your lane's working copy, on your lane's branch. Never edit the main checkout or another lane's folder. Pass this rule on to any agent you start.

**What you never do.** No `git push`. No deploy. No call to a paid model: nothing runs with `--live`, and every model call in a test goes through a port with a fake. No real phone call. No secret read or written, and no `.env` file touched. No Firestore emulator in a lane (its port is shared); the lead runs `npm run test:emulator` after each merge. No dev server on port 3000.

**Design documents are read-only.** `docs/design/*` and the `requirements.md` and `design.md` of every spec under `.kiro/specs/` are not edited. A gap, an ambiguity or a conflict goes under "Contract questions" in your lane's report, numbered on from the last question you can find (163 is the next free number after brief 012's design note; each lane prefixes its own letter, for example `W-163`, so two lanes never share a number).

**Rulings.** The owner is away for this build. Where a brief gives a ruling, it is the lead's, made for this build and listed in the report for the owner to confirm. Where you meet a decision the brief does not cover, take the answer that fails closed, make it one named constant or one small function so it is cheap to change, and list it in your report under "Rulings needed". Do not stop and wait.

**Properties come first and run red first.** For each invariant: write the property in a new file, run it, record the seed and the shrunk counterexample in your report, then write the code that makes it green. A committed property file (`*.property.test.ts` already in git) is never edited. If one looks wrong, say so in the report and leave it.

**Tests are never weakened.** No assertion is loosened, no test is deleted to get to green, and no test is skipped. An expected-fail test (`it.fails`) loses its `.fails` in the commit that fixes it, and its paired "today:" pin is deleted in that same commit.

**The house rules still hold.** They are in `.kiro/steering/` (read the four always-on files, and any `fileMatch` file whose pattern covers what you edit). The ones that bite most often:
- No wall-clock read outside the clock port (`scripts/clock-allowlist.json`).
- `packages/core` imports no Firebase, OpenAI, Next, Node I/O or server code.
- A machine-like file (`*-phase.ts`, `*machine*.ts`, an exported `step` or `next*`) needs its row in `docs/machines/`.
- A change to a stored shape needs a defaults read for documents written before it, and a test of that read.
- User-facing words live in `apps/web/src/ui/copy.ts` and pass `copy-check`.
- Models read, extract and word. Code validates before anything is written. Nothing is called saved, gone or done before its write has committed.

**Hot files.** These are edited by more than one lane: `packages/core/src/schema/records.ts` and `wire.ts`, `packages/core/src/testing/samples.ts`, `packages/server/src/core-docs.ts`, the barrels `packages/core/src/index.ts` and `packages/server/src/index.ts`, `packages/server/src/store/paths.ts`, `packages/server/src/routes/turn.ts`, `open.ts` and `tool.ts`, `packages/core/src/admission.ts`, `head.ts`, `eligible.ts`, `packages/server/src/head-build.ts`, `packages/server/src/worker/tick.ts` and `jobs.ts`, and `apps/web/src/components/screen/MainScreen.tsx`. In a hot file: add, do not reorder or reformat; put your logic in a new module of your own and leave one call at the seam; keep each addition in its own block. Your brief says which hot files your lane may edit. Do not edit the others.

**The voice reducer's golden corpus** (`packages/core/src/voice/testing/golden-traces.json`) is re-recorded only by the voice lane, only when a fix or a generator change moves digests, in the same commit, with the count of calls moved and the reason in the commit message.

**Commits.** One kind of change per commit, staged by explicit path. A plain imperative sentence as the subject, as in `git log`, and a short prose body. End every commit message with your own Claude `Co-Authored-By` trailer. Leave the working tree clean when you finish.

**Start of a lane stage.** `git merge build/plan-stages` in your working copy, resolve any conflict (keep both sides' additions; never drop the other lane's code), then run `npx vitest run` once to confirm a green start.

**Checks before you report.** Run each and give the exit code and counts: `npx vitest run` (the count of expected-fail tests may only go down), `npm run lint`, `npm run typecheck`, and `npm run build` if you changed anything under `apps/web`. While you work, run only the test files you are touching.

**The report.** `docs/briefs/NNN-report.md`, committed last: what was built (by task), what was not built and why, each red-first seed and counterexample, contract questions, rulings needed, which hot files you touched and where, the check results, and what could not be checked without a live call, a browser or the owner. Plain words. Say "not tested" where that is true.

**Your final message** to the lead: under 300 words. Built, not built, rulings needed, hot files touched, check results, the last commit hash.
