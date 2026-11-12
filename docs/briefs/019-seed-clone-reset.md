# Brief 019: the seeded persona, clone and reset (lane `seed`, F8)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Franki runs on fixtures through Dec 1: mail, calendar and bank rows come from a seed, and they enter through the same writes live data would (spec §4, line 136). Nothing loads a seed today. `CoreState.visitId` and `fixtureNamespace` exist, and `ownerClock` in `core-docs.ts` throws `UnsupportedClockModeError` for fixture mode. This brief builds the persona, the one load function, the clone per visit, the reset, and the fixture clock.

## Read first

- Spec §15 (lines 462 to 475): the demo. The persona must make every beat true. Spec §4 lines 122 to 138 (what gets written, sources, packets), §10 (lines 301 to 309) and §11 (lines 311 to 317).
- Contracts: `core/state` (line 261), Clocks and the reset rules (line 271), `POST /api/seed/reset` (line 745), `open` with `visitId` (line 736), `ExtractV1` floor and seed (line 498), `ClaimsV1` (516 to 536), `PrivateReadOwn` and `PrivateReadInbound` (538 to 560), bank `Observation` (line 23), `rollups` (164 to 170), `moments` (94 to 106), and the IDs KS05 and KS09 (972 to 1007).
- `packages/core/src/schema/records.ts`, `packages/server/src/core-docs.ts`, `packages/server/src/store/` (the port, both stores, `paths.ts`), `packages/core/src/clock.ts`, `packages/server/src/worker/extract.ts` (how a packet's output is validated and written today), `apps/web/src/client/typed-turns.ts`.

## What to build

1. **A design note first,** `docs/briefs/019-design.md`, short: the persona on one page, the file layout of the seed, what a packet is, how IDs are salted by namespace, how dates are made relative, the order of reset, and every gap you found between spec, contracts and code with the answer you chose.

2. **One persona,** as committed data under `packages/server/src/seed/`. From §15:
   - The clone's world clock starts on a Friday at 08:40 in the visitor's zone.
   - An interview today at 14:00, moved from yesterday. On Tuesday the owner gave a good answer about their gap year (a told line).
   - The hero fixture exactly as spec §10 gives it (line 305): a window of 21 dates with at least 14 covered local dates; six posted takeout purchases of $30, $28, $34, $34, $24 and $36, which is $186; four of the six on nights with an accepted, timed, busy meeting starting at or after 18:00, which is $126, each with an evening purchase time. Bank rows and calendar rows that can each be named as a source.
   - An email from Jordan, a recruiter, still without a reply.
   - Private things a reader could guess from the owner's own text but that were never said: three guesses, proposed only.
   - No fact about a brother anywhere in the seed, and no allergy.
   - No pet named Biscuit: that is the visitor's own line.
   - 30 full emails and 60 bulk ones, a calendar, bank rows, and a 40-memory set that a readout can speak from.
   - Invented names only: no real company, product, bank, shop, delivery service or person. A restaurant or merchant gets a plain made-up name.

3. **One packet per line.** Each seeded line (an owner turn, an email, a calendar or bank row) carries its own packet: the extraction output for that line alone, in the shapes the contracts give (`ExtractV1`, `ClaimsV1`, the private reads), with `open: []` and only the entities its own spans mention. The packets are written by hand in this brief and marked as authored, not as model output. A later paid run can regenerate them; build the script for that run behind a port that is fake by default, and do not run it live.

4. **One load function.** It takes a fixture, a namespace, a zone and a world clock, and writes the seed through the same validation and the same store writes a live turn or the extraction worker uses: spans checked against Evidence text, a source on every field, lineage on every row. A packet that fails validation fails the load. No second write path.

5. **Clone per visit and reset,** `POST /api/seed/reset` as the contract gives it: it fences, clears every row of that tenant (paged, subcollections too), reseeds, then unblocks; the namespace salts synthetic IDs only; the visit ID is stored and persists across a reload. A reset while a call is open closes the call first. Two visits never see each other's rows.

6. **The fixture clock.** `ownerClock` returns the `ClockPair` for fixture mode: the world clock from `state.worldClock`, the ops clock live, by the allowlist in contracts line 271. Dates in the seed are relative to the world clock at load. Moving the clock forward (`/api/seed/advance`) is the next brief's; leave a clear seam.

## Properties, red first

- **Isolation:** for any two visits and any order of resets and loads, no read by one visit returns a row of the other.
- **Reset is total:** after a reset, the tenant holds exactly the seed, for any rows written before it.
- **The load is the same writes:** every seeded row passes the validators a live write passes; a seed row with a span that is not in its Evidence fails the load.
- **Sources hold:** every number the persona's hero pattern uses traces to named bank and calendar rows; the window's takeout total is exactly $186.00, and the late-meeting share is exactly four orders and $126.00.
- **Determinism:** the same fixture, namespace, zone and clock give the same rows.

## Hot files this lane may edit

`packages/server/src/core-docs.ts` (the clock mode), `packages/server/src/store/paths.ts`, `firestore.indexes.json` and `store/indexes.ts` if a query needs one, the barrels, and additions to `schema/records.ts`, `schema/wire.ts` and `testing/samples.ts`. New: `packages/server/src/seed/**`, `packages/server/src/routes/seed-reset.ts`, and its thin route file under `apps/web/src/app/api/seed/reset/`. Not `routes/turn.ts`, `open.ts`, `admission.ts`, `head.ts`, `eligible.ts` or `worker/tick.ts`. If `open` must read the visit ID differently, write the change down for the lead and do not make it.

`firestore.rules` stays deny-all.

## Done

The persona, the load, the reset route and the fixture clock, the properties green, the checks of brief 016, and `docs/briefs/019-report.md`. The report lists the persona's facts a demo depends on, each with the file that holds it, and says which packets are authored by hand.
