# Brief 026 report: company, quiet and alone on the server

Lane `voice`, second stage, on branch `lane/audience`. Built by Claude Code, not by Kiro. The tasks come from the `voice-control` spec, which Kiro wrote; each one is ticked in `tasks.md` with "Built by Claude Code (brief 026)".

## What was built, by task

- **45, the Head by audience** (`0bc8cde`).
  - `packages/core/src/head.ts`: `headAdmitsSens(audience, sens)`. Outside `private`, only S0 Memory lines go in.
  - The rules section, with every hard rule, is untouched. The Now line already named the audience.
  - A private compile is byte-identical to one with no audience.
  - `packages/server/src/head-build.ts`: `buildHead` takes an optional audience.
  - `head.property.test.ts` and the "rule in every Head" property were not edited, and both pass.
- **48, company and quiet on `/api/turn`** (`7650598`).
  - The logic is in the new `packages/server/src/audience-swap.ts`. `routes/turn.ts` now runs the Server_Rule in wave B.
  - Row 8 (company or quiet, live call), in the turn's transaction:
    - stores `company` and raises `policyRev`;
    - sets `waitDeadline` to now + 10 s and moves the Session to `closing`;
    - clears `core/epoch.activeSessionId`, as a close does;
    - writes the hangup Job and answers `blocked`. The Job runs after the response.
  - Row 6 (crisis with company or quiet): the care Permit, `waitDeadline` + 60 s, the crisis modifier set, the Session left `active`, no hang-up.
  - Row 1: `narrowedHere` (a live Session with a `waitDeadline` and a non-private audience) answers every later turn `blocked`. It runs before the Stamp and clientSeq checks, stores no Turn, and writes only the hold decision and the answer.
  - Quiet is recorded as company, with `quiet` in the decision's reasons (Q79).
- **49, alone** (`3f3582a`).
  - Before the transaction, `precompileAudienceHead` compiles the Head of the audience the parse may move to: private for `alone`, company for `company` or `quiet`.
  - Row 10 writes `core/bundle` with `bundleRev + 1` and that Head, stores `private` and raises `policyRev`. The answer carries the new Deck and the ALONE line. Nothing hangs up, and a gap stays a gap.
  - Row 9 (a typed company line with no call) gets the narrow Head the same way.
- **50, open with the carried audience** (`f8e9009`).
  - `routes/open.ts` reads the named Session under the Owner's uid. `inheritedAudience` carries its audience while its `waitDeadline` holds, and the Head is compiled for that audience.
  - The swap line goes out only for an inherited `company` with no crisis. It is a `postCommitControl` Permit from the Admission_Seam over the COMPANY ack note, under turn `H("swapline", sessionId)`.
  - An ordinary open, or one past the deadline, or one naming another Owner's Session, starts `private` with `proactive: null`. This is what brief 031 asks of the server.
- **51, error close** (`fafd360`).
  - `routes/close.ts`: `reason:"error"` on a Session whose Effective_Audience isn't private sets `waitDeadline` to now + 60 s.
  - The deadline goes in the close's one Session update. `beginCloseInTx` gained an `extra` argument for it.
  - A user close leaves it null. The reconnect walk is in `open-audience.test.ts`.
- **53, checks and report**: this file, and the wave B section of `docs/briefs/011-report.md` with the live-check steps.

## Not built

- **The Parse_Repair and the Superseding_Post still use wave A.** They are in `intents/repair.ts` and `postSupersede`, which belong to the other builder in this round. A late company hit raises `policyRev` there, but does not narrow, hang up or swap (R15.5). Next step: pass `"B"` and call `audienceEffect` from both.
- **`/api/tool` and the typed phone path still use wave A, with `narrowedHere: false`.** Those files weren't this lane's to edit.
  - A tool continuation on a row 6 Session (still `active`) can still get a `slowOrdinary` Permit. Its notes are S0, because the audience is `company`.
  - On a row 8 Session (`closing`), the tool route answers stale.
