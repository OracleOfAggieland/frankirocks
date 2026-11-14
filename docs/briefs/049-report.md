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
7. (Review S2) Set `GOOGLE_OAUTH_REDIRECT_URI`, a plain value: `https://franki-web--frankirocks.us-central1.hosted.app/google/callback` in `apps/web/apphosting.yaml`, and `http://localhost:3000/google/callback` in `apps/web/.env.local`. Unset, every Google route answers CONFIG.

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

### Review fixes (Nov 14)

Two adversarial reviews attacked Part B. Each item below got a test that failed first, except where marked. Claude built all of it; Kiro wrote none.

| Finding | What changed | Commit |
| --- | --- | --- |
| S1 | `profile`, `userinfo.profile` (and `openid`, `email`, `userinfo.email`) are harmless extras; any other extra scope still refuses and revokes. `SIGN_IN_SCOPES` in the fake. **`include_granted_scopes=true` is still sent** (G-296). | `9bf5fcd` |
| S2 | `GOOGLE_OAUTH_REDIRECT_URI`, one plain value per deployment; start refuses an Origin whose `/google/callback` isn't it; unset or malformed is CONFIG. `apphosting.yaml`, `docs/setup.md`, README. | `9bf5fcd` |
| S9 | An exchange answer the port can't read (oversize or malformed `id_token`) revokes the fresh grant before it fails. | `9bf5fcd` |
| S10 | Pins of the accepted-scope set (adding `gmail.send` fails a test) and of the start URL's exact parameters (`oauth-review.test.ts`); a new property, `connect-state-every-call.property.test.ts`, counts every port call and also checks no row and no pending change. It went red on the old code: seed 1255974258, counterexample `["expired",0,0,"a-A--00Aa_a0000a-0Aa_0A_00AAaa0--__aa-Aa0_-"]`. | `9bf5fcd`, `62fcba9` |
| S5 | A connect whose state doesn't match writes nothing at all (no request row, no ledger row, the pending left as it was), unless that requestId already has a row (the replay). The callback page posts only after taking a one-time marker the sheet placed in localStorage when it opened the popup, and removed when the wait ended. | `62fcba9`, `5f1a437` |
| S6 | Disconnect clears the pending authorization. The connect's save refuses (`badState`) and revokes when the gmail document's rev moved since the claim. | `62fcba9` |
| S7 | A token the key can't open is erased anyway; the row's outcome is the new `disconnectedUntold`; the answer is disconnected. | `62fcba9` |
| S8 | Recorded connect answers hold `email: null`; the route answers the live view. | `62fcba9` |
| S3, D5 | `accountKey` now stays on both documents after disconnect and expiry. A connect by a different account moves `activeGeneration` on. Rows carry the generation, and their provider, thread and logical keys are hashed under `googleKeyScope(connectorId, generation)` (generation 0 keeps the old keys). Every read checks the generation; the same account reconnecting reads its old rows. | `62fcba9` |
| S4 | The storing transaction re-reads the document (`stillReadable`): a disconnect or another account that committed mid-read stores nothing and answers `notConnected`. | `62fcba9` |
| D7 | The storing transaction is tried once more on `staleRevision`, then answers `failed`. Its test passed when written, since the fix landed with S4. | `62fcba9`, `5ffaef4` |
| D6 (b) | An incomplete block snapshot (past 128) fails the read before any fetch. Test written after the fix, as D7. | `62fcba9`, `5ffaef4` |
| D6 (a) | "Start over" keeps provider blocks whose key names a row a kept connector read (Google or bank). | `5ffaef4` |
| D9 | Tag names are matched case-insensitively on the original string; Unicode `Cf` and U+2028/2029 become spaces in body, subject, title and headers; every URL-like token is `[link]` (`linkless`). | `d7baece`, `5ffaef4` |
| D8 | `cutAt` never splits a surrogate pair. A part past the decode bound is decoded to it and marked cut; a part with `attachmentId` and no `data` is marked; HTML dropped at an unclosed construct is marked. | `d7baece`, `5ffaef4` |
| D10 | An opaque all-day event blocks its day. A length that is not a whole positive number of minutes within the day bounds answers `invalid`, calling nothing. | `d7baece`, `5ffaef4` |
| D12 | `gmailQuery` throws and `searchMail` answers `invalid` on a non-integer time. Appending a revision sets the prior one's `isCurrentProvider` to false. `readableMessage` given an old eid answers the current revision. A change past 64 revisions fails the read. Failed `getMessage`s set `partial`. | `d7baece`, `5ffaef4` |
| D1 | `listEvents` reads pages of 50, at most 4 (`EVENTS_READ_MAX = 200`), and says `truncated`. `freeTime` answers gaps only up to `through` (the last read event's start when pages remain) and says `complete`. | `5ffaef4` |
| D2 | Every text slice of a connected-Google row is at least S1 (`RowOptions.sensMin`). Fixture rows are unchanged. | `5ffaef4` |
| D3 | `evidenceClass` (now exported from `routes/gate-tool.ts`) gives a connector row the lowest class among its slices, T with none. Fixture rows keep the source rule, and every existing test stayed green. | `5ffaef4` |
| D4 | Sent mail with a quote or forward marker stores `bodyOwn` (O) and `bodyQuoted` (T), with no `body`. An event title is O only when `organizer.self` and `creator.self` (now read from Google). | `5ffaef4` |
| D11 | Senders are `{ name, address }`. `ownerHasMailed` asks `in:sent to:<address>` for one result, once per address per read context. | `5ffaef4` |

Existing tests changed to match a ruling, never loosened: `google.test.ts`'s two hosted-origin tests now set the hosted `GOOGLE_OAUTH_REDIRECT_URI` (S2); its search test reads the structured sender (D11); its free-time test and core's `freeGaps` test mark their all-day event transparent, since an opaque one now blocks (D10).

**For Part C, the signatures that changed:**

```ts
type GoogleReadFailure = "unavailable" | "notConnected" | "expired" | "failed" | "forgotten" | "invalid";
interface GoogleReadContext { route; epoch; tokens: Map; mailed: Map<string, boolean> }   // still made by googleReadContext(route, epoch)
interface MailSender { name: string; address: string | null }   // MailHit.sender and ReaderText.sender
searchMail(g, q): Promise<GoogleRead<{ hits: MailHit[]; read: string[]; partial: boolean }>>        // invalid for a non-integer time
listEvents(g, w): Promise<GoogleRead<{ zone; events: EventRow[]; read: string[]; truncated: boolean }>>
freeTime(g, w, minutes, bounds?): Promise<GoogleRead<{ zone; gaps; read: string[]; complete: boolean; through: string }>>   // invalid for a bad length
ownerHasMailed(g, address: string): Promise<GoogleRead<boolean>>   // new; invalid for anything that isn't plainly an address
googleConfigured(env)   // now also needs GOOGLE_OAUTH_REDIRECT_URI
```

`readableMessage` keeps its signature. Its `body` joins `bodyOwn` and `bodyQuoted` for split sent mail, so Part C's reader sees both, and must still treat the whole message as T (`evidenceClass` says T for a split row).

**New contract questions:**
- **G-296.** Ruling S1 says to drop `include_granted_scopes`, but the committed `port-read-only.property.test.ts` pins `include_granted_scopes=true`, and committed property files may not be edited. The parameter stays, with the identity scopes accepted, which removes the refusal. Dropping it needs the director's leave to change that one line of the property.
- **G-297.** Account separation uses the connector's `activeGeneration` and a key scope, not a new field. `GoogleConnection.accountKey` now means "the last account connected on this document" and survives disconnect and expiry (a hash, never shown).
- **G-298.** S6 detects an overtaken claim by the gmail document's `rev`. Any write to that document between claim and save (a disconnect, a new start, an expiry) refuses the connect, which is the safe side.
- **G-299.** The S5 marker is one same-origin localStorage key, not sessionStorage or `window.opener`: Google's COOP can sever the opener, and sessionStorage's copy into a popup differs across browsers. With no usable storage the callback still posts, and the server's state check (which now consumes nothing on a mismatch) is the only guard. A link opened while the owner's own popup is out can still take the marker; its state won't match, so it changes nothing.
- **G-300.** `freeTime` past the 200-event cap clips at the last read event's start instead of failing, and answers `complete: false` and `through`.
- **G-301.** Format characters become spaces rather than vanishing, so the existing direction-mark test holds and no two words run together.
- **G-302.** `linkless` replaces a scheme URL, a `www.` host and a bare host with a path. A bare `name.tld` with no path is kept, since it can't be told from a file name. An email address is kept.
- **G-303.** At the revision cap the read fails (the "fail" choice). A hot message that changes 64 times can no longer be searched until a ruling raises the cap or allows rolling.
- **G-304.** Flipping the prior revision's `isCurrentProvider` bumps that row's `rev`. A lineage ref to the old revision at its old rev would then not match; Part C should cite current revisions only.
- **G-305.** Kept blocks (D6 a) survive "Start over" with the forget receipts they came from deleted.

**Corrections to the claims above:** `mailText` did not drop every link (an attribute's tail could leak past a `>` inside quotes); it now replaces URL-like tokens with `[link]` (G-302). "A blocked provider ID is not fetched" held only within the first 128 blocks; past them the read now fails closed.

**Checks after the fixes:** `npm run typecheck` green; `npm run lint` 0 errors, the one old warning (`avatar/three/brass.ts`); `npm run build` green. Shard 1/3: 221 files, 1,908 passed, 17 expected fail. Shard 2/3: 221 files, 1,760 passed, 2 expected fail. Shard 3/3: 220 files, 1,633 passed, 2 expected fail.

**Left unfixed:**
- **S1's parameter removal**, for G-296.
- **D6, no forget path can block a Google row yet.** The reviewer found that nothing in the forget flow creates a provider block for a connected-Google message or event. The block checks above are tested with hand-made blocks only, so "forget" of a Google row does not reach the read layer today.

**New risks from these fixes:**
- The localStorage marker can stop a real connect in a browser that clears storage between the press and the callback.
- Rows stored before these fixes have generation 0, keys under the connector ID and S0 slices. A re-read stores a new revision, since the content key now includes slice classes and sensitivities.
- `freeTime` now reads up to 4 pages, so up to 4 Calendar calls per ask.
# Brief 049 report

## Part A: the errand framework (lane `errands`)

Built by Claude in the lane `lane/errands`. Kiro wrote none of it. Every check below ran on fakes: no OpenAI, Google or other outside call was made.

### What was built

| Ruling | What | Where |
|---|---|---|
| 1 | One tool, `start_errand`, whose only argument is `about` (a non-empty set of `mail` and `calendar`, unique). Its description asks for one neutral sentence first. It is in `CALL_TOOLS`, offered only while an errand agent is ready for the owner (review fix R2), and the reply after its result carries no tools. | `packages/core/src/schema/wire.ts` (`ErrandArgs`, `ErrandCall`, `ErrandResult`, `ERRAND_TOOL`), `packages/core/src/voice/machine.ts`, `packages/core/src/voice/tool-args.ts` |
| 2 | The assignment is read by the server from the owner's own committed turns: class U, final, committed, alive, Evidence still retained, this Session, ending with the asking turn, at most 4, newest last. The Errand stores turn IDs, and the words are reread at run time, so a forgotten turn takes its words with it. | `packages/server/src/errands/assignment.ts` |
| 3 | The tool answers at once: `started`, `notConnected`, `busy`, `unavailable` (or `stale` for a turn that no longer counts). One transaction claims the Errand (ID hashed from Session and turn), its Job and one `errand` ledger row. The run is scheduled through `ctx.schedule`. Notes are code-worded and S0. | `packages/server/src/errands/start.ts`, `packages/core/src/errands/lines.ts`, `packages/server/src/routes/tool.ts` |
| 4 | The run is a Job (`claimJob`, `ERRAND_LEASE_MS`), and each step renews the lease. A lapsed run is picked up by the state poll (each second in a call) and by the tick (Q18 then Q17, `errand` added to `runDueJobs`). A second claim starts from nothing. A third never runs, and the Errand ends `failed`. | `packages/server/src/errands/run.ts`, `packages/server/src/errands/deliver.ts` (`pickUp`), `packages/server/src/worker/tick.ts`, `docs/machines/server-background.md` |
| 5 | A bounded Responses loop through `OpenAIPort`: `store: false`, the brain model at low effort, a fixed developer message, the owner's words as the only user message, and tool outputs wrapped as data. The port's result now carries function calls and output items. No second client. Limits are 40 s wall, 6 model calls, 10 tool calls, 12 s per model call and 8 s per tool call. | `packages/server/src/openai/responses.ts`, `packages/server/src/openai/live.ts`, `packages/core/src/errands/limits.ts` |
| 6 | The registry: an agent is an ID, an `about`, fixed instructions, tools and an availability check. Production's list is empty. A test-only agent proves the framework. | `packages/server/src/errands/agent.ts`, `packages/server/src/testing/errand-agent.ts` |
| 7 | At most 2 Errands run per owner, else `busy`. An unheard result goes `cardOnly` after 5 minutes, or when a poll comes from another Session. | `start.ts`, `deliver.ts` |
| 8 | The last output is structured (an outcome plus at most 3 lines of at most 200 characters, each with refs). Code drops refs that name nothing this run read, drops lines left with no ref, and keeps lines only for `answered`. A line's class is the lowest-trust class of its refs and its sensitivity the highest. Code adds the attribution. | `packages/core/src/errands/result.ts` |
| 9 | Delivery: a `proactive` decision written through the Admission_Seam (`admitErrandLine`), said once with sayExactly and no tools. It is offered by the state poll only in a call, with an ack and a Deck, after 2 s of quiet, for this Session and epoch. The decision row is the claim. | `packages/server/src/admission/seam.ts`, `packages/server/src/errands/deliver.ts`, `packages/server/src/routes/state.ts` |
| 10 | A Gate candidate per line, on the recall trigger with the assignment words. A line is said in full only in private. A third-party line is spoken only for senders the owner has mailed, else carded. S2 is never spoken late. Gate rows are written for every line not said. | `packages/server/src/errands/gate.ts` |
| 11 | A card shows each line with its source: sender, subject and date for mail; title and time for an event. There are no links. | `packages/server/src/errands/card.ts`, `apps/web/src/ui/errands/errand-view.ts` |
| 12 | The S0 running word ("Checking your mail") comes from the state poll's `errands` view and sits on the stage. An S0 aware note goes on later spoken turns. | `packages/server/src/errands/aware.ts`, `packages/server/src/routes/turn.ts`, `apps/web/src/client/errand-shelf.ts`, `apps/web/src/components/errands/ErrandWord.tsx`, `App.tsx`, `app-controllers.ts`, `voice-client.ts` |
| 13 | A failure is said plainly, once: "I couldn't get to your mail just now." | `packages/core/src/errands/lines.ts`, `deliver.ts` |
| 14 | The forget executor's close step drops every Errand that isn't already dropped (erasing its lines and reads) and settles its Job, under the barrier. The runner rechecks the epoch and barrier before every write, and delivery rechecks them in its claim. A poll drops any Errand of an older epoch. Reset deletes Errands with the tenant and keeps connectors. | `packages/server/src/errands/forget.ts`, `packages/server/src/forget/executor.ts`, `run.ts`, `deliver.ts` |

Other changes:
- **Machine and docs:** the machine `server.errand` (`packages/core/src/errands/errand-machine.ts`, page `docs/machines/errands.md`), the `voice-call.md` tool list, and a specimens section, "Errands".
- **Records:** the Errand record, plus the `errand` ledger and job kinds (`packages/core/src/schema/records.ts`).
- **Store:** two new single-field query shapes, Q49 (errands by `startedAt`, newest first) and Q50 (errands by `retainUntil`, review fix R12), in `packages/server/src/store/indexes.ts`, with no composite index to deploy, and the collection `errandMarks` (review fix R1).
- **Corpus:** the voice golden corpus was re-recorded for the new tool.

### Properties

| Property | File | Red first |
|---|---|---|
| No source, no line | `packages/core/src/errands/no-source-no-line.property.test.ts` | **Red against the first code.** Seed `-296647823`, path `9:2:1:3:2:2:2:4:3:3:3:3:5:6:6:6:6:8:9:8:8:8:8:8:8`. Counterexample: outcome `nothing` with the line `"!"` on a readable ref, which was kept. Fixed: only `answered` keeps lines. |
| Whose words | `packages/server/src/errands/whose-words.property.test.ts` | **Red against the first code.** Seed `-1987307272`, path `14:3:1:6:6:6:10:10:11:11:11:11:8:8`. Counterexample: four earlier owner turns, the third with its Evidence already forgotten, then the ask. The forgotten turn took one of the four slots, so an earlier sentence that was still readable was lost. Fixed: a turn whose Evidence is not retained takes no slot. |
| Said once | `packages/server/src/errands/said-once.property.test.ts` | Passed on its first run. **Red shown on a temporary mutant** (a per-poll decision ID, no status or revision recheck, delivered Errands still due): seed `350580895`, path `1:1:0:2:2:3:4:1:2:2:12`. The mutant was reverted. |
| No Resurrection through an errand | `packages/server/src/errands/no-resurrection-errand.property.test.ts` | Passed on its first run. **Red shown on a temporary mutant** (the poll's drop of an old-epoch Errand removed): seed `-486734447`, path `1:0:1:1`, counterexample `["beforeRun", dropMissed, 1 poll, 0 runners]`. The Errand stayed `running` after a forget the drop missed. The mutant was reverted. |

Two properties were written after the code they test, not before it. That departs from the order the lane rules ask for. Both still went red against that first code and found real gaps. The other two needed mutants to show red.

### Not built, or partial

- **Part D, the typed line.** A typed turn with no call open doesn't offer `start_errand`.
- **Card-only "when its Session closes" is lazy.** It happens at the next poll from another Session, not when the Session closes.
- ~~A result whose offered line the browser drops is not offered again.~~ Fixed by review fix V2: it is offered again once its offer expires, within its five minutes.
- **No ring or sound, and Franki's look doesn't change while an Errand runs.**
- **The emulator suite was not run.** Brief 016 says the Firestore emulator's port is shared across lanes, so it can't run in a lane.

### Contract questions

- **E-257.** The delivery's whisper is kind `moment`, `unprompted`, with `momentId` set to the Errand ID. The browser's existing rule for an unprompted proactive line then plays it with sayExactly, and the voice reducer is unchanged. `receiptMoments` skips IDs with no Moment.
- **E-258.** Superseded by review fix V2 (E-272): delivered only on a receipt, offered again after an unheard offer expires.
- **E-259.** A `failed` Errand waits to be said, as `ready` does (ruling 13).
- **E-260.** For the Gate, "asked" uses the assignment words as the owner's turn on the `recall` trigger, and still needs a certain speaker: the Errand's own turn typed, or judged `O`. An uncertain spoken turn hears "It's on your screen", or the held line, instead of the found lines.
- **E-261.** The forget drop runs in the executor's close step, not inside the fence transaction (no queries inside route transactions). The epoch rechecks and the poll's lazy drop cover an Errand the drop missed.
- **E-262.** When some of the asked `about` values have a ready agent, the Errand runs with those.
- **E-263.** The running count is read inside the start transaction, from the 12 most recent Errands, filtered in code. This needed the new shape Q49, and no composite index.
- **E-264.** A lapsed run is picked up by the state poll as well as the tick. `errand` was added to the tick's Q17.
- **E-265.** Card-only on Session close is lazy (see "Not built").
- **E-266.** Superseded by review fix R12 (E-280): no cap.
- **E-267.** `StateResponse` gains `errands` as a union variant. Changed by review fix R1 (E-276): a missing one now means "keep what is shown".
- **E-268.** Cards come from the state view: this epoch, the last 30 minutes, any Session, gated again for the current audience on every poll. `Proactive.cards` is empty, and the just-delivered card goes out in the same response.
- **E-269.** A run stopped by a barrier other than a forget leaves its Job leased. The lease lapses, and the next claim restarts the run.
- **E-270.** Only the Errand's own turn decides whether the speaker is certain. Earlier assignment turns don't.
- **E-271.** The run's taint and the text cleaning are a separate step, `taintErrandLines` (`packages/core/src/errands/taint.ts`), run after `checkErrandResult`. The committed property "No source, no line" pins `checkErrandResult` (line text a prefix of the planner's, class and sensitivity over the cited refs only), so the whole-run taint could not go inside it without weakening that property.
- **E-272.** Said once now means: at most one offer out at a time (`ERRAND_OFFER_MS`, 10 s); a new offer only after the last one expired with no receipt, and only within the result's five minutes; any receipt that says the line went out (`admitted`, `playbackStarted`, `playbackEnded` or `transcript`), for any attempt, makes it `delivered` and stops further offers. If a line played and every receipt for it was lost, it can be played again, once per expired offer. The browser sends no speech-start time for the line: its clock is not the server's ops clock, so the re-offer and the browser's own drop rules cover a line it dropped.
- **E-273.** Quiet topics: `gateErrandLines` takes a `topicOf` seam and applies `silenced`, but no server path builds a quiet `GateTopic` for an Errand line today, so only the crisis rule is live (V7). A quiet-topic mapping for mail and events is part C's to add.
- **E-274.** The poll finds a Session's Errands through a new top collection, `errandMarks/{sessionId}` (at most `ERRAND_MARK_IDS_MAX` = 12 IDs and an `openUntil`), read by name with no query. A Session that started more than 12 Errands lists only the first 12.
- **E-275.** Readiness (R2) is worked out on every state poll by calling each agent's `available`. Agents must keep it cheap. It is not on the open answer, so `start_errand` is first offered about a second after the call opens, at the first poll.
- **E-276.** A poll out of its budget sends no `errands`, and the browser keeps what it shows. A card leaves the browser's shelf `ERRAND_SHELF_KEEP_MS` (= `ERRAND_CARD_KEEP_MS`, 30 min) after the last poll that listed it, on a completed forget, or as soon as a poll stops listing it.
- **E-277.** A third-party line whose sender's name fails `safeName` is card only, and one address under two names counts as two senders (found by the V8 property).
- **E-278.** `retryStale` moved from `routes/state.ts` to `store/errors.ts` so the runner can share it. The state route re-exports it.
- **E-279.** A store fault in a run, other than a lost race, ends the Errand `failed` at once. It is said and carded as the plain failure line.
- **E-280.** The forget's close step drains every Errand with `retainUntil` set (new single-field shape Q50), 100 per transaction, under the barrier, then advances. A large backlog makes that step take more transactions.
- **E-281.** The tick strips at most `ERRANDS_STRIP_MAX` (50) rows a tick. A waiting row past its window goes `cardOnly`.

### Review fixes

Each fix has a test that failed first, except where noted.

| Finding | Commit | Note |
|---|---|---|
| V1 taint by run, by what was shown | `49c5fdb` | Five tests red against the old records and run. |
| V3 clean text, escape inside `sayExactly` | `49c5fdb` | |
| V2 re-offer until a receipt, `delivered` on receipt | `bd50d32` | "Late receipt" passed before the fix (vacuously). The said-once property is restated (below). |
| V4 the claim rereads Session and core, gates again | `bd50d32` | |
| V5 cards only in the Errand's Session, company S0 only | `bd50d32` | |
| V7 crisis says and shows nothing | `bd50d32` | Quiet topics: seam only (E-273). |
| V9 start only once admitted, a repeat answers from it | `bd50d32` | |
| V11 heard line's Turn keeps its class, writes `said` | `bd50d32` | Red with the old `routes/receipt.ts`. |
| R1 bounded poll, Gate inputs at finish, skip with no Errand | `bd50d32` | |
| R4 a stranded run ends `failed`, not busy | `bd50d32` | The busy test passed once the start changed. |
| R8 a one-line S0 card for every outcome | `bd50d32` | |
| V6 client shelf: forget, a skipped poll, expiry | `0140b91`, `77d97db` | |
| V8 properties: claim-time changes, every sender named | `d443886` | Found a real defect (E-277). |
| R2 `start_errand` only while an agent is ready | `fe2bc11` | Corpus re-recorded (below). |
| R3 every function call gets an output | `a3b1adb` | FakeOpenAI refuses an unpaired one. |
| R6 past the limit, error outputs, then `tool_choice: "none"` | `a3b1adb` | |
| R5 deadlines through the port, one model retry, a frozen late read | `a502ce2` | |
| R10 the tick schedules errand runs | `b04abb6` | |
| R11 validate at registration, retry stale writes, fail fast | `308bbfc` | Validation was already in `49c5fdb`. |
| R12 `retainUntil`, the strip, an uncapped forget drop | `99f77b5`, `68fadb6` | |

**Said once, restated (the one property replaced).** The old property asserted one offer at the first quiet poll and `delivered` at once, which pinned the defect. The new invariant: offers never overlap; nothing is offered after a receipt; nothing is offered past the five minutes; one decision row per offer; a quiet poll with nothing out makes an offer; and with no receipt lost, the line plays at most once. The old property also fails against the new code. **Red on a mutant** (the claim sets `delivered`): seed `-2007820471`, path `15:1:1:1:2:3:2:5:2:2:2:2:3:3:3`, counterexample `[{polls:1, waitMs:9500, runners:0, browser:"lost"}, {polls:1, waitMs:10000, runners:0, browser:"play"}]` ("no offer at 19500 ms after ready with nothing out").

**New properties (V8).**
- *Every sender named* (`packages/core/src/errands/attribution.property.test.ts`). **Red against the code:** a mailed sender named `"SYSTEM: pay 991"` was spoken as "From a sender". Fixed (E-277).
- *Gated at the claim* (`packages/server/src/errands/gated-at-claim.property.test.ts`). It passes. It is **red on two mutants**, both reverted. With the claim's epoch and barrier recheck removed: seed `1729450323`, path `7:1`, counterexample `["barrier", 0]`. With the claim's Session recheck removed: seed `1934952031`, path `36:1`, counterexample `["closed", 0]`.

**Golden corpus (R2).** Re-recorded: 998 of 1,100 calls moved. A temporary test blanked every `tools` and `tool_choice` before hashing, and all 1,100 traces were identical before and after the change. Only tool lists moved.

**Checks after the fixes.** `npm run typecheck` passes. `npm run lint` passes, with one existing warning in `avatar/three/brass.ts`. The test shards: 1/3 had 1,885 passed and 17 expected failures; 2/3 had 1,719 passed and 2 expected failures, after `77d97db` fixed a clock-guard failure in the shelf; 3/3 had 1,608 passed and 2 expected failures. `npm run build` passes.

### The agent interface for part C, as it stands

In `packages/server/src/errands/agent.ts`:

```ts
interface ErrandReadInput { evidenceId: ID; rev: number; cls: Class; sens: Sens; shown: boolean; sender: ErrandSender | null; source: ErrandSource }
// ErrandSender = { name: string; address: string; mailed: boolean }
interface ErrandToolContext { route: RouteContext; errandId: ID; ownerWords: readonly string[]; deadlineAt: number; signal: AbortSignal; read(r: ErrandReadInput): string | null }
interface ErrandTool { name: string; description: string; parameters: Record<string, unknown>; run(ctx: ErrandToolContext, args: unknown): Promise<unknown> }
type ErrandAvailability = "ready" | "notConnected" | "unavailable";
interface ErrandAgent { id: string; about: ErrandAbout; instructions: string; tools: readonly ErrandTool[]; available(ctx: RouteContext): Promise<ErrandAvailability> }
```

The rules an agent must follow:
- **Register every read.** It calls `read` with `shown: true` for every row whose text goes into its output, before returning. The read is checked when it registers; one that fails, or one past `ERRAND_READS_MAX`, makes the whole run card only.
- **Stop at the deadline.** It passes `signal` to its own requests. After the deadline, `read` answers null.
- **Keep `available` cheap.** It runs on every state poll. Throwing reads as not ready.
- **Register through `RouteDeps.errandAgents`.** Production's `PRODUCTION_ERRAND_AGENTS` is still empty, so `start_errand` is never offered.

### Left unfixed

- **Quiet topics for errand lines.** V7 is partial: only the seam exists (E-273).
- **`aware.ts`.** The running note still counts every running Errand of the Session, including one that R4 would treat as stranded. It is S0 and says only what is being looked through.

### Never exercised outside tests

- Nothing ran against a real model, and no real agent exists.
- Not checked in a live call: the run, the late line, the running word and the card on the main screen.
- The specimens section was not looked at in a browser.
- The voice corpus was re-recorded and has not been heard.

## Part C: the agents (lane `google`)

Built by Claude in `lane/google` on fakes only (no OpenAI or Google call). Kiro wrote none of it.

### What was built
- `packages/server/src/errands/google-agents.ts`: the mail agent (`search_mail`, `read_mail`) and the calendar agent (`list_events`, `find_free_time`) over the Part B reads. Every row put in a tool output is registered with its stored class and sensitivity (`evidenceView`) and its sender. For a sender the owner has not mailed, `search_mail` answers ref, address and date only, registered not shown; a mailed sender (or the owner's own message) also gets the subject, registered shown. `read_mail` takes only a ref this run's own search returned, then runs the reader: one tool-less `bg` call, `store: false`, fixed developer text, owner words and message as untrusted user JSON, strict output `{bears, gist ≤240, when, where}`, gist cleaned with `cleanErrandText`. `when` goes through `resolveSpoken` (a day) and, for the calendar, `resolvePeriod` (now to its end, cut to 14 days); else `unresolved`.
- Readiness: each agent is `ready` only while its connector is readable; `unavailable` when Google isn't configured. Live (`errandAgents` unset), both register only when `googleConfigured` (`errands/agent.ts`, `errands/google-registry.ts`).
- `google-agents.test.ts`: one end-to-end script (ask, `started`, run with FakeGoogle and scripted models, `ready`, the poll offers the line), no body or poison text in any planner request, the reader request has no tools, no rule or preference rows written, and a foreign ref refused without a reader call.

### Not built
- Superseded by the review fixes below: the other end-to-end scripts, the unmailed-sender test, the calendar tool tests and the properties now exist. What is still not built is under "Left unfixed".

### Contract questions
- **C-300.** (was G-300) Dates resolved in the owner's world-clock zone. Superseded by E3 and E5: the ops clock, and the calendar's own zone (a guess in the owner's zone is read again once in the calendar's when Google answers another).
- **C-301.** (was G-301) Mail `when` accepted only a day phrase. Superseded by E2: `resolvePast` takes past days and periods.
- **C-302.** (was G-302) Per-run state in a module map. Superseded by T11: the runner's per-claim scratch. A second claim still starts with no refs, so `read_mail` refuses until it searches again.
- **C-303.** (was G-303) The owner's own messages count as mailed. Kept; their lines are still card only when the run also showed a stranger's mail.
- **C-304.** (was G-304) `find_free_time` registered the events behind the gaps as read, not shown. Superseded by T6: what blocks the window is registered shown, with the class of its typed time fields only.
- **C-306.** Only the first `Authentication-Results` header counts, and only with authserv-id `mx.google.com`; a DMARC pass must name the From domain (T1).
- **C-307.** `SENT_CHECK_MAX = 1`: one sent message is fetched per sender, and it must hold the exact address in To or Cc. A sender the owner wrote to only by Bcc is not mailed.
- **C-308.** FakeGoogle matches words, `from:`, `is:unread` and dates only with `fullQuery` on; `in:`, `category:` and `to:` always. Older tests assumed every message matched.
- **C-309.** The `unmailed` notice line is S1 and held in company (it says there is mail from a stranger).
- **C-310.** Notice precedence when several tools flagged: unmailed, expired, failed, partial, then a day code could not place (`noticeOf`).
- **C-311.** A disconnect drops one page (`Q50`) of holding Google Errands per disconnect; more than 100 at once would need a second disconnect or the forget's drain.
- **C-312.** A connector that moved (disconnected, expired, another account) drops a finished Errand, not just hides it.
- **C-313.** A reader failure counts as a partial read, not a failed run.
- **C-314.** A line on the owner's own message in a run that also read a stranger is card only.
- **C-315.** A free-time read is registered with title "" and the class of the `calendar.*` slices. `refViews` still rereads the whole row, so a cited busy event whose title came from someone else reads as T at the result check (fails closed: card only).
- **C-316.** A free-time window entirely in the past answers no gaps.
- **C-317.** The T9 test was committed with T8 (`c81c319`), not with its own fix.
- **C-318.** `list_events` leaves room under `ERRAND_TOOL_OUTPUT_CHARS` (800 characters) for the wrapper; a cut list flags the run `partial`.
- **C-319.** The Head sentence about look-ups is added by the voice machine (`callHead`) while `errandsReady`, not by the server's Head, so the Deck and every recorded trace with no agent ready are unchanged.
- **C-320.** A half-covered ask starts with the ready part and names the rest in the start note; the Errand's `about` holds the ready part only.
- **C-321.** The link cleaner treats any dot-joined host ending in two or more letters as a link, so a missing space ("Dr.Smith", "Node.js") becomes `[link]`.
- **C-322.** The fixture poison scripts (`scripts/gate-poison.ts`) run on the script runner, which has no errand step; mail cases there would be silent greens. Mail poison through the errand path is covered by the "Mail cannot order" property and `google-agents.test.ts` instead.
- **C-323.** E11's commit (`ecd15b9`) left the `expired` member of `ErrandAvailability` to the docs commit (`dbafb54`); the tree typechecks only from `dbafb54` on.

### Review fixes (Nov 14)

| Finding | Commit |
|---|---|
| T11, E12: per-claim state in the runner's scratch; parallel sent checks; reader timeout and abort | `c52008c` |
| T1: mailed only on Gmail's DMARC pass, a sent message to that exact address, no list mail | `dec8fd3` |
| T2, T3: unmailed sender is ref, date, unread only; reader gets the owner's own part of sent mail | `eba531e` |
| E9, T4, T5: speak only on mailed senders' mail; card marker for runs that read strangers; address-only naming; attribution day words | `37451b3` |
| T8, E4: code-worded notices when no line is citeable | `c81c319` |
| T9, E6: "It's on your screen" only when the card shows a line to this audience | `3affefb` |
| T10, E10: disconnect drops Google Errands; delivery rechecks the connector and generation | `8faf572` |
| E2, E3, E5, E8, T6, E1, T7: backward mail dates, ops clock, one zone, local text, part of day, 14-day clip, capped lists, free-time refs, invites don't block | `2e2f97f` |
| E11, T12 (readiness): Head sentence, started note, half-covered ask, expired grant, one read per agent | `ecd15b9` |
| T12: generic link cleaner | `981d449` |
| Docs (registry, README, setup, machine doc) | `dbafb54` |
| Group 4: properties "No body to the planner; no tool to the reader" and "Mail cannot order" | `84102dd` |
| Group 4: end-to-end scripts | `d5ba0f5` |

Both new properties were checked red against a deliberate break (a body in `read_mail`'s output; attribution removed) before passing.

### Left unfixed
- **E7** (a result whose Session closed before it was said, carried to the owner's next private Session as card only, once, within the card window). Not built: it needs a new owner-level record, a shown-once mark on the Errand, forget and reset coverage, and rules. Today such a result is never said or shown, which fails closed.
- **Poison scripts** (Group 4): see C-322.

### Never exercised outside tests
- Any real Gmail or Calendar call, any real reader call, the DMARC and sent-mail checks against real headers, a real calendar in another zone, the Head sentence in a live call, and the half-covered and expired notes heard by a person.
