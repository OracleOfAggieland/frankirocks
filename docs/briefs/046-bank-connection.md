# Brief 046: a real bank, read-only (lane `plaid`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

**Who builds this.** Claude builds it from this brief, in three parts. It is not Kiro's work, and its commits do not carry the Kiro trailer.

## What it is

The owner connects a bank through Plaid Link. Plaid's own window takes the bank sign-in, so Franki never sees a bank password. The server then pulls that bank's transactions and Franki can answer questions about spending. Until now money came from fixtures only (spec §14 lists real Plaid among the cuts; the owner has now asked for it).

Product rules that bind every part:

- **Read-only, by construction.** The only Plaid product requested is `transactions`. Never `auth`, `transfer`, `payment_initiation`, `investments`, `liabilities`, `identity`, `assets` or `income`. No route, tool or port method can move money. A test pins the product list and the set of Plaid endpoints the port can reach.
- **Every number traces to a source.** A spoken or shown amount is computed by code from bank rows and names the dates it covers. A model never totals anything.
- **No advice.** No investment, tax or legal advice. No cause words; a pattern is an association.
- **The bank can inform, not instruct.** A merchant name or description is data. It never becomes a rule, a preference, an identity fact or a permission.
- **Forget and disconnect mean gone from the next thought.**
- **A side effect has an audit entry.** Connecting and disconnecting each write a ledger row.

## Rulings for this brief

These are the director's, made so the build can start. Each one that departs from `docs/design/` is recorded under "Contract questions" at the end of this file when the part lands. `docs/design/` itself stays read-only.

1. **Secrets and config.** `PLAID_CLIENT_ID` and `PLAID_SECRET` are Secret Manager secrets (runtime only). `PLAID_ENV` is a plain value, `production` or `sandbox`; anything else is a `ConfigError`. `FRANKI_BANK_TOKEN_KEY` is a secret holding 32 random bytes in base64. Read them the way `phoneConfig` reads Twilio's (`packages/server/src/phone/twilio.ts`), by name, and never open an `.env` file.
2. **The access token.** It is encrypted before it is stored, with AES-256-GCM under `FRANKI_BANK_TOKEN_KEY`, a fresh 12-byte IV per write, and a versioned envelope so the key can be rotated. The connector's ID is bound in as additional authenticated data, so a token copied to another user's document does not decrypt. The token never appears in a route answer, a ledger row, a log line or an error. This departs from `docs/design/architecture-decision.md` (Cloud KMS, decrypt in Functions only): the sync runs in the web backend because the store lives in `packages/server`.
3. **Where it is stored.** `users/{uid}/connectors/{connectorId}`, with a closed, bounded schema that follows `docs/design/memory-contracts-v2.md` lines 224 to 231 (provider, state, generations, cursor, coverage, quota lease, last success, last error). The Plaid-specific part (item ID, institution, accounts, the encrypted token) goes in one nullable sub-object of that record rather than a new collection name, since `connectors` is already in the contract's collection list. `syncPages` is not built (contract: deferred); see ruling 6 for what stands in for it.
4. **Rows are Evidence.** Each bank transaction becomes one Evidence record: `kind: "transaction"`, `source: "plaid"`, `observation.kind: "bank"`, `connectorId` set, `authorship: "imported"`, `extractPacketMode: "source"`. Copy the field choices of the seed's `buildBank` (`packages/server/src/seed/build.ts`), with these differences:
   - IDs are deterministic from the connector and Plaid's `transaction_id`, so pulling the same row twice writes nothing new.
   - Every slice is `class: "O"`, `sens: "S1"` (spec §3: bank rows and category totals are S1).
   - The title is the merchant (`merchant_name ?? name`) through `safeName`, with a ranged text slice.
   - `amountCents` is Plaid's amount in integer cents, same sign (Plaid: positive is money out). Convert without float drift, and refuse a value that is not a whole number of cents.
   - Only `iso_currency_code` rows are kept; a row with no ISO currency is skipped and counted.
   - `purchaseAt`: `authorized_datetime` when present (`providerAuthorized`, `instant`), otherwise `authorized_date ?? date` (`providerDate`, `day`, `civilDate`). `postedAt` is null while pending.
   - `category` maps from `personal_finance_category.detailed` in one pure function with a table test: groceries, restaurant (restaurants, coffee, bars), takeout (fast food and delivery), everything else `other`. Check the current taxonomy on Plaid's site before writing the table.
   - A modified row is a new Evidence revision (`appendEvidenceRevision`), never an edit. A removed row is a new revision with `removed: true`. When a pending row posts, the posted row's `pendingOfId` is the pending row's Evidence ID.
   - A negative amount is kept as it is. `refundOfId` stays null unless the original is known for certain; never guess a refund's original.
