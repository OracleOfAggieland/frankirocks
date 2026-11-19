# Setup: services, phone calls and deploy

The root [README](../README.md) covers running Franki locally. This page holds the service setup behind it. Versions and boundaries are in [`.kiro/steering/tech.md`](../.kiro/steering/tech.md).

## Services

| Part | Choice |
|---|---|
| Web app | Next.js 16 (App Router) on Firebase App Hosting, us-central1 |
| Brain | Route handlers in `apps/web`, with the logic in `packages/server` |
| Voice | OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC |
| Reasoning | OpenAI `gpt-6.1-terra`, escalating to `gpt-6.1-sol`, with `gpt-6-luna` for background work |
| Avatar | three.js, drawn in code, with an SVG fallback |
| Background jobs | Cloud Functions for Firebase (2nd gen, Node 24) |
| Data | Cloud Firestore (us-central1) |
| Secrets | Secret Manager |

## Outbound phone calls

Sign in to Franki and say or type “Call +1 415 555 0123 and ask what time they close.” Give the destination and assignment together. Twilio dials the recipient and bridges the answered call to Franki. Franki introduces itself as an AI assistant and receives only the current request as its assignment. The initial receipt reports whether Twilio accepted the dial request.

Phone calls use the live agent's existing `OPENAI_API_KEY` and voice model. Twilio authenticates dialing with its account SID and auth token. The OpenAI webhook signing secret verifies incoming callbacks.

While a call is out, the wall phone shows dialing, ringing, connected, ended, or why the call was missed. Twilio sends signed progress updates to `/api/phone/twilio` for each dial. The screen and ordinary conversation read the stored status. The scheduled `reconcilePhoneCalls` function checks due calls every minute to recover missed updates, including after the user closes the browser. Calls placed before this feature enter recovery when their status is next read. If carrier lookups keep failing for 48 hours after a dial, tracking shows an unknown status and a later signed terminal callback can still settle it.

Any signed-in user can call. Franki saves the call request in that user's conversation and passes an opaque call ID through Twilio. The signed OpenAI webhook looks up that ID in Firestore to find the original request.

The phone specialist files its answer, voicemail report, or inconclusive finding through `/api/phone/report`. An early report is available in the original private conversation while the carrier still tracks the call. If the carrier reports an answered call has ended, Franki waits 15 seconds for its report before showing an unconfirmed outcome. A later report within the existing one-hour retention window updates the same card. Busy, unanswered, and failed calls have immediate outcomes. Ask “What did they say?” to hear the latest call’s result.

During a private voice conversation the live model receives silent status updates for up to four recently updated calls. You can switch topics while a call runs, then ask “Are they still on the line?” or “What did the first place say?” The next voice reply can use the call's status and request that specific report. Deploy the composite ledger index on `kind`, `payload.sessionId` and `updatedAt` with the web app.

The report tool accepts a credential scoped to the assigned SIP call. For a tunnel or a separate deployment, set `FRANKI_PHONE_REPORT_ORIGIN` to the public HTTPS origin serving the Twilio callback and specialist report routes. App Hosting sets this origin to `https://frankirocks.com`. Each dial registers its own callback URL with Twilio.

For local development, use `apps/web/.env.local`. App Hosting reads the five phone settings below from Secret Manager at runtime. Deploy the Firestore indexes before rolling out the updated app and scheduled function. The function's service account needs Firestore access and access to the existing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `FRANKI_ID_HMAC_KEY` secrets.

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Programmable Voice account credentials |
| `TWILIO_PHONE_NUMBER` | Voice-capable Twilio number or verified outbound caller ID in international format, including the leading + |
| `OPENAI_PROJECT_ID` | The OpenAI project ID beginning with `proj_` |
| `OPENAI_WEBHOOK_SECRET` | Signing secret for the project's webhook |

In the OpenAI project, subscribe a webhook to `realtime.call.incoming` at `https://<your-public-host>/api/phone/openai`. Local testing needs a public HTTPS tunnel to the running app. Twilio receives the SIP address in each call's TwiML. On a Twilio trial account, verify the destination as well. [OpenAI SIP setup](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=realtime) · [Twilio outbound calls](https://www.twilio.com/docs/voice/api/call-resource)

## Web search during a voice conversation

