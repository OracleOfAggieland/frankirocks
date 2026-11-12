# Brief 025: corrections and life changes on the turn (lane `writes`, F3 waves C and D)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This stage follows brief 018 in the same lane.

Wave B put the hard-rule route into `/api/turn`. This brief builds the last two waves of brief 012: a correction marks the old value wrong before Franki answers (wave C), and a life change the owner states updates the record on that turn (wave D).

## Read first

- `docs/briefs/012-voice-writes.md`: the sections "Wave C: corrections" and "Wave D", and "What the owner should experience".
- `docs/briefs/012-design.md` section 9, the wave C and wave D tables (tasks C1 to C6 and D1 to D4, lines 1143 to 1161), and the sections those tasks cite.
- `docs/briefs/012-report.md` with wave B's section, and `docs/briefs/018-report.md`.
- Spec §4 lines 122 to 166 (the bitemporal rule and the evidence ladder), §7 lines 243 to 257. Contracts lines 822 to 823 and 839 (`applyCorrection`, `applyTransition`).

## What to build

Tasks C1 to C6, then D1 to D4, in order, as the design note's tables give them: the files, the dependencies and the witnesses. One commit per task. The properties of C1 and D1 run red first, with seeds in the report.

What must hold when it is done:
- "No, her name is Mara, not Maya." The reply already knows it is Mara. Maya is never offered again and never shows up as "used to be". A correction marks the old value `wrong`. It never becomes history.
- "My dad passed away last night." Franki answers with care. The record changes on that turn, and nothing cheerful about him is raised afterwards.
- "I might leave my job." Nothing is written as a change. It is uncertain, so it gets care only.
- Franki never says something is corrected or changed before the write has committed.
- Extraction never applies a correction or a change the turn already handled.

Rulings for this build, for the owner to confirm: as in brief 018. Deadlines stay named constants at their designed values, nothing runs with `--live`, and the frozen extraction lines stay frozen. Where a test pinned `assertedAt` to the commit clock or an unstripped "my X" ID and task C2 or C5 changes that by design, update that test, and list each one in the report with the reason.

## Hot files this lane may edit

As brief 018: this lane is the one writer on `packages/server/src/onturn/**`, `worker/extract.ts`, `packages/core/src/extract.ts` and `head.ts` for these waves, and it may edit `recall.ts` for task C4's renames (the screen lane changed `recall.ts`; merge first and keep its changes). `routes/turn.ts` only where a task names it. Not `packages/core/src/voice/**`, `eligible.ts`, `worker/tick.ts` or `jobs.ts`.

## Done

C1 to C6 and D1 to D4 with their witnesses, the checks of brief 016, the wave C and wave D sections added to `docs/briefs/012-report.md`, and a one-page `docs/briefs/025-report.md` with the rulings, contract questions and hot files touched. If both waves do not fit in one run, stop at a task boundary with the tree green and say which task is next.
