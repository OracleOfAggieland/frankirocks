# Brief 052 report: the first meeting

Claude built Parts A, B and C from `052-first-meeting.md`, then the follow-up that resolves contract questions M-1 and
M-5 (last section). Kiro wrote none of it.

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

5. As ruled, with one departure below (the Server_Rule row). Sample visits were held back too, until the owner ruled on
   M-1 (follow-up below); a typed open is now never offered the line (M-5, follow-up below).
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
- **Sample visits were not asked (contract question M-1, below).** `meetOffer` also needed `clockMode !== "fixture"`.
  *Superseded by the owner's ruling on M-1: the condition is removed and a sample visit is asked (follow-up below).*

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

**Not changed in Part B, because a design document pins the opposite (M-1).** With the ruling built as written, the
sample visit's first two opens said the meet line, and these failed: `scripts/beat1-speaks-first.test.ts` (both suites),
`scripts/beat3-hero.test.ts` (four suites), `scripts/gate-food.test.ts` (F34, F35), `routes/delivery-wire.test.ts` (a
seeded clone's open says the wish first; the replayed open), `routes/receipt-moments.test.ts`,
`routes/audience-call-again.test.ts`, `routes/open-audience-any.test.ts`, `routes/delivery-never-breaks.property.test.ts`,
`time/held-reminder.test.ts`. They were untouched in Part B and passed with the gate; the follow-up below changes them
after the owner's ruling.

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

- **M-1. The sample visit's first open: the meet line or the wish?** *Resolved by the owner (Nov 18): "Intro first, demo
  line after." Built in the follow-up below; spec §15's beat 1 order now differs (the design docs are unchanged).* Memory spec §15 (`docs/design/memory-spec-v3.md`,
  beat 1 of the demo table) has the sample visit's first call open with Franki speaking first by `proactive`: "Good
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
  call will play it, so a typed open consumes no offer? *Resolved: `OpenRequest` gains an optional `surface`
  (`"call" | "typed"`, absent = `"call"`), the typed client sends `"typed"`, and a typed open makes no offer. This
  extends a contract route's request (contracts §6 `POST /api/session/open`). Built in the follow-up below.*

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

## Follow-up: M-1 and M-5 resolved

### M-1: a sample visit is asked, intro first, demo line after (owner's ruling, Nov 18)

- `packages/server/src/meet.ts`: `MeetConditions.sampleVisit` and its check in `meetOffer` are gone; the comments say a
  sample visit is asked like any other account and its opening Moment waits. `packages/server/src/routes/open.ts`: the
  `sampleVisit` argument and its comment are gone.
