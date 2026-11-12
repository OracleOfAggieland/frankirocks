# Brief 036: review of one-shot time and delivery, and its fixes (lane `fix5`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the time lane's work (brief 023, merged as `28e74a7`). It confirmed most findings by running a throwaway probe and the rest by reading. Its findings are below as it gave them. Time is what lets Franki speak first, so a defect here is something said that should not be: a wish for the old time of a moved interview, a line drawn from a fact the owner has since corrected, the takeout figure said with company in the room. No route delivers a moment yet. Brief 030 wires delivery in its second phase, and these fixes land first.

Where a finding and a ruling of brief 023 disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**1. High, confirmed by a run. A moved occasion speaks its old time, then loses its wish.**
- Files: `packages/core/src/moments/merge.ts` line 84 returns null unless the row is `pending`, so derive never touches a `leased` row. `chooseNow` (`packages/server/src/time/proactive.ts` line 53), `proactiveOf` and `admitMoment` (`packages/server/src/time/said.ts` lines 20 to 33) never reread the source.
- Sequence: a seeded clone. `memoryTick` at 08:40 leases the wish "Good luck at 2 PM…". The interview moves to 16:00 (a new event row with `replacesIds:[old]`, the old row set to `history`). Tick again.
- Wrong result: the wish row is still `leased` with the 2 PM template and the old `noteRef`. `chooseNow` picks it, `proactiveOf` puts "Good luck at 2 PM" on the wire, and `admitMoment` admits it. If it is not admitted within 15 ops-minutes, the lease expires, the reread follows the stale `noteRef` to the `history` row, and the wish is cancelled for good: the moved occurrence never gets a wish, because the moment ID is the same.
- Spec §13: "the rendered string changes" and "nothing fires at the old time".
- Fix: in `mergeMoment`, when a `leased` row's planned fields change, drop the lease and write it back to `pending` with the new plan. `admitMoment` rereads the source in its transaction with the same verdict the tick uses (eligibility and holds) and checks the lease token and generation against the permit (contracts line 958: "Commit checks epoch/policy/source/lease/generation/eligibility").

**2. High, confirmed by a run. A moment whose source turned `wrong`, or otherwise ineligible, after open is still spoken and admitted.**
- Sequence: a wish is leased, then its source Memory is patched to `status:"wrong"`. `chooseNow` still chooses it and `admitMoment` still admits it.
- Fix: the reread of finding 1 at admission, and `chooseNow` skips a candidate whose source verdict is not `ok`.

**3. High, by reading. The delivery seams do not pass the Gate.**
- File: `proactive.ts` lines 47 to 133. `chooseNow` takes only `transitionOrCrisis` and `turnsSinceCheckInAnswer`. `proactiveOf` blocks only S2. Missing, and already in `packages/core/src/gate/gate.ts`: the audience (company holds S1+), an unknown audience, rushed, the source-class ceiling (mail: attributed logistics only), crisis.
- With company present, the S1 insight "You've spent $186 on takeout…" would go on the wire as a whisper. An `event` Memory from mail gets an unattributed wish and check-in: the reread in `memoryVerdict` (`packages/server/src/time/tick.ts` line 220) uses `stage:"read"`, so the authority check of `eligible` never runs.
- Ruling: the Gate runs inside `chooseNow`, for every candidate, with the unprompted trigger, the session's audience and modifiers, and the source's class and sensitivity. Anything whose verdict is not `say` is not spoken; a `card` verdict may go to a card. The reread at open uses `stage:"speech"`. Putting the Gate here, and not in each route, means a route cannot forget it. Brief 033 changed the Gate's context (it names the moment as `opener` or `idle`, and a whisper must match its Gate result): build this finding last, after merging `build/plan-stages` with brief 033's "Outcome" section in it.

**4. Medium, confirmed by a run. Crisis holds disagree between delivery and the Gate.**
- File: `packages/core/src/moments/delivery.ts` lines 92 to 101 holds only insight, celebrate, ask and expiryAsk. `chooseDelivery` with `transitionOrCrisis:true` and a wish candidate gives `spoken: wish`. After "He didn't make it", a "Good luck…" or "How did … go?" plays. `griefAsk` is not in the held kinds either: it went to a card with reason `dayCap`, not `transitionHold`.
- Ruling: crisis and transition are separate inputs. Crisis holds every candidate that is not `mustSay`. `griefAsk` joins the held kinds.

**5. Medium, confirmed by a run. The day's caps are not enforced at admission.**
- File: `time/said.ts` lines 20 to 33. With the counters at `speech:3, heavy:1` for today, `admitMoment` on a wish returns true and the count becomes 4. The caps are checked only in `chooseNow`, outside any transaction, so two tabs, or an opening racing an idle whisper, can both choose and both admit.
- Fix: in `admitMoment`'s transaction, recompute today's counts and refuse when a cap is reached, unless the candidate is `mustSay` or carries a verified override.

**6. Medium, confirmed by a run. The hero insight and the celebrate can never be marked `said`.**
- File: `saidTargetOf` (`packages/core/src/moments/said.ts` lines 73 to 76) takes the template from `cue` payloads only, and `cueTokens` is always `[]` (`merge.ts` line 51), so `idTagged` cannot match either. An insight admitted on a response whose transcript equals the exact offer line gives `recordSaid` null. No delivery row is written, so "Why did you bring that up?" has nothing to read for the hero.
- Fix: the worded line that `proactiveOf` produced (or its hash and tokens) is stored with the admission and is the target of the match.

**7. Medium, confirmed by a run. A jump past midnight of day 0 kills the hero.** Left to brief 030, which already has it as finding 3 of brief 029: the hero's window slides with the world clock, the seeded coverage does not, and the pending decoy enters the window from day +1.

