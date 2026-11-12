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
