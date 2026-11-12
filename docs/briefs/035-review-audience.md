# Brief 035: review of the audience wave on the server, and its fixes (lane `fix4`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the audience lane's work (brief 026, merged as `d306bd4`). It confirmed every finding but two by running a throwaway probe. Its findings are below as it gave them. Several are paths brief 026 named as not built, because their files belonged to another lane at the time. The review shows they are leaks today: the owner says someone walked in, and Franki keeps the full Head. This brief fixes them.

Where a finding and a ruling of brief 026 disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**1. High, confirmed by a run. A late company or quiet hit through the Parse_Repair puts the call back to `private`.**
- File: `packages/server/src/intents/repair.ts` lines 76 to 97. It uses `changesWhatIsSaid(..., "A")` and applies no audience effect.
- Sequence: a live call. ASR "My boss just walked in." The first Decisions call misses its deadline, and the repair answers `{company:0.9}`.
- Wrong result: the first answer is `clarify`. Once the repair commits, the Session has `audience:"private"`, the lease is cleared, the status is `active`, `policyRev` is unchanged and no hangup Job is written. The next ordinary turn answers `slowOrdinary` with a Deck whose Head still holds the S1 line. A failed repair would leave `unknown`; a successful one is worse. The 350 ms in-call parse deadline makes this route common.
- Fix: in the repair's hit branch, apply the wave B audience effects: the effects of row 8, the hangup Job, and its scheduled drive for a live call.

**2. High, confirmed by a run. A Superseding_Post with a company line answers `ordinary` and narrows nothing.**
- File: `packages/server/src/routes/turn.ts`, `postSupersede` (about lines 551 and 576 to 611), still on `"A"`.
- Sequence: post turn 1 as `missing`, then supersede it with "my boss just walked in" and `{company:0.9}`.
- Wrong result: `200 ordinary`, `audience:"private"`, `status:"active"`, `waitDeadline:null`, the lease cleared. The call continues on the full Head.
- Fix: the same wave B audience effects, inside the supersede transaction.

**3. High, confirmed by a run. A typed crisis line with company and no call open narrows nothing, and admits an S1 note.**
- File: `packages/core/src/admission.ts`. Row 6 needs `i.callLive`, so the turn falls to row 7, whose notes are `typedPrivate` ("all"). `audienceEffect` returns null for row 7.
- Sequence: typed, no call, `{crisis:0.6, company:0.9}`: "My sister is reading this and I can't do this anymore."
- Wrong result: `ready`, the Session stays `private`, `modifiers.crisis` is null, `policyRev` is unchanged, and the note shows on the screen with `sens:"S1"`. Requirement 14.7 says the route "SHALL still record the Audience and raise policyRev".
- Fix: when a company or quiet candidate fires with crisis and no call, the notes are S0, and the audience effect records `company`, raises `policyRev`, sets the crisis modifier and leaves the hang-up out.

**4. Medium-high, confirmed by a run. A retained company candidate under a chosen `forget` is dropped.**
- File: `serverRule` rows 8 and 9 test `p.chosen === "company"`. `forget` outranks company, and row 11 answers "not yet".
- Sequence: a live call, `{forget:0.9, company:0.9}`: "Forget that, my boss just walked in."
- Wrong result: `ready`, audience `private`, Session `active`. The call keeps its S1 Head with the boss in the room.
- Ruling: company or quiet narrows whenever it fires as a retained candidate, whatever class was chosen. The same shape as "a retained crisis always gets care".

**5. Medium, confirmed by a run. An inherited company Session loses its audience on a reconnect that no successful error close came before.**
- File: `packages/server/src/audience-swap.ts` lines 179 to 183 (`inheritedAudience` needs `waitDeadline`). The inheriting Session B starts with `waitDeadline:null` (`open.ts` lines 180 to 181).
- Sequence: A narrowed. Open B naming A gives company. B drops with no close landing first. Open C naming B.
- Wrong result: C's audience is `private` and its Head holds the S1 fact.
- Ruling: a Session opened with a non-private audience carries it to its successor unless the owner closed it themselves (`reason:"user"`).

