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

## Deploy

Two secrets live in Secret Manager, and `apps/web/apphosting.yaml` already lists both. Set each one once, and say yes when the CLI offers to grant the `franki-web` backend access:

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