5. **The sample visit stays the sample visit.** Every visitor is a clone of the persona with a frozen fixture clock. In `clockMode: "fixture"` the hero, the compare loop and the moments (`readMoneyRows` in `packages/server/src/routes/tool-food.ts`) do not read `source: "plaid"` rows, and a bank pull never writes `core/state.coverage`. A real bank's rows are read only by the new money read in part C, which reads nothing but rows of a connected bank. This keeps persona rows and real rows out of the same total. A test proves the hero's numbers are unchanged with a bank connected.
6. **A pull is all or nothing.** One pull reads `/transactions/sync` from the stored cursor to `has_more: false`, restarting from the stored cursor on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` (three tries). It writes every row, and only then advances the cursor and the connector's coverage in the last transaction (the intent of KS05). A crash midway leaves the old cursor, and the next pull rewrites the same deterministic IDs. One pull at a time per connector, held by the contract's quota lease in a Firestore transaction, not an in-process lock.
7. **No webhook yet.** Pulls happen on connect, when the client asks (`POST /api/bank/sync`), and before a money read when the last success is older than an hour by the ops clock. The first import is polled: the connector stays `syncing` until Plaid reports the historical update complete. Link tokens set no `webhook` and no `redirect_uri`.
8. **Limits.** `transactions.days_requested: 90`. At most 4 connected banks per user. Linking the same institution with a matching account twice removes the new Item at Plaid and answers with the existing connector.
9. **Reset and disconnect.**
   - "Start over" keeps a connected bank: `clearTenant` leaves `connectors` alone, the reset's last transaction sets each connector's cursor to null and its coverage to unknown, and the next pull imports again. The token is never orphaned by a reset.
   - Disconnect calls `/item/remove` first. `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN` count as removed; any other failure leaves the connection as it was and says so. Then the token is erased, the state is `disconnected`, and that connector's rows are no longer read by anything. Delete them if the store has a sanctioned delete for it; otherwise gate every read on the connector's state and say which was done.
10. **Time.** The bank's rows are facts in real time, and a fixture visit's world clock is frozen. A money read over a connected bank resolves "this month" and the like through the pure date resolver with the **ops clock in the owner's zone** as its now, and its answer names the first and last date it covers. All time still comes through the Clock_Port.
11. **Names.** `bank` in routes, screen copy and file names. `plaid` only as the provider value and inside the port.

## The routes (all parts code against this)

All under `apps/web/src/app/api/bank/`, each file `adapt(spec)` only, logic in `packages/server/src/bank/`. Auth and origin checks as every other route. Closed request and response schemas in `packages/core/src/schema/wire.ts`.

| Route | Request | Answer |
|---|---|---|
| `POST /api/bank/link-token` | `{}` | `{linkToken, expiresAt}`. 409 with a reason code at the bank limit. |
| `POST /api/bank/connect` | `{requestId, publicToken, institutionId?, institutionName?}` | `{bank: BankView, existing: boolean}` |
| `GET /api/bank/status` | none | `{banks: BankView[], canConnect: boolean}`. Reads Firestore only, never calls Plaid, writes nothing. |
| `POST /api/bank/sync` | `{connectorId}` | `{bank: BankView}` after one pull (or at once when another pull holds the lease). |
| `POST /api/bank/disconnect` | `{requestId, connectorId}` | `{bank: BankView}` with `state: "disconnected"` |

`BankView` is what the screen may show and nothing more: `{connectorId, institutionName, state, importing, accounts: [{name, mask, type, subtype}], lastSyncedAt, coveredFrom, coveredTo, needsReconnect}`. No balances, no token, no Plaid IDs.

Connect follows the phone call's ledger pattern (`packages/server/src/phone/outbound.ts`): claim a ledger row with a deterministic ID, make the outside call once and never retry an ambiguous one, then complete, fail or block the row. If anything fails after the exchange and before the save, the new Item is removed at Plaid.

## Part A: the server

Scope: config, the Plaid port, token encryption, the connector schema and paths, the five routes, the pull and its Evidence mapping, rulings 5 and 9, tests. No screen work, no voice tool.

- **The port.** A typed `BankPort` on `RouteDeps`, like `dial` and `callStatus`, with a throwing default in `packages/server/src/testing/fakes.ts`. The live one uses plain `fetch` with a timeout and `redirect: "error"`, as the Twilio calls do; no Plaid SDK on the server. It reaches exactly: `/link/token/create`, `/item/public_token/exchange`, `/accounts/get`, `/transactions/sync`, `/item/remove`. Check each request and response against Plaid's current API reference before coding it, including the sync response's update-status field that says whether the historical import is complete. Plaid's error body (`error_type`, `error_code`) maps to a closed set: needs reconnect, revoked, transient. `link/token/create` sends `client_name: "Franki"`, `products: ["transactions"]`, `country_codes: ["US"]`, `language: "en"`, and a stable `client_user_id` hashed from the uid.
- **Errors.** A missing or malformed setting answers the routes with one plain message and no detail. Needs-reconnect sets the connector `expired`; revoked sets `disconnected` and erases the token.
- **Docs.** `docs/setup.md` gets the four settings and what each is. `apps/web/apphosting.yaml` gets the three secrets (`availability: [RUNTIME]`) and `PLAID_ENV` as a plain value, `production`.
- **Record-shape rule** (`.kiro/steering/state-machines.md`): any change to a stored record ships with a read that fills defaults for older records, and a test over one.

Tests, the properties red first with 1,000 runs:
- **Twice is once.** For any pull, applying it again writes no new document and leaves the cursor and coverage the same.
- **The cursor never runs ahead.** For any pull that fails at any write, the stored cursor is the old one, and the next pull ends in the same state as a pull that never failed.
- **Cents are exact.** For any Plaid amount with at most two decimals, the cents are that amount times 100 exactly and the sign holds.
- **The token stays in.** For any connector state, no route answer, ledger row or log line holds the token or its ciphertext, and a token sealed for one connector does not open for another.
- **Read-only.** The port's reachable paths are exactly the five above and the product list is exactly `["transactions"]`.
- Unit tests: the category table, modified and removed revisions, pending to posted, the duplicate link, the orphan removal, each error class, reset keeps the connection, disconnect, the hero unchanged with a bank connected, the limit of 4.

Stop and report, with the facts, instead of working around any of these: the store cannot accept a `connectors` record without a change to `docs/design/`; ruling 5 or 9 needs more than a small, tested change in the hero's reader or the reset; a tracked `*.property.test.ts` would have to be edited.

## Part B: the screen

The owner asked for a window where they connect their bank. Plaid Link is the window where the bank sign-in is typed; this part is what opens it and what the screen says before and after.

- One quiet way in on the main screen, and a modal sheet that follows `components/surfaces/WhatIKnowSheet.tsx` (focus trap, Escape, drawer from 1024 px, bottom sheet below). Read `.kiro/steering/ui-design.md` first and place the way in where it fits those rules.
- The sheet says, in plain words, that Franki can read and cannot move money, and that the bank sign-in happens in Plaid's window. One button opens Plaid Link from that click. After it: importing, then each connected bank with its accounts (name and last four) and when it was last read, and a disconnect that asks **Yes** / **Not now** with neither pre-selected. A bank that needs a new sign-in says so. Nothing is shown that the server did not answer.
- A pure machine in `apps/web/src/ui/bank/` and its shell in `apps/web/src/client/`, in the pattern of `ui/phone/phone-call.ts` and `client/phone-watch.ts`, with its page and row in `docs/machines/`. Copy in `ui/copy.ts`. Tokens only. Reduced motion respected. A specimens section that walks every state without calling anything.
- Plaid Link in the browser: the `react-plaid-link` package pinned exactly, or Plaid's own script loaded directly if the package fights the build checks. Either way it loads only when the sheet asks for it, never on the main screen's first load.
- Tests: the machine's transitions, a client test for each route answer, the specimens test.

## Part C: Franki answers

A read-only tool, working name `read_money`, so the owner can ask what they spent.

- The model supplies only the question's shape (a period, and optionally one of the four categories or a merchant's words). Code resolves the dates (ruling 10), reads the connected banks' current rows through `eligible()`, and computes totals, counts and the top merchants in integer cents. The answer names its dates and what it leaves out (pending rows, rows with unknown time).
- Money is S1. The answer goes through the Gate exactly as a recall note above S0 does (`packages/server/src/routes/gate-tool.ts`): said in private when the owner asked, held with company or an unknown audience, with the Gate row written. Never add a path around the Gate.
- With no bank connected, the tool says so and offers the way in from part B as a card; it never answers from persona rows.
- A pull runs first when the last success is over an hour old (ruling 7), inside the tool's time budget, and a stale answer says how old it is.

Stop and report before building if: the lineage caps (root keys, depends-on) cannot cite a month of rows; the Gate cannot treat an asked money question as asked without a change to the pure gate's rules; or balances cannot be given a source the Gate accepts (then leave balances out).

## Part C design

Built by Claude. The tool is `read_money`, one more name in the closed tool unions.

- **Arguments (the model's, all shape):** `{period, group, merchant}`. `period` is one of `this_week`, `last_week`, `this_month`, `last_month`, `last_7_days`, `last_30_days`, `last_90_days`. `group` is null or one of the closed spending groups (`MONEY_GROUPS`). `merchant` is null or up to 64 characters. No amount and no date are ever an argument. `When` has no explicit range, so none is offered.
- **Result:** `{name: "read_money", state, notes, cards}`. `state` is `answered`, `noBank`, `importing`, `narrow`, `unclear` or `held`. `notes` (at most 4) are `W` notes of kind `result`, one per consecutive part of the period. Each part cites its own rows in `rootKeys` (the title slice's root key) and `dependsOn` (`e:<eid>`), and stays within the caps of 128 and 256. `cards` holds at most one `source` card, carried only by `noBank`.
- **The row's category (follow-up 1):** `description` is `{kind: "inline", text: <detailed code>}` with its own ranged `description` slice (`O`/`S1`), or null when the code is absent or fails `^[A-Z0-9_]{1,64}$`. The primary is the longest known primary that prefixes the code. Primaries contain underscores (`FOOD_AND_DRINK`), so splitting at the first underscore would be wrong.
- **Pure core (`packages/core/src/bank/money.ts`):** the group table (primary to group, with groceries, restaurants (coffee too) and fast food split out of food and drink), `codeKind` (spend, transfer, card payment, income), `moneyPeriod` (civil dates from the ops clock's instant in `core/state.currentZone`, weeks Monday to Sunday as `resolvePeriod` has them), and `moneyAnswer` (the totals, the top 5 merchants, money back, what was left out, the parts and the lines). It works in integer cents only.
- **The server read (`packages/server/src/bank/money-read.ts`):** checks the turn (class U, final, committed, current stamp), reads the readable banks (`readableBankIds`), runs `pullIfStale` on each bank under one deadline taken from the tool budget, scans Evidence, keeps `source: "plaid"` rows of those connectors, keeps the newest revision of each logical row (the one no other revision names in `revisionOf`), runs each through `eligible()` with the forget snapshot at stage `toolReturn`, then computes.
- **What counts as spending:** amounts above zero whose code is not a transfer, a card payment or income. A negative row that is not one of those counts as money back. Pending rows are left out and counted, and so are rows in another currency. A merchant's words must all appear in the owner's own words this turn, or the answer is `unclear`. The bank's text can't steer a read.
- **Splitting:** with more than 128 cited rows, the period splits into consecutive weeks, greedily packed into parts of at most 128 rows. If one week is still too big, or there would be more than 4 parts, the answer is `narrow`: one S0 line that asks for one week, one group or one merchant, with no total.
- **The Gate (`packages/server/src/bank/money-gate.ts`, one call from `gate-tool.ts`):** each note above S0 is one candidate: class `O`, `S1`, trigger `recall`, topic null, and aliases `MONEY_ALIASES` (spend, spent, spending, money, paid, cost, bought, purchases, charges, transactions, bank, groceries and so on). "Asked" is therefore the pure gate's own `askedByOwner`: the owner's certain U/C words hold one of those terms. A note goes out only on `say` with render `free`, so private and asked. Anything else writes its Gate row, and the note is replaced by one S0 line with no digits (`held`). The Server_Rule's S0 limit is applied first, as for recall.
- **Typed path:** `typedReplyRequest` adds `MONEY_TOOL` beside the phone tool for an owner's typed U line. `normalizeResponse` reports a completed `read_money` call's arguments. `typedReplyNote` answers `{readMoney: args}`, and `turn.ts` marks the response with `moneyPendingId`, as it does for the phone. After commit, `finishTypedMoney` reads, gates and admits the notes under a `tool` rule and replaces the cached response. A replay that lost the arguments answers one S0 "ask again" line.
- **Voice path:** `CALL_TOOLS` and `CALL_TOOL_NAMES` gain `read_money`. The reply after a money result carries no tools, as after a phone result.
- **Freshness:** a bank whose last success is more than an hour old is pulled first, inside the budget. A late or failed pull answers from what is stored and says how old it is. With nothing stored and the bank still importing, the answer is `importing`.
- **First pull after connect (follow-up 2):** connect schedules no pull. The screen's first `POST /api/bank/sync` (Part B polls it while `importing`) pulls in-request, and a money read pulls a bank that has never succeeded, because a null `lastSuccessAt` counts as stale.

## Contract questions

Part A. Numbered on from W-232, with this lane's letter.

- **P-233 (ruling 2, departs from `architecture-decision.md`).** The access token is sealed in the web backend with AES-256-GCM under `FRANKI_BANK_TOKEN_KEY`, not with Cloud KMS in Functions. The envelope is `{v: 1, iv, body}` (base64url IV; base64url ciphertext with the 16-byte tag appended). The additional authenticated data is `["franki-bank-token", 1, uid, connectorId]`, so the uid is bound as well as the connector. Rotation means adding a version 2 key and a `v: 2` branch; none exists yet.
- **P-234 (ruling 3).** `connectors/{connectorId}` follows contracts §1 field for field. `cursor` is `Content` as the contract says, stored as `{kind: "inline", text}`. `lastError` is the contract's `ErrorCode` (`AUTH` for needs-reconnect and revoked, `DEPENDENCY` for transient); the bank's own closed class is `bank.problem` (`needsReconnect`, `revoked`, `transient`). The sub-object is named `bank` (ruling 11). It holds Plaid's raw `itemId`, the institution, up to 32 accounts (`accountId`, name, mask, type, subtype), the sealed token, `connectedAt`, `historicalComplete` and the last pull's skipped counts. `syncPages` is not built.
- **P-235 (record-shape rule).** No connector exists before this brief. `withConnectorDefaults` reads a contract-only connector (no `bank` key) as `bank: null` and an older bank with no `lastPullSkipped` as zeros. A unit test covers both.
- **P-236 (ruling 5, wider than written).** `readMoneyRows` drops every row with `source: "plaid"` and a non-null `connectorId` in both clock modes, not only in `fixture`. The ruling's own words say a real bank's rows are read only by the part C money read, and the persona's rows have `source: "fixture"` and no connector. Older test fixtures that use `source: "plaid"` with a null `connectorId` are still read.
- **P-237 (ruling 9).** There is no sanctioned delete for Evidence outside forget and reset, so disconnect does not delete rows. It erases the token, sets `disconnected` and nulls the cursor. Every read is gated instead: the hero's reader drops all connector rows, and `readableBankIds` (exported for part C) names the connectors whose rows may be read. Reset deletes a bank's Evidence along with everything else, because `clearTenant` clears all Evidence, and it keeps the connector (cursor null, coverage unknown, lease dropped, `historicalComplete` false, token kept). The reset's last transaction calls `resetBankCursors`.
- **P-238 (dates).** A provider date with no time is stored at 12:00 UTC (`DATE_ONLY_HOUR_UTC`) wherever a `TS` is required (`occurredAt`, and `postedAt` when Plaid gives only `date`). `purchaseAt.zone` and Evidence `zone` are null, because Plaid gives no zone. With an authorized time, `purchaseAt.civilDate` is `authorized_date` (possibly null). `postedAt` is `datetime`, falling back to `date` at noon UTC, and is null while pending. Part C should resolve days from `civilDate` where it is set.
- **P-239 (pending to posted).** `pendingOfId` is the pending row's **first** revision's eid, set only when that row is stored or is written in the same pull; otherwise null. The first revision keeps the ID stable when the pending row is later removed or revised.
- **P-240 (categories).** Plaid has no delivery code in PFCv1 or PFCv2 (checked against `pfc-taxonomy-all.csv`), so `takeout` is `FOOD_AND_DRINK_FAST_FOOD` only. Bars are inside `FOOD_AND_DRINK_RESTAURANT`. Coffee is `restaurant`. Everything else is `other`. The sync request does not set `personal_finance_category_version`, so the account's default applies; the FOOD_AND_DRINK codes are the same in both versions.
- **P-241 (wire).** The brief's table has `institutionId?` and `institutionName?`, but closed schemas have no optional keys. `BankConnectRequest` has both as nullable, and `parseConnect` fills a missing one with null before the closed check. Any other extra key is PARSE. The limit answer is HTTP 409 with `{error: "LIMIT", retryAfterMs: 0}`; no new error code was added.
- **P-242 (connect failures).** A refused exchange (Plaid error body on a 4xx) fails the ledger row; an unknown outcome blocks it. Either answers 409 STALE, and a retry with the same `requestId` answers 409 again without calling Plaid. Part B must start a new Link session with a new `requestId`. An unconfirmed exchange may have created an Item that Franki can't remove, because it has no access token.
- **P-243 (duplicate link).** "Matching account" means the same `institution_id` plus one account with equal mask, type and subtype. The existing connector answers even when it is `expired`; re-linking an expired bank through Plaid's update mode is not built.
- **P-244 (titles).** A merchant name that fails `safeName` is titled `"a merchant"` (`BANK_TITLE_FALLBACK`), not `safeName`'s `"a sender"`. The institution name in `BankView` is `null` when it fails `safeName`.
- **P-245 (idempotency).** Connect and disconnect use `mutation()` with new route names `bankConnect` and `bankDisconnect` (`ROUTE_NAMES`, `RESPONSE_BY_ROUTE`) and their own `bank` ledger row. Link-token and sync have no `requestId`, as the brief's table says. Link-token writes nothing, and a pull is idempotent by construction (property "twice is once").

Rulings needed (fail-closed defaults, each one named constant): `PULL_LEASE_MS` 120 s; `PULL_ROWS_MAX` 20,000 rows per pull (more is refused as transient); `WRITE_CHUNK` 100 transactions per write transaction; `MAX_REVISIONS` 64 per row; `BANK_CENTS_MAX` $100 billion; `STALE_AFTER_MS` one hour (ruling 7). Coverage after a pull is `complete` from `connectedAt` minus 90 days once Plaid reports `HISTORICAL_UPDATE_COMPLETE`, `partial` from minus 30 days at `INITIAL_UPDATE_COMPLETE`, and unknown before that.

Part C.

- **P-246 (periods).** The model picks from seven named periods. No explicit date range is offered, because `When` has no range kind and the pure resolvers (`resolvePeriod`, `resolveSpoken`) only find ends that lie ahead. `moneyPeriod` (core) builds each period with `civilDateAt` and `addCivilDays` from the ops clock's instant in `core/state.currentZone`, with weeks running Monday to Sunday as in `resolvePeriod`. A row's day is its provider `civilDate` (P-238), or else its authorized instant's day in the owner's zone.
- **P-247 (groups, wider than written).** The ruling's list, plus `foodAndDrink` (all four food groups at once), `otherFoodAndDrink`, `government` (taxes and agencies; donations are `giving`) and `other` (`OTHER_OTHER`, or a well-formed code with no known primary). `LOAN_DISBURSEMENTS_*` (PFCv2 only; PFCv1 files it under `TRANSFER_IN`) is treated as a transfer, so it is never spending or money back. The primary is the longest known primary that prefixes the code. It is not the text before the first underscore.
- **P-248 (merchant words).** A merchant filter applies only when every word of the model's merchant (two or more characters) is in the owner's own words this turn. Otherwise the answer is `unclear`, with no total. A row matches when every word is in its title.
- **P-249 (the Gate).** There is one candidate per note: class `O`, the note's sensitivity, trigger `recall`, topic null, and `MONEY_ALIASES` as aliases. The pure gate is unchanged. A `say` whose render isn't `free` (the template an unknown audience gets) is held, and its row is written as `hold` with reason `audience` (`ceiling` in private). The pure verdict was `say`, which writes no row, and recall writes none in that case either. With company, the pure gate answers an asked S1 candidate with a `card`. Per the ruling it is held and no card is shown. If any note is held, the whole answer is held behind one S0 line with no digit. A Gate row carries at most 8 refs (the ledger cap); the note keeps the full lineage.
- **P-250 (what a note cites).** A part's note cites every row behind any number it states: the purchases, the money back, and the pending, other-currency and undated rows it counts. Undated rows go in the first part. The 128-row cap counts all of them.
- **P-251 (the Server_Rule limit).** On `/api/tool` the Server_Rule's S0 limit applies to a money result after the Gate has written its rows. If the Gate says yes but the rule limits to S0 (a parse gap, a judge other than O), the answer is held with no Gate row, since that hold is the rule's and not the Gate's.
- **P-252 (typed path).** There is no second model call. The code's lines are the typed reply's notes, admitted under a `tool` rule after the turn commits (the phone's pattern). `typedReplyNote` keeps its old type, and the turn route calls `typedReplyOutcome`. A replay that lost the model's arguments answers `MONEY_LINES.lost`.
- **P-253 (category on the row, follow-up 1).** `description` is `{kind: "inline", text: code}` with a `description` slice (O/S1, 0 to its length). The content key includes it, so a row stored before this change gets one new revision on its next pull (Part A was never deployed). `bank.status` still hashes the four food categories as before.
- **P-254 (first pull, follow-up 2).** Connect schedules no pull. The first pull is the screen's first `POST /api/bank/sync` (Part B polls every 15 s while `importing`), run in-request. A money read also pulls a bank whose `lastSuccessAt` is null. A shorter lease for a scheduled attempt was rejected: it would still race the screen's calls, and a throttled host could still stall it.
- **P-255 (voice).** The reply after a `read_money` result carries no tools, as after `make_phone_call`. `docs/machines/voice-call.md` line 67 still says "all four" tools and needs a one-line fix. It is in the screen lane's files and was not edited here.
- **P-256 (golden corpus).** Adding `MONEY_TOOL` to `CALL_TOOLS` changes `session.update` and every `response.create`, so the corpus was re-recorded on the director's instruction. Brief 016 leaves this to the voice lane. 600 of 600 `arbCall` and 398 of 500 `arbCallWide` calls moved, all because of the tool list.

Rulings needed (part C, each a named constant): `MONEY_READ_RESERVE_MS` 1.2 s kept back from the tool budget after pulls; `MONEY_PULL_MIN_MS` 250 ms; `MONEY_SCAN_MAX` 50,000 Evidence documents (more answers `narrow`); `MONEY_NOTE_ROWS_MAX` 128; `MONEY_PARTS_MAX` 4; `MONEY_TOP_MERCHANTS` 5; `MONEY_MERCHANT_CHARS` 64; `MONEY_TYPED_BUDGET_MS` 4.5 s; `MONEY_ALIASES` (the words that make a money question asked); freshness is the oldest last read among the banks answered from.

## Outcome

**Part A (server): built, not committed.** Built by Claude.

- Core: `packages/core/src/bank/index.ts` holds `centsOf`, the category table and `isConnectedBankRow`. `records.ts` gains the `Connector` schema, `withConnectorDefaults` and the `bank` ledger kind. `wire.ts` gains `BankView` and the five request and response schemas. `primitives.ts` gains route names `bankConnect` and `bankDisconnect`.
- Server: `packages/server/src/bank/` holds `config.ts`, `seal.ts`, `plaid.ts` (the `BankPort` and its live fetch half), `connector.ts`, `rows.ts`, `pull.ts` and `routes.ts`. `RouteDeps.bank` is new, and `testRig` sets a throwing `throwingBank` by default. The store accepts `connectors` (path helper, `schemaFor` case). No new index: listing uses Q28.
- Rulings 5 and 9: one filter line in `readMoneyRows`, a `connectors` skip in `clearTenant`, and one `resetBankCursors` call in the reset's last transaction.
- Web: five `adapt(spec)` files under `apps/web/src/app/api/bank/`. `apphosting.yaml` has three runtime secrets and `PLAID_ENV: production`. `docs/setup.md` has a "connected bank" section.
- Tests: `bank/bank.test.ts` has 28 unit tests: categories, cents, error classes, settings, sealing, link token and the limit of 4, connect (replay, optional fields, refused and unconfirmed exchange, orphan removal twice, duplicate link), the pull (field choices, skips, modified and removed revisions, pending to posted, paging restart and three tries, each error class, lease held, scope), status reads only, disconnect (removed codes, a failure that keeps the connection, retry), the hero unchanged, reset keeps the bank, barrier refusal, and the defaults read. There are five property files at 1,000 runs each.
- Red first. The properties were written after a first version of the code, so each was seen failing against a seeded fault, then passing on the real code:
  - Cents are exact: naive `amount * 100`. Seed -675557537, counterexample `[-7399959065076, 1]`.
  - Read-only: `"auth"` added to the products. Seed -290893069, counterexample one `linkToken` call.
  - Twice is once: the same-content skip removed. Seed 555395312, counterexample a second pull that modifies `t1` once.
  - The cursor never runs ahead: the cursor written in the row-page transaction. Seed -1487277480, failing at transaction 3.
  - The token stays in: a log line carrying the sealed body. Seed 1558534260, counterexample `["access-sandbox--00--a--", "connected", null, undefined, undefined]`.
  - The hero test was seen failing with the ruling 5 filter removed (`totalCents` changed).
- Not built: parts B and C, a Plaid webhook, update-mode re-linking, deleting a disconnected bank's rows, and key rotation past v1.
- Not tested: any real Plaid call, the Firestore emulator for `connectors`, and the live `fetch` path beyond the faked responses in the read-only property. Plaid field names were checked against plaid.com/docs/api on 2026-11-13. `error_code` and `error_type` in Plaid's error body, and the relink and revoked code lists, were taken from the lead's notes and not re-read on Plaid's errors page.
- Look first at: `pull.ts` (lease, write chunks, publish), the orphan and duplicate paths in `routes.ts`, and P-236 and P-237 above.

**Part B (screen): built, not committed.** Built by Claude.

- The way in: one small brass-edged "Bank" control in the lab's corner row, beside the jar (`data-slot="bank"` in `MainScreen.tsx`, one new slot). It sits with the jar because both open a sheet about what Franki reads, and the corner row is where the lab's other quiet controls live; the header rail stays slim. It is unavailable until the visit has said which account this is, and its lamp lights only once the server has answered a bank being read.
- The sheet: `components/bank/BankSheet.tsx`, modal in the pattern of the What I know sheet (focus moved in, held and handed back, Escape, scrim; a drawer from 1024 px, a bottom sheet below). It says Franki can read and can't move money, and that the bank sign-in is in Plaid's window. One "Connect a bank" button; then each bank with its accounts by name and last four, "Importing transactions" or when it was last read, a line when it needs a new sign-in, and Disconnect, which asks **Yes** / **Not now** with neither pre-selected. No field of its own, no amounts, nothing the server did not answer.
- The machine: `ui/bank/bank-machine.ts` (`ui.bank`, page `docs/machines/bank.md`), with its shell `client/bank-watch.ts` and the five calls in `client/api.ts`. Polling an importing bank is a sync every 15 s, one round at a time, stopping when none imports, after 4 failed rounds, or after 20 minutes. A refused or unconfirmed connect is never sent again; Connect starts a new Link session.
- Plaid Link: `react-plaid-link` 5.0.0, pinned. `components/bank/BankLink.tsx` is loaded with `React.lazy` by `BankLinkHost.tsx` only while a Link session is out, so the package and Plaid's script load only after the owner pressed Connect. Link opens as soon as it is ready after that press (Plaid Link is an in-page iframe, not a popup). Link's exit returns the sheet to a calm line; Plaid's error text is never shown.
- Specimens: a "Bank" section walks every phase but `unread` (which is never drawn) and the notes worth seeing, from fixture states, with no network and no Plaid.
- Rulings needed: `BANK_POLL_MS` 15 s, `BANK_POLL_MAX_MS` 20 minutes, `BANK_SYNC_FAILURE_LIMIT` 4, `BANK_LINK_OPEN_MS` 20 s; the way in is gated on the visit's input gate; times are shown in the world clock's zone.
- Not built: re-linking an expired bank through Plaid's update mode (the sheet says to disconnect and connect again), a status read at sign-in (the lamp stays dark until the sheet is first opened), and part C.
- Not tested: a real Link session or any real Plaid call, the sheet in a browser, and the focus hold while Plaid's iframe is open.

**Part C (Franki answers): built, not committed.** Built by Claude.

- Tool: `read_money`, args `{period, group, merchant}` (`MoneyArgs`, closed), result `{name: "read_money", state, notes, cards}` (`MoneyResult`). It is in `ToolCall`, `ToolResult`, `CALL_TOOLS`, `CALL_TOOL_NAMES`, the typed reply's tools (`MONEY_TOOL`, strict) and the `/api/tool` dispatch.
- Core: `packages/core/src/bank/money.ts` holds the group table, `codeKind`, `moneyPeriod`, `moneyAnswer`, the lines and `MONEY_ALIASES`.
- Server: `bank/money-read.ts` (the read), `bank/money-gate.ts` (the Gate, one call from `routes/gate-tool.ts`) and `bank/money-typed.ts` (the typed finisher). There are seams in `routes/tool.ts`, `routes/turn.ts` (three additions), `routes/typed-reply.ts` (`typedReplyOutcome`) and `openai/live.ts` and `responses.ts` (`moneyCallArguments`).
- Follow-up 1: the category code on `description` (P-253). The "twice is once" generator gained transfer, card-payment, income and malformed codes. The property also checks that a stored code always passes the pattern.
- Follow-up 2: connect schedules no pull (P-254). `connectVia` in the bank rig now pulls the way the screen does, through the sync route.
- Web: the only file changed is `apps/web/src/client/voice-client.test.ts`, one line that pins the call's tool list. No web source changed.
- Tests: `core/bank/money.test.ts` has 51 tests: the group table and code kinds, each period and the zone, spending, money back and the excluded kinds, pending, other currency and undated rows, group and merchant filters, the split, the two narrowing cases, and the lines. `core/voice/money-tool.test.ts` has 2. `server/bank/money.test.ts` has 17, all end to end on the routes: voice in private, group and merchant, an unsaid merchant, company, not asked and an uncertain speaker, no bank, a disconnected bank, a revised and a removed row, pending to posted, a stale bank pulled, a failed pull, a late pull within the limit, still importing, closed arguments, a typed turn with replay and the tools sent, a typed turn with company, and argument parsing. `bank.test.ts` gained 1 (category codes). Existing pins were updated for the fifth tool: `machine.test.ts` (2 lines) and `turn.typed-reply.test.ts` (1 line).
- Red first, three new property files at 1,000 runs:
  - Every cent has a row: pending rows counted as spending. Seed -1355945113, counterexample one pending $0.01 fast-food row `t1` on 2026-10-05, `last_30_days`.
  - Company hears no amounts: first red on the real code. A held note under an `unknown` audience wrote no Gate row (the Gate's `say`/template writes none), seed -2032237112, now fixed (P-249). Then the planted fault, card treated as said: seed 1460558492, no Gate row (the Server_Rule's S0 limit still kept the digits out).
  - The persona never answers: the readable-bank check removed and connectorless rows read. Seed 844342441, counterexample `[[], null, this_week, "What did I spend last month?"]`, which answered instead of `noBank`.
- Golden corpus re-recorded (P-256).
- Not built: balances, an explicit date range, a "Here, or on screen?" card for company, and spoken totals across parts (each part states only its own).
- Not tested: a real Plaid, OpenAI or Realtime call, the voice client in a browser, how the realtime model words the notes, and the Firestore emulator.
- Checks (Part C, 2026-11-13): `npm run typecheck` exit 0. `npm run lint` exit 0, with 1 warning in `components/avatar/three/brass.ts`, a file not touched here. `npm test` gave 1 failed, 4758 passed and 23 expected fail. The one failure is `scripts/ui-boundaries.test.ts`, which flags the word "window" in `apps/web/src/ui/copy.ts` lines 188 to 220. Those are Part B's lines, still in progress, and the failure held in two runs some minutes apart. `npm run build` exit 0.