**6. Medium, confirmed by a run. The server's 10 s inheritance window is shorter than the browser's 12 s swap limit.**
- File: `SWAP_WAIT_MS` in `audience-swap.ts` line 42 against `SWAP_LIMIT_MS` in `packages/core/src/voice/machine.ts` line 108. The browser's open limit is 5 s and its retries wait 1, 2 and 5 s.
- Sequence: a company hit, the hangup Job run, the clock 11 s on, an open naming A.
- Wrong result: `audience:"private"`, the full Head, no swap line. The browser thinks it finished the swap.
- Ruling: an expired wait on a non-private Session never yields `private` to an open that names it. It yields `unknown`, which gets the S0 Head. The wait itself is set from the browser's limits (the swap limit plus one open), by a constant that names them, with a test that fails if the browser's constants outgrow it.

**7. Medium, confirmed by a run. A turn on a narrowed Session is thrown away whole, so a hard rule or a crisis said in the swap window is lost.**
- File: `routes/turn.ts` lines 258 to 280. Row 1 returns before the hard-rule executor, the Turn, the Evidence and the Extract_Job.
- Sequence: a company hit, then on the same Session "Oh and I'm allergic to peanuts." with `{hardRule:0.9}`.
- Wrong result: `blocked`, `core/rules.allergies` stays `[]`, no Turn and no Evidence. A crisis line in this window gets `blocked`, with no care and no record.
- Ruling: the answer stays `blocked` with no Permit, but the Turn, its Evidence and its Extract_Job are written, the hard-rule executor runs under the narrowed audience, and a crisis candidate sets the crisis modifier so the next call opens with care. This reverses brief 026's ruling "later turns on a narrowed Session store no Turn"; the test that pinned it changes, and is listed in the report.

**8. Medium, confirmed by a run. An open that lands while the company turn is in flight loses the hit.**
- File: `open.ts` lines 162 to 163: the open closes `activeSessionId`, which moves A to `closing`. Then `turn.ts` line 231 throws `staleError("session")`, because A is not narrowed.
- Sequence: open B naming A, then post the company turn on A.
- Wrong result: the turn gets `409 STALE` and B is `private` with the S1 Head.
- Fix: in the turn transaction, a `closing` Session that was closed by a replacing open still records a company or quiet hit and carries it to the owner's active Session, with the `policyRev` raise.

**9. Medium, confirmed by a run. `/api/session/state` on a crisis-deferred Session still issues a fresh StateAck and a Deck with the private Head.**
- File: `routes/state.ts` lines 65 and 77. No check of `narrowedHere`.
- Wrong result: a non-null `ack` under the raised stamp, and a Deck with the S1 line. A fresh ack is what lets the browser grant `fastO` itself on the old call.
- Fix: no ack and no Deck when the Session is narrowed here.

**10. Medium-low, confirmed by a run. A company line and a hard rule in one typed turn leave a private Head under a company audience.**
- File: `audienceEffect`'s `bundleFor` returns null when the bundle was already written, and `onturn/execute.ts` compiles with the audience from before the turn.
- Sequence: typed, no call: "My cousin is reading over my shoulder. I'm allergic to peanuts." with `{company:0.9, hardRule:0.9}`.
- Wrong result: the Session is `company`, but the response Deck and `core/bundle` carry the S1 line and "Audience: private".
- Fix: the hard rule's bundle compiles with the audience the turn ends with. `onturn/execute.ts` is being edited by the hard-rule fix lane (brief 032): make this change after merging `build/plan-stages` with that lane's work in it, as the last item, or pass the audience in from `routes/turn.ts` without editing `execute.ts` if its signature already allows it.

**11. Low, confirmed by a run.** A row 8 `blocked` answer carries a Deck with the full private Head under the raised stamp. Fix: no Deck when the answer hangs up.

**12. Low, by reading.** `packages/server/src/typed-reply.ts` lines 60 to 95: a typed reply in a company Session takes its note's sensitivity only from `head.selectedRefs`, but its input includes earlier safe turns, of which only S2 is dropped. Fix: the sensitivity is the highest of both.

**13. Low, by reading.** The crisis modifier is not inherited by the swapped Session (`open.ts` line 181 copies only the audience). Fix: inherit it.

**14. Noted, no change.** `alone` has no check of who said it. The spec does not ask for one. Write it as a contract question.

**15. A committed property is flaky (question V-165 of brief 031).** `packages/core/src/voice/narrowing.property.test.ts` (Property 10) fails on about 2 seeds in 70, for example seed `1176707969`, path `932:0:0:0:0:0:2:2:2:2:2:1:2:2:2:3:3:3:6:4:7:7:7:7`. A second `blocked` answer for a Session the call already swapped away from does nothing, correctly, but the property reads it as a new narrowing, so the swap line on the fresh call counts as heard from an old call.
- Ruling, as a narrow exception to "never edit a committed property file": reproduce the failure with that seed first. If the cause is as described, change only the property's reading of a `blocked` answer, so that it counts one only when it is for the Session of the call that is open at that step. Change nothing else in the file and keep 1,000 runs. One commit of its own, with the seed. If the machine is at fault and not the property, stop and report it; do not edit the machine.

