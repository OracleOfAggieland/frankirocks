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
tests             Deploy smoke test and Firestore rules tests
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

## Deploy

```bash
npm run deploy                  # Firestore rules, Functions and App Hosting
SMOKE_TOKEN=... npm run smoke   # checks the live backend without spending audio minutes
```

`POST /api/health` (with the smoke token) checks Firestore, the OpenAI key, Realtime client-secret minting, and the `heartbeat` function's last run.

## License

[MIT](LICENSE)
