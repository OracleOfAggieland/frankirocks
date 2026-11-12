# Client: route calls, retries, the clock and sign-in

The browser reaches the server only through one function, `ApiClient.call` in `apps/web/src/client/api.ts`. The voice call, the typed line and the Debug panel each build their own waits and retries on top of it.

### `client.api`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/client/api.ts` |
| State | `ApiResult` |
| Tests | `apps/web/src/client/api.test.ts` |

One call is a short sequence, with no state kept between calls:

1. A path that does not start with `/api/` throws.
2. Every route but `/api/health` awaits `getToken()`. No token answers `{ ok: false, kind: "signedOut" }` without touching the network.
3. The `timeoutMs` timer starts after the token step and aborts the fetch; it covers the request and reading the body.
4. The answer is one of `ApiResult`: `ok` with the body, or a failure kind `signedOut`, `timeout`, `network`, or `http` with the contracts ErrorCode and `retryAfterMs` when the body has them.

Not modelled: a rejected or slow `getToken()`. The token is awaited outside the `try` and the timer, so its outcome is the caller's.

### `client.retries`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/client/voice-client.ts` |
| Tests | `apps/web/src/client/voice-client.test.ts` |

Two sends are retried inside the Voice_Client, so the reducer sees only the final answer:

- **Turn post** (`postTurn`). One `requestId` per Turn (and one per Superseding_Post), kept in `turnRequestIds`, so a resend is the same request and a committed one is replayed. A timeout, a network failure or an `http` answer with a retry hint is sent again, at most twice more, inside one `TURN_TIMEOUT_MS` from the first send. A Superseding_Post that answers a retryable `hold` waits the hint and is sent again inside the same budget. Anything else dispatches `turnOk` or `turnFailed`.
- **Receipt** (`sendReceipt`). The identical body is sent until the server accepts or refuses it, after 1, 2 and 5 s (or the server's hint), for at most `RECEIPT_RETRY_WINDOW_MS` from the first send. `signedOut` and an `http` answer with no hint stop it.

Open, state, tool and close are sent once; their failures are events (`openFailed`, `stateFailed`, `toolFailed`, `closeFailed`) and the reducer decides.

### `client.clock`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/client/clock.ts` |
| Tests | `apps/web/src/client/clock.test.ts` |

The browser Clock_Port. Its state is one number, the offset added to the monotonic reading. `syncToServer` sets it from a server opsClock instant, taken to fall at the middle of the round trip; the Voice_Client and the typed line call it with the Deck's `issuedAt` after an open. Each sync replaces the offset; a non-finite instant or a round trip that ends before it starts is ignored. This is the only Browser_Client file that reads time.

### `client.auth`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/components/App.tsx` |
| State | `AuthState` in `apps/web/src/client/auth.ts` |
| Tests | `apps/web/src/components/App.test.tsx`, `apps/web/src/client/auth.test.ts` |

`AuthState` is `loading`, `signedOut` (with the last sign-in failure, or none) or `signedIn`. `App` sets it from Firebase's `onAuthStateChanged` and, with it, the token source. The controllers (Voice_Client, typed line, Debug panel) are built from the token source in one `useMemo`, so they exist only while signed in and a new sign-in starts with no Session. `signOut` hangs up any call and closes the typed Session, waits at most `SIGN_OUT_LIMIT_MS`, then signs out of Firebase whatever the server answered.

Not modelled: page hide and unload, and disposing the controllers when the Firebase user changes without the button.

### `client.debugRefresh`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/client/debug-panel.ts` |
| Tests | `apps/web/src/components/DebugPanel.test.tsx` |

`DebugPanelModel.refresh` is a coalescer with two fields, `inFlight` and `queued`. With nothing in flight it starts a load. While a load runs, the first call queues exactly one more load after it, and every later call joins that queued load. `inFlight` is cleared in a `finally` when its load settles.

### `client.authSession`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/client/auth-session.ts` |

A closed phase for the signed-in session, with one exit that disposes the controllers for every way of leaving it.

### `client.reaction`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/client/reaction.ts` |

One classifier from a failed `ApiResult` to what the screen does, shared by the loops that call routes.
