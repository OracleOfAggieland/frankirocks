# Memory: eligibility, revisions and the read side

What Franki may use or say is decided in code from stored records. Rules: `.kiro/steering/memory-rules.md`, and for the write side `.kiro/steering/memory-writes.md`. The write side's machines (status moves, the FastSlots call, hard-rule slots, the bundle state) are the last four blocks.

### `memory.eligible`

| Field | Value |
|---|---|
| Status | explicit |
| File | `packages/core/src/eligible.ts` |
| Decides | `eligible` |
| State | `ER`, `EligibilityReason`, `EC`, `Snapshot` |
| Tests | `packages/core/src/eligible.test.ts`, `packages/core/src/eligible.context.test.ts`, `packages/core/src/eligible.row-epoch.property.test.ts`, `packages/core/src/eligible.row-policy-rev.property.test.ts`, `packages/core/src/eligible.row-stamp.property.test.ts`, `packages/server/src/routes/policy-rise.test.ts` |

`eligible(x, c, s)` is the one decision whether a Memory or Evidence row may be used for a verb at a stage. Pure: no clock, store, network or global state, and identical inputs give an identical `ER`. Invalid or missing input answers `{ allow: false, reason: "ineligible" }` and never throws. The Head compiler and recall read Memory rows through it.

Freshness (its clause 5) has two halves. The read's context must be current: a context whose `epoch` or `policyRev` differs from `core/epoch` is denied `freshness`. The row is compared on its `epoch` only: a row below the context's epoch is denied `freshness`, so forget, which raises the epoch, still fences what was stored before it. A stored row's own `policyRev` records when it was written and is not compared, so a `policyRev` rise does not hide a Memory stored before it, from recall or from the next Head. The ruling is CQ 162 in `docs/briefs/012-design.md`. `eligible.context.test.ts` pins the context half; `eligible.row-epoch.property.test.ts` and `eligible.row-policy-rev.property.test.ts` state the two row halves over Memory rows, and `eligible.row-stamp.property.test.ts` states both over every Memory and Evidence status, class and dirty flag. `routes/policy-rise.test.ts` raises `policyRev` through a late forget on a Superseding_Post and on a Parse_Repair, then checks that recall in the same call still reads the stored Memory and that the next Head holds it.

The browser generation, foreground generation and worker revision checks that follow (clauses 6 to 8) are unchanged.

### `memory.parseGap`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/audience.ts` |
| Tests | `packages/server/src/parse-gap.property.test.ts`, `packages/server/src/intents/repair.test.ts` |

Three fields of the Session decide whether the room is trusted:

| Field | Meaning | Written by |
|---|---|---|
| `audience` | The stored audience | `expireLease` and `failedParseEffect` (to `unknown`), a parsed `alone` |
| `parseLease` | A Turn whose parse failed and may still be repaired, with a token and an end time | `failedParseEffect` opens it (`REPAIR_LEASE_MS`, or `MISSING_LEASE_MS` for a missing transcript); a repair that commits clears it |
| `committedParseSeq` | The parse watermark | `/api/turn`; `advancedWatermark` after a late parse |

`effectiveAudience` is `unknown` while a lease is held, without changing the stored value, so a repair that succeeds leaves no trace. A lease that ran out is a failed repair: the next request that sees it stores `unknown` and clears the lease. A Parse_Gap is `committedParseSeq < lastClientSeq`. The state route answers `ack: null` while the audience is `unknown`, a gap exists, or an S2 user Turn is among the last four, and `ack: null` refuses `fastO` in the browser.

### `memory.epoch`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/core-docs.ts` |
| Tests | `packages/server/src/core-docs.test.ts` |

`core/epoch` holds the epoch, `policyRev`, the forget barrier and the active Session. `ensureCoreDocs` creates it with the other four core documents in one transaction. Its writers on this branch:

| Writer | Changes |
|---|---|
| `packages/server/src/routes/open.ts` (`openSession`) | `activeSessionId` to the new Session, `activeCallId` to null |
| `packages/server/src/sessions.ts` (`beginCloseInTx`) | clears `activeSessionId` and `activeCallId` when they name the closing Session |
| `packages/server/src/routes/turn.ts`, a Superseding_Post with a hit that changes what is said | `policyRev + 1` |
| `packages/server/src/intents/repair.ts` (`runParseRepair`), a repaired hit that cuts | `policyRev + 1` |
| `packages/server/src/seed/reset.ts` (`resetVisit`) | `barrier` up and through its phases (see `memory.forget`); at the end `seedCoreDocs` writes `epoch + 1`, `barrier` null, `activeSessionId` and `activeCallId` null, `policyRev` kept |

These two are the only places that raise `policyRev`, each behind `changesWhatIsSaid`; `scripts/policy-rev-raises.test.ts` fails when another appears. No write, proposal, the repair's hardRule route or the extraction backstop raises it (`.kiro/steering/memory-writes.md`).

A raised `policyRev` is the counter that cancels speech, Decks and work in flight. It makes every Deck issued before it lower than the next one, so the browser cancels older speech; the browser's `fastO` refuses an ack whose revisions differ from the Deck; and an Extract_Job written before the raise is requeued at the new `policyRev`, while one whose epoch changed fails `STALE` (see [server-jobs](server-jobs.md)). It does not hide stored rows: `memory.eligible` compares a row on its epoch only.

### `memory.forget`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/schema/records.ts` |

`core/epoch.barrier` is null or a forget in progress, whose `phase` is one of `fence`, `close`, `resolve`, `install`, `closure`, `resume`, with a deadline and up to 32 queued control operations. While it is not null, session open answers `blocked`, and the state, turn and tool routes refuse with the barrier error. No forget code moves through these phases yet. The seed reset (`packages/server/src/seed/reset.ts`, brief 019) is the one writer that raises it: `fence` when it starts, `close` while it closes Sessions and hangs up calls, `install` while it clears and reloads the tenant, then null in the transaction that writes the clone's core documents. It never uses `resolve`, `closure` or `resume`. A barrier held by another operation, or by a reset still inside its `RESET_BARRIER_MS` deadline, refuses the reset with the barrier error; the reset takes over only its own tenant's crashed reset after the deadline. `initialCoreDocs` writes it null.

### `memory.head`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/head-build.ts` |
| Tests | `packages/core/src/head.test.ts`, `packages/core/src/head.property.test.ts` |

The Head is compiled at session open only: `buildHead` reads every Memory and the Evidence it depends on from a lock-free snapshot and runs the pure `compileHead` (`packages/core/src/head.ts`). Open writes it to `core/bundle` with `bundleRev + 1`, and every Deck of the Session carries it. A Memory committed after that snapshot reaches the Head at the next open.

### `memory.recall`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/routes/tool.ts` |
| Tests | `packages/server/src/routes/tool.test.ts` |

One `/api/tool` call is a pipeline with these answers:

| Answer | When | Recorded |
|---|---|---|
| `stale` | the Stamp is not current, or the Session is not `minting` or `active` | no (`Unrecorded`) |
| `hold` | the Turn's parse has not committed within `PARSE_WAIT_MS`, polled every `PARSE_POLL_MS` | no (`Unrecorded`) |
| `ready` with a result and a Permit | the Admission_Seam issued the continuation's Permit over the result: notes from a model read within `RECALL_DEADLINE_MS`, code-ranked excerpts of the same lines if it failed or ran late, or no notes when the Turn's own words ask for nothing to recall; notes above S0 are dropped unless the Server_Rule allows them | yes |
| `hold` with a Deck | the seam issued no Permit | yes |

### `memory.assistantTurn`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/routes/receipt.ts` |
| Tests | `packages/server/src/routes/receipt.test.ts` |

A `transcript` receipt writes Franki's words as an assistant Turn with ID `H("aturn", sessionId, responseId)` and `seq = Session.nextClientSeq - 1`, and its Evidence of class M, in one transaction; no Extract_Job is written, so assistant words never become Memories. A repeated transcript for the same response writes nothing new. A receipt whose Stamp is not current is answered `accepted: false` and writes nothing. In the browser, `voice.call` sends one transcript receipt per response at `response.done`, or when the response leaves `recent`, at hang-up, or when the connection is lost.