**What the tests and the property miss.** `turn.narrowing.property.test.ts` narrows only through an on-turn hit on a live call and asserts only status, permit and notes, never the Deck. `turn-audience.test.ts` pins finding 7 as intended. `open-audience.test.ts` has no open between 10 and 12 s, no chain without a close, no open racing the turn. The guard `scripts/policy-rev-raises.test.ts` now counts three sites and cannot tell the two in `turn.ts` apart; its `changesWhatIsSaid(..., "B")` check is also true for crisis and forget.

## New properties

In new files beside the existing ones:

1. **A narrowing through any door.** For any way the company or quiet hit arrives (on the turn, by the repair, by a superseding post, typed with no call, with crisis, with forget, on a Session an open is replacing), after it commits: the Session's audience is not private, `policyRev` rose, and no later answer from any route for that owner (turn, state, open naming it, tool) carries a Deck, a Head or a note with an S1 or S2 line, until an `alone` line commits.
2. **The audience survives the swap.** For any sequence of opens, closes with any reason, drops with no close, and clock steps after a narrowing, an open that names a Session in that chain never gets a private Head unless the owner closed it themselves or said they are alone.
3. **Nothing said in the swap window is lost.** For any turn posted on a narrowed Session, its Turn and Evidence are stored, a stated allergy ends as a rule or under the unresolved filter, and the answer carries no Permit.
4. **Every hard rule in every Head, through all of the above.** The rules section of each Head issued in properties 1 to 3 holds every stored rule.

Tighten the guard test as well (it is not a property file): each raise site is named, and the wave B site is checked against the audience effect, not only against `changesWhatIsSaid`.

## How to work

