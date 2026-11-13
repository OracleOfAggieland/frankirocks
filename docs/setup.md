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

While a call is out, a wall phone hangs beside Franki and shows where the call stands: dialing, ringing, on the phone, ended, or why it was missed. The browser reads that from `GET /api/phone/status`, which checks the caller's own call record and then asks Twilio for the call's status.

Any signed-in user can call. Franki saves the call request in that user's conversation and passes an opaque call ID through Twilio. The signed OpenAI webhook looks up that ID in Firestore to find the original request.

Known gaps: what the callee says is not returned to the owner, nothing confirms before dialing, and no real call has been tested yet.

For local development, use `apps/web/.env.local`. App Hosting reads the same five phone settings from Secret Manager at runtime. Deploy the Firestore indexes in this repository before enabling the webhook.

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Programmable Voice account credentials |
| `TWILIO_PHONE_NUMBER` | Voice-capable Twilio number or verified outbound caller ID in international format, including the leading + |
| `OPENAI_PROJECT_ID` | The OpenAI project ID beginning with `proj_` |
| `OPENAI_WEBHOOK_SECRET` | Signing secret for the project's webhook |

In the OpenAI project, subscribe a webhook to `realtime.call.incoming` at `https://<your-public-host>/api/phone/openai`. Local testing needs a public HTTPS tunnel to the running app. Twilio receives the SIP address in each call's TwiML. On a Twilio trial account, verify the destination as well. [OpenAI SIP setup](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=realtime) · [Twilio outbound calls](https://www.twilio.com/docs/voice/api/call-resource)

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
