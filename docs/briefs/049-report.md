# Brief 049: report

## Part B: a read-only Google connection (lane `google`)

Claude built this part from rulings 15 to 22, 26 and 27. Kiro wrote none of it. Part B has no agent, no model tool and no model call. It provides the connection, the port, "Evidence on read" as plain functions for Part C, and the screen.

### What was built

**OAuth (ruling 15)**, in `packages/server/src/google/routes.ts`, `oauth.ts` and `config.ts`:
- **`POST /api/google/start`**
  - Makes a 32-byte state, of which only its SHA-256 is stored, and a PKCE verifier (S256), which is stored sealed under the label `franki-google-verifier`.
  - Builds the redirect URI from the guard-checked `Origin` (checked again against `ALLOWED_ORIGINS`) plus `/google/callback`.
  - Stores all of it as `google.pending` on the owner's gmail connector document, with a 10-minute end (`PENDING_TTL_MS`). A later start replaces an earlier one.
  - Answers Google's URL with `response_type=code`, `access_type=offline`, `prompt=consent` and `include_granted_scopes=true`.
- **`POST /api/google/connect`**
  - Rejects a malformed state with PARSE.
  - In a transaction, it hashes the state, compares it in constant time (`timingSafeEqual`), checks the expiry, consumes the pending authorization and claims one ledger row (`kind: "google"`), all before any call to Google.
  - Exchanges the code once, with the redirect URI that was stored at start. That URI is never rebuilt from the connect request.
  - A 4xx is `failed/rejected`. An ambiguous answer is `blocked/unconfirmed` and is never retried.
  - Grants are read from the token answer's `scope` (ruling 16).
  - Identity comes from the `id_token` payload. Its `aud` and `iss` are checked, `sub` is required, and the email is kept only when `email_verified`. Its signature is not fetched (G-284).
  - Saving both documents runs in a second transaction. A save that fails revokes the grant.
- **`GET /api/google/status`** reads Firestore only.
- **`POST /api/google/disconnect`**
  - Revokes the grant once. `invalid_token` counts as already revoked.
  - Any other failure keeps the connection and answers 503 (`notRevoked`).
  - On success it erases both documents' tokens. The stored rows stay and become unreadable (ruling 18).
- **The callback page** is `apps/web/src/app/google/callback/page.tsx`, with `components/google/GoogleCallback.tsx` and `client/google-callback.ts`.
  - It has `referrer: no-referrer` and `noindex`.
  - It takes the query out of the address bar before anything else, and reads `error` only as "denied".
  - It sends the connect once with the owner's Firebase token, then broadcasts one word on the `franki-google` channel and closes itself.
  - It shows fixed copy only.

**Tokens and storage (rulings 17 and 18):**
- `packages/server/src/sealed.ts` is the bank's AES-256-GCM envelope made generic, with AAD `[label, 1, uid, id]`. A test pins the bank's old envelope byte for byte (`sealed.test.ts`).
- The refresh token is sealed under `franki-google-token`. Access tokens live only in `GoogleReadContext.tokens`.
- `invalid_grant` on refresh marks both documents `expired` and erases the token.
- `Connector.google` in `packages/core/src/schema/records.ts`, and `GoogleView` with the route schemas in `wire.ts`.

**The port (ruling 19)** is `packages/server/src/google/port.ts`:
- Plain fetch with an 8 s timeout and `redirect: "error"`.
- Five pinned endpoints (`GOOGLE_ENDPOINTS`). The data methods are GET only.
- `liveGoogle`. The test doubles are `throwingGoogle` (the `testRig` default) and `FakeGoogle`, in `testing/fake-google.ts`.

**Evidence on read (rulings 20 and 21):**
- `google/read.ts`, with `mail.ts` (a bounded MIME walk, no attachments), `calendar.ts` and `rows.ts`.
- Row fields come from the seed's own builders, now shared (`mailRowFields` and `calendarRowFields` in `seed/build.ts`). The output was checked to be identical.
- Own mail and own events are O, the rest T. A changed message or event becomes a new revision.
- A blocked provider ID is not fetched, stored, returned or counted.
- The epoch is fenced before each write.
- Pure helpers in `packages/core/src/google/index.ts`:
  - `gmailQuery`: every term quoted, always `-in:spam -in:trash -category:promotions -category:social`.
  - `mailText`: a linear HTML-to-text pass that drops scripts, styles, comments and attributes, and drops the rest at any unclosed construct. No URL is kept.
  - `freeGaps` and `isConnectedGoogleRow`.

