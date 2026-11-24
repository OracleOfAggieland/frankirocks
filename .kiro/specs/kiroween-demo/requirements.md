# Requirements Document

## Introduction

This spec covers Brief 054, the Kiroween Demo (`docs/briefs/054-kiroween-demo.md`, lane `kiroween-demo`). A visitor presses one button, with no sign-in form, and is in the lab as **Jeffrey Kisses**, an invented and absurdly rich man Franki already knows well. The mail, calendar and bank are simulated at the port. Everything above the port is the real product.

This is part A of the brief. `requirements.md` (this file) and `design.md` (with the correctness properties) are written; `tasks.md` follows in a later run. Behavior and contracts still come from `docs/design/memory-spec-v3.md` and `docs/design/memory-contracts-v2.md`. `docs/design/` is read-only. The requirements below keep the brief's rulings as given. The questions the first draft raised were answered by the owner; the answers are folded into the requirements they touch and listed under "Resolved questions" at the end.

### Prerequisites outside the code

1. The Anonymous sign-in provider is enabled for the Firebase project, and `localhost` and the deployed origins are authorized domains. The owner does this in the Firebase console. Nothing in this spec can.
2. The simulators seal their tokens under the key the bank and Google connectors already use (`FRANKI_BANK_TOKEN_KEY`). A Demo_Visit needs that key and the model settings, and nothing else (Requirement 10 criterion 11).

### Who builds what (brief 054, "Parts")

| Part | What | Who |
|---|---|---|
| A | This spec | Kiro |
| B | The persona-author skill and the taste steering file | Kiro |
| C | Server: anonymous flag, pairing, plays-owner, simulators, routing ports, connectors at seed, guards, switch | Claude |
| D | Web: button, anonymous sign-in, the visit's fixture, account menu, the two sheets | Claude |
| E | The persona under `packages/server/src/seed/kisses/` | Kiro, through the `stitch-persona` workflow |
| F | Review, the whole suite, a look in the browser | Claude |

Part C lands the fixture type changes first, so part E has types to write against.

### Out of scope (brief 054, "What it doesn't do")

1. No account balance read. Large deposits are rows; a balance is not.
2. No upgrade from a demo visit to a real account.
3. No cleanup job for demo tenants a visitor walks away from.
4. No per-visitor spending cap beyond what every account has.
5. The Kisses persona is not offered to signed-in accounts.

## Glossary

