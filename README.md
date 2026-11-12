# Franki

Franki is an avatar-first, voice-first assistant for your whole life: time, food, money and goals in one loop. It's an entry for Kiroween 2026 in the Frankenstein category.

> **Status: scaffold.** The infrastructure is wired end to end. Franki's features come next.

## Stack

| Part | Choice |
|---|---|
| Web app | Next.js 16 (App Router) on Firebase App Hosting, us-central1 |
| Brain | Route handlers in `apps/web`, with the logic in `packages/server` |
| Voice | OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC, straight from the browser to OpenAI |
| Reasoning | OpenAI `gpt-6.1-terra`, escalating to `gpt-6.1-sol`, with `gpt-6-luna` for background work |
| Background jobs | Cloud Functions for Firebase (2nd gen, Node 24) |
| Data | Cloud Firestore (us-central1) |
| Secrets | Secret Manager. Google and Plaid tokens are encrypted with Cloud KMS, and only Functions can decrypt them. |

## Layout

```
apps/web          Next.js app (the App Hosting root directory)
packages/core     Pure TypeScript shared by everything, with property tests
packages/server   Server-only logic (Firestore, OpenAI), independent of the web framework
functions         Scheduled jobs, Pub/Sub and webhooks, bundled with esbuild
tests             Deploy smoke test, no-network Vitest setup (tests/setup) and Firestore emulator tests (tests/firestore)
```

## Develop

You need Node 24 (see `.nvmrc`). The emulator tests also need Java 21.

```bash
npm install
npm run dev              # http://localhost:3000
npm test                 # unit and property tests (Vitest + fast-check)
npm run test:emulator    # Firestore rules against the emulator
npm run lint && npm run typecheck && npm run build
```

Under `npm run dev`, `http://localhost:3000/recorder` records your own takes of the judge spike's probe lines into the gitignored `scripts/judge-spike/audio/owner/` (development only; production builds have no such page or route). See `docs/briefs/006-report.md`.

## Outbound phone calls

Sign in to Franki and say or type “Call +1 415 555 0123 and ask what time they close.” Give the destination and assignment together. Twilio dials the recipient and bridges the answered call to Franki. Franki introduces itself as an AI assistant and receives only the current request as its assignment. The initial receipt reports whether Twilio accepted the dial request.

Phone calls use the live agent's existing `OPENAI_API_KEY` and voice model. Twilio authenticates dialing with its account SID and auth token. The OpenAI webhook signing secret verifies incoming callbacks.

While a call is out, a wall phone hangs beside Franki and shows where the call stands: dialing, ringing, on the phone, ended, or why it was missed. The browser reads that from `GET /api/phone/status`, which checks the caller's own call record and then asks Twilio for the call's status.

Any signed-in user can call. Franki saves the call request in that user's conversation and passes an opaque call ID through Twilio. The signed OpenAI webhook looks up that ID in Firestore to find the original request.

For local development, use `apps/web/.env.local`. App Hosting reads the same five phone settings from Secret Manager at runtime. Deploy the Firestore indexes in this repository before enabling the webhook.

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Programmable Voice account credentials |
| `TWILIO_PHONE_NUMBER` | Voice-capable Twilio number or verified outbound caller ID in international format, including the leading + |
| `OPENAI_PROJECT_ID` | The OpenAI project ID beginning with `proj_` |
| `OPENAI_WEBHOOK_SECRET` | Signing secret for the project's webhook |

In the OpenAI project, subscribe a webhook to `realtime.call.incoming` at `https://<your-public-host>/api/phone/openai`. Local testing needs a public HTTPS tunnel to the running app. Twilio receives the SIP address in each call's TwiML. On a Twilio trial account, verify the destination as well. [OpenAI SIP setup](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=realtime) · [Twilio outbound calls](https://www.twilio.com/docs/voice/api/call-resource)

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

## License

[MIT](LICENSE)