**Separation (ruling 22):**
- `isConnectedGoogleRow` filters connected Google rows out of the hero and compare reads (`routes/tool-food.ts`), `seed/hero-check.ts` and the Lab's mail count (`memory-views.ts`).
- Tests: `google.test.ts` ("the hero is unchanged") and `memory-views.lab-google.test.ts`.

**The screen (ruling 26):**
- `ui/google/google-machine.ts` (`ui.google`) and its transitions test.
- `client/google-api.ts`. A start URL not on `https://accounts.google.com` is refused.
- `client/google-watch.ts`. The window is opened blank in the press, never read for `closed`, and closed on every way out of the wait.
- `components/google/GoogleSheet.tsx` and `GoogleWayIn.tsx`, beside the bank's button.
- `COPY.google`, and the specimens section "Google".

**Docs (ruling 27):**
- `docs/machines/README.md` row and `docs/machines/google.md`.
- `docs/setup.md` "A connected Google account".
- `README.md`.
- `apps/web/apphosting.yaml`.

### Checks

- `npm run typecheck`: green.
- `npm run lint`: green, with 0 errors and the one warning that was already there, in `avatar/three/brass.ts`.
- `npm run build`: green. The four `/api/google/*` routes and `/google/callback` are built.
- The suite, in three shards:

| Shard | Files | Tests | Expected fail |
| --- | --- | --- | --- |
| 1/3 | 219 | 1,886 passed | 17 |
| 2/3 | 219 | 1,729 passed | 2 |
| 3/3 | 218 | 1,630 passed | 2 |

Shard 3 first failed in `scripts/ui-boundaries.test.ts`, which reads the word "window" in `ui/copy.ts` as the browser global. The copy now says "pop-up", and shard 3 was run again, green.

### Properties, red first

- **`packages/server/src/google/port-read-only.property.test.ts`:** every request the port sends is a GET on a pinned data host, or one of the three pinned POSTs. It went red with a seeded POST to the events endpoint: seed -137031710, counterexample `[[{"method":"exchangeCode","arg":"","n":0}]]`.
- **`packages/server/src/google/connect-state.property.test.ts`:** a state that is expired, another owner's, already used or wrong never reaches the exchange. It went red with the expiry check dropped: seed 721778143, counterexample `["expired",0,0,"a---aa0-Aa0-a_0_-aAa0_a-0a-aAAAA0aa0a-0_0__"]`.

### For Part C: the read functions

All are exported from `@franki/server`. Each answers `GoogleRead<T> = { ok: true; value: T } | { ok: false; why: "unavailable" | "notConnected" | "expired" | "failed" | "forgotten" }` and never throws on Google's failures. `read` lists the Evidence IDs touched, for lineage.

```ts
googleReadContext(route: RouteContext, epoch: number): GoogleReadContext   // { route, epoch, tokens: Map } — one per Errand run
searchMail(g: GoogleReadContext, q: MailQuery): Promise<GoogleRead<{ hits: MailHit[]; read: string[] }>>
readableMessage(g: GoogleReadContext, eid: string): Promise<GoogleRead<ReaderText>>
listEvents(g: GoogleReadContext, window: EventWindow): Promise<GoogleRead<{ zone: string; events: EventRow[]; read: string[] }>>
freeTime(g: GoogleReadContext, window: EventWindow, minutes: number, bounds: DayBounds = DEFAULT_DAY_BOUNDS): Promise<GoogleRead<{ zone: string; gaps: { start: string; end: string }[]; read: string[] }>>
googleConfigured(env: Env): boolean   // false -> start_errand answers `unavailable`
```

The types:
- **`MailQuery`** (`@franki/core`): `{ from: string | null; words: readonly string[]; afterMs: number | null; beforeMs: number | null; unread: boolean }`. Part C resolves `when` to `afterMs`/`beforeMs` with `dates.ts`.
- **`MailHit`:** `{ eid, sender, at, subject (≤120) | null, fromSelf, unread }`. It never has a body.
- **`ReaderText`:** `{ eid, sender, at, subject, body (≤12,000 chars), cut }`. It is for the tool-less reader only.
- **`EventRow`:** `{ eid, title (≤120) | null, start, end, allDay, organizerSelf }`.
- **`EventWindow`:** `{ fromMs, toMs }`. At most 14 days for `freeTime`, and 50 events.

