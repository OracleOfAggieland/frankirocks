# Brief 049: background errands, and a real Gmail and Google Calendar (lanes `errands`, `google`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. Then read `docs/briefs/046-bank-connection.md` (the last connector) and the forget acknowledgment's delivery in `docs/briefs/048-design.md` (the last thing said without a turn asking for it).

**Who builds this.** Claude builds it from this brief. It is not Kiro's work, and its commits do not carry the Kiro trailer. Builder commits end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## What it is

Two things that meet in the middle.

1. **Errands.** In a call, Franki can hand a job to a helper that runs on the server, keep talking, and say what the helper found when it is ready. "Let me look." Then, a few seconds later, at a pause: "Found it. Dana wrote on Tuesday about the lease." The helper is a second model with its own small set of tools. The talking model never waits on it.
2. **Google.** The owner connects one Google account. Franki can then read their Gmail and their Google Calendar, and only through errands: the talking model has no mail or calendar tool of its own.

Until now mail and calendar came from fixtures only (spec §14 lists real Gmail and Calendar among the cuts; the owner has now asked for them).

Product rules that bind every part:

- **Read-only, by construction.** No route, tool or port method can send mail, write a draft, change a label, or create, change or delete an event. The scopes requested cannot do those things either. A test pins the scope list and the set of Google endpoints the port can reach.
- **Mail can inform. It cannot give orders,** change a belief about the owner, or grant a permission. Text from a message or an invite is data. It never becomes a rule, a preference, an identity fact, a `life` fact, a permission or an errand's assignment.
- **An errand's assignment is the owner's own words.** Not the talking model's, and never text from mail.
- **Every spoken or shown line names its source.** A line that cites no Evidence the errand actually read is dropped.
- **Dates come from the pure resolver.** No model sets a date.
- **Forget means gone from the next thought.** That includes an errand that is running and a result that is waiting.
- **The Gate decides what may be said,** as it does for every other tool.

## What the docs say (read Nov 13, 2026) and what we took from them

- `gpt-realtime-2.1` stays. OpenAI's newer voice API (GPT-Live) has delegation built in, but it is a different API and a different model; moving to it is not in this brief.
- The Realtime docs give one shape for a tool result: one `function_call_output` per `call_id`. Nothing documents a second, later output for the same call. So `start_errand` answers once, at once ("started"), and the result arrives later as a new response the app creates. This repo already creates every response itself, and already has one path for a line no turn asked for (the `proactive` Permit).
- OpenAI's guidance for a finished background job: say it only from verified state, drop a result whose request was superseded, keep the filler before a tool call neutral ("must not imply success or failure").
- OpenAI's guidance for untrusted text: pass it through user messages or tool outputs, never developer messages; use structured outputs between agents; keep approvals on for side effects. Google's own docs warn of indirect prompt injection through mail.
- OpenAI's hosted Gmail and Calendar connectors (`connector_id`) are deprecated for models released after Sep 1, 2026, which covers the 6.x models this repo uses. Google's own MCP servers are a preview. We call Google's REST APIs ourselves with our own OAuth, which also gives the narrowest scopes.
- Background mode with a webhook (`background: true`) was considered for the helper and not taken: it needs `store: true` (mail text retained at OpenAI), its behaviour with function tools is not documented, and each step would wait on a webhook. The helper runs in this repo's own Job runner instead.

Pages: `developers.openai.com/api/docs/guides/` `realtime-conversations`, `voice-server-controls`, `voice-prompting`, `background`, `webhooks`, `tools-connectors-mcp`, `agent-builder-safety`, `live-delegation`; `developers.google.com/identity/protocols/oauth2/web-server`; `developers.google.com/workspace/gmail/api/auth/scopes`; `developers.google.com/workspace/calendar/api/auth`.

## Rulings for this brief

These are the director's, made so the build can start. Each one that departs from `docs/design/` is recorded under "Contract questions" in `docs/briefs/049-report.md` when its part lands. `docs/design/` itself stays read-only. Where a ruling says "follow X" and X does not fit, stop following it, do the nearest sound thing, and record why.

### Errands