- **Demo_Visit**: A visit by an Anonymous_Tenant, which plays Jeffrey on the Kisses_Fixture.
- **Anonymous_Tenant**: A tenant whose verified ID token reports sign-in provider `anonymous`. This is the only thing that makes a tenant a demo tenant.
- **Anonymous_Flag**: The boolean the Token_Verifier reports and the RouteContext carries: true exactly when the verified token's sign-in provider is `anonymous`.
- **Token_Verifier**: The `TokenVerifier` interface in `packages/server/src/auth/guard.ts`, with its live half in `auth/admin-verifier.ts`.
- **Route_Guard**: `guardRequest` in `packages/server/src/auth/guard.ts`, run by `runRoute` in `routes/runtime.ts` before any route logic.
- **RouteContext**: The `RouteContext` in `packages/server/src/routes/runtime.ts`.
- **Jeffrey**: Jeffrey Kisses, the persona, invented. The visitor plays him.
- **Kisses_Fixture**: The second `SeedFixture`, in `packages/server/src/seed/kisses/`, registered in `FIXTURES` (`packages/server/src/seed/persona/index.ts`) beside the first.
- **Riley_Fixture**: The existing `PERSONA` fixture, Riley. Its behavior is unchanged.
- **Sample_Visit**: A visit by a signed-in (non-anonymous) tenant on the Riley_Fixture.
- **Seed_Loader**: `buildSeed` and `loadSeed` (`seed/build.ts`, `seed/load.ts`), with the checks that raise `SeedLoadError`.
- **Reset_Route**: `POST /api/seed/reset`, `resetVisit` in `packages/server/src/seed/reset.ts`.
- **Bank_Port**: `BankPort` in `packages/server/src/bank/plaid.ts`.
- **Google_Port**: `GooglePort` in `packages/server/src/google/port.ts`.
- **Simulated_Bank**: A Bank_Port built from the Kisses_Fixture's bank lines.
- **Simulated_Google**: A Google_Port built from the Kisses_Fixture's mail and calendar lines.
- **Simulator_Token**: The sealed token the seed installs on each demo connector. It carries what a simulator needs (which fixture, the visit's world start, the zone).
- **Routing_Port**: A port that implements both Bank_Port and Google_Port and sends each call to a simulator when the unsealed token is a Simulator_Token, and to the live provider otherwise.
- **Demo_Switch**: The one environment value that turns the demo on or off.
- **Demo_Button**: The button labelled "Kiroween Demo".
- **Mailed_Sender**: A sender the trust rule counts as mailed (`senderMailed` in `packages/server/src/google/read.ts`).
- **Stranger**: A sender who is not a Mailed_Sender.
- **Denied_List**: The list of words no line of the persona may hold: real names and brands, kept broad (large companies and well-known public figures in general), so it reads as a general rule and not as a list about one person. A data file under `packages/server/src/testing/`, written by part B.
- **Demo_Marker**: The address fragment `#demo` on `/lab`. It carries the press of the Demo_Button from the Landing_Page to the Lab.
- **World_Clock_Read**: A read over a simulated connector that takes "now" from the visit's world clock (`ownerClock(...).worldClock`) and not from the ops clock (Requirement 28).
- **Hero_Offer**: The proactive offer built by `TAKEOUT_LATE_V1` (`packages/core/src/patterns/takeout.ts`): takeout on nights with late meetings.
- **Lab**: The page at `/lab`. **Landing_Page**: the front door at `/`.

## Requirements

### Requirement 1: The Kiroween Demo button

**User Story:** As a visitor, I want one obvious button that opens the lab, so that I can try Franki without an account.

#### Acceptance Criteria

1. WHILE the Demo_Switch is on, THE Landing_Page SHALL show the Demo_Button in the hero, and nowhere else on the page. The top bar keeps its "Wake Franki" link unchanged.
2. WHILE the Demo_Switch is on AND the visitor is signed out, THE Lab's signed-out panel SHALL show the Demo_Button beside the existing Google sign-in, which stays.
3. WHILE the Demo_Switch is off, THE Landing_Page and THE Lab's signed-out panel SHALL show no Demo_Button, no placeholder and no explanation. UNTIL the browser has the switch's answer (Requirement 15 criterion 8), they SHALL show nothing for it either.
4. THE Demo_Button SHALL read "Kiroween Demo", SHALL be reachable and operable by keyboard, and SHALL have a target of at least 44 px.
5. THE Demo_Button's label SHALL live in the copy files (`apps/web/src/ui/copy.ts` for the Lab, `apps/web/src/ui/copy-landing.ts` for the Landing_Page) and SHALL follow the copy rules (sentence case where it applies, no Banned_Cause_Words).
6. THE Lab SHALL NOT import anything from `components/landing/` or `ui/landing/` to show its Demo_Button.
7. THE Landing_Page's Demo_Button SHALL be a link to `/lab#demo`. It SHALL NOT start a sign-in itself, so the Landing_Page needs no Firebase code.

### Requirement 2: One press opens the lab

**User Story:** As a visitor, I want one press to put me in the lab, so that nothing stands between me and Franki.

#### Acceptance Criteria

1. WHEN the visitor presses the Demo_Button, THE Browser_Client SHALL sign in with Firebase anonymous sign-in and open the Lab, with no popup, no form, and no request for an email account or a bank.
2. WHEN the anonymous sign-in succeeds, THE Browser_Client SHALL start the visit with the Kisses_Fixture's ID in the reset request, and the visit SHALL be Jeffrey's.
3. EACH anonymous sign-in SHALL create its own Firebase user, and so its own tenant. THE system SHALL NOT use a shared account for any visitor.
4. IF the anonymous sign-in fails, THEN THE Lab SHALL stay signed out and SHALL show the cause in plain words, without a token or a config value.
5. WHEN the page is reloaded during a Demo_Visit, THE Browser_Client SHALL restore the same anonymous user and resume the same visit, as a signed-in visit does.
6. WHEN the Lab loads at `/lab#demo` AND no user is signed in, THE Browser_Client SHALL sign in anonymously, once, and SHALL then remove the Demo_Marker from the address, so a reload does not repeat the press. THE Lab SHALL NOT ask the visitor a second time.
7. WHEN the Lab loads at `/lab#demo` AND a signed-in, non-anonymous user is present, THE Browser_Client SHALL NOT replace that user's session. THE Lab SHALL open as that user and SHALL show one line with one button, "Sign out and open the demo". ONLY that button's press SHALL sign the user out (closing their calls and Sessions as a sign-out does) and start the demo.
8. WHEN the Lab loads at `/lab#demo` AND an anonymous user is already signed in, THE Browser_Client SHALL remove the Demo_Marker and change nothing else.
9. THE Browser_Client MAY read Firebase's `isAnonymous` to decide what to display and what to offer. It SHALL NOT use it to authorize or to choose what the server does.

### Requirement 3: The account menu

**User Story:** As a visitor, I want the menu to say who I am playing, so that I know this is a demo.

#### Acceptance Criteria

1. WHILE the visit is a Demo_Visit, THE account menu's trigger SHALL show "Jeffrey Kisses" and SHALL mark the visit as a demo.
2. THE account menu SHALL NOT show "(no email)" on a Demo_Visit, and `App.tsx` SHALL NOT fall back to that string for an anonymous user.
3. THE persona's display name in the browser SHALL equal the Kisses_Fixture's own name for Jeffrey. THE browser SHALL hold it as a constant beside the fixture ID, and a test SHALL fail if the two differ, as `scripts/persona-fixture-id.test.ts` does for the fixture ID.
4. THE account menu SHALL keep Sign out and Delete my data. Their behavior on a Demo_Visit is Requirement 16.
5. A signed-in visitor's menu SHALL be unchanged.

### Requirement 4: The anonymous flag comes from the verified token

**User Story:** As the owner, I want "demo" to be something the server checks, so that no browser can claim it.

#### Acceptance Criteria

1. THE Token_Verifier SHALL return, with the `uid`, whether the verified token's sign-in provider is `anonymous`.
2. THE live Token_Verifier SHALL read that fact from the claims the Admin SDK's `verifyIdToken(idToken, true)` has already verified, so the revocation check stays.
3. THE Route_Guard SHALL pass the Anonymous_Flag to `runRoute`, and `runRoute` SHALL put it on every RouteContext.
4. THE Anonymous_Flag SHALL be read from the verified token on every request. THE system SHALL NOT read it from a request body, a query string, a header other than the bearer token, a stored field or a browser-held value.
5. IF the token carries no sign-in provider, or any provider other than `anonymous`, THEN THE Anonymous_Flag SHALL be false.
6. THE Token_Verifier fakes used by existing tests SHALL keep working without change and SHALL report false.
7. A server decision that depends on a Demo_Visit (Requirements 5, 7, 10, 14, 15, 16) SHALL take the Anonymous_Flag as an argument. Pure code in `packages/core` SHALL receive it as an argument and SHALL NOT read it from anywhere else.
8. WHERE a request has no verified token (the errand run endpoint, background work), THE Anonymous_Flag SHALL be absent and a decision that needs to know SHALL take it from the connector (Requirement 28). THE system SHALL store no demo flag anywhere.

### Requirement 5: Anonymous and Jeffrey go together

**User Story:** As a visitor, I want Start over and forget to touch only my visit, and as the owner I want the persona kept off real accounts.

#### Acceptance Criteria

1. WHEN the Reset_Route receives a request from an Anonymous_Tenant naming the Kisses_Fixture's ID, THE Reset_Route SHALL clone the Kisses_Fixture into that tenant.
2. WHEN the Reset_Route receives a request from a tenant that is not anonymous naming the Kisses_Fixture's ID, THE Reset_Route SHALL refuse it with the same closed answer as an unknown fixture ID (`scopeError`).
3. WHEN an Anonymous_Tenant names any fixture other than the Kisses_Fixture, THE Reset_Route SHALL refuse it with the same `scopeError`, and SHALL NOT substitute the Kisses_Fixture.
4. WHEN the Reset_Route refuses a request under criteria 2 or 3, THE Reset_Route SHALL refuse before the fence: no barrier raised, no epoch raised, nothing cleared, no row written.
5. FOR any reset request, an anonymous tenant SHALL end with the Kisses_Fixture or a refusal, and a non-anonymous tenant SHALL NEVER end with the Kisses_Fixture.
6. THE Sample_Visit's reset, its fixture ID, its answers and its tests SHALL be unchanged.
7. WHEN a Demo_Visit presses Start over, THE visit SHALL be cloned again from the Kisses_Fixture in the same tenant, with a new namespace, and SHALL NOT touch any other tenant.
8. THE Kisses_Fixture SHALL NOT be offered to signed-in accounts, in the browser or on the server.

### Requirement 6: The persona is a second SeedFixture

**User Story:** As the author of the persona, I want the same types, loader and checks as the first fixture, so that Jeffrey cannot bypass a rule Riley obeys.

#### Acceptance Criteria

1. THE Kisses_Fixture SHALL be a `SeedFixture` in `packages/server/src/seed/kisses/` with `origin: "authored"`, a 43-character ID in the shape the route accepts, and a `windowDays`, registered in `FIXTURES` beside the Riley_Fixture.
2. THE Kisses_Fixture SHALL use the existing line types (`turn`, `mail`, `calendar`, `bank`), the existing Seed_Loader and the existing checks (exact spans, closed schemas, W-LINEAGE).
3. WHEN the Kisses_Fixture is loaded through the real Seed_Loader, THE load SHALL raise no `SeedLoadError`.
4. THE design MAY add a new optional field to a fixture line type. Lines of the Riley_Fixture that omit it SHALL build exactly the rows they build today.
5. THE design SHALL add no new record kind unless it shows that the demo cannot be done without one.
6. THE fixture type changes SHALL land before the persona is written (part C before part E).
7. THE browser's copy of the Kisses_Fixture ID SHALL be pinned to the server's by a test that fails if they differ.
8. THE import from `kisses/` into `FIXTURES` SHALL NOT create a circular import with `persona/`.
9. `FIXTURES` SHALL keep the Riley_Fixture's ID and contents exactly as they are.

### Requirement 7: The visitor plays Jeffrey

**User Story:** As a visitor, I want Franki to greet me as Jeffrey and not ask my name, so that the demo starts on the first line.

#### Acceptance Criteria

1. WHILE the visit is a Demo_Visit, THE Head compile SHALL let Jeffrey's name, resting on fixture Evidence only, reach the Head's name line.
2. WHILE the visit is a Demo_Visit, THE open SHALL NOT offer the first-meeting line ("What should I call you?"), and `meetOffer` SHALL return no offer.
3. FOR every visit that is not a Demo_Visit, THE existing rule SHALL hold: a name resting only on fixture Evidence is not the visitor's, never reaches the Head, and does not close the first meeting. A Sample_Visit is asked for its name as it is today.
4. THE Head compile in `packages/core` SHALL stay pure. WHETHER the visit is a Demo_Visit SHALL arrive as an argument from the route that holds the Anonymous_Flag.
5. THE design SHALL say how the Head's inputs learn this without trusting the browser (brief 054 ruling 5).
6. WHEN Franki opens a call on a Demo_Visit, THE opening SHALL greet Jeffrey by name.
7. THE name SHALL still pass `promotableName` (at most 40 characters and four words, letters and the allowed marks).
8. IN a company or unknown audience, THE name SHALL still never reach the Head (existing rule, unchanged).
9. WHEN Jeffrey says "forget my name" on a Demo_Visit, THE name SHALL be gone from the next thought as for any forget, and Franki SHALL still not offer the first-meeting line.
10. THE first-meeting exception SHALL be for a Demo_Visit only. Owner ruling M-1 (Nov 18, `packages/server/src/meet.ts`: a Sample_Visit is asked for its name like any other account) stays true for every other visit.

### Requirement 8: A simulated bank at the port

**User Story:** As a visitor, I want Franki to answer about Jeffrey's money from a bank that looks connected, with no real bank behind it.

#### Acceptance Criteria

1. THE Simulated_Bank SHALL implement the whole Bank_Port from the Kisses_Fixture's bank lines.
2. THE Simulated_Bank's `accounts` SHALL answer one institution named for the persona, with the persona's accounts (name, mask, type, subtype), at most `BANK_ACCOUNTS_MAX`.
3. THE Simulated_Bank's `sync` SHALL answer the fixture's lines as provider transactions with: exact integer cents, the provider's sign (a purchase positive, a refund or deposit negative), USD, dates and instants in the visit's zone placed from the world start in the Simulator_Token, `pending` as authored, and a detailed category code that the existing `groupOf` and `codeKind` read.
4. THE Simulated_Bank's `sync` SHALL follow the port's paging contract (`nextCursor`, `hasMore`, the update status) so that the real `pullBank` runs unchanged. After a full sync, a later sync with the returned cursor SHALL answer no additions.
5. THE Simulated_Bank SHALL make no network call and SHALL read no environment value.
6. THE Simulated_Bank's `linkToken` and `exchange` SHALL NOT be reachable (Requirement 14), and SHALL refuse if called.
7. THE Simulated_Bank's `remove` SHALL succeed with no effect outside the process.
8. THE Simulated_Bank SHALL offer no balance. Large deposits are rows.
9. EACH bank row's amount SHALL be at most `BANK_CENTS_MAX` ($100 billion) in absolute value.
10. EVERYTHING above the port SHALL be the real product: the pull, the import (`source: "plaid"`), `read_money`, the Gate, the errand runner, the planner, the reader and the trust rule.
11. THE category code and the account of a fixture bank line SHALL come from two new optional fields on `BankLine`: a detailed category code and an account reference. A line that omits the code SHALL take a default from `category` through the existing mapping (`takeout` is `FOOD_AND_DRINK_FAST_FOOD`, `groceries` is `FOOD_AND_DRINK_GROCERIES`, `restaurant` is `FOOD_AND_DRINK_RESTAURANT`), and a line that omits the account SHALL take the fixture's first account. A line that gives a code whose `bankCategoryOf` differs from its `category` SHALL fail the load. The Riley_Fixture SHALL build the same rows as today.

### Requirement 9: A simulated Google at the port

**User Story:** As a visitor, I want Franki to read Jeffrey's mail and calendar as if they were connected, with no Google behind them.

#### Acceptance Criteria

1. THE Simulated_Google SHALL implement the whole Google_Port from the Kisses_Fixture's mail and calendar lines.
2. THE Simulated_Google's `refresh` SHALL answer a simulated access token that is itself a Simulator_Token, so that the data calls, which carry only an access token, route to the simulator (Requirement 10).
3. THE Simulated_Google's `listMessages` SHALL answer the fixture messages that match the query the product's own builder (`gmailQuery`) writes, including `in:sent to:<address>` and sender, word, date and unread terms, up to the port's maximum.
4. THE Simulated_Google's `getMessage` SHALL answer a payload that `google/mail.ts` reads like Gmail's: headers, a body, labels (a `SENT` label on the owner's own mail), list or bulk markers on bulk mail, and an `Authentication-Results` header from `mx.google.com` carrying the fixture's DMARC verdict for that line (Requirement 13).
5. THE Simulated_Google's `listEvents` SHALL answer the fixture's events as Google's list does: the latest revision of each event, its zone, start, end, status, the owner's response, transparency, and paging.
6. THE Simulated_Google's `exchangeCode` SHALL NOT be reachable (Requirement 14) and SHALL refuse if called. Its `revoke` SHALL succeed with no effect outside the process.
7. THE Simulated_Google SHALL be read-only: it SHALL reach no endpoint outside `GOOGLE_ENDPOINTS` and SHALL send, draft, label or change nothing.
8. THE Simulated_Google SHALL make no network call.
9. EVERYTHING above the port SHALL be the real product (the reader, the planner, the errand runner, the trust rule, the Gate).

### Requirement 10: Routing is by token

**User Story:** As the owner, I want a demo token never to reach Plaid or Google, and a real token never to reach a simulator.

#### Acceptance Criteria

1. THE Routing_Port SHALL be the port the runtime hands out (`bankRuntime`, `googleRuntime`) in place of the live port. Test overrides through `deps.bank` and `deps.google` SHALL still win.
2. WHEN a call carries a token that, once unsealed, is a Simulator_Token, THE Routing_Port SHALL send it to the simulator.
3. WHEN a call carries any other token, THE Routing_Port SHALL send it to the live provider.
4. A Simulator_Token SHALL carry what the simulator needs: which fixture, the visit's world start and the zone.
5. A token a live provider issues SHALL NEVER read as a Simulator_Token, and a Simulator_Token SHALL NEVER read as a live token.
6. IF a token has the Simulator_Token marker but does not parse, THEN THE Routing_Port SHALL refuse the call and SHALL NOT forward it to a live provider.
7. A simulated access token (Requirement 9 criterion 2) SHALL route by the same rule.
8. THE Routing_Port's methods that carry no token (`linkToken`, `exchange`, `exchangeCode`) SHALL go to the live provider, and Requirement 14 keeps a Demo_Visit away from them.
9. FOR any sequence of calls, a Simulator_Token SHALL never reach a live provider, and a non-simulator token SHALL never reach a simulator.
10. THE simulators SHALL NOT be reachable from a request body, a query string or a browser-held value.
11. A Demo_Visit SHALL need only `FRANKI_BANK_TOKEN_KEY` and the model settings every visit needs. WHEN the Plaid or Google client settings are missing, a Demo_Visit SHALL still read the simulated bank, mail and calendar, the Google errand agents SHALL still register for it, and the live half of each Routing_Port SHALL refuse every call. A deployment that is not demo-enabled SHALL behave as today when those settings are missing.

### Requirement 11: The seed installs the connectors

**User Story:** As a visitor, I want the bank, mail and calendar already connected when I arrive.

#### Acceptance Criteria

1. WHEN the Reset_Route clones the Kisses_Fixture, THE Reset_Route SHALL install one bank connector and the Gmail and Calendar connectors in the connected state, each with a sealed Simulator_Token, before it unblocks the tenant.
2. THE sealed tokens SHALL use the same seal functions and key as a real connection, bound to the tenant and the connector ID, so the existing unseal path reads them.
3. THE connectors SHALL be the existing connector records. Requirement 6 criterion 5 applies.
4. THE Gmail and Calendar connectors SHALL show the scopes a real grant would, and SHALL be readable (`isReadableGoogle`).
5. WHEN a Demo_Visit presses Start over, THE reset SHALL install the three connectors again with fresh Simulator_Tokens carrying the new visit's world start and zone, so no token from the earlier visit stays.
6. WHEN the reset clones the Riley_Fixture, THE connectors SHALL be left as they are today (a connected bank stays; brief 046 ruling 9).
7. THE bank rows SHALL arrive through the real pull. A reset SHALL clear the bank cursors as it does today, so the next pull imports again.
8. THE install SHALL be part of the reset's own writes, so a crashed reset is retried or taken over as any other reset is.

### Requirement 12: One authored list, two readers

**User Story:** As the owner, I want the numbers Franki says to match the rows the hero reads, to the cent.

#### Acceptance Criteria

1. THE Kisses_Fixture's bank lines SHALL be seeded as fixture Evidence (read by the hero) and served by the Simulated_Bank (read by `read_money` as imported rows).
2. FOR any period, group and merchant, THE total `read_money` gives over the Simulated_Bank SHALL equal the sum of the fixture's bank lines that match.
3. THE Kisses_Fixture's mail lines SHALL be seeded as fixture Evidence and served by the Simulated_Google with the same sender, address, subject, body and time.
4. THE Kisses_Fixture's calendar lines SHALL be seeded as fixture Evidence (all revisions) and served by the Simulated_Google (the latest revision) with the same title, start, length, status and response.
5. THE hero SHALL read only the seeded fixture rows. `read_money` and the errands SHALL read only the connected rows. No total SHALL mix the two (existing rules `isConnectedBankRow` and `isConnectedGoogleRow`, unchanged).
6. A pending fixture bank line SHALL be served as pending, and SHALL stay out of totals as it does for imported rows.
7. THE simulators SHALL date every row from the visit's world start, so a fixture line and its simulated twin fall on the same civil date and instant. Which "now" a read measures a period or a day from is Requirement 28.

### Requirement 13: Mail trust comes from the fixture

**User Story:** As the owner, I want Franki to decide how to treat a sender by the same rule as for any real account.

#### Acceptance Criteria

1. A fixture mail line SHALL be able to say whether its sender passes DMARC, as a new optional field on the line type. A line that omits it SHALL read as a pass, as every seeded message does today.
2. THE Simulated_Google SHALL turn that field into the `Authentication-Results` header that `senderAuthOf` reads (`aligned`, `failed` or `unknown`), and the seeded row's `senderAuth` SHALL follow the same field, so the two readers agree.
3. A sender SHALL count as mailed by the rule in `senderMailed` and by no other: Gmail's DMARC verdict passed for the From domain, Jeffrey's own sent mail to that exact address is in the fixture, and the message is not bulk or list mail. THE simulator SHALL supply the DMARC verdict, the sent mail and the bulk markers from the fixture, and `senderMailed` SHALL run unchanged.
4. THE fixture SHALL NOT carry a field that says "mailed". The answer SHALL come from the trust rule.
5. THE Kisses_Fixture SHALL have at least one Mailed_Sender and at least one Stranger.
6. FOR any fixture mail line, the decision to speak it or show it as a card SHALL equal what the trust rule gives for that line's sender.

### Requirement 14: Demo visitors can't reach outside

**User Story:** As the owner, I want a demo visitor to be unable to place a call or reach a provider.

#### Acceptance Criteria

1. WHILE the visit is a Demo_Visit, THE phone SHALL NOT be offered: the specialist catalog SHALL report `phone` as unavailable, the call's tool list SHALL NOT hold `make_phone_call` or the phone-report tools at any time, including before the first state answer, and a typed reply SHALL NOT offer them. `read_money` SHALL stay offered on a typed turn: the typed turn's single tool flag is split into a phone flag and a money flag.
2. IF a Demo_Visit's tool route or turn route is asked to place a phone call, THEN THE server SHALL refuse, SHALL place no dial and SHALL write no `phoneCall` row.
3. IF a Demo_Visit asks for a Plaid Link token or a bank connect, THEN THE server SHALL refuse it before any call to Plaid.
4. IF a Demo_Visit asks to start a Google sign-in or complete a Google connect, THEN THE server SHALL refuse it before any call to Google.
5. THE refusals SHALL be closed route errors with no detail in the body, as the existing routes give.
6. WHILE the visit is a Demo_Visit, web search SHALL stay available as for any visit.
7. FOR any tool call on a Demo_Visit, no phone dial SHALL be placed and no live Plaid or Google call SHALL be made.
8. IF a Demo_Visit asks to disconnect the bank or Google, THEN THE server SHALL refuse it with the same closed answer. THE disconnects that account delete runs are not routes and SHALL be unaffected. THE guards for Plaid Link and Google sign-in SHALL sit at the routes, because the port methods they would reach carry no token to route by.

### Requirement 15: A switch

**User Story:** As the owner, I want to turn the demo off with one value.

#### Acceptance Criteria

1. THE system SHALL have one environment value, the Demo_Switch, named `FRANKI_DEMO`. THE demo SHALL be on only when its value equals `on`. Absent, empty or any other value SHALL be off. No other setting SHALL turn the demo on or off.
2. WHILE the Demo_Switch is off, THE Landing_Page and THE Lab SHALL hide the Demo_Button (Requirement 1 criterion 3).
3. WHILE the Demo_Switch is off, THE Route_Guard SHALL refuse every request whose verified token is anonymous, with the same closed authentication answer as a rejected token, before any route logic and before any store call.
4. WHILE the Demo_Switch is off, a refused anonymous request SHALL create, read and change nothing.
5. THE Demo_Switch SHALL NOT change anything for a signed-in non-anonymous user.
6. THE Demo_Switch SHALL be a named value in `apps/web/apphosting.yaml` and SHALL pass the env sync check.
7. `/api/health` output SHALL stay unchanged.
8. THE browser SHALL learn whether the switch is on from one unauthenticated `GET` route that answers `{ "enabled": true }` or `{ "enabled": false }` and nothing else. THE route SHALL read no tenant, SHALL be separate from `/api/health`, and SHALL answer with `cache-control: no-store`.

### Requirement 16: Leaving cleans up

**User Story:** As a visitor, I want my visit to go away when I leave.

#### Acceptance Criteria

1. WHEN a Demo_Visit signs out, THE Browser_Client SHALL close its calls and Sessions as a sign-out does, then delete the account on the server, then sign out locally.
2. THE account delete SHALL remove the tenant and the anonymous Firebase user, as Delete my data does, including the bank and Google disconnects, which SHALL go to the simulators.
3. A Demo_Visit's delete SHALL NOT call Plaid or Google.
4. WHEN a Demo_Visit uses Delete my data, THE result SHALL be the same as a sign-out.
5. IF the delete does not finish within the sign-out limit (`SIGN_OUT_LIMIT_MS`, the one a sign-out already waits), THEN THE Browser_Client SHALL sign out locally anyway, so a visitor who chose to leave is never stuck. A tenant left behind is the walked-away case of criterion 6.
6. THE system SHALL NOT add a cleanup job for demo tenants a visitor walks away from.

### Requirement 17: The Bank sheet and the Gmail and Calendar sheet

**User Story:** As a visitor, I want the connection sheets to show what Franki is reading and to say it is simulated.

#### Acceptance Criteria

1. WHILE the visit is a Demo_Visit, THE Bank sheet SHALL show one connected bank, named for the persona, with its accounts, and SHALL say plainly that it is simulated.
2. WHILE the visit is a Demo_Visit, THE Gmail and Calendar sheet SHALL show Jeffrey's mail and calendar as connected, and SHALL say plainly that they are simulated.
3. NEITHER sheet SHALL offer Connect or Disconnect on a Demo_Visit. The way-in buttons that open the sheets stay.
4. THE sheets SHALL show only what the server answered, with no field of their own, and no amounts, as they do today. THE bank and Google status answers SHALL carry one new closed boolean `simulated`, set by the server from the Anonymous_Flag and present only when true, and a sheet SHALL say "simulated" only when the server says so. THE bank status answer SHALL report `canConnect` false on a Demo_Visit.
5. THE sheets' copy SHALL live in `apps/web/src/ui/copy.ts` and follow the copy rules.
6. A Sample_Visit's sheets and a real connection's sheets SHALL be unchanged.

### Requirement 18: "How much did I spend on rocket fuel this month?"

**User Story:** As a visitor, I want a spending question answered from Jeffrey's bank.

#### Acceptance Criteria

1. WHEN the visitor asks how much Jeffrey spent on rocket fuel this month, THE answer SHALL come from `read_money` over the Simulated_Bank's imported rows.
2. THE answer's total SHALL be the sum of the cents of the rows it names, and every figure SHALL trace to those rows.
3. THE model SHALL give only the question's shape (period, group, merchant) and SHALL NOT give an amount, a total or a date.
4. THE answer SHALL say how fresh the read is, as `read_money` does today.
5. THE answer SHALL NOT give advice and SHALL NOT call a pattern a cause.
6. THE Kisses_Fixture SHALL hold rocket-fuel rows in the last days of its window, so this question has rows to answer from (Requirement 28 says which "now" it is read against).
7. THE question SHALL work on a call and on a typed turn.

### Requirement 19: Mail and calendar questions

**User Story:** As a visitor, I want Franki to look through Jeffrey's mail and calendar when I ask.

#### Acceptance Criteria

1. WHEN the visitor says "Check my mail for anything from mission control", THE system SHALL answer through the mail errand over the Simulated_Google.
2. WHEN the visitor says "What's on my calendar today?", THE system SHALL answer through the calendar errand over the Simulated_Google, with "today" read against the visit's world clock (Requirement 28).
3. THE specialist catalog SHALL report `mail` and `calendar` as ready on a Demo_Visit, so `start_errand` is offered.
4. THE answers SHALL pass through the real errand runner, planner, reader and Gate, so a third-party line is spoken or carded by the trust rule.
5. THE Kisses_Fixture SHALL hold mail from a sender the question can find ("mission control" is an invented sender) and at least one event today.
6. THE questions SHALL work on a call, which is the only path that offers errands to any account. Typed turns SHALL NOT offer them, on a Demo_Visit as on every visit.

### Requirement 20: The hero offer

**User Story:** As a visitor, I want the hero offer to arrive the usual way, with Jeffrey's own rows behind it.

#### Acceptance Criteria

1. THE Hero_Offer SHALL be computed by `TAKEOUT_LATE_V1` from the Kisses_Fixture's own seeded rows, never from connected rows.
2. ON the clone's Friday, THE pattern SHALL yield an offer: status `eligible` and `mostly`, with the 21-date window, at least 14 covered dates, at least 6 posted takeout orders, and a majority of both count and cents on nights with an accepted, confirmed, opaque, timed meeting at or after 18:00.
3. THE offer SHALL arrive by the same route as for the Riley_Fixture (the proactive Moment, the card, and the Gate).
4. THE offer's wording SHALL be an association only and SHALL NOT call the pattern a cause.
5. THE persona SHALL set a small takeout habit beside very large everything else, so the contrast is the joke (Requirement 25).
6. EVERY number in the offer SHALL trace to a source row.

### Requirement 21: "What do you know about me?"

**User Story:** As a visitor, I want Franki to say what Jeffrey has told him.

#### Acceptance Criteria

1. WHEN the visitor asks "What do you know about me?", THE answer SHALL recall what Jeffrey has told Franki: Memories from the Kisses_Fixture's turns.
2. EVERY Memory SHALL resolve through its spans to the Evidence line that carries it (lineage, KC03, W-LINEAGE).
3. THE answer SHALL NOT say anything for which the fixture has no line.
4. THE answer SHALL follow the Gate: sensitive lines stay out of a company audience.

### Requirement 22: A stranger's mail is mail

**User Story:** As the owner, I want a stranger's instructions never treated as orders.

#### Acceptance Criteria

1. THE Kisses_Fixture SHALL hold at least one mail line from a Stranger whose body tells Franki to do something.
2. WHEN Franki reads that line, THE system SHALL treat it as mail: attributed and carded as the trust rule decides, never as an order.
3. MAIL SHALL NEVER write a rule, a preference, an identity or a permission, and SHALL NEVER change a belief.
4. THE line's instruction SHALL be counted as a directive (`directiveCount`) and SHALL NOT be done.

### Requirement 23: Everything a sample visit does works here too

**User Story:** As a visitor, I want the whole lab to work on the demo.

#### Acceptance Criteria

1. ON a Demo_Visit, THE call, typed turns, the visit bar, the bolts, Start over, the Lab and the jar SHALL work as on a Sample_Visit.
2. THE simulated clock SHALL be labelled as simulated, as on a Sample_Visit.
3. THE Sample_Visit's existing tests SHALL pass unchanged.
4. THE Demo_Visit SHALL be walked in the browser (specimens page or Lab) before the lane is done.

### Requirement 24: The product rules bind every part

**User Story:** As the owner, I want the demo to obey every rule the product obeys.

#### Acceptance Criteria

1. ALLERGIES SHALL be hard rules in every food path, failing closed, on a Demo_Visit.
2. NO tool SHALL move money. THE system SHALL give no investment, tax or legal advice. EVERY number SHALL trace to a source row.
3. A PATTERN SHALL NEVER be called a cause.
4. A crisis SHALL get care plus 988.
5. A forget SHALL leave the forgotten thing gone from the next thought, and it SHALL stay forgotten.
6. MAIL SHALL inform and SHALL NOT give orders, change a belief or grant a permission.
7. THE Clock_Port, a source on every field, lineage, closed schemas and the Admission_Seam SHALL be untouched.
8. THE simulators SHALL read time from the injected clock and SHALL NOT read the wall clock. `scripts/clock-allowlist.json` SHALL NOT grow for them.
9. THE import-boundary rules SHALL hold: `packages/core` imports no I/O, and `packages/server` imports neither `next` nor `apps/web`.
10. A demo-only code path SHALL NOT weaken a rule for any other visit.

### Requirement 25: Taste rules for the persona

**User Story:** As the owner, I want Jeffrey to be funny by scale and never the butt of a mean joke.

#### Acceptance Criteria

1. EVERYTHING in the persona SHALL be invented: merchants, senders, events, addresses, places and Jeffrey himself. NO line SHALL name a real person, company, product, place of business or trademark, or describe a real person's life, family, looks, health or politics.
2. NO line of the persona SHALL hold a word from the Denied_List. THE Denied_List SHALL be kept broad: large companies and well-known public figures in general, so it reads as a general rule and not as a list about one person.
3. FRANKI SHALL treat Jeffrey as anyone else: warm, a little amused, never fawning and never mocking.
4. JEFFREY SHALL be likeable: he calls his mother, tips well, and forgets to cancel subscriptions.
5. THE joke SHALL be the size of ordinary things: rocket fuel next to a late library fee, a very large deposit next to a $9 sandwich, a launch window that keeps landing on dinner.
6. THE persona SHALL be clean: nothing crude, nothing about bodies, nothing political.
7. THE persona SHALL be true to the product: exactly one real allergy, stated in Jeffrey's own words, and no fact without a line that carries it.
8. EVERY amount SHALL stay under `BANK_CENTS_MAX`.

### Requirement 26: What the persona must hold

**User Story:** As the author of the demo, I want a list of what the persona has to contain so every try-it item works.

#### Acceptance Criteria

1. THE Kisses_Fixture SHALL hold Jeffrey's turns (his name, his habits, his allergy, his mother, his subscriptions), enough for Requirements 7, 20 and 21.
2. THE Kisses_Fixture SHALL hold mail, including bulk mail, at least one Mailed_Sender, at least one Stranger, mail from "mission control" and a Stranger's instruction (Requirements 13, 19 and 22).
3. THE Kisses_Fixture SHALL hold calendar events, including late meetings for the hero and an event today (Requirements 19 and 20).
4. THE Kisses_Fixture SHALL hold bank rows: a small takeout habit for the hero, rocket fuel, large deposits, and one connected bank's accounts (Requirements 8, 18 and 20).
5. THE persona SHALL be written by Kiro under `packages/server/src/seed/kisses/` through the `stitch-persona` workflow, with the persona-author skill and the taste steering file from part B.

### Requirement 27: How this is checked

**User Story:** As the owner, I want each ruling to have a check.

#### Acceptance Criteria

1. THE Kisses_Fixture SHALL load through the real Seed_Loader with no `SeedLoadError`, and `TAKEOUT_LATE_V1` SHALL yield an offer on the clone's Friday.
2. THE design SHALL carry these as fast-check properties, red first where possible: Agreement (Requirement 12), No crossing (Requirement 10), Pairing (Requirement 5), No way out (Requirement 14), Trust (Requirement 13) and Taste (Requirement 25), and any further property the design needs.
3. THE Sample_Visit's existing tests SHALL pass unchanged.
4. A Demo_Visit SHALL be walked on the specimens page or in the Lab, in the browser.
5. WHEN the lane is done, THE report SHALL be written to `docs/briefs/054-report.md`: what was built, by whom, what was checked and how, contract questions, and what was not tried.


### Requirement 28: Reads over a simulated connector use the visit's world clock

**User Story:** As a visitor, I want "this month" and "today" to mean the visit's month and day, so that the answers follow the visit bar and the bolts and find the rows Jeffrey's data holds.

#### Acceptance Criteria

1. WHEN the money read measures a period ("this month", "last week" and the rest), THE read SHALL take "now" from the visit's world clock IF the visit reads on the world clock (criterion 3), and from the ops clock otherwise.
2. WHEN the mail and calendar agents resolve a time phrase ("today", "yesterday", "this week"), THE agents SHALL take "now" from the visit's world clock IF the visit reads on the world clock, and from the ops clock otherwise.
3. A visit reads on the world clock when its request carries a verified token whose Anonymous_Flag is true. WHERE the request carries no token (the errand run endpoint, background work), a visit reads on the world clock when a connector of the tenant holds a token that, unsealed, is a Simulator_Token. THE system SHALL store no flag for this. A request whose Anonymous_Flag is false SHALL read on the ops clock without opening any connector.
4. THE freshness line of a money read ("last read 5 minutes ago") and every lease, deadline and expiry SHALL stay on the ops clock, since a pull really happens in real time.
5. EVERY other visit SHALL read on the ops clock exactly as today (brief 046 ruling 10 and review fix E3 are unchanged for a live connector).
6. A Demo_Visit's reads SHALL NOT read the wall clock. "Now" arrives as an argument from `ownerClock`.

## Resolved questions

The first draft of this file ended with sixteen open questions. The owner answered each one. The answers are folded into the requirements above. In the list below, "Q" is the question's number in that draft.

1. **Q1, the switch.** Ruling: `FRANKI_DEMO`, on only when it equals `on`, plus one unauthenticated `GET` route that returns `{ enabled }` and nothing else. In Requirements 1 and 15.
2. **Q2, the landing press.** Ruling: the landing button links to `/lab#demo`, and the Lab signs in anonymously when it finds the marker. In Requirements 1 and 2.
3. **Q3, a real user presses the button.** Ruling (changed from the draft): a signed-in, non-anonymous user is never replaced silently. The Lab opens as that user and shows one line with one button, "Sign out and open the demo". Only that press signs them out and starts the demo. In Requirement 2.
4. **Q4, an anonymous tenant names the Riley fixture.** Ruling: refuse, with the same `scopeError` as an unknown fixture. In Requirement 5.
5. **Q5, fixture bank lines.** Ruling: two optional fields on `BankLine`, a detailed category code and an account reference, with the default mapping so the first persona builds the same rows. In Requirement 8.
6. **Q6, "this month" and "today".** Ruling (with one change): reads over a simulated connector use the visit's world clock. The anonymous flag decides where a request token exists. Where none exists (the errand run endpoint, background work), the connector decides: one whose unsealed token is a Simulator_Token reads on the world clock. No stored flag. In Requirement 28.
7. **Q7, Start over.** Ruling: the reset reinstalls the three connectors with fresh Simulator_Tokens. In Requirement 11.
8. **Q8, settings.** Ruling: a Demo_Visit needs only the token key and the model settings. In Requirement 10.
9. **Q9, background work and typed turns.** Ruling, both parts: split the typed-turn flag so `read_money` stays; mail and calendar questions stay call-path only. In Requirements 14 and 19.
10. **Q10, where the button goes.** Ruling: the hero only, plus the Lab's signed-out panel. In Requirement 1.
11. **Q11, the persona's name and "simulated" in the browser.** Ruling: a constant pinned to the fixture by a test, and a closed `simulated` boolean on the two status answers. In Requirements 3 and 17.
12. **Q12, the Denied_List.** Ruling: a data file written by part B, kept broad (large companies and well-known public figures in general). In Requirement 25 and the Glossary.
13. **Q13, the first meeting against owner ruling M-1.** Ruling: an exception for a Demo_Visit only. In Requirement 7.
14. **Q14, what "mailed" means.** Ruling: keep the code's rule (DMARC pass, sent mail to the exact address, not bulk), with the simulator supplying the three facts. In Requirement 13.
15. **Q15, disconnect and token-less routes.** Ruling: refuse the disconnect routes on a Demo_Visit, and guard Link and Google sign-in at the routes. In Requirement 14.
16. **Q16, sign-out when the delete does not finish.** Ruling: wait a bounded time, then sign out anyway. In Requirement 16.
