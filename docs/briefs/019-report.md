# Brief 019 report: seed, clone and reset

Branch `lane/seed`. Built by Claude, not Kiro. No commit carries `Built-with: Kiro`.

## Built, by task

1. **Design note:** `docs/briefs/019-design.md`. It covers the persona, the file layout, packets, IDs and the namespace, dates, the fixture clock, the reset steps and eight gaps.
2. **Persona:** the files under `packages/server/src/seed/persona/` (`turns.ts`, `mail.ts`, `bulk.ts`, `calendar.ts`, `bank.ts`, `index.ts`). The persona is Riley, who works at the invented Corvel Freight. Every name is invented, and every address is on `.example`.
3. **One packet per line, all written by hand.** No packet came from a model. Every seeded Evidence row carries `parserVersion: "seed-authored-v1"` and `source: "fixture"`, and the fixture is marked `origin: "authored"`.
   - Turns carry ExtractV1 Items, and three carry PrivateReadOwnV1 guesses.
   - Full inbound mail carries ClaimsV1, and some carries PrivateReadInboundV1. The new closed schemas are in `packages/core/src/claims.ts`.
   - Calendar and bank rows carry typed Observations.
   - `seed/regenerate.ts` is the port a later paid run would use. Its reader is fake by default, and a live reader is refused unless `allowLive` is passed. No live reader is built. The load refuses a regenerated fixture until regenerated packets have a parser version of their own.
4. **One load:** `seed/build.ts` and `seed/load.ts`.
   - Turns go through the extraction worker's own planner (`planItem`) with exact spans only, and no `anchorSpan` repair.
   - Packets go through the closed schemas, and every Memory is checked against W-LINEAGE before anything is written.
   - Rows are then written with the store's ordinary `create`, which runs the same commit checks as live.
   - A bad packet throws `SeedLoadError` and writes nothing.
