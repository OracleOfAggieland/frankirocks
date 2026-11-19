# Brief 052 report: the first meeting

Claude built Parts A, B and C from `052-first-meeting.md`. Kiro wrote none of it.

## Part A: the name in the Head (rulings 1 to 4)

**Built.**

- `packages/core/src/owner-name.ts` (new, exported through the package index): `ownerName`, the owner's own name, and
  `headAdmits`, the Head's own filter for one Memory (eligible at `project`, spoken grade, not S2, `headAdmitsSens`),
  which `compileHead` now also uses, so the two cannot drift. `headAdmitsSens` moved here from `head.ts` (still exported
  from `@franki/core`). Also `isSelfNameRow` and `restsOnlyOnFixture`.
- `packages/core/src/head.ts`: in a private audience, one more `now` line straight after `Now:`: `knownNameLine(name)`
  with the name Memory's ref, or `NO_NAME_LINE` with no ref. The promoted Memory's own `know` line is left out, and a
  self name resting only on fixture Evidence is left out while the owner's own name is known. `compileHead`'s ok result
  carries `ownerName: string | null`; nothing stored changes, and `HEAD_SECTIONS` is unchanged.
- `packages/server/src/head-build.ts`: `buildHead` returns `compileHead`'s result, so `ownerName` passes through. No new
  read: the Snapshot already holds every Evidence the Memories' `dependsOn` names.
- `packages/core/src/voice/lines.ts`: `MEET_LINE` and `MEET_AGAIN_LINE`, both in `FIXED_LINES`.

**Rulings.**

1. No new record kind, core-doc field, route or tool. The name is the existing `identity.alias` (`entityRef: "self"`)
   or `identity.name` (subject `self`).
2. `ownerName` picks from the rows that pass `headAdmits` for the compile's audience: a self alias or name, kind `fact`,
   value `text`, whose trimmed text matches `^[\p{L}\p{M} '’.-]{1,40}$`; alias first, then latest `assertedAt`, then
   smallest id. "Rests only on fixture Evidence" is read from the Snapshot: the row names at least one Evidence and all
   of them are `source: "fixture"`. A row is picked only when every Evidence it names is in the Snapshot and at least
   one is not fixture (a missing Evidence fails closed). The typographic apostrophe (’) is allowed beside the straight
   one, as names are often typed with it; say if it should go.
3. As ruled. The two texts are exactly the brief's.
4. As ruled.