For each finding 1 to 13: the failing test first (the reviewer's sequence as a route test, and the new property red with its seed recorded), then the smallest fix, one finding per commit. Then finding 15. Order: 1, 2, 3, 4 first (the leaks), then 7, 8, 9, then 5, 6, 13, then 11, 12, then 10 last, after a fresh merge of `build/plan-stages`.

The wiring lane (brief 030) is editing `open.ts`, `state.ts`, `receipt.ts` and the tool routes at the same time, and the hard-rule fix lane (brief 032) is in `packages/server/src/onturn/**`. Keep each edit to a shared file small and in one place. Put the logic in `audience-swap.ts` and `admission.ts`, and let a route gain a few lines.

Where a fix changes a ruling of brief 026 or a line of the voice-control design, add a numbered contract question at the end of the list in `docs/briefs/026-report.md`, saying what it amends and why.

## Hot files this lane may edit

`packages/server/src/audience-swap.ts`, `packages/core/src/admission.ts`, `packages/server/src/intents/repair.ts`, `packages/server/src/routes/turn.ts`, `state.ts`, `open.ts`, `close.ts`, `packages/server/src/typed-reply.ts`, `packages/server/src/sessions.ts`, `scripts/policy-rev-raises.test.ts`, and for finding 15 only, `packages/core/src/voice/narrowing.property.test.ts`. Not `packages/core/src/voice/machine.ts`, not `packages/server/src/onturn/**` except as finding 10 says.

## Done

The fixes with their red-first tests, the four properties green, the checks of brief 016 with `npm run build`, and a section "Outcome" at the end of this file: per finding, the test, the commit, and the ruling it changed; per property, the seed and the counterexample it found before the fix.

## Outcome

Built on `lane/fix4` from `2d58f65`, with `build/plan-stages` merged before finding 10 (`dbd185a`). Every fix had its route test fail first, in `packages/server/src/routes/audience-review.test.ts`, one `describe` per finding. No live call, paid model call, emulator, deploy or push.

### Findings

| # | Fixed | Commit | Test that failed first | What it changed |
|---|---|---|---|---|
| 1 | yes | `79def0b` | A late company hit through the Parse_Repair left the Session private, and the next Deck's Head held the S1 line | `lateNarrowing` in the repair transaction: company, the raise, the narrow Head, and the hang-up when a call is live |
| 2 | yes | `e7c818b` | A Superseding_Post with a company line answered `ordinary` and narrowed nothing | The same effects in `postSupersede` |
| 3 | yes | `e45d612` | A typed crisis line with company and no call admitted an S1 note and stayed private | Row 7 with company in wave B: S0 notes, company, the raise, the crisis modifier, no hang-up |
| 4 | yes | `c1837fd` | A company candidate kept under a chosen `forget` narrowed nothing | Rows 8 and 9 test whether company or quiet fires among the candidates. The raise moved into `audienceEffect`, behind `audienceRow` |
| 5 | yes | `a3fdf2b` | After a typed company line, an open naming that Session got a private Head | Inheritance needs no `waitDeadline`. A `user` close marks a non-private Session private |
| 6 | yes | `738c39d` | An open 11 s after a company hit started private | `SWAP_WAIT_MS = SWAP_LIMIT_MS + OPEN_LIMIT_MS` (17 s), imported from the voice machine. An expired wait yields `unknown` |
| 7 | yes | `9540227` | A turn on a narrowed Session stored no Turn, so an allergy said in the swap window was lost | The turn is kept: Turn, Evidence, Extract_Job, the hard-rule executor, and the crisis modifier. The answer is still `blocked` with no Permit |
| 8 | yes | `a451158` | A company turn that committed after an open replaced its Session narrowed nothing | `carryNarrowing` narrows the open's Session B, with the hang-up when it is live |
| 9 | yes | `a79f333` | `/api/session/state` on a crisis-deferred Session issued a StateAck and a private Deck | No StateAck and no Deck while `narrowedHere` |
| 10 | yes | `474d8c3` | A company line and an allergy in one typed turn left the S1 line in `core/bundle` | `turnEndAudience`: the executor compiles with company when company or quiet fires. `onturn/execute.ts` is unchanged |
| 11 | yes | `bb5c965` | The row 8 `blocked` answer carried a Deck with the S1 line (row 6's answer too, found by property 1) | `narrowsHere`: no Deck on an answer that hangs up or sets the swap wait |
| 12 | yes | `f80776b` | With no Memory in the Head and an S1 earlier turn, the typed reply's note was S0 | The note's sens is the highest of the Head's Memories and the safe turns |
| 13 | yes | `d55f979` | After row 6, the inheriting Session had no crisis modifier | `inheritedSession` copies it |
| 14 | no change | | | Contract question V-180 |
| 15 | yes | `449b159` | Reproduced with seed `1176707969` and the brief's path | See below |

Notes on two rows:
- Finding 11: property 1 found the same Deck on row 6's care answer, so the fix covers both.
- Finding 12: commit `c87fcde` fixes a field name in its test. Typecheck caught it after the merge.

**Finding 15.** At step 18 of the counterexample, the `blocked` answer is for Session 1. The call is on Session 8 (phase `HELD`) and had already swapped away from Session 1 (`swappedFrom`). The machine sends no commands for it, as its design says, so the fault was in the property, not in `machine.ts`.
- What changed: the property now counts a `blocked` answer only when it is for the Session of the call open at that step (`step.before.session`).
- Kept: 1,000 runs.
- Result: green on that seed and on 40 runs with random seeds.

**After the merge** (`803e703`), brief 034's twelve exposures needed two changes:
- Their "the blocked answer's Deck holds no S1+ fact" step had been expected-fail, waiting on findings 11 and 9. It now passes, so it is green.
- The reconnect step declares a third extraction call, because finding 7 keeps the follow-up turn.

### Properties

All four run 1,000 times on the in-memory store with no model. Each was written red first.

| Property | File | Seed and path | Shrunk counterexample, and the finding |
|---|---|---|---|
| 1, a narrowing through any door | `routes/audience-doors.property.test.ts` (`4684b8f`) | at the base: `-1851743552`, `0:0:0:0:0` | `[{"kind":"onTurn","cls":"company","p":0.3,"judge":"H"},["turnHere"]]`: the row 8 answer's Deck held the S1 line (finding 11) |
| | | with only row 8 fixed: `-525200571`, `2:1:1:1` | `[{"kind":"crisisLive","cls":"company","p":0.3,"judge":"H"},["turnHere"]]`: row 6's answer, the same |
| 2, the audience survives the swap | `routes/audience-swap-chain.property.test.ts` (`aa101d6`) | at the base: `202569653`, `6:0:2:1:2:5:5:9:8:1:5:6:3:3` | `["onTurn",[{"kind":"open","pick":0},{"kind":"open","pick":1},{"kind":"clock","ms":1000}]]`: the inheriting Session, dropped with no close, gave a private Head (finding 5) |
| | | after finding 5: `-641064201`, `14:0:2:2:3:3` | `["onTurn",[{"kind":"clock","ms":61000},{"kind":"open","pick":0},{"kind":"drop"}]]`: an expired wait gave a private Head (finding 6) |
| 3, nothing said in the swap window is lost | `routes/audience-swap-window.property.test.ts` (`9540227`) | at the base: `-667950442`, `0:0:0:0:0:0:0`; the final file against the code before finding 7: `1515754680` | `["company",[{"what":"allergy","a":"shellfish","source":"asr","stamp":"before","judge":"O"}]]`: no Turn stored (finding 7) |
| 4, every hard rule in every Head | `routes/audience-rules-every-head.property.test.ts` (`9540227`) | at the base: `824413065`, `7:1:1`; the final file against the code before finding 7: `-533705916`, `3:1:1:3` | `[{"kind":"crisisLive","cls":"company","p":0.3,"judge":"H"},"sesame",["turnHere"]]`: the allergy said in the swap window was never stored (finding 7) |

The door harness is `packages/server/src/testing/audience-doors.ts`. It doesn't check the answer of the open in the "replaced" door, because that answer comes before the hit commits.

Not probed by property 1:
- `/api/tool`: it still runs wave A with `narrowedHere` false (wait `NARROW_TOOL`). V-181.
- Proactive whispers: none reach an open yet (wait `GATE_WIRE`).

### Rulings changed

These rulings of brief 026, and lines of the voice-control design, changed:
- V-167 (later turns on a narrowed Session store no Turn) is reversed by finding 7. See V-171.
- Q81's 10 s swap wait is now 17 s, set from the browser's limits. An expired wait yields `unknown` (finding 6). See V-173.
- V-166's "an inherited Session starts with a null deadline, so its own turns are admitted" still holds. Inheritance no longer needs a deadline (finding 5). See V-172.
- "A guard test changed": the wave B raise moved from `postTurn` into `audienceEffect`, behind the rule's audience row (finding 4). See V-174.
- "Rulings needed", item 5: the hard rule's own bundle now compiles with the audience the turn ends with (finding 10). The Deck carries no Head when the narrow Head can't be compiled (findings 1 to 4). See V-177.
- Design "Wave B" and "Audience effects in the transaction":
  - row 7 with company records company (finding 3);
  - a row 8 or row 6 answer carries no Deck (finding 11);
  - the state route issues nothing on a Session narrowed here (finding 9).

### Existing assertions changed

- `packages/server/src/routes/turn-audience.test.ts`, "every later turn on the narrowed Session answers blocked": the later Turn is now stored, and `nextClientSeq` is 3 (was null and 2). Reason: finding 7 reverses V-167.
- `packages/server/src/routes/open-audience.test.ts`, "past waitDeadline it starts private": it now expects `unknown`, and no S1 line in the Head. Reason: finding 6.
- `scripts/policy-rev-raises.test.ts`: rewritten as the brief asks. It names five raise sites by function, each behind its own check, and adds a behavioral test of the wave B site.
- `packages/server/src/scripts/gate-exposure.ts` and `gates.summary.test.ts`:
  - the expected-fail Deck step is now green, and the summary counts 12 green, 0 waiting (findings 11 and 9);
  - the reconnect declares the follow-up's extraction (finding 7).
- `packages/core/src/voice/narrowing.property.test.ts`: how it reads a `blocked` answer (finding 15).

### Hot files touched

Production code:
- `packages/server/src/audience-swap.ts`: most of the logic.
- `packages/core/src/admission.ts`: rows 7 to 9, plus the `narrowsAudience` and `crisisFires` exports.
- `packages/server/src/intents/repair.ts`.
- `packages/server/src/routes/turn.ts`: `postTurn` and `postSupersede`.
- `routes/state.ts`: one condition.
- `routes/open.ts`: one import and one line.
- `routes/close.ts`: one line.
- `routes/typed-reply.ts`: one line.

Tests:
- `scripts/policy-rev-raises.test.ts`.
- `narrowing.property.test.ts`, for finding 15.
- New test files, and `testing/audience-doors.ts`.
- Outside the list: `scripts/gate-exposure.ts` and `gates.summary.test.ts`. The merge brought them in, and findings 7, 9 and 11 changed what they pin.

Not touched: `machine.ts`, `onturn/**`, `sessions.ts` and `core/writes/**`. Forget is still unbuilt: no route calls the forget code.