Ask Franki about a current fact, restaurant or public event. For example, ask “Which museums in Austin are open this Sunday?” For “near me,” give a city or neighborhood when Franki asks. In a private voice session Franki delegates the question to the OpenAI Responses API with hosted `web_search`, using the existing `OPENAI_API_KEY` and `FRANKI_BRAIN_MODEL`. The configured model needs hosted web search support.

One web lookup runs at a time in the session. You can keep talking or let Franki answer at the next pause. The answer card groups each finding with its clickable sources. If the sources do not verify the answer, Franki says so. The worker has a 30-second provider deadline. The latest result is available for up to an hour in its original session and generation. [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)

## A connected bank (read-only)

The owner connects a bank through Plaid Link, Plaid's own window, so Franki never sees a bank password. The server asks Plaid for the `transactions` product only and reaches five Plaid endpoints, none of which can move money: `/link/token/create`, `/item/public_token/exchange`, `/accounts/get`, `/transactions/sync` and `/item/remove`. The routes are under `/api/bank/` (`link-token`, `connect`, `status`, `sync`, `disconnect`). The access token is sealed with AES-256-GCM before it is stored, and it never appears in a route answer, a ledger row or a log line.

| Variable | Kind | Value |
| --- | --- | --- |
| `PLAID_CLIENT_ID` | Secret | The Plaid client ID from the Plaid dashboard |
| `PLAID_SECRET` | Secret | The Plaid secret for the environment named in `PLAID_ENV` |
| `PLAID_ENV` | Plain value | `production` or `sandbox`; anything else is refused |
| `FRANKI_BANK_TOKEN_KEY` | Secret | 32 random bytes in standard base64 (44 characters), for example from `openssl rand -base64 32`. Changing it makes every stored bank token unreadable, so each bank must be connected again |

`apps/web/apphosting.yaml` sets `PLAID_ENV` to `production`. Because `npm run dev` copies plain values from that file into `apps/web/.env.development.local`, local development also uses `production` unless you change it there. A missing or malformed setting makes every bank route answer `CONFIG`.

Known gaps: there is no Plaid webhook; banks are read on connect, when the screen asks, and before a money read when the last read is over an hour old. No real Plaid call has been tested.

## A connected Google account (read-only)

The owner connects Gmail and Google Calendar from the Gmail and Calendar button at the foot of `/lab`. Google's own page, in its own window, takes the sign-in, so Franki never sees a Google password. Until Google has reviewed the app, that page warns first ("Google hasn't verified this app"); the sheet lists the three taps past it (Advanced, the link that starts "Go to", then Select all and Continue), and inside another app's own browser (Facebook, Instagram) it offers the page's link for Safari or Chrome first. Franki asks for `openid`, `email`, `gmail.readonly` and `calendar.events.readonly` only, and calls Google with GET only, apart from the token exchange, the refresh and the revoke. Nothing is imported: a message or an event is stored as Evidence only when a read returns it. The routes are under `/api/google/` (`start`, `connect`, `status`, `disconnect`); Google sends its window back to the page `/google/callback`, which sends the connect. The refresh token is sealed with AES-256-GCM under `FRANKI_BANK_TOKEN_KEY`, and no token, code or state appears in a route answer, a ledger row or a log line.

In the Google Cloud console, in a project you own:

1. **APIs and services, Library:** enable the Gmail API and the Google Calendar API.
2. **OAuth consent screen:** user type External. Franki asks for `openid`, `email`, `gmail.readonly` and `calendar.events.readonly`. Google may also answer `profile` from Franki's own Google sign-in; that is accepted, and any other extra scope refuses the grant. Two ways to run it:
   - **Testing** (a project of its own): add the scopes and every Google account that will connect as a test user. Only those accounts can connect, and Google ends each grant after seven days; the sheet then asks for a new sign-in.
   - **In production, unverified** (what `frankirocks` uses, since Firebase's own Google sign-in shares that screen and Testing would limit sign-in to test users): the scopes are not listed, because listing them starts Google's verification. Google shows an "unverified app" page on connect (*Advanced*, then *Go to frankirocks*), grants don't expire after seven days, any Google account can connect, and Google caps unverified grants at 100 users over the project's lifetime.
3. **Credentials, Create credentials, OAuth client ID:** application type Web application. Under Authorized redirect URIs add `http://localhost:3000/google/callback`, `https://frankirocks.com/google/callback` and `https://franki-web--frankirocks.us-central1.hosted.app/google/callback`, one for each origin in `ALLOWED_ORIGINS` (`packages/server/src/auth/guard.ts`). The browser never calls Google itself, so no JavaScript origin is needed. On `frankirocks` the client is "Franki Gmail and Calendar".
4. Copy the client ID and the client secret into the settings below, and set each deployment's redirect URI.

| Variable | Kind | Value |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Plain value | The OAuth client ID, ending `.apps.googleusercontent.com`. Set in `apps/web/apphosting.yaml`; `npm run dev` copies it from there |
| `GOOGLE_OAUTH_REDIRECT_URI` | Plain value | This deployment's one callback address: its origin plus `/google/callback`, exactly as registered on the OAuth client. `https://frankirocks.com/google/callback` in `apps/web/apphosting.yaml`, so Google connects from `frankirocks.com` only (www redirects there; the hosted.app address can't start a connection). `http://localhost:3000/google/callback` in `apps/web/.env.local`; the dev sync never copies this one from `apphosting.yaml`. Start refuses a request from any other origin, so a deployed server never hands out the localhost callback |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret | The OAuth client secret (`firebase apphosting:secrets:set GOOGLE_OAUTH_CLIENT_SECRET`), and in `apps/web/.env.local` for local work |
| `FRANKI_BANK_TOKEN_KEY` | Secret | The bank's key, above. Changing it makes every stored Google token unreadable too |

On a new deployment, create the secret before the three Google entries go into `apps/web/apphosting.yaml`, because a rollout fails on a secret that isn't in Secret Manager. `npm run dev` copies only nonempty plain values from that file (`scripts/sync-local-env.mjs`), and never the redirect URI, so the localhost callback in `.env.local` stands. With any of these names unset or malformed, every Google route answers `CONFIG` and the sheet says Google isn't set up.

Asking: once connected, ask in a call ("Did Dana write about the lease?", "What's on tomorrow?", "Am I free Thursday afternoon for 45 minutes?"). The call hands the ask to a helper (`start_errand`), and the answer comes at the next pause with a card. A half-covered ask (mail and calendar, with only mail connected) looks through the connected part and says the other isn't connected; an expired grant is said as needing connecting again.

What it doesn't do:

- No writes of any kind: no send, reply, delete, label, RSVP or event change.
- A message can't order Franki: no tool outside the four reads, no memory, rule, preference or identity write, no change to the Head.
- Mail from a sender you have never written to is never read out (card only, by address); a sender counts as written to only with Gmail's DMARC pass for the From domain and a sent message to that exact address, and never for list or bulk mail.
- At most `ERRAND_RUNNING_MAX` look-ups at once; calendar windows are clipped at 14 days; a cut list says `truncated`.
- A disconnect drops what a look-up found, including a result not yet said.

Known gaps: no real Google call has been tested; everything runs against a scripted fake. Mail and events are read only when asked, never in the background, and Google sends no push notifications here.

## Company mode (off)

Company mode is off unless `FRANKI_COMPANY_MODE` is `on` (brief 053). While it is off, a walk-in or a "keep that between us" never ends the call, and an account an earlier company hit narrowed opens private. Nothing sets the variable, on App Hosting or locally. The tests turn it on in `packages/server/src/testing/fakes.ts`.

## Deploy

Set each runtime secret listed in `apps/web/apphosting.yaml` in Secret Manager and grant the `franki-web` backend access. For example:

```bash
npx -y firebase-tools@15.34.2 apphosting:secrets:set OPENAI_API_KEY
npx -y firebase-tools@15.34.2 apphosting:secrets:set SMOKE_TOKEN    # any long random string
```

Then:

```bash
npm run deploy   # Firestore rules, Functions and App Hosting
npm run smoke    # checks the live backend without spending audio minutes
```

`npm run smoke` reads `SMOKE_TOKEN` from Secret Manager with your gcloud login unless the variable is set. It calls `POST /api/health`, which checks Firestore, the OpenAI key, Realtime client-secret minting, and the `heartbeat` function's last run.

## The recorder page

Under `npm run dev`, `http://localhost:3000/recorder` records your own takes of the judge spike's probe lines into the gitignored `scripts/judge-spike/audio/owner/` (development only; production builds have no such page or route). See [`briefs/006-report.md`](briefs/006-report.md).
