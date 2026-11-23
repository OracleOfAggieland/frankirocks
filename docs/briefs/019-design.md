# Brief 019 design note: the seeded persona, clone and reset

Lane `seed`, F8. Built by Claude Code from brief 019; no Kiro spec covers it.

## The persona on one page

The owner is **Riley**, an operations analyst at Corvel Freight, interviewing for a product role at Tessellate Labs. Every name is invented.

- **The clone's clock** starts on a Friday at 08:40 in the visitor's zone: the latest such instant at or before the reset (`cloneWorldStart`). Every seeded date is an offset from that Friday (day offset plus local minute), so "Tuesday" is three days back and "Thursday" is yesterday.
- **The interview:** a calendar event at Tessellate Labs, first at Thursday 14:00, moved to Friday 14:00. It is two Evidence revisions of one logical event (`revisionOf`, `scheduleRev` 1 then 2), and a Tessellate email on Thursday says it moved. Riley said on Thursday evening that it moved to tomorrow at 2 (an `event` Memory resolved by the real resolver to Friday 14:00).
- **The told line:** on Tuesday Riley said the gap-year answer went well in a practice round (an `episode` Memory asserted on Tuesday).
- **The hero fixture (spec §10):** the window is the 21 local dates before the clone's Friday. Bank rows fall on 18 of them. Six posted takeout purchases: $30, $28, $34, $34 on four nights with an accepted, confirmed, opaque, timed meeting starting at or after 18:00 (each purchase between 20:30 and 21:10 local), and $24 (a Sunday, no meeting) and $36 (a night whose 18:30 meeting Riley declined). Total $186, late share four orders and $126. Decoys that must not count: one pending takeout row, one restaurant row on a late-meeting night, one declined late meeting, one meeting at 17:00.
- **Jordan,** a recruiter at Lindqvist Search, wrote on Wednesday about a platform role. Nothing in that thread is from Riley.
- **Three private guesses,** each from one of Riley's own lines and never said: that Riley may be ready to leave Corvel, that evenings are wearing Riley down, and that money feels tight this month. Proposed only: `hypothesis` Memories, class M, status `alleged`, S2, `never_outbound`.
- **Absent on purpose:** no brother, no sibling at all, no allergy, no pet, nothing named Biscuit.
- **Counts:** 40 Memories from Riley's own turns, 3 guesses, 30 full emails (8 sent by Riley), 60 bulk emails, a calendar and bank rows.

## File layout

`packages/server/src/seed/`:

| File | What |
|---|---|
| `fixture.ts` | The fixture's types: lines, relative times, authored spans |
| `persona/turns.ts` | Riley's turns, each with its ExtractV1 packet and any PrivateReadOwnV1 packet |
| `persona/mail.ts`, `persona/bulk.ts` | The 30 full emails with ClaimsV1 packets, and the 60 bulk ones |
| `persona/calendar.ts`, `persona/bank.ts` | Calendar and bank rows; their packet is the typed Observation code reads |
| `persona/index.ts` | `PERSONA`, the one fixture |
| `clock.ts` | `cloneWorldStart`, local-time to instant |
| `build.ts` | Pure: fixture, namespace, zone, clock in; Evidence, Memories and Jobs out, or a `SeedLoadError` |
| `load.ts` | Writes the built rows through the Store_Port |
| `clear.ts` | Deletes every row of a tenant, paged by document ID (Q28), turns too |
| `reset.ts` | The reset sequence |
| `hero-check.ts` | Reads the hero's numbers back out of the seeded rows, for tests and the report |
| `regenerate.ts` | The port a later paid run would use to regenerate packets; fake by default, no live reader built, and the load refuses its output until it has a parser version |

`packages/core/src/claims.ts` holds the closed output schemas of ClaimsV1, PrivateReadOwnV1 and PrivateReadInboundV1. `routes/seed-reset.ts` is the route, and `apps/web/src/app/api/seed/reset/route.ts` its thin adapter.

## What a packet is

One packet per seeded line, holding that line's extraction output and nothing else: `open: []`, no earlier turns, and only the entities the line's own spans mention.

- **A turn** carries ExtractV1 items. The load runs each through `planItem`, the same planner the extraction worker uses. Every item must plan to a Memory, or the load fails.
- **An email** carries ClaimsV1 output. Bulk mail may carry logistics only. Some emails also carry PrivateReadInboundV1 topic signals.
- **A turn may carry PrivateReadOwnV1** hypotheses. Their support spans quote that turn only.
- **Calendar and bank rows** are read by code (spec §4 table), so their packet is the typed Observation itself.