5. **Clone per visit and reset:**
   - The work is in `seed/reset.ts` and `seed/clear.ts`, with the route in `routes/seed-reset.ts` and `apps/web/src/app/api/seed/reset/route.ts`.
   - The order is: fence (barrier up), close (Sessions closing, calls hung up), install (clear every row but the core docs and this request's ledger row, paged by `__name__`, turns before Sessions), reseed, then one transaction that writes the five core docs, drops the barrier and records the answer.
   - The namespace is `H("seed-ns", uid, visitId, requestId)`, so a retried request replays and a new visit gets a new namespace.
   - It needed a `delete` on the Store_Port (`Tx.delete`), added to both stores with conformance cases.
6. **Fixture clock:**
   - In fixture mode, `ownerClock` returns world = `state.worldClock` and ops = live. Fixture mode with a null `worldClock` fails closed.
   - The extraction worker now takes its world time from `ownerClock`.
   - The seam for brief 023 is `seed/clock-state.ts` `setWorldClock`. It moves `state.worldClock` only, refuses during a barrier (KS09) and for an old namespace, and no route calls it.

Also added: `docs/machines/memory.md` now lists the reset as a writer of `core/epoch` and its barrier. Tests: `seed/persona.test.ts` (demo facts), `seed/clock.test.ts`, `seed/clock-state.test.ts`, `seed/regenerate.test.ts`, `seed/build.test.ts`, `routes/seed-reset.test.ts`, `worker/extract.fixture-clock.test.ts`.

## Demo-critical persona facts, and where each lives

| Fact | File |
|---|---|
| Clone starts Friday 08:40 in the visitor's zone (`CLONE_WEEKDAY`, `CLONE_MINUTE`) | `seed/clock.ts` |
| Interview today 14:00, moved from yesterday 14:00 (two revisions, scheduleRev 1 then 2) | `seed/persona/calendar.ts` (`cal-interview`); Tessellate's "moved" email in `persona/mail.ts`; Riley's own line in `persona/turns.ts` |
| Tuesday: good answer about the gap year (told line) | `seed/persona/turns.ts` |
| Six posted takeout purchases, $30, $28, $34, $34, $24, $36 = $186 | `seed/persona/bank.ts` |
| Four of them on nights with an accepted, timed, busy meeting at or after 18:00 = $126; decoys: a declined late meeting on a takeout night, a 17:00 retro, and late meetings on nights with only a restaurant or a pending charge | `seed/persona/calendar.ts`, `seed/persona/bank.ts` |
| A 21-date window with 18 covered dates | `seed/persona/index.ts` (`windowDays`), `seed/persona/bank.ts` |
| Jordan Ellery (Lindqvist Search), no reply from Riley | `seed/persona/mail.ts` (thread `jordan-platform-role`) |
| Three private guesses, proposed only (M, alleged, S2, never_outbound) | `seed/persona/turns.ts` (`turn-inbox`, `turn-cereal`, `turn-cleaning`) |
| No brother or sibling, no allergy, no pet, no Biscuit | checked in `seed/persona.test.ts` |
| 30 full emails (8 from Riley), 60 bulk, 40 own-word Memories (+3 guesses = 43) | `persona/mail.ts`, `persona/bulk.ts`, `persona/turns.ts` |

## Not built, and why

- `/api/seed/advance` and the seed event: these are brief 023's. The seam exists.
- A live packet reader: the brief says not to run one live.
- Session and Turn rows for seeded turns: owner turns are Evidence only (`kind: turn`, no `sessionId`). Nothing on this branch reads seeded transcripts by Session.
- ClaimsV1 packets are validated, but no consumer exists, so they write no rows. Mail lines write Evidence only.
- `open` does not read the visit ID. It is noted for the lead and not changed (brief rule).
- No supersede in the seed: two lines with the same key fail the load (`sameKey`) instead.

## Red first

Each seed and counterexample is from the run before the code existed.

- **Isolation:** seed -1414730678, path `1:0`, `[[{"who":"visitor-a","kind":"reset","visit":1}]]`. Fails with "expected null not to be null": the stub reset left `fixtureNamespace` null.
- **Reset is total:** seed -2106779224, path `0:0:0:0:0:0`, `[{"sessions":0,"turnsEach":0,"memories":0,"jobs":0,"ledger":0}]`. Fails because the state was not in fixture mode.
- **Same writes, (a) load equals planner:** seed -599833544, path `0:0:0`, `["America/Chicago",1767225600000]`. Fails with "expected 0 to be 43" memories.
- **Same writes, (b) a mutated span fails the load:** seed 691344469, path `0:0:0:0:0`, `[{"line":0,"span":0,"edit":"append"},"America/Chicago"]`. Fails with "expected null to be an instance of SeedLoadError".
- **Sources hold:** seed 1407511548, path `0:0:0`, `["America/Chicago",1767225600000]`. Fails because the window was `{from:'',to:''}`.
- **Determinism:** seed 1064928017, path `0:0:0:0`, `["America/Chicago",1767225600000,1]`. Fails with "expected 0 to be greater than 0". Honestly, it was red only through its non-empty precondition: an empty stub is trivially deterministic.

All five are green now. **Weakness:** the run counts were committed low (isolation 25, reset-total 25, same-writes 25, sources 40, determinism 20) to keep the suite fast on a shared machine. Committed property files are never edited, so raising them needs a lead's call.

## Contract questions

- **S-163:** `SeedResetRequest` has no `clientZone`. The reset takes the zone from `core/state.currentZone`, so a first visit gets whatever zone `ensureCoreDocs` stored.
- **S-164:** contracts §6 names "seedrole/namespace" for who may reset, and nothing defines it. This build uses `mayReset`.
- **S-165:** a reset during a forget's barrier should arguably queue (barrier `queuedOps`). It answers 423 BARRIER instead.
- **S-166:** the reset response's `sessionId` is always null. The contract shape allows a Session, but the reset never opens one.
- **S-167:** ClaimsV1 outputs have no T-record target in the contracts, so they are validated and dropped.
- **S-168:** the ClaimsV1 Topic list differs from the Memory Domain list. `topicDomain` maps family to relationship, and identity and other_secret to other.
- **S-169:** the store contract had no delete, yet "Reset ... clears all tenant rows" needs one. `Tx.delete` was added (written-and-deleted is invalidInput).
- **S-170 (brief 038 finding 3, amends S-163):** `ResetRequest` now carries `clientZone`, and it's required. A first clone is laid out in the browser's zone, and the core documents it creates are too.
- **S-171 (brief 038 finding 1, amends `mayReset`):** a real account is answered 409 with a new code, `LIVE`, not 403 AUTH, so the browser can tell a real account from a failed clone. On `lane/fix7-held`, finding 9 widens "real" from Evidence alone to any Session, ledger row (a seed route's own request entries aside), Evidence or hard rule. That fails the committed isolation property, so it waits for a ruling.
- **S-172 (brief 038 finding 2, amends "a reset raises epoch ... at unblock"):** the fence raises the epoch in its own transaction, so every stamp check fails during the reset, and the receipt route refuses under a barrier. A refused writer's own failed request entry stays in the tenant after the reset.
- **S-173 (brief 038 finding 8):** each clear and load transaction checks that the barrier still carries the reset's operation ID, or answers STALE.
- **S-174 (brief 038 finding 10, amends S-165 in part):** a reset answers 423 BARRIER while a phone call of the user may still be out. The forget part of S-165 stands.

## Rulings needed

Each is one constant or one small function.

- `mayReset`: an account may reset only if it is already a clone or holds no Evidence. An account with its own data gets 403.
- `RESET_BARRIER_MS` = 60 s: after it, a reset may take over its own tenant's crashed reset. `RESET_HANGUP_BUDGET_MS` = 3 s.
- `CLONE_WEEKDAY` = 5 and `CLONE_MINUTE` = 520: the latest Friday 08:40 at or before now. A DST gap shifts forward.
- `EVENING_FROM_MINUTE` = 17:00 for an "evening purchase", and `LATE_MEETING_FROM_MINUTE` = 18:00.
- `SEED_LINES_PER_TX` = 20 and `CLEAR_PAGE` = 100.
- Own mail carries no ClaimsV1 packet.
- Guesses are stored as hypothesis Memories (M, alleged, S2, never_outbound, no `sayAs`).
- A reset raises epoch, rulesRev and bundleRev, and keeps policyRev.
- A `SeedLoadError` in the reset maps to CONFIG 500.
- Calendar and bank slices are class O.
- The load refuses a regenerated fixture until it has its own parser version.

## Files touched

Hot files from the brief's list:
- `packages/server/src/core-docs.ts`: fixture mode in `ownerClock`, plus its message.
- `packages/core/src/schema/wire.ts`: `SeedResetRequest` and `SeedResetResponse`, appended.
- The barrels `packages/core/src/index.ts` and `packages/server/src/index.ts`: lines appended.

Outside the list, none forbidden:
- `store/port.ts`, `store/memory-store.ts`, `store/firestore-store.ts`, `store/conformance.ts`: `Tx.delete`.
- `worker/extract.ts`: world time from `ownerClock`.
- `intents/repair.test.ts`: its wrapper Tx passes `delete`.
- `core-docs.test.ts`: the "rejects fixture" test was replaced by fixture-mode tests.
- `docs/machines/memory.md`.

Not touched: `turn.ts`, `open.ts`, `admission.ts`, `head.ts`, `eligible.ts`, `worker/tick.ts`, `firestore.rules`.

## Checks (final, run one after another)

- `npx vitest run --maxWorkers=3`: exit 0. 293 files; 3232 passed, 20 expected fail (none added), 0 failed. No timeout reruns were needed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0, with `/api/seed/reset` listed.

## Not tested

- `Tx.delete` on the Firestore emulator. The conformance cases ran on MemoryStore only, and no emulator was allowed.
- The reset against real Firestore paging and transaction limits.
- A live call being hung up by a reset.
- The browser path (a visit calling reset, then open).
- Any regenerated packet from a real model.