### `memory.spokenTime`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/dates.ts` |

`resolveSpoken(spoken, spokenAtMs, zone)` is the pure resolver that turns the words said into one civil day (and a time, when one was said), or null when the words do not name exactly one day it can be sure of. A null keeps the spoken words and the day they were said. The resolved day is computed from the moment the words were spoken.

### `memory.status`

| Field | Value |
|---|---|
| Status | table |
| File | `packages/core/src/writes/status.ts` |
| Decides | `statusTransition` |
| State | `MemoryStatus` in `packages/core/src/writes/types.ts` |
| Events | `StatusEvent` in `packages/core/src/writes/types.ts` |
| Tests | `packages/core/src/writes/plans.test.ts`, `packages/core/src/writes/error-never-history.property.test.ts` |

The only code that decides a Memory's next status when a correction (`correct`) or a change (`transition`) names it. A file-private table typed `Record<MemoryStatus, Record<StatusEvent, ...>>`, read by `statusTransition`; a pair it does not hold answers `refuse`. A correction marks any `active`, `scheduled`, `history` or `alleged` row `wrong`, never `history`. A change moves `active` and `history` to `history`, and refuses `scheduled` and `alleged`. A `wrong`, `retracted` or `blocked` row refuses both, so an error never comes back.

### `memory.slots`

| Field | Value |
|---|---|
| Status | explicit |
| File | `packages/core/src/writes/slots-phase.ts` |
| Decides | `nextSlots`, `initialSlots` |
| State | `SlotsPhase` in `packages/core/src/writes/types.ts` |
| Events | `SlotsEvent` in `packages/core/src/writes/types.ts` |
| Tests | `packages/core/src/writes/slots-phase.test.ts`, `packages/core/src/writes/slots-phase.property.test.ts` |

The FastSlots call of one request: when it starts and when it settles. `initialSlots(regex)` starts `idle`, with whether the final transcript matched the regex rules. In `idle`, `ready` (the request is new and its context is read) and `parsed` update what is known. Once the context is read, a regex match, an asked question or a route candidate starts the call, in that order of precedence, with its deadline `FAST_SLOTS_DEADLINE_MS` from that event (`start: true` is returned once). With the context read and a parse that found nothing, no regex match and nothing asked, the call is `notNeeded`. A `running` call settles on its answer, or on a deadline event at or past its deadline as a timeout. `settled` and `notNeeded` never change. A replayed request never reaches `ready`, so it never calls FastSlots.

### `memory.ruleState`

| Field | Value |
|---|---|
| Status | explicit |
| File | `packages/core/src/writes/rule-state.ts` |
| Decides | `ruleTransition` |
| State | `RuleSlot` in `packages/core/src/writes/types.ts` |
| Events | `RuleEvent` in `packages/core/src/writes/types.ts` |
| Tests | `packages/core/src/writes/hard-rule.test.ts` |

One hard-rule slot, keyed by subject (or anonymous) and code: `absent`, `pending` or `active`. `ruleTransition` returns the next slot and the outcome, or a refusal. From `absent`, an affirm writes the rule `active` and an unsure answer writes it `pending`; a denial is recorded and the slot stays `absent`. From `pending`, an affirm makes it `active`, an unsure answer keeps it, and a denial clears it. An `active` rule is kept whatever voice says: voice never relaxes it. `superseded` (a firmer rule on another slot answers this one) clears only a `pending` slot and is refused otherwise. A trusted tap is refused (`tapOnly`): removal by tap is not built.

### `memory.bundle`

| Field | Value |
|---|---|
| Status | explicit |
| File | `packages/core/src/writes/bundle.ts` |
| Decides | `bundleAfter` |
| State | `BundleState` |
| Events | `BundleEvent` |
| Tests | `packages/core/src/writes/plans.test.ts` |

The only code that decides `core/bundle.state`. `bundleAfter(prev, event)`: a compiled Head is `clean`; a failed compile or a burned bundle is `dirty`, the old Head stays and writes still commit; `blocked` stays `blocked` whatever the event, since only forget is meant to leave it.