- **Gate seams in open, state and turn** (brief 024's list): not wired here, which is brief 030's job. The Head now compiles by audience, so the audience half of that seam is in place.

## Red first

- **Property 10, server half** (`packages/server/src/routes/turn.narrowing.property.test.ts`, 100 runs). Red at seed 749011380.
  - Shrunk counterexample: `[{"kind":"company","p":0.3,"judge":"H"}, [{"kind":"asrFinal","text":"What's on for tonight?","answer":{},"judge":"O","stamp":"before","seq":"next"}]]`.
  - The narrowing turn answered `ordinary`, because the route still ran the rule in wave A.
  - Green after task 48. The machine half (`packages/core/src/voice/narrowing.property.test.ts`) is still green and untouched.

## A guard test changed

`scripts/policy-rev-raises.test.ts` (brief 014, S6; not a property file) pins every site that raises `policyRev`. It allowed the late hit and the Parse_Repair only. Wave B's design adds a raise for an on-time company, quiet or alone hit, so the full suite failed on it (`e016b50`).
- The raise sits in `postTurn`, behind `changesWhatIsSaid(rule.parse, rule.judge, "B")`, as the late hit's does. `audienceEffect` only receives the raised epoch.
- The guard now lists this one added site in `turn.ts` and still checks every site for `changesWhatIsSaid`. No other site would pass. The owner or the lead should confirm this change.

## Contract questions

- **V-165.** Task 45 says "the rules section unchanged". Brief 012's `renderRulesSection` already changes that section outside `private`: the heading adds "don't read them aloud", and pending lines name no one. Built: `compileHead` doesn't touch the section further, and every hard rule is still in it. Proposal: v3 says the rules section is the one rendered for the audience.
- **V-166.** Design "Wave B" gives no Session field for "narrowed during itself" (row 1's `narrowedHere`). Built: `waitDeadline !== null`, with a non-private audience and a live status. An inherited Session starts with a null deadline, so its own turns are admitted. Proposal: v3 names the field, together with Q81's "carries to the next open until".
- **V-167.** On a narrowed Session, a later turn's words are not stored: no Turn, no Evidence, no clientSeq move. That speech may be the guest's. Proposal: v3 says whether those words are kept.
- **V-168.** The swap line's decision cites a `turn` Ref (`H("swapline", sessionId)`) that names no stored Turn. Proposal: v3 gives proactive lines their own Ref type.
- **V-169.** R15.5 and the Parse_Repair's wave B effects, plus `/api/tool` row 1, are in files outside this stage (see "Not built").
- **V-170.** With `unknown`, the Head also drops S1 lines, which is stricter than the Gate (S1 templated). That also reaches the hardRule route's recompile while a parse lease holds. Proposal: v3 states the Head's level for `unknown`.

## Rulings needed

Taken as the spec proposes, as the brief rules: Q79 (quiet is recorded as company), Q68 (crisis always takes the reply), and Q54 (named constants at their designed values: `SWAP_WAIT_MS` 10,000, `CARE_SWAP_WAIT_MS` 60,000 and `RECONNECT_WAIT_MS` 60,000, all in `audience-swap.ts`).

Q95 is still the owner's. The Fixed_Line wording was already in `packages/core/src/voice/lines.ts`, as the spec proposes it: "Got it. I'll keep things general for now." and "Okay, just us again." The `company` and `alone` predicate wording is unchanged.

New rulings, each one function or constant in `audience-swap.ts`, each failing closed:
1. `narrowedHere` = a live Session with a `waitDeadline` and a non-private audience (V-166).
2. A later turn on a narrowed Session stores nothing but the hold decision and the answer (V-167).
3. `speaksSwapLine`: the line only for an inherited `company`. An inherited `unknown` starts narrow and silent.
4. `headAdmitsSens`: S0 only for `unknown` too (V-170).
5. The precompiled Head is written only if the rules and epoch it read still hold and no hardRule write took `core/bundle` in the same transaction. Otherwise the Deck keeps its Head. For `alone`, that means it stays narrow.
6. Row 8 clears `core/epoch.activeSessionId`, as `/api/session/close` does, so the Job, not the next open, closes the old Session.
7. Non-private for an error close is the Effective_Audience, with an expired lease counting as `unknown`.

## Hot files touched

- `packages/server/src/routes/turn.ts`, in `postTurn` only:
  - the imports;
  - one `precompileAudienceHead` line after the parse;
  - `!narrowedHere(s0)` added to the status check;
  - the narrowed-Session block before the Stamp check;
  - the rule input moved above the Session update, now with `wave: "B"`;
  - the `audienceEffect` block, with its policyRev raise behind `changesWhatIsSaid` and `...aud.session` in the Session update;
  - `stampOut2` and `headOut2` in the Deck, the admission and the answer;
  - the hangup schedule.
  - `postSupersede` is untouched, and the merge with B9 was clean.
- `packages/server/src/routes/open.ts`: the imports, the previous-Session read, the audience passed to `buildHead` and `newSession`, and the swap-line block.
- `packages/server/src/routes/close.ts`: one block.
- `packages/core/src/head.ts` and `packages/server/src/head-build.ts`: task 45 only.
- Not hot: `packages/server/src/sessions.ts` (the `extra` argument). New: `audience-swap.ts` and `testing/two-memories.ts`.

## Checks

Run on `79f844c`, after the last `git merge build/plan-stages`. No network call was made, and nothing ran with `--live`.

- `npx vitest run --maxWorkers=3`: exit 0, 389 files, 3,716 tests passed. No expected-fail test is reported.
  - Before this stage's first merge, the start-of-stage run had one unrelated red: the Gate lane's `whisper.adds-nothing` property, seed 476042120, which came from that lane. It passed in this run.
  - In the first full run of this stage, the raise-site guard failed (see "A guard test changed"), and was fixed in `e016b50`.
- `npm run lint`: exit 0.
- `npm run typecheck` (with `tests/`): exit 0.
- `npm run build`: exit 0. Nothing under `apps/web` changed; it was run because core and the 011 checks list it.
- `npm run test:emulator`: not run. The emulator is the lead's, after the merge.

## Not checked without a live call, a browser, the emulator or the owner

Not tested:
- the swap on a real call, and a real Realtime hang-up;
- the second microphone grant;
- the open's 3.5 s budget with the extra read (`tests/firestore/open-retry.test.ts`, emulator only);
- whether the swap line's Permit (10 s TTL from the open) is still live when the fresh call's ack matches on a slow network;
- every live-check step in `011-report.md`.