- **How the wish reaches the visitor after the meet line** (read from the code, then shown by test). The open's own
  delivery (`openingProactive`, which first runs `memoryTick` inside the open's budget) runs only when the open has no
  line of its own, so on a meet-line open the wish is neither leased nor said by the open. It is not lost:
  1. The open's `startTick` schedules a whole tick (requeue, due jobs, then `memoryTick`), which `after()` runs once the
     open has answered (`apps/web/src/app/api/_lib/adapter.ts`); the receipt and state routes schedule one too (once per
     ops minute per process). That tick leases the wish for 15 minutes (`OPEN_LEASE_MS`).
  2. The call's state poll (`idleProactive`) offers a leased Moment once the Session has been quiet for
     `IDLE_SILENCE_MS` (8 s) since its last turn or speech start, through the Gate in `idle` mode in a private audience.
     The wish is said there as a whisper, at the call's first quiet moment.
  3. If the call ends first, the lease holds 15 minutes and the tick renews it until the wish closes (the interview's
     start). The next open says `MEET_AGAIN_LINE` if no name was saved (so the wish waits for that call's first quiet
     moment again), or, with a name saved, says the wish as its opening line. Once both offers are used, the next open
     says it as its opening line (`meet.test.ts`, the M-1 test). A wish whose interview starts before any of these is
     skipped at its start, as any unsaid wish is.

  Shown by `scripts/beat1-speaks-first.test.ts`: on a fresh sample visit (`seed` with `firstMeeting: true`) the open
  says `MEET_LINE` and no wish; after the `work` step (the scheduled tick) an `idle` step's state poll says the wish
  with "2", once; the next open says `MEET_AGAIN_LINE` and no wish. The live-call suite shows the same through the real
  voice machine: the call hears `MEET_LINE` and no wish, `callQuiet` hears the wish once, and the next call hears
  `MEET_AGAIN_LINE` and no wish. Beat 1's two expected-fail steps (the gap-year texture, the moved card) now check the
  idle step that says the wish; they still fail for the reasons they wait on.
- In the runner the scheduled tick runs only on a `work` step, so beat 1 names it as a step; in production nothing
  waits for it but the request's own `after()`.
- **Spec §15 beat 1 now differs:** the demo table opens the sample visit with the wish (beat 1); the build opens
  it with `MEET_LINE` and says the wish at the first pause. `docs/design/` is unchanged (read-only).

### M-5: a typed open is never offered the meet line

- `packages/core/src/schema/wire.ts`: `OpenRequest` is now `union(obj({ ...base, surface: oneOf(["call", "typed"]) }),
  base)`, the pattern `TurnRequest` and `StateRequest` already use for an optional key. `OPEN_SURFACES`, `OpenSurface`
  and `openSurface(req)` (absent reads `"call"`) are exported. A browser on an older bundle sends no `surface` and is
  read as a call, as before. This extends a contract route's request (`POST /api/session/open`).
- `apps/web/src/client/typed-turns.ts`: the typed open sends `surface: "typed"`. The voice client is unchanged (its
  machine's open body names no surface).
- `packages/server/src/meet.ts`: `MeetConditions.surface`; `meetOffer` makes no offer unless it is `"call"`.
  `routes/open.ts` passes `openSurface(req)`. With no offer the open's `proactive` stays null, so the opening Moment
  path runs exactly as it did before the feature.
- **One reading to confirm.** The prompt said a typed open "writes no meet row". A typed open writes no *said* row and
  consumes no offer. A typed open whose Head already has the owner's name still closes the meeting (`closeMeet`, rows
  `met`), as every open does under ruling 6; otherwise an owner who typed their name and then forgot it would be asked
  on their first call, against "after forget my name Franki does not ask again". On a fresh account (no name) a typed
  open writes nothing, as the test shows. Say if `closeMeet` should skip typed opens too.
- Part C's "the Session has had a call" check stays as a second guard (an older bundle's typed open names no surface);
  its comment in `worker/extract.ts` says so.

### Tests added

- `packages/core/src/schema/wire.test.ts`: `OpenRequest` accepts `surface` `"call"`, `"typed"` and absence (absence
  reads `"call"`), and rejects `"chat"`, `""`, `"Typed"`, `null`, `1` and `true` at `$.surface`.