1. **One tool: `start_errand`.** Args: `about`, a non-empty set drawn from `mail` and `calendar`. Nothing else. No free text from the model reaches the helper. The tool's description tells the model to say one short neutral sentence first and never to guess what will be found.
2. **The assignment is read by the server** from the owner's own committed turns: class `U`, final, in this Session, ending with the turn that carries the current Stamp. At most the last 4, newest last, so "yes, check that" still has its referent. The Errand stores turn IDs, not the words, and reads the words when it runs, so a forgotten turn takes its words with it. Use the reader `make_phone_call` uses for the owner's turn where it fits.
3. **`start_errand` answers at once.** It claims the Errand (deterministic ID from the turn, one per turn), writes one ledger row, schedules the run through `ctx.schedule`, and returns `started`, or `notConnected` (no Google account covers what was asked), `busy` (ruling 7) or `unavailable` (Google is not configured on this server). Notes are code-worded and S0. The reply after it carries no tools, as after a phone or money result.
4. **The run is a Job.** Reuse `claimJob`, `dueJobs`, the lease and the tick's due-job pass, so a run whose instance died is picked up by a later request (in a call the state poll arrives every second). Renew the lease at each step. Second claim after a lapsed lease starts the run again from nothing; a third never happens, and the Errand ends `failed`. Add the row to `docs/machines/server-background.md`.
5. **The helper is a bounded loop** on the Responses API through `OpenAIPort`, with `store: false`. Widen the port's result to carry function calls and the output items that have to be sent back; do not add a second OpenAI client. The planner uses the brain model at low effort. Every limit is a named constant: wall time (40 s), model calls (6), tool calls (10), each model call's timeout, each Google call's timeout (8 s).
6. **An agent registry.** `packages/server/src/errands/` holds the framework: an `ErrandAgent` is an id, a fixed instruction text, a set of tools (name, strict JSON schema, an executor that takes a context and returns bounded JSON), and nothing else. The `about` set picks the agents and the helper gets the union of their tools. The framework knows nothing about Google. Part A ships it with the registry empty, proved by a test-only agent.
7. **Limits.** At most 2 Errands running per owner; a third answers `busy`. A result nobody has heard is dropped 5 minutes after it is ready, or when its Session closes, whichever is first; after that it is a card only.
8. **The planner's last output is structured:** an outcome (`answered`, `nothing`, `failed`) and at most 3 lines, each at most 200 characters, each with the refs it rests on. Code then checks every ref against the Evidence this Errand actually read and drops a line with none. A line's class is the lowest-trust class among its refs and its sensitivity the highest. Code adds the attribution ("From Dana Park, Tuesday:") to a line that rests on third-party text; the model does not write it.
9. **Delivery is a `proactive` decision written by the seam,** said once with `sayExactly`, with no tools. Study the forget acknowledgment (`packages/server/src/forget/ack.ts`, brief 048 F-217) and follow it. It is offered by the state poll when: the Errand is `ready`; its Session is the open one and the epoch has not moved since it was claimed; the call has been quiet for `ERRAND_SILENCE_MS` (2 s); and the Gate allows it. The client's existing drop rules stand (listening, nothing in flight, no speech since the poll went out), so a result waits for a pause and never talks over the owner. Exactly once: the decision row is the claim, whatever order polls and retries arrive in.
10. **The Gate.** Add the candidate builder the way `read_money` did (`gate-tool.ts`, `bank/money-gate.ts`). A result is said in full only in private. Otherwise it is held with a Gate row and one S0 line says so. Use the spec's table (§6): third-party lines are attributed, and are spoken only for senders the owner has mailed; otherwise they go on the card. An S2 line is never spoken by a late delivery.
11. **A card carries the detail.** When a result is delivered or dropped to card-only, a card shows each line with its source (sender, subject, date for mail; title and time for an event). No links, and no text from a message other than its subject and the helper's line.
12. **While an Errand runs, the screen says so** with a small S0 word under Franki ("Checking your mail", "Checking your calendar"), from the state poll. And the talking model is told on later turns, in one code-worded S0 note in the manner of `packages/server/src/phone/aware.ts`, that a look-up is still out, so it neither starts a second one nor guesses.
13. **Failure is said plainly, once:** "I couldn't get to your mail just now." Code-worded, S0.
14. **Forget.** A forget's fence ends every running Errand of that owner and drops every waiting result (`dropped`), before the fresh call opens. The runner rechecks the epoch before it writes a result, and delivery rechecks it before it claims the decision. Reset ("Start over") clears Errands and keeps the Google connection.

### Google