**Tests.** `owner-name.test.ts` (examples plus an order-independence and best-row property, 300 runs),
`head-owner-name.property.test.ts` (the two lines exactly as ruled over generated Memories, audiences and caps; the
ref once; the drop order with the name line in `now`; fixture name beside an owner's own name), and two examples in
`voice/lines.test.ts` (Fixed_Lines, `quoteSafe` unchanged, a valid ack note). Written after the code, not red first.

## Part B: the opening line (rulings 5 and 6)

**Built.**

- `packages/server/src/meet.ts` (new): the two delivery rows (`meetRowId(1|2)` = `H("ledger","meet",n)`),
  `readMeetRows`, `meetOffer` (the ruling's conditions), `meetRule` (the Server_Rule input), `recordMeetSaid`,
  `closeMeet` and `meetSaidIn` (for Part C: the Session a said row names).
- `packages/server/src/routes/open.ts`: the rows are read by ID in the transaction's first round, beside the core
  documents. After the acknowledgment and the swap line had their turn, the meet line goes through `admitRule` as the
  open's `proactive`, and its row is created in the same transaction. An open whose Head has an owner name creates
  any missing row `met`. Since `proactive` is then set, the opening Moment is skipped by the check that already exists.
- `packages/core/src/admission.ts`: one optional `RuleInput` field, `meetLine`, and one Server_Rule row (see
  departures).
- The browser machine is unchanged. `voice/voice-meet.transitions.test.ts` shows the open's meet line plays exactly as
  the swap line does: HELD at the matching ack, one `response.create` with `sayExactly(line)` and no tools, and nothing
  when the Permit's hash doesn't match.

**Rulings.**

5. As ruled, with two departures below (the Server_Rule row, and sample visits).
6. As ruled, except the `met` state (below). A said row is `decision`, `state: "complete"`, `purpose: "proactive"`,
   `acceptedRefs: [the turn it was said as, under its Session; the Permit's decision]`. A met row is the same with
   `acceptedRefs: []`. A retried `requestId` replays the stored answer (the existing request replay). "Start over"
   clears the rows with the rest of the ledger; account delete removes `users/{uid}` recursively; a forget doesn't
   touch the ledger rows.

**Departures from the brief.**

- **The Server_Rule got a row.** No existing row can carry a line nobody asked for: the swap line comes from row 9 (a
  company hit) and the acknowledgment from row 11 (a forget hit). Reusing row 11 would have labelled the greeting a
  forget parse. So `RuleInput` gains `meetLine?: AckText`, set only by `meet.ts`, and the row right after row 1 gives
  `postCommitControl`, scope `ack`, notes `none`, with the line, in a private audience, and holds (`audience`)
  otherwise. The voice-control design's rule table (`.kiro/specs/voice-control/design.md`) does not list this row; I
  did not edit the spec.
- **No `met` ledger state.** `Ledger.state` is closed to `pending | complete | failed | blocked`, so a `met` row is a
  `complete` row that names no turn; `meetSaidIn` tells them apart. No schema change was needed.
- **Sample visits are not asked yet (contract question M-1, below).** `meetOffer` also needs `clockMode !== "fixture"`.
  The product rule "a visitor on a fresh sample visit is still asked" is therefore not built. The Head part is: a
  sample visit's Head says the owner hasn't given a name.

**Existing tests changed, and why.**

- `routes/open.test.ts`, "one transaction writes bundle and session": the first open's `proactive` is now the meet line,
  not null (the ruling's purpose).
- `testing/hero-offer.ts` (used by `offer-heard-to-the-end`, `receipt-sent`, `receipt-counts-only-sent`,
  `said-rows`, `said-row-only-on-match`), `routes/delivery-wire.test.ts` ("an open with nothing due"),
  `routes/open-audience.test.ts` (`rigWithCall`, and owner-1's open in "for another Owner's Session"),
  `admission/seam.test.ts` (two route tests), `routes/debug-memory.test.ts` (two tests): these test another opening line
  or the admission decisions on a fresh live account, where the meet line now takes the first two opens. They now start
  with the meeting over (`testing/meet.ts`, `meetAlreadyHappened`, which writes both rows `met` as an open with a known
  name does). The seam and debug tests also leave the two meet rows out of their decision counts (`meetRowIds`):
  the rows are `decision` ledger rows, so the debug panel lists them, as it lists the forget acknowledgment's.
- `apps/web/src/client/voice-client.test.ts` (`setup`) and `voice-client.mic.test.ts` (`setup`, now async): these drive a
  whole call against the real routes and wait for LISTENING; a first open now says the meet line first, so they timed
  out. They now start with the meeting over (`meetAlreadyHappened`).
- `worker/extract.test.ts`, "a Memory the packet's own correction closes…": the owner's name "Alex" is now the
  `knownNameLine("Alex")` line in `now`, not `- The owner's name is Alex.` in `know` (ruling 3). Found after Part A's
  commit; fixed in Part B's.

**Not changed, because a design document pins the opposite (M-1).** With the ruling built as written, the sample
visit's first two opens said the meet line, and these failed: `scripts/beat1-speaks-first.test.ts` (both suites),
`scripts/beat3-hero.test.ts` (four suites), `scripts/gate-food.test.ts` (F34, F35), `routes/delivery-wire.test.ts` (a
seeded clone's open says the wish first; the replayed open), `routes/receipt-moments.test.ts`,
`routes/audience-call-again.test.ts`, `routes/open-audience-any.test.ts`, `routes/delivery-never-breaks.property.test.ts`,
`time/held-reminder.test.ts`. They are untouched and pass with the gate.

## Part C: the short answer (ruling 7)

**Built.**

- `packages/core/src/extract.ts`: `ExtractPacket.pending` is `PacketPending | null` (the contract's
  `{id, rev, kind: PendingKind, rendered, optionIds}`); `buildExtractPacket` takes an optional `pending` and still sends
  null without one. `MEET_PENDING_RENDERED` ("What should I call you?", the tail of both meet lines) and
  `meetPending(rowId)` give the one pending code fills: `{id: rowId, rev: 1, kind: "identity", rendered, optionIds: []}`.
  `EXTRACT_GUIDE` gains one bullet straight after the owner's-name bullet: when `pending.kind` is `identity`, Franki
  had just asked what to call the owner, so a reply that gives a name ("Matt", "It's Matt.", "Matt Avila") is
  `identity.name` (`identity.alias` for a nickname) with the span on the name in the owner's words, and a reply that
  gives no name gives no name item.
- `packages/server/src/worker/extract.ts`: `meetPendingFor` fills `pending` for an owner's U user Turn at `seq` 1 or 2
  (`MEET_ANSWER_TURNS`; a Session's `nextClientSeq` starts at 1 and the turn route compare-and-sets it, so these are the
  owner's first two turns in it) when a meet row's `meetSaidIn` is that Session, and the Session has had a call. Null
  everywhere else. `currentTurn` reads the Turn once; `priorTurns` now takes that read as an optional argument, so a
  short reply does not read its Turn twice. The pending is passed to the packet only: it is not in `context`, so it is
  in no `contextIds`, `dependsOn` or `packetEids`, and the span rule (only `fields[0].text` is quotable) and the
  authority checks are untouched.

**Reads the worker adds.** Per extract job with a Session and Turn: one point read of its Turn (before, only a short
or pointing-back turn read it, inside `priorTurns`; now that read is shared). Only for a U user Turn at `seq` 1 or 2:
the two meet rows by ID, one batch. Only when one of them names this Session: one point read of the Session. Seeded
Evidence (no Session) reads nothing more. No queries are added, so no index.

**Departure.** The ruling keys the pending off the meet row's Session only. The worker also needs that Session to have
had a call (`callId` or `registeredCallIds`, as the turn route's `noCallOpen` reads it). Reading the code, a typed
Session's open goes through the same `openRoute`, so a typed-only owner's first open can record a meet row and carry
`MEET_LINE` as its `proactive`; the typed screen drops it (`showsOnScreen` needs `asks: false`), so nobody asked, and the
brief's test wants a typed turn with no call to carry null. Without the check that typed Session's first two turns
would carry the hint. **Finding for Part B (not changed here):** that typed open also consumes a meet offer the owner
never heard, against ruling 9 ("a typed-only owner is never asked") and the "at most twice" count. Not shown by a test;
read from `open.ts`, `typed-turns.ts` and `app-controllers.ts`.

**Tests** (`packages/server/src/worker/extract.meet.test.ts`, 14; red first: with the worker passing `pending: null`, the
7 that need the hint failed and the 7 null cases passed): the pending's fixed words and both meet lines ending in them;
the guide bullet's place; the first and second owner turn after `MEET_LINE` carry the identity pending and the third
null; after `MEET_AGAIN_LINE` the pending names row 2; null for no row, a row said in another Session, and rows closed
`met`; null for a typed-only Session with a meet row; null for seeded Evidence and for a turn with no Turn record; null
for an assistant Turn and a T Turn at `seq` 1; a scripted bare "Matt." gives `identity.name`, class U, active, its slice
on the owner's turn, depending only on that Evidence, and the next Head's "You're talking with Matt" line; with the
pending set and the owner saying "Sure.", a name item whose span quotes the hint, mismatches the owner's words, runs
past the turn, or names the meet line's turn writes nothing; the extract leaves the meet rows unchanged. No existing
test changed. The sample persona's seeded turns carry null by construction (their Evidence has no Session); the
existing extract suites (authority, lineage, backstop and the rest) pass unchanged.

**Not shown:** whether the real brain model files a bare name from the hint (no paid call was made;
`scripts/extract-check` was not run), and how a real owner answers.

## Contract questions

- **M-1. The sample visit's first open: the meet line or the wish?** Memory spec §15 (`docs/design/memory-spec-v3.md`,
  the demo table, 0:00 to 0:20) has the sample visit's first call open with Franki speaking first by `proactive`: "Good
  luck at 2. If the gap year comes up, you had a good answer Tuesday." Product rule 3 and ruling 5 have a visitor on a
  fresh sample visit hear "Hi, I'm Franki… What should I call you?" first, which takes the wish's place on the first two
  calls (the wish would come on the third), and the hero offer's with it. The beat 1 and beat 3 scripts pin the spec.
  Built: the meet line is held back on `clockMode: "fixture"` accounts (one condition in `meetOffer`, `sampleVisit`).
  Removing it builds the ruling as written; the scripts above would then need the owner's word on the demo order.
  Note also that "Start over" exists only for sample visits (a real account is never reset), so "after Start over the
  first open carries MEET_LINE again" can't happen while M-1 holds; the test checks that a reset clears both rows.
- **M-2. A Server_Rule row for the meet line** (`meetLine`, after row 1), not in the voice-control design's table.
- **M-3. `met` as a `complete` row with no turn ref**, not a new ledger state.
- **M-4. The ExtractV1 `pending.id` is a ledger row's ID, not a `pending/` document's.** The contract's `pending` slot
  names a pending question by `{id, rev}`; the `pending/` collection is not built, so the id is the meet row's
  (`meetRowId(n)`) and `rev` is 1. Nothing reads it back: the model is told to copy ids only from `open` or roster, and
  code builds `contextIds` itself.
- **M-5. A meet line said on a typed-only open** (Part C's departure above): should the open skip the meet line when no
  call will play it, so a typed open consumes no offer?

## What the tests cover, and what only a live call can show

Covered with fakes: the pick and the two Head lines (properties); the open's first and second offers under a Permit,
the third with none and delivery running; a known name closing both rows; a retried request; a blocked open; an owner
hold; a company-inherited open; a forget acknowledgment first; Start over clearing the rows; a saved then forgotten name
(a real forget on a live call, through the fakes) giving no meet line and the "hasn't told you" line after; a sample
visit not asked (M-1); the machine playing the line exactly.

Not shown: a real call hearing the line, how the realtime model follows the two Head lines, and how a real owner
answers. The meet line on a live account replaces the opening Moment on the first two calls, as ruled.

## Checks (Parts A and B)

Last runs before the Part B commit, on the Part B tree:

- `npm run typecheck`: 4 of 4 tasks successful.
- `npm run lint` (only `apps/web` has a lint script): 0 errors, 1 warning, the existing one in
  `apps/web/src/components/avatar/three/brass.ts` 113:107 (untouched).
- `npx vitest run --shard=1/3`: 247 files, 2,128 passed, 17 expected fail (after the voice-client fix; the run before it
  had 23 failures, all in `voice-client.test.ts`, which also failed alone and were the meet line, not load).
- `--shard=2/3`: 246 files, 1,915 passed, 2 expected fail.
- `--shard=3/3`: 246 files, 1,834 passed, 2 expected fail, 1 failed: `voice-client.mic.test.ts` "mic allowed at 8 s",
  which failed alone too (the meet line); fixed as above and passing alone (2 of 2). Shard 3 was not rerun whole.
- The harness moved each shard command to the background after 180 s; each was waited on to the end before the next.
- The emulator suite was not run (the director runs it).

## Checks (final, on the Part C tree)

Each run whole, one after another, on the tree that was committed:

- `npm run typecheck`: 4 of 4 tasks successful.
- `npm run lint -- --force`: 0 errors, 1 warning, the same existing one in `brass.ts` 113:107.
- `npx vitest run --shard=1/3`: 247 files passed, 2,128 passed, 17 expected fail, 0 failed.
- `--shard=2/3`: 247 files passed, 1,929 passed, 2 expected fail, 0 failed (it holds the new
  `extract.meet.test.ts`, 14).
- `--shard=3/3`: 246 files passed, 1,835 passed, 2 expected fail, 0 failed. This whole run supersedes the Part B
  shard 3 run above.
- The emulator suite was not run (the director runs it). No paid model call was made.
