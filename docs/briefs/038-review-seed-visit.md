# Brief 038: review of the seed, the reset and the visit, and its fixes (lane `fix7`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

An independent review read the code a visitor's whole stay depends on: the seeded clone, "start over", the time bolt and the visit on the screen (briefs 019, 027, the advance route of 023, and the visit check of 030). It confirmed five findings by running a probe and the rest by reading. Its findings are below as it gave them. It found no way for one visitor to reach another's data: the user ID comes only from the verified token. What it found is a visitor who can lock themselves out for good, a reset that leaves old words behind, and a first clone laid out in the wrong time zone.

Where a finding and a ruling of brief 019 or 027 disagree, this brief rules for the reading that fails closed. Each such ruling is the lead's, for the owner to confirm, and is listed again in the report.

## Findings

**1. High, confirmed by a run. A chip or a typed line before the first clone locks that account out of the demo for good.**
- Files: `packages/server/src/seed/reset.ts` lines 49 to 51 (`mayReset`) and 79 to 82; `apps/web/src/components/App.tsx` lines 398 and 408. The typed bar and the chips are not gated on the visit's phase. While the visit is `cloning` or `failed`, `app-controllers.ts` lines 78 to 80 send `visitId: null`, so open and turn run on the fresh account in live mode and write Evidence. From then on `mayReset(live, hasEvidence=true)` is false.
- Sequence: a fresh user, open, the typed turn "What do you know about me?" (200, one Evidence row). The reset then answers 403 `{"error":"AUTH"}`, and "Try again" answers 403 for ever. In practice: the first reset times out (the client's limit is 8 s; a cold start is enough) and the judge presses a chip.
- Ruling: the visit has three outcomes, and the server says which. **Ready:** the account is a clone. **Live:** the server answers that this is a real account that is never reset, with its own code (not `AUTH`); the screen then shows no "start over" and no bolt, the real clock, and takes input as today. **Failed:** anything else; the screen takes no input (no chip, no typed send, no call) and offers the retry. While `cloning`, no input either.

**2. High, confirmed by a run. A reset leaves Evidence of the old visit in the new clone.**
- Files: `reset.ts` lines 84 to 90 (`fence`); `packages/server/src/routes/receipt.ts` lines 58 to 75. The fence raises the barrier but not the epoch, `policyRev` or `rulesRev`; those rise only at unblock. The receipt route has no barrier check, so its stamp check still passes during the reset, and it writes an Evidence row and an assistant Turn. The clear runs evidence, then memories, then sessions, so a receipt that commits after the evidence pages are gone stays.
- Sequence: clone, open, reset again. When `clearTenant` first queries `/memories`, post a transcript receipt ("Old visit words."). Result: the receipt answers 200 `accepted:true`, the reset answers 200, and the old Evidence row is in the tenant after the reset. In practice: the last spoken reply's transcript landing just after "start over" hangs up.
- Fix: the fence raises the epoch in its own transaction, as the forget fence does (contracts line 883), so every stamp check fails during the reset. The receipt route refuses while a barrier is up.

**3. High, confirmed by a run. Every first clone is laid out in UTC, not the visitor's zone.**
- File: `packages/server/src/routes/seed-reset.ts` line 13 calls `ensureCoreDocs(ctx.uid, ctx.deps)` with no client zone, so `currentZone` is UTC. The visit machine sends the reset on sign-in, before any open, and `ResetRequest` carries no zone.
- Result on a fresh user: the world clock is `2026-10-30T08:40:00.000Z`, which is 03:40 in Chicago. The next open sets the zone to the browser's, so the clone's "Friday 08:40" becomes Friday 3:40 AM on the badge, and the seeded "interview at 2" and "meetings after 6" land five to eight hours off for a visitor in the United States. A later "start over" uses the corrected zone, so the first clone and later ones differ. The tests hide it: `testing/seed.ts` `resetAs` sets the zone first.
- Fix: `ResetRequest` carries the client's zone, and the reset passes it to `ensureCoreDocs` and the clone. An unknown or missing zone is refused, not defaulted.

**4. Medium, by reading. A tab from an old visit keeps working against the new clone.**
- Files: `apps/web/src/ui/visit/visit-machine.ts` lines 144 and 134 reuse the same `visitId` on start over and on retry; `packages/server/src/routes/open-visit.ts` lines 12 to 14 checks only `visitId`. After "start over" in tab B, tab A's open still passes, and tab A talks to the new clone while showing its old lines and old clock. Tab A's bolt sends the old namespace, gets STALE, and fails on every press until a reload.
- Fix: each reset has a new visit ID, the server checks it on open and on turn when one is sent, and a STALE answer to any visit call tells the tab to reload the visit. A call's open sends no visit ID today; brief 030's second phase adds it in the voice machine, so leave `packages/core/src/voice/**` alone and keep accepting null from a call.

**5. Medium, by reading. The screen can show a made-up time as real.** In `failed` or `cloning` the badge shows the real clock with `simulated: false`, while the account may already be a clone (the client timed out at 8 s and the server finished).
- Ruling: while the visit is `cloning` or `failed` the badge shows no clock at all. A clock is shown only once the server has said which clock the account runs on.

**6. Medium, confirmed by a run. Nothing limits resets or advances on a public demo.** Any Google account can sign in. One reset clears and then writes about 240 rows. Each advance leaves a derive Job row that only a reset removes.
- Ruling: a limit per user on the ops clock, kept with the owner's counters: one reset per 30 s and 40 a day, and 200 advances per visit. Named constants. Over the limit answers 429 with the time to wait, and the screen says so.

**7. Low, confirmed by a run.** An advance has no upper bound: `to: "9999-12-31T23:59:59.999Z"` answers 200, after which every bolt target fails validation and the bolt is dead until "start over". Fix: refuse a target more than 60 days past the clone's start.

**8. Low, by reading.** Two resets overlap if one runs longer than 60 s: a takeover lets the first's `loadSeed` keep writing after the second's clear, so the tenant ends with two copies of the persona. Fix: each `loadSeed` and `clearTenant` transaction checks that the barrier still carries its own operation ID.

**9. Low, confirmed by a run.** "Start over" wipes a live account that has no Evidence: its Sessions and ledger rows are deleted and its hard rules replaced with empty ones.
- Ruling: a live account is real, and is never reset, if it has any Session, any ledger row, any Evidence or any hard rule. With finding 1's gate this no longer locks a visitor out: a visitor's browser always clones before anything else.

**10. Low, noted.** The reset answers 423 behind a forget where the contract says it queues (forget is not wired, so leave it), and a phone call in progress is not ended by a reset, while its ledger row is deleted under it. Fix the second: a reset is refused with 423 while a phone call of this user is still out.

**What the properties miss.** `simulated-label` restates the badge's own definition and cannot fail. `reset-total` is sequential, with no writer racing the reset, and starts from a tenant that already has a zone. `isolation` and `determinism` never cover a first reset before any open. `seed-advance` jumps three days at most and never races a reset. `one-clone` and `clock-forward` cover the machine alone.

## New properties

In new files beside the existing ones:

1. **A reset is total under any writer.** For any interleaving of a reset with a receipt, a turn, a tool call, a tick, an advance and an extraction job of the old visit: after the reset answers, the tenant holds exactly the rows a fresh clone holds, and every refused writer was answered, not dropped silently.
2. **The first clone is the same as any later one.** For any client zone, a fresh user's first reset (with no open before it) and a later reset give the same rows, the same local times of day for the seeded events, and the same world clock in that zone.
3. **A real account is never reset, and a visitor is never locked out.** For any sequence of the calls a browser can make in its phases (with the input gate in place): a fresh account ends as a clone; an account with any Session, ledger row, Evidence or rule from live mode is refused with the live code and loses nothing.
4. **An old visit cannot talk to the new one.** After a reset, any open, turn or advance that names an earlier visit ID is answered STALE and writes nothing.
5. **A shown clock is labelled by the server's word.** For any visit state and any server answer, the badge shows a clock only when the server has said the mode, and shows it as simulated exactly when the mode is the fixture clock.
6. **The limits hold.** For any stream of resets and advances on the ops clock, no more than the limits pass, the refused ones write nothing, and the world clock never passes the cap or goes back.

## How to work

For each finding 1 to 10: the failing test first (the reviewer's sequence, and the new property red with its seed and counterexample recorded), then the smallest fix, one finding per commit. Order: 2, 3, 1 and 9 together, 4, 5, then 6, 7, 8, 10.

Other lanes are editing `packages/server/src/routes/open.ts`, `state.ts`, `turn.ts` and `receipt.ts`. Keep each edit to those small and in one place: a barrier or visit check that calls into `packages/server/src/seed/**` or `routes/open-visit.ts`, where the logic lives.

Where a fix changes a ruling of brief 019 or 027, add a numbered contract question at the end of the list in that brief's report, saying what it amends and why.

## Hot files this lane may edit

`packages/server/src/seed/**`, `packages/server/src/routes/seed-reset.ts`, `seed-advance.ts`, `open-visit.ts`, the visit and barrier checks in `open.ts`, `turn.ts` and `receipt.ts` (a few lines each), `packages/core/src/schema/wire.ts` (the reset request and the visit answers, additions only), `apps/web/src/ui/visit/**`, `apps/web/src/client/visit-model.ts`, `app-controllers.ts`, `api.ts` (the visit calls), `VisitBar`, and the input gate in `App.tsx`. Not `packages/core/src/voice/**`.

## Looking at it

A dev server on port 3210 only, the `/specimens` page only, no sign-in, stopped when you finish. Never port 3000.

## Done

The fixes with their red-first tests, the six properties green, the checks of brief 016 with `npm run build` and the repo's copy-check, token-check and ui-boundaries scripts, and a section "Outcome" at the end of this file: per finding, the test, the commit and the ruling it changed; per property, the seed and counterexample.