15. **OAuth, with no unguarded route.** Three guarded routes and one client page:
    - `POST /api/google/start` makes a one-time state (32 random bytes; only its hash is stored), a PKCE verifier (S256; stored sealed), and the redirect URI (the request's already-checked Origin plus `/google/callback`), stores them in one pending document for that owner with a 10-minute end, and answers with Google's authorization URL: `response_type=code`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`.
      - *Amended Nov 14 (review S1, S2):* `include_granted_scopes=true` was wrong to ask for: it brings back the scopes of Franki's own Google sign-in (`profile`), which the scope check then refused and revoked. The identity scopes `openid`, `email`, `profile`, `userinfo.email` and `userinfo.profile` are now harmless extras, and the parameter is to go (held by G-296 until the committed property's pin of it may change). The redirect URI is one configured value per deployment, `GOOGLE_OAUTH_REDIRECT_URI`, which the Origin plus `/google/callback` must equal exactly.
    - The page `/google/callback` is a client page. It reads `code`, `state` and `error` from the address, calls `POST /api/google/connect` with the owner's Firebase token, then closes itself. It opens in a popup so a live call stays up.
    - `POST /api/google/connect` checks the state against that owner's pending document (constant-time, not expired), consumes it in a transaction before anything else, claims one ledger row, and exchanges the code once. An ambiguous exchange is `blocked` and never retried. A state issued to another owner, used twice or expired makes no call to Google.
    - `GET /api/google/status`, `POST /api/google/disconnect`.
16. **Scopes, pinned by a test:** `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/calendar.events.readonly`. Google lets the owner grant some and not others, so read what was granted: mail and calendar connect independently, and granting neither connects nothing.
17. **Tokens.** The refresh token is sealed with the bank's AES-256-GCM envelope, under the same key and a different AAD label (`franki-google-token`), bound to the owner and the connector. Make the sealing helper generic rather than copying it. An access token lives only in the memory of the run that fetched it. No token, code, state or verifier appears in a route answer, a ledger row, a log line or an error. A refresh answered `invalid_grant` sets the connector `expired`, and the sheet says to connect again.
18. **Where it is stored.** `users/{uid}/connectors/{connectorId}`, one document per provider (`gmail`, `calendar`), following the contract's shape, with the Google part in one nullable sub-object beside `bank`. One Google account per owner. Disconnect revokes the grant at Google once, erases the tokens in both documents and stops every read; stored rows stay and are unreadable, as the bank's are.
19. **The port.** `GooglePort` on `RouteDeps`, plain `fetch`, 8 s timeout, `redirect: "error"`, hosts pinned (`accounts.google.com` for the URL only, `oauth2.googleapis.com`, `gmail.googleapis.com`, `www.googleapis.com`). Data methods are GETs only: list and get messages, list events. `throwingGoogle` is the default in tests, with a scripted fake beside the bank's.
20. **Rows are Evidence, written when read.** There is no mailbox import and no `syncPages`. A message the helper's search returns, and an event its listing returns, is stored as Evidence through the same builders the fixtures use (`buildMail`, `buildCalendar` in `packages/server/src/seed/build.ts`), with `source: "gmail"` or `"calendar"`, the connector's ID, and a deterministic ID from the provider's ID. A changed message or event is a new revision. Own mail and own events are `O`; everything from someone else is `T`. Schema bounds hold: a long body is cut at the bound and marked cut.
21. **A blocked provider ID drops.** A message or event the owner has forgotten is not stored again, not returned to the helper, and not counted (spec §8, "What stays gone").
22. **The sample visit stays the sample visit.** The hero, the compare loop, the moments and the Lab counts never read `source: "gmail"` or `"calendar"` rows, and the helper's tools never read fixture rows. A test proves the hero's numbers are unchanged with Google connected.

### The two agents

23. **Mail agent tools.**
    - `search_mail`: optional `from` (a name or address), `words` (up to 5), `when` (a phrase, resolved by `packages/core/src/dates.ts`), `unread`. Code builds Gmail's query, quoting every term, and always excludes spam, trash, promotions and social. At most 8 messages. It answers with, per message: a ref, the sender through `safeName`, the date, and the subject cut to 120 characters. Never the body.
    - `read_mail`: a ref from this Errand's own search, and nothing else. It runs **the reader**: one tool-less call on the background model over that one message's text and the owner's words, with a closed output: whether it bears on the ask, a gist of at most 240 characters, and optional `when` and `where` phrases copied from the message. The planner gets the reader's output, never the body.
24. **The planner never sees a message body, and the reader never has a tool.** Both are asserted on the requests `FakeOpenAI` records. Everything from Google goes into the model as tool output or a user message marked as untrusted data; the developer message is fixed text.
25. **Calendar agent tools.**
    - `list_events`: `when` (a phrase, resolved by the pure resolver against the clock port and the calendar's time zone). At most 14 days and 50 events, the primary calendar, single instances in start order. It answers with, per event: a ref, the title cut to 120 characters, start, end, all-day, and whether the owner is the organizer.
    - `find_free_time`: `when` and `minutes`. Code computes the gaps between the owner's events inside named day bounds. No model does the arithmetic.
    - A phrase the resolver cannot place answers `unresolved`, and the helper says it needs a day.

### The screen

26. **A Google way in beside the bank's,** at the foot of `/lab`, opening a sheet built on the bank sheet's shell: connect, what is connected (the account's address, mail, calendar), connect again when expired, disconnect (asked first). A pure machine `ui.google` with a transitions test, a watch store, copy in `COPY.google`, a specimens section. three.js props are not needed here.
27. **Docs.** Rows and pages in `docs/machines/`. Setup in `README.md` and `docs/setup.md`: the Google Cloud steps, the two config names (`GOOGLE_OAUTH_CLIENT_ID` plain, `GOOGLE_OAUTH_CLIENT_SECRET` secret), `apps/web/apphosting.yaml`, `scripts/sync-local-env.mjs`. With either name unset, the routes answer "not configured", the sheet says so, and `start_errand` answers `unavailable`.

## Properties, red first

Write each one failing before the code that makes it pass. Never edit a committed `*.property.test.ts`.

- **Whose words.** For any tool arguments and any Deck, the text the helper receives as its assignment is exactly the owner's committed `U` turns. No model text and no Evidence text is in it.
- **No body to the planner; no tool to the reader.**
- **No source, no line.** A result line whose refs are not Evidence this Errand read is never said and never shown.
- **Said once.** For any interleaving of polls, retries and a second runner, a result is delivered at most once.
- **No Resurrection through an errand.** After a forget, nothing an earlier Errand found is said or shown, and a forgotten message does not come back through a later search.
- **Mail cannot order.** A message that says to ignore instructions, to call a number, that the owner has no allergy, or that grants a permission: no memory write, no rule change, no tool call beyond the read set, and anything said about it is attributed. Add it to the poison scripts.
- **Read-only.** The scope list and the port's reachable endpoints and methods are pinned.
- **State.** A connect with a state that is another owner's, used or expired reaches Google zero times.

## Build in this order

- **Part A, lane `errands`: the framework.** Rulings 1 to 14 with the registry empty and a test-only agent. Wire (`start_errand`), records, the Job, the runner, the port widening, the result check, delivery, the Gate branch, the card, the running word, the aware note, forget and reset, the voice corpus re-record, machines docs, a specimens section.
- **Part B, lane `google`: the connection.** Rulings 15 to 22 and 26 to 27, with no agent: OAuth routes and page, sealing made generic, connector documents, the port and its fake, Evidence on read as plain functions with tests, blocked IDs, the sample-visit test, the sheet, setup docs.
- **Part C, lane `google` after `errands` is merged into it: the agents.** Rulings 23 to 25, the reader, the poison scripts, and the end-to-end scripts: an ask in a call, the neutral line, the result at a pause; the same in company; a forget midway; Google not connected; an expired grant.
- **Part D, only if A to C are green: the typed line.** With no call open, a typed ask starts an Errand after the turn commits, in the manner of `phone/typed.ts`, and the result arrives by the typed state poll as the forget acknowledgment does.

Each part ends with: `npm run typecheck`, `npm run lint`, the whole suite in three shards run in the foreground (`npx vitest run --maxWorkers=3 --shard=1/3`, then 2/3, 3/3), `npm run build`, and a section in `docs/briefs/049-report.md` listing what was built, what was not, and the contract questions. Number them `E-257` onward in lane `errands`, `G-280` onward in lane `google`, and from 300 in part C.

## Hot files

Both lanes add members to the same closed unions: `packages/core/src/schema/records.ts`, `primitives.ts`, `wire.ts`, `packages/server/src/store/paths.ts`, `store/checks.ts`, `seed/clear.ts`, `seed/reset.ts`, `routes/runtime.ts`, `testing/fakes.ts`, `apps/web/src/components/App.tsx`, `app-controllers.ts`, `client/api.ts`, `ui/copy.ts`, `docs/machines/README.md`. Keep each addition in one small block so the merge is a keep-both. Only lane `errands` touches `packages/core/src/voice/` and the golden corpus.

## Not in this brief

Sending or drafting mail, creating or changing events, attachments, other calendars, a second Google account, push or polling sync, moments or patterns from real mail, a move to GPT-Live, a sideband socket, and hosted MCP servers. No paid OpenAI call and no call to Google is made while building: every test runs on the fakes.

## Done

The four checks are green on the joined lane, the properties above exist and were red first, and `049-report.md` says what was never run against the real thing.