**8. Medium, by reading. A reminder never passes the caps or quiet hours.** `isMustSay` returns false for every kind (`delivery.ts` line 71). Contracts line 332 and spec §6 make a commitment due within 24 h `mustSay`. "Remind me at 22:00" is held until morning, and a fourth line of the day drops a reminder the owner confirmed.
- Fix: a confirmed reminder due within 24 h is `mustSay`. Nothing else is.

**9. Medium, by reading and by the lane's own test. A reminder's confirmation is not bound.** `packages/server/src/time/reminder.ts` lines 84 to 111.
- A "no" writes nothing, so a later "yes" still applies (`time.test.ts` lines 145 to 147 does exactly that). `confirmReminder` trusts the caller's `offer.time` and `offer.note` and never recomputes `pendingId` from them, so a different time or note under the same `pendingId` executes. The rendered row stores no options or stamp (contracts: "pendingRendered binds exact pending/options/stamp"). Nothing checks that the yes came after the render.
- Fix: the rendered row stores the offer's time and note (or their hash) and the confirm compares them; a "no" writes a declined row and a later yes is refused; the yes turn must be later than the render. The test that pinned declined-then-applied changes.

**10. Medium, by reading. A reminder fires after its source is corrected or forgotten.** The `makeReminder` action stores no source ID, and the verdict at open is only "action complete" (`time/tick.ts` lines 277 to 280).
- Fix: the reminder keeps its source's ID and lineage, and open rereads it like any other moment's source.

**11. Low, confirmed by a run.** An `expiryAsk` ID depends on the owner's current zone (`derive.ts` line 201), so a zone change asks an already-answered expiry question again. Fix: key it on `validTo` itself.

**12. Low, by reading.** A wish retired once is never revived: move the occasion to 07:00 (the wish is retired as `skipped`), then back to 14:00, and no wish fires. Fix: merge may revive a row skipped with `startPassed` when the new time is still ahead.

**13. Low, confirmed by a run.** `chooseDelivery` throws on a NaN world time, because `inQuietHours(NaN, zone)` throws. Fix here: `delivery.ts` treats a non-finite time as quiet before it calls. (The Gate lane guards `inQuietHours` itself.)

**14. Low, by reading.** `said` does not need playback: `saidUpdate` accepts any transcript on the admitted response, whatever `playbackAt` says and even after a `cancelled` receipt. Fix: `saidAt` needs `playbackStarted` seen and no cancel before it.

**15. Low, noted.** Moment rows are never deleted. Past 2,000 rows `scanMoments` returns null and nothing opens for that owner again; `TICK_PAGE` of 100 means a large jump moves only the first 100 candidates. Fine at demo size. Write it in the report as a known limit, with a test that pins what happens at the cap (it fails quiet, and says so in a ledger row or a log line).

**What the properties miss.** "Jump equals waiting" holds the ops clock still, so no lease ever expires, and runs the pure plan, not `memoryTick`. "Identity stable" never merges into a leased row and never asserts nothing fires at the old time. "Nothing fires unresolved" models a correction as a new revision of the same row, not a new row with the old one `wrong`, and checks only at open. "Time only asks" asserts pure functions do not mutate their inputs. "Caps and quiet hours" is pure and sequential, one day long, and never holds a wish under crisis. "No row, no claim" is pure, accepts containment, and never checks playback.

## New properties

In new files beside the existing ones, on the server path (`memoryTick`, `chooseNow`, `admitMoment`, `recordSaid` over the in-memory store), with the ops clock moving:

1. **Nothing fires at the old time.** For any sequence of ticks, moves of the occasion, lease expiries and admissions: nothing is admitted whose rendered time differs from its source's time at that moment, each occurrence is admitted at most once, and an occurrence still ahead after its last move can still be wished.
2. **A changed source is never spoken.** For any change to a source between open and admission (`wrong`, history, blocked, superseded, forgotten by a block): `chooseNow` does not choose it and `admitMoment` refuses it.
3. **The caps hold under any interleaving.** Two sessions choosing and admitting in any order never admit more than three in a world day or more than one heavy, except `mustSay`. Days change by the world clock and the zone.
4. **Crisis is quiet.** With crisis set, `chooseNow` speaks nothing that is not `mustSay`.
5. **Said needs a played, matching, admitted reply.** `saidAt` is set only with an admission, a playback start, no cancel and a match, and the ledger row is written in the same transaction.
6. **Every spoken choice passed the Gate.** For any audience, modifiers, source class and sensitivity: whatever `chooseNow` returns as spoken has a Gate verdict of `say` for that same context.
7. **A reminder is bound to its offer.** It executes only for the exact offer that was rendered, after the render, never after a no, and never once its source is corrected.

## How to work

For each finding 1, 2, 4, 5, 6, 8 to 14: the failing test first (the reviewer's sequence, and the new property red with its seed and counterexample recorded), then the smallest fix, one finding per commit. Then finding 15's test. Finding 3 last, after a fresh merge of `build/plan-stages`: if brief 033 has no "Outcome" section yet, stop there with the tree green and everything committed, and report; the lead will send you on.

Where a fix changes a ruling of brief 023, add a numbered contract question at the end of the list in `docs/briefs/023-design.md`, saying what it amends and why.

## Hot files this lane may edit

`packages/core/src/moments/**` and `packages/server/src/time/**`, with their tests. `packages/core/src/schema/records.ts` for the Moment and reminder rows, additions only. Not the routes (brief 030 calls these functions; keep their names, and where a signature must change, say so in the report with the old and the new), not `packages/core/src/gate/**`, not the seed.

## Done

The fixes with their red-first tests, the seven properties green, the checks of brief 016, and a section "Outcome" at the end of this file: per finding, the test, the commit and the ruling it changed; per property, the seed and counterexample; and the signature of every seam function that changed.