Caps: `MAIL_SEARCH_MAX = 8` and `EVENTS_MAX = 50`.

`readableMessage` answers `notConnected` for an eid that is not this owner's connected Gmail row, so Part C must also check that the eid came from this Errand's own search (ruling 23).

`forgotten` means the epoch moved since `epoch`, or a forget holds the barrier.

### Not built, or partial

- No agent, tool, Errand or model call. That is Part C.
- `start_errand`'s `unavailable` is only the `googleConfigured` function.
- In-Reply-To is not mapped to a provider key (G-286).
- `senderAuth` is always `unknown`.
- No refresh-token rotation handling beyond storing what Google answers.
- The callback page, the popup, BroadcastChannel and `window.close` were checked by unit tests and a static render only. No browser has run them.

### Contract questions

- **G-280.** The pending authorization lives on the gmail connector document (`google.pending`), not in a new collection. It holds the state's hash, the sealed verifier, the redirect URI, `issuedAt` and `expiresAt`. The ledger never holds them.
- **G-281.** The start answer has to carry the state inside Google's URL. Start takes no `requestId` and writes no ledger row.
- **G-282.** A granted scope outside the four (plus `userinfo.email`) refuses the whole grant and revokes it.
- **G-283.** All refusals answer 409 STALE, with only the code in the body: used, expired or wrong state, no refresh token, an unexpected scope, a bad identity, another account. The ledger row says which. A grant of neither mail nor calendar is revoked, and the route answers 200 `nothingGranted`.
- **G-284.** The `id_token` is read from the token endpoint's own TLS answer, so its signature is not fetched (no JWKS call).
- **G-285.** `fromSelf` comes from Gmail's `SENT` label only. Bulk mail is detected from the List-Id and List-Unsubscribe headers or the category labels.
- **G-286.** In-Reply-To names a Message-ID, not a Gmail ID. It is left null, because mapping it would need a second read.
- **G-287.** "Cut" is marked by the parser version `gmail-read-v1-cut`, since the schema has no cut flag.
- **G-288.** Expired erases the token, so a new sign-in is the only way back.
- **G-289.** `isConnectedGoogleRow` needs `connectorId !== null`, as the bank did (P-236), so fixture rows with source `gmail` still count.
- **G-290.** `gate-tool`'s `evidenceClass` still maps calendar to O. Google events from others are T on their slices, which Part C's Gate wiring should check.
- **G-291.** A malformed state (PARSE 400) doesn't consume the pending authorization.
- **G-292.** All-day, declined, transparent and cancelled events don't block free time. `DEFAULT_DAY_BOUNDS` is 9:00 to 18:00 in the calendar's zone.
- **G-293.** The read functions' Evidence context uses generation 0, session null and stage `toolReturn`.
- **G-294.** `GOOGLE_OAUTH_CLIENT_ID` is a plain value set to `""` in `apphosting.yaml` until the owner fills it in. `scripts/sync-local-env.mjs` already skips empty values, so it wasn't changed.
- **G-295.** The sheet learns the outcome from the callback page over a BroadcastChannel, not from `popup.closed`. Google's COOP can sever the opener, so a backup status read runs every 4 s while waiting, with a 10-minute deadline. The broadcast carries one word, never the view or the address.

### The owner's setup

These steps are also in `docs/setup.md`.
1. In the Google Cloud console, enable the Gmail API and the Google Calendar API.
2. On the OAuth consent screen, choose External and Testing. Add the four scopes, and add each connecting account as a test user. Testing grants end after 7 days.
3. Create an OAuth client of type Web application, with these redirect URIs: `http://localhost:3000/google/callback` and `https://franki-web--frankirocks.us-central1.hosted.app/google/callback`.
4. Put the client ID in `GOOGLE_OAUTH_CLIENT_ID`: the plain value in `apps/web/apphosting.yaml`, and `apps/web/.env.local`.
5. Set the client secret with `firebase apphosting:secrets:set GOOGLE_OAUTH_CLIENT_SECRET`, and grant the backend access. Also put it in `.env.local`.
6. `FRANKI_BANK_TOKEN_KEY` is already set.

### Never exercised outside tests

Everything. No call to Google was made. Never run in a browser:
- the consent screen;
- the popup;
- the callback;
- granular consent;
- refresh;
- revoke;
- MIME and HTML parsing of real mail;
- calendar zones from a real calendar.

All of it ran against `FakeGoogle`, the scripted fetch, and static renders.
