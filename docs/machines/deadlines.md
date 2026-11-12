# Deadlines: the ladder

Many limits nest: a server route answers inside its budget, the browser's request times out a little later, and the call's own wait sits outside both. This page lists those limits by request, with their values on this branch, so a change to one can be checked against its neighbours. The values are exported constants; the page names the constant, never a copy of the number alone.

### `time.deadlines`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/voice/machine.ts` |

Every limit counts on an opsClock (the browser's in `machine.ts` and the client files, the server's in `packages/server`), never the wall clock.

| Request | Server limit | Browser request timeout | Call's own wait | Holds today |
|---|---|---|---|---|
| Session open | `OPEN_BUDGET_MS` 3,500 (`packages/server/src/routes/open.ts`) | `OPEN_TIMEOUT_MS` 5,000 (`apps/web/src/client/voice-client.ts`) | `OPEN_LIMIT_MS` 5,000 | server < browser = call |
| SDP exchange | `SDP_OPENAI_BUDGET_MS` 3,500 for OpenAI, the route within 5 s (`packages/server/src/routes/sdp.ts`) | `SDP_TIMEOUT_MS` 5,000 | `CONNECT_LIMIT_MS` 5,000, from the open answer to the data channel | OpenAI budget < browser |
| State poll | one transaction, retried up to 3 times on a lost race (`retryStale`, `packages/server/src/routes/state.ts`) | `STATE_TIMEOUT_MS` 1,500 | `ACK_LIMIT_MS` 1,500 in CONFIGURING; `STATE_STALE_MS` 5,000 before a lost request stops blocking the next | browser = ack limit < stale limit |
| Turn post | `HOLD_RETRY_MS` 250 as the retry hint of a `hold` (`packages/server/src/routes/turn.ts`) | `TURN_TIMEOUT_MS` = `TURN_RESPONSE_LIMIT_MS`, retries included | `TURN_RESPONSE_LIMIT_MS` 5,000 (`permit` wait) | browser budget = call's wait |
| Recall tool | `TOOL_RESULT_LIMIT_MS` 4,500, with `PARSE_WAIT_MS` 1,500 and `RECALL_DEADLINE_MS` 2,500 inside it (`packages/server/src/routes/tool.ts`, `packages/core/src/recall.ts`) | `TOOL_TIMEOUT_MS` = `TOOL_LIMIT_MS` | `TOOL_LIMIT_MS` 6,000 | parse wait + read ≤ route limit < call's wait |
| Close | `HANGUP_CALL_DEADLINE_MS` per hangup after the answer (`packages/server/src/openai/realtime-calls.ts`) | `CLOSE_TIMEOUT_MS` 1,500 | none: the call is already CLOSED | |
| Receipt | one transaction | `RECEIPT_TIMEOUT_MS` 1,500 a try, `RECEIPT_RETRY_WINDOW_MS` 60,000 in all | none | |
| Typed line | as Turn post | `TURN_TIMEOUT_MS` 10,000 and `OPEN_TIMEOUT_MS` 5,000 (`apps/web/src/client/typed-turns.ts`) | none | |

Limits inside the call that depend on each other:

| Limit | Value | Related to |
|---|---|---|
| `JUDGE_LIMIT_MS` | `APP_JUDGE_SETTINGS.deadlineMs`, 1,200 (`packages/core/src/voice/judge.ts`) | `fastOProblem` refuses after t0 plus the same deadline |
| `FAST_ACK_AGE_MS` | 2,500 | equals `FAST_O_ACK_AGE_MS` (`packages/core/src/voice/fast-o.ts`) and the server's `ACK_TTL_MS` (`packages/server/src/sessions.ts`) |
| `HELD_TRANSCRIPT_LIMIT_MS`, `ADMITTED_TRANSCRIPT_LIMIT_MS` | 2,500 and 5,000 from t0 | a held Turn is posted `missing` sooner than an admitted one |
| `MISSING_WINDOW_MS` | 10,000 | equals the server's `MISSING_LEASE_MS` (`packages/server/src/audience.ts`) |
| `REFRESH_MS` | 45,000 | below the server's `DECK_TTL_MS` of 60,000 (`packages/server/src/sessions.ts`) |
| `HOLD_LIMIT_MS` | 2,500 | the wait in HELD after a higher Deck cut a reply |
| `SPEAK_CAP_MS` | 45,000 | the longest an admitted reply may run |

Server leases:

| Lease | Value | Related to |
|---|---|---|
| Request ledger `LEASE_MS` | 15,000 (`packages/server/src/ledger/request.ts`) | longer than every browser request timeout above, so a retry of a slow request is refused, not run twice |
| Parse repair `REPAIR_LEASE_MS` | 2,500 (`packages/server/src/audience.ts`) | above `REPAIR_DEADLINE_MS` 2,000 (`packages/server/src/intents/repair.ts`) |
| Job `LEASE_MS` | 30,000 (`packages/server/src/worker/jobs.ts`) | the default claim |
| `EXTRACT_LEASE_MS` | twice `EXTRACT_DEADLINE_MS` plus 15,000 (`packages/server/src/worker/extract.ts`) | covers one call and its one repair |
| `SESSION_IDLE_MS` | 10 minutes (`packages/server/src/sessions.ts`) | pushed forward by, among others, state answers and playback receipts; `SESSION_WRITE_MIN_MS` 30,000 spaces the state route's writes |

Not modelled: one module that owns these limits. Each file exports its own, and the relations above are kept by hand.
