# Server: work after the response

Some route work runs after the response is sent. The Server_Library cannot import `next`, so every route takes a `Schedule` (`packages/server/src/routes/runtime.ts`), and the Web_App's adapter passes one backed by `after()` from `next/server`. Tests pass one that records the work and runs it on demand (`packages/server/src/testing/fakes.ts`).

### `server.background`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/app/api/_lib/adapter.ts` |

`adapt(spec)` converts the Request, calls `runLiveRoute` with `(work) => after(work)` and returns the route's JSON with `cache-control: no-store`. A scheduled task's promise goes to `after()` as it is: the adapter adds no logging and no catch, and nothing waits for it. Structured log lines come from the routes themselves, through `deps.log` (`consoleLog` in `packages/server/src/routes/live-deps.ts`, one JSON object per line).

A response never waits for scheduled work. What each task leaves behind when it fails, and what finishes it:

| Scheduled by | Work | If it fails or never runs | Picked up by |
|---|---|---|---|
| `/api/turn`, close, `afterClosed`, an open whose drain lost its race | the extract drain (`drainExtractJobs`) | Extract_Jobs stay `queued`, `retry` or `leased` | the next drain from any of those, and the tick's Q17; a lease that ended is requeued by Q18 or the drain itself |
| `/api/turn` | the Parse_Repair (`runParseRepair`) | the Session's `parseLease` runs out | the next request that sees the lapsed lease stores audience `unknown` (`expireLease`, `packages/server/src/audience.ts`) |
| close, and an open whose prior hangup failed | `driveHangupJob` | the `hangup` Job stays `retry` | the Job's own backoff while `driveHangupJob` runs; after that the Job comes due every `HANGUP_STEADY_MS` and the tick's Q17 runs it; a second close makes it due now |
| the tick's Q13 | hangups and `finishCloseInTx` of an expired Session | the Session stays `closing` with a `hangup` Job | as above |
| the SDP route | `orphanHangup` for a call no Session knows | retries for `ORPHAN_RETRY_LIMIT_MS`, then logs `sdp.orphanCall` | nothing: a raw call ID has no Job |
| `/api/session/state` | the whole tick (`scheduleTick`) | the Owner's minute slot is spent | the next minute's tick |

Not modelled: a runner that wakes on time with no request. Every row above but the orphan hangup is finished by a later request.