Packets are written by hand and marked as authored: every seeded Evidence has `parserVersion: "seed-authored-v1"`, and the fixture's `origin` is `"authored"`. A span is authored as its quote, plus an occurrence index when the quote repeats. `build.ts` turns it into offsets against the line's text. The load then checks every span exactly with `verifySpan`, without the worker's few-character anchoring, so a quote that isn't in its Evidence fails the load.

## IDs and the namespace

The namespace salts synthetic IDs only: each line's logical Evidence ID is `H("seed", namespace, lineId)`, its eid is `H(logicalId, version)` as for live Evidence, the seed job ID is `H("seed-job", namespace, lineId)` (Memory IDs follow from it through `idParts.memory`), and provider, account, merchant and calendar keys are `H("seed-key", namespace, kind, name)`. Entity IDs are not salted: they come from `resolveMention`, as live ones do. A reset makes a new namespace, `H("seed-ns", uid, visitId, requestId)`, so a retry of the same request gets the same one.

## Dates

Each line's time is `{ day, minute }`: days from the clone's Friday and a local minute. `build.ts` turns it into an instant in the visitor's zone at load. A turn's world time is its own `occurredAt`, so "tomorrow at 2" said on Thursday resolves against Thursday. The window and coverage come from the same Friday.

## The fixture clock

`ownerClock` returns `{ worldClock: { now: state.worldClock, zone: currentZone }, opsClock: live }` in fixture mode (contracts line 271). The extraction worker now takes its world time from `ownerClock` too, or a visitor's "Thursday" would resolve against the real date. Moving the clock forward is brief 023's job. The seam is `setWorldClock(tx, uid, namespace, to, opsNow)` in `seed/clock-state.ts`, which only moves `state.worldClock`, refuses while a barrier is up (KS09) or when `namespace` is not the current clone, and is not yet called by any route.

## The order of a reset

1. **Fence.** One transaction: refuse if a barrier is up that is not a reset of this tenant's own (BARRIER 423). Set `core/epoch.barrier` (phase `fence`), and set `state.fixtureNamespace` to the new namespace so a crashed reset can be recognised and taken over.
2. **Close.** Every live Session goes to `closing` through `beginCloseInTx`, and its calls are hung up. If a hangup fails, the reset fails retryably and the barrier stays, so nothing can speak.
3. **Clear.** Every row except `core/*` and this request's own ledger row is deleted, 100 at a time by document ID, including each Session's turns.
4. **Reseed.** Build in memory first, so a bad packet fails before anything is written. Then write in transactions of at most 20 lines.
5. **Unblock.** One transaction resets the five core documents to the seed's values (epoch + 1, so in-flight work fails STALE, rules and bundle empty, state in fixture mode with the world clock, namespace and visit ID), clears the barrier, and records the response.

## Gaps found, and the answer chosen

1. **The store had no delete.** `Tx.delete` is added to the port and to both stores. Reset is its only caller, and Evidence is otherwise still never deleted.
2. **No ClaimsV1 consumer exists, and no T-record collection.** ClaimsV1 packets are validated at load and write nothing but their Evidence. "Awaiting reply" is code thread ordering over Evidence (`threadKey`, `inReplyToProviderKey`, authorship), as contracts §5 says.
3. **Supersede on seeded lines.** The worker's commit loop also closes same-key rows (Q03). The seed is authored so nothing supersedes, and a same-key collision fails the load. This is a check, not a second write path.
4. **Seeded turns have no Session or Turn rows.** Their Evidence has `sessionId: null`, `turnId: null`.
5. **Topic and Domain differ.** The private reads' `Topic` maps onto the `hypothesis` predicate's `Domain`: family to relationship, identity and other_secret to other.
6. **Who may reset.** Contracts say "seedrole/namespace" without defining the role. A reset is allowed only on a tenant already in fixture mode, or one with no Evidence yet (`mayReset`). An account with real data is never wiped.
7. **Open and the visit ID.** `open` does not read `visitId`. The browser has to keep the visit ID and call reset before the first open of a visit. That is written down for the lead and not changed here.
8. **Calendar and bank classes.** Their typed fields get class O. A calendar title gets T when someone else organised the event, O otherwise.