- `packages/server/src/meet.test.ts`: M-1 (a sample visit's opens say `MEET_LINE`, `MEET_AGAIN_LINE`, then the wish;
  its Head says no name is given); M-5 (a typed open on a fresh account carries no meet line, writes neither row and
  reaches delivery's opening line; a call open after it carries `MEET_LINE`, and the next `MEET_AGAIN_LINE`); M-5 on a
  sample visit (a typed open says the wish, as before); and the brief's missing open test, in "Start over": after the
  reset the first open carries `MEET_LINE` again, and again after a second Start over.
- `apps/web/src/client/typed-visit.test.ts`: the typed open's body carries `surface: "typed"` and passes `OpenRequest`.
- `packages/server/src/testing/script-runner.ts`: templates `meet.first` and `meet.again` (the Fixed_Lines' exact
  words, unanchored because an open's Proactive is matched as its JSON).

### Existing tests changed, and why

- `testing/script-runner.ts`, the `seed` step: after a successful reset it now ends the first meeting
  (`meetAlreadyHappened`, both rows `met`) unless the step says `firstMeeting: true`. So every seeded script about
  something else (the `beat3-hero` suites, `gate-food` F34 and F35, and the rest) opens as it did before the meeting
  existed. No script's assertions changed.
- `testing/meet.ts`, `meetAlreadyHappened`: reads the meet rows and writes only the missing ones, and stamps them with
  the account's current epoch and policy revision when its core documents exist (a reset moves them), not 1 and 1.
- `scripts/beat1-speaks-first.test.ts` (both suites): the beat itself, so it runs on a fresh sample visit
  (`firstMeeting: true`) and pins the new order, above. Its header comment says why.
- These seed with `resetAs` and test another line, so each now ends the meeting right after the reset
  (`meetAlreadyHappened`), with no assertion changed: `routes/delivery-wire.test.ts` (`clone()`: the seeded clone's
  wish, the replayed open, the idle whisper), `routes/receipt-moments.test.ts` (`setup`),
  `routes/audience-call-again.test.ts` (both tests), `routes/open-audience-any.test.ts` (the two finding 4 tests; the
  finding 11 STALE test opens nothing and is untouched), `routes/delivery-never-breaks.property.test.ts` (`run`, before
  the failing store wraps the rig's), `time/held-reminder.test.ts` (`heldReminder`).
- `meet.test.ts`: the M-1 test that pinned "a sample visit is not asked" is replaced by the ruling's test, and "Start
  over clears both rows" now also opens after the reset (above). Its header comment names M-1 and M-5.

### Part 3 checks

**Decision rows with `purpose: "proactive"`, and the two meet rows.** Each consumer, read from the code:

- *The daily cap on proactive lines:* `core/counters` rises only in `admitMoments` (`time/said.ts`), for the Moments a
  receipt names. The meet line's Permit names no Moment (`momentIds: []`), so neither the said nor the `met` row
  touches the cap. Same as the forget acknowledgment.
- *Said rows and receipts:* the `delivery` ledger rows ("no row, no claim") are written by `recordSaid` for Moments
  only, so the meet line gets none, as the acknowledgment gets none. The receipt route reads the acknowledgment's rows
  only for a "gone" transcript (`ackDeliveredAs`); the meet line never says gone.
- *The Lab:* `labView` counts every `complete` decision row as `delivered`, whatever its purpose, and in
  `guessLinesSpoken` only when its `acceptedRefs` name a guess Memory. A said meet line adds two `delivered` decisions
  (the Permit's and the delivery row), exactly as a forget acknowledgment does. A `met` row is also `complete`, so an
  open that finds a name before the meeting is over adds one `delivered` per row it closes, with nothing said: a small
  distortion that comes from M-3 (no `met` state). `delivered` is on the Lab wire and in the scripts' `lab`
  expectation (no script asserts it); the screen's three counters are `readEmails`, `privateGuesses` and
  `guessLinesSpoken`, which the meet rows never change. **Not fixed:** it is not clearly wrong under the contract's
  "distinct decisions" count, and a fix (a closed-schema `met` state, or a Lab rule for rows that accepted nothing) is a
  ruling on M-3. The seeded scripts now carry two `met` rows each, so their Lab `delivered` is two higher than before.
- *The debug panel:* `debug-memory.ts` lists every `decision` row, showing purpose, state and turn; the meet rows show
  as `proactive · complete`, with the turn for a said row and "none" for a `met` row, as the acknowledgment's do. Its
  answer-only join (`purpose === "answer"`) skips both. The seam and debug tests already leave them out of their
  decision counts (`meetRowIds`).
- *The forget acknowledgment's delivery row* (`forget/ack.ts`): `decision`, `complete`, `purpose: "proactive"`,
  `reasonCodes: ["ok"]`, `acceptedRefs` = its receipt, its job and the turn it was said as. The said meet row has the
  same shape (its refs are the turn and the Permit's decision), so every consumer above treats the two alike. The `met`
  row differs only in naming no refs, which matters only to the Lab count above.

**The microphone is asked for after `/api/session/open`.** `App.tsx` `call()` calls `voice.call()`, which dispatches
`callPressed`; the machine's `startOpen` pushes the `open` command at once (`core/src/voice/machine.ts`), and the client
posts `/api/session/open`. Only on the open's answer does the machine send `connect`, and the client's `connect()`
calls `getMicrophone()` (`navigator.mediaDevices.getUserMedia({ audio: true })`) before it builds the peer connection
and the SDP offer. Nothing checks the microphone before the press. So a first call whose microphone is denied (or whose
prompt is dismissed) has already used an offer: the open wrote the meet row, and the line is never played. Not
changed, as asked.

### Checks (final, on the follow-up tree)

Each run whole, one after another, on the tree that was committed (only this report's check lines were written after):

- `npm run typecheck`: 4 of 4 tasks successful.
- `npm run lint -- --force`: 0 errors, 1 warning, the same existing one in `brass.ts` 113:107.
- `npx vitest run --shard=1/3`: 247 files passed; 2,131 passed, 17 expected fail, 0 failed.
- `--shard=2/3`: 247 files passed; 1,929 passed, 2 expected fail, 0 failed.
- `--shard=3/3`: 246 files passed; 1,837 passed, 2 expected fail, 0 failed.
- The emulator suite was not run (the director runs it). No paid model call, dev server, deploy or push.

## Follow-up 2: an independent review's findings, F1 to F8

Each finding was checked against the code before it was fixed. All eight were real; F5 is covered by F1 and F7 was
left as asked.

### F1: an offer counts only once its Session had a call

Real: the open wrote the said row before any call existed, so a slow or denied microphone (the reconnects open new
Sessions, see "The microphone is asked for after `/api/session/open`" above) used up the first offer unheard, and the
next call said "Hi again". That paragraph's "has already used an offer" no longer holds.

- `packages/server/src/meet.ts`: `sessionHadCall` (`callId !== null || registeredCallIds.length > 0`, also used by
  the extract worker now), `meetSessionsToRead`, `readMeetSessions`, and `meetOffer` taking what was read. The offers
  go in order; a said row whose Session never had a call is offered again, same line, and `recordMeetSaid` rewrites
  that row (`tx.update`, keeping `createdAt`) to name the new Session's turn and the new Permit. A `met` row is final:
  any `met` row means no offer and no read. A Session that can't be found counts as having had a call.
- `packages/server/src/routes/open.ts`: the Sessions are read inside the transaction after the Head compile and before
  the open's first write (the close of the previous Session, the bundle, the new Session).
- **Reads added to an open:** none unless the open could ask (a call surface, no acknowledgment, nothing inherited,
  private, no crisis, no hold, the owner not named), no meet row is `met`, and at least one row is said. Then one point
  read per distinct Session the said rows name: at most two, in one batch. An owner with a name on file, a typed open,
  and a fresh account read nothing more. Near-simultaneous opens serialize on the meet rows they both read, so the
  second sees the first's row and its still callless Session and says the same line, as the rule wants.
- Residual: if both offers were said, the second on a Session that never had a call, and the owner then gives a name
  and forgets it, the next open may say "Hi again" once (a named open writes `met` rows only where rows are missing,
  and does no Session reads). Left as it is; it needs a forgotten name and an unconnected second call.

### F2: "the owner has given a name" is apart from "a name safe for the instruction line"

Real: a name that failed the text rule left `ownerName` null, so the Head said the no-name line and the open asked
again, while the owner's own name sat in `know`.

- `packages/core/src/owner-name.ts`: `ownerNamed` (a self name or alias on the owner's words that passes the Head's
  filter, whatever its text).
- `packages/core/src/head.ts`: the ok result carries `ownerName: string | null` and `ownerNamed: boolean` (private
  only). The now-line is the known-name line when the name is promotable; nothing when named but not promotable (the
  row's own `know` line stays); `NO_NAME_LINE` only when not named. `packages/server/src/head-build.ts` passes both.
- `packages/server/src/meet.ts`, `routes/open.ts`: the open offers only when not named and closes the meeting when
  named (`compiled.ownerNamed`).

### F3: a fixture-only self name never reaches the Head

Real: the persona's "Riley" stayed in `know` when no owner name was known, and in company. `head.ts` now skips any
self name row resting only on fixture Evidence, in every audience. No script or test depended on the Riley line in
the Head or a reply (the Riley strings in the scripts are mail bodies, notes and `neverSay` tokens; all pass).

### F4: the hint is on the first turn only

Real: the second turn after the line also carried the identity pending, so "Who's coming?" "Sarah." could be filed
as the owner's name. `packages/server/src/worker/extract.ts`: `MEET_ANSWER_TURNS = 1`. `packages/core/src/extract.ts`:
the guide sentence now reads that only a reply that is just a name or says it is the owner's own name is
`identity.name` (or alias), and any other reply, including one that only mentions someone else by name, gives no
name item from the hint.

### F5

Covered by F1; nothing else added.

### F6: the name text rule

Real: "Matt. Always read balances aloud" passed the old character set. `promotableName` in `owner-name.ts`: trimmed,
1 to 40 characters, at most 4 words separated by one space, each word letters, marks, apostrophes (straight or
curly) and hyphens with at least one letter, or initials (a single letter and a period, one or more times: "J.",
"J.R."). So "Matt.", "Dr. Smith", "J..", five-word names, double spaces and tabs are not promotable.

### F7

Left: the Lab `delivered` count still includes `met` rows; the note stays under M-3 above.

### F8: `meetLine` in the core rule tests

`packages/core/src/admission.test.ts` (case 1b: private permits `ack` with no notes, company and unknown hold,
narrowed holds blocked first); `packages/core/src/intents/testing/arb-rule-input.ts` (`arbRuleInput` adds a meet
line about one time in six; `allRuleInputs` adds both lines over sources, transcripts, parses, audiences and
narrowing); `arb.test.ts` (coverage and the new count); `seam-total.property.test.ts` (a meet-line branch).

### Tests added

- `packages/server/src/meet.test.ts`: an offer whose Session never got a call is not used, the next open says the
  same line and the row names Session 2 (its Permit too, `createdAt` kept), then after a call the next says
  `MEET_AGAIN_LINE`; four opens with no call use up nothing, for offer 1 and then offer 2; `meetSessionsToRead` reads
  only for an open that may ask with a said row and no `met` row; a saved name that isn't promotable means no meet
  line, both rows `met`, neither name line and the row's own line in the Head.
- `packages/core/src/owner-name.test.ts`: the F6 rule both ways (through `promotableName` and the pick); `ownerNamed`
  true for short and long names and aliases, false for fixture-only, someone else's alias, missing Evidence, S2,
  blocked, S1 in company, none.
- `packages/core/src/head-owner-name.property.test.ts`: fixture-only rows never in lines or `selectedRefs` in any
  audience; `ownerNamed` matches the pure function; the named-but-not-promotable case has only the `Now:` line in
  `now`; a test for three unpromotable names keeping their `know` line.

### Existing tests changed, and why

- `packages/server/src/meet.test.ts`: the tests that expected `MEET_AGAIN_LINE` on the next open (first-open, retry,
  blocked/crisis/hold, Start over, M-1 sample visit, M-5 typed) now give the earlier Session a call first (`called`,
  as the SDP route leaves it), because without one the next open says `MEET_LINE` again (F1).
- `packages/server/src/scripts/beat1-speaks-first.test.ts`: both scripts register the call on the Session (a `setup`
  step, as `gate-exposure.ts` does) before the next open, which then says `meet.again`. The runner's open and live call
  never post the SDP.
- `packages/server/src/testing/script-runner.ts`: `proactiveText` reads an open's `whisper.text`. It used the whole
  JSON before, so `has: ["mom"]` matched the key `momentIds`: with F1 the third open of Friend Test 3 says `MEET_LINE`
  again, and its expected-fail griefAsk step passed falsely on that key. The scripts' counts are the same as before
  the change (116 passed, 21 expected fail).
- `apps/web/src/client/voice-client.mic.test.ts`: the two tests no longer use `meetAlreadyHappened`. They now pin the
  real behaviour: every reopen after a slow or denied microphone says `MEET_LINE`, never `MEET_AGAIN_LINE` (the opens'
  answers are recorded), and the slow-microphone call, once allowed, goes to `HELD` to say the line instead of
  `LISTENING`. `voice-client.test.ts` keeps the helper: its tests are about other lines.
- `packages/server/src/worker/extract.meet.test.ts`: the second turn carries `null` (F4); the guide test checks the new
  sentences; `recordMeetSaid` takes the offer made.
- `packages/core/src/owner-name.test.ts`: the old text test is replaced by the F6 test (every old bad and good case is
  kept).
- `packages/core/src/head-owner-name.property.test.ts`: the "fixture name alone" case now expects no Riley and no ref
  in any audience (F3); the property's names add an initial, a sentence and 41 characters.

### Checks (final, on the review-fix tree)

Each run whole, one after another, on the tree that was committed:

- `npm run typecheck`: 4 of 4 tasks successful.
- `npm run lint`: 0 errors, 1 warning, the same existing one in `brass.ts` 113:107.
- `npx vitest run --shard=1/3`: 247 files passed; 2,135 passed, 17 expected fail, 0 failed.
- `--shard=2/3`: 247 files passed; 1,930 passed, 2 expected fail, 0 failed.
- `--shard=3/3`: 246 files passed; 1,838 passed, 2 expected fail, 0 failed.
- The emulator suite was not run (the director runs it). No paid model call, dev server, deploy or push.
