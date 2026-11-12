# Memory: eligibility, revisions and the read side

What Franki may use or say is decided in code from stored records. Rules: `.kiro/steering/memory-rules.md`. The memory write side (on-turn slots, hard rules, corrections, status moves) is being built on another branch; its machines are listed here as `planned`.

### `memory.eligible`

| Field | Value |
|---|---|
| Status | explicit |
| File | `packages/core/src/eligible.ts` |
| Decides | `eligible` |
| State | `ER`, `EligibilityReason`, `EC`, `Snapshot` |
| Tests | `packages/core/src/eligible.test.ts` |

`eligible(x, c, s)` is the one decision whether a Memory or Evidence row may be used for a verb at a stage. Pure: no clock, store, network or global state, and identical inputs give an identical `ER`. Invalid or missing input answers `{ allow: false, reason: "ineligible" }` and never throws. The Head compiler and recall read Memory rows through it.

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

A raised `policyRev` makes every Deck issued before it lower than the next one, so the browser cancels older speech. An Extract_Job written before the raise is requeued at the new `policyRev`; one whose epoch changed fails `STALE` (see [server-jobs](server-jobs.md)).

### `memory.forget`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/schema/records.ts` |

`core/epoch.barrier` is null or a forget in progress, whose `phase` is one of `fence`, `close`, `resolve`, `install`, `closure`, `resume`, with a deadline and up to 32 queued control operations. While it is not null, session open answers `blocked`, and the state, turn and tool routes refuse with the barrier error. On this branch the barrier is only ever written as null (`initialCoreDocs`); the phases are listed in this order in the schema, and no code moves between them yet.

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
| Status | planned |
| File | `packages/core/src/writes/status.ts` |

The table of allowed Memory status moves, read by one transition function.

### `memory.slots`

| Field | Value |
|---|---|
| Status | planned |
| File | `packages/core/src/writes/slots-phase.ts` |

The on-turn slot reader's phase, as a pure step.

### `memory.ruleState`

| Field | Value |
|---|---|
| Status | planned |
| File | `packages/core/src/writes/rule-state.ts` |

A pending hard rule's state until its slots are answered.

### `memory.bundle`

| Field | Value |
|---|---|
| Status | planned |
| File | `packages/core/src/writes/bundle.ts` |

The bundle state a write leaves behind, and when the Head must be rebuilt.
