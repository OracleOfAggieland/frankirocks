# Brief 026: company, quiet and alone on the server (lane `voice`, second stage)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This stage follows brief 017 in the same lane, and it starts only after the writes lane's wave B (brief 018) is merged into `build/plan-stages`, because both change `/api/turn`.

Brief 017 built the call swap in the Voice_Machine and the Voice_Client against faked server answers. This brief builds the server half of the audience wave: tasks 45, 48, 49, 50, 51 and 53 of the `voice-control` spec. Kiro wrote that spec and its tasks; this lane's code is written by Claude Code, and the tasks are ticked with that note.

## Read first

- `.kiro/specs/voice-control/tasks.md` lines 443 to 515, `requirements.md` R14, R15 and R24, and `design.md` questions 68, 79, 81, 86 and 95.
- Spec §6 lines 210 to 214 (audience) and §3 lines 77 to 93 (the control turn; the "Company or quiet" row).
- `docs/briefs/017-report.md` (what the machine and client expect from the server) and `docs/briefs/018-report.md` (what wave B changed in the turn route).
- `packages/core/src/head.ts`, `packages/server/src/head-build.ts`, `audience.ts`, `routes/turn.ts`, `open.ts`, `close.ts`, `worker/hangup*`.

## What to build

Tasks 45, 48, 49, 50, 51 and 53, in the order their dependencies give, exactly as `tasks.md` gives their files and witnesses:

- **45** The Head compiles by audience: with `company`, no line above S0, the rules section unchanged, the Now line says the audience; `private` is byte-identical to before.
- **48** `/api/turn`: a company or quiet hit narrows the Session, raises `policyRev`, sets the wait deadline, writes the hang-up job and answers `blocked`; with crisis also a candidate, the care Permit plays first.
- **49** `/api/turn`: alone widens the Session and returns the new Deck.
- **50** Open carries a narrowed audience into the fresh call, with the swap line.
- **51** An error close keeps a narrowed audience across a reconnect.
- **53** The wave B checks and the wave B section of `docs/briefs/011-report.md`, with the live-check steps the task lists. The live checks themselves are the owner's; write the steps, do not claim them.

Rulings for this build, for the owner to confirm, as in brief 017: question 79 (quiet is recorded as company), question 68 (crisis always takes the reply) and question 54 (deadlines stay named constants at their designed values) are taken as the spec proposes them. Question 95's wording for the company and alone lines is an open owner decision: use the wording the spec proposes, in `apps/web/src/ui/copy.ts` or the server's template table, wherever the acknowledgment templates live, and list it in the report.

Tick each task in `tasks.md` when its witness passes, with the actual time and "Built by Claude Code (brief 026)" on the task's Actual line.

## Hot files this lane may edit

For this stage the voice lane is the one writer on `packages/server/src/routes/turn.ts`, `open.ts` and `close.ts` and on `audience.ts`. In `turn.ts` and `open.ts`, wave B's hard-rule route is already there: add the audience branch beside it and change none of its code. `head.ts` and `head-build.ts` for task 45 only. Not `admission.ts`, `eligible.ts`, `worker/extract.ts`, `packages/server/src/onturn/**` or the schema files beyond what a task names.

Two properties must stay green and untouched: `head.property.test.ts` and wave B's "the rule is in every Head" properties. A narrowed Head still carries every hard rule.

## Done

The six tasks with their witnesses, property 10 green on both halves, the checks of brief 016, and `docs/briefs/026-report.md`.
