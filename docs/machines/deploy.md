# Deploy: checks, config and shapes that cross a deploy

What runs before code ships, and what has to stay compatible while an old browser tab or old stored records meet new code.

### `deploy.ci`

| Field | Value |
|---|---|
| Status | documented |
| File | `.github/workflows/ci.yml` |

One job on every pull request and every push to `main`, cancelled when a newer run starts for the same ref. In order: `npm ci`, lint, typecheck, test, build, the Firestore emulator suite, a grep of the build output (`apps/web/.next/static`, `functions/dist`) for anything shaped like an OpenAI key, and a secret scan. A failed step stops the job.

### `deploy.order`

| Field | Value |
|---|---|
| Status | documented |
| File | `package.json` |

`npm run deploy` is one Firebase CLI command, `deploy --only firestore,functions,apphosting`: Firestore rules and indexes (`firestore.rules`, `firestore.indexes.json`), the Cloud Functions in `functions/`, and the App Hosting backend. The browser code, the route handlers and the server library they import are built together into one App Hosting build.

### `deploy.wire`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/schema/wire.ts` |
| Tests | `packages/core/src/schema/wire.test.ts` |

The request and response shapes of every route are closed schemas shared by both sides. The browser validates every answer before it uses it (`parsed` in `apps/web/src/client/voice-client.ts`, `validate` in `apps/web/src/client/typed-turns.ts`); an answer that does not validate is handled as a failed request. A tab loaded before a deploy keeps its old schemas until it reloads, so a wire change reaches an open tab as failed requests. Rule: no wire change ships while a tab may be open on the old build.

### `deploy.records`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/core/src/schema/records.ts` |
| Tests | `packages/core/src/schema/records.test.ts`, `packages/core/src/schema/roundtrip.property.test.ts` |

Stored records are closed schemas too, and every write is validated against them at commit (see [server-store-tx](server-store-tx.md)). A record written before a shape change stays in the store as it was. Rule: a change to a stored shape ships with a read that fills defaults for the older record, and a test over a record written before the change.

### `deploy.config`

| Field | Value |
|---|---|
| Status | documented |
| File | `packages/server/src/config/env.ts` |
| Tests | `packages/server/src/config/models.test.ts`, `packages/server/src/health.test.ts` |

`requireEnv` throws a `ConfigError` that names the variable and never its value. The live route deps are built on the first request (`liveRouteDeps` in `packages/server/src/routes/live-deps.ts`) and cached; a missing variable there answers the route's config error before any route logic. Model IDs are read only through `packages/server/src/config/models.ts`. `/api/health` keeps its own output (`.kiro/steering/structure.md`).

### `deploy.envSync`

| Field | Value |
|---|---|
| Status | documented |
| File | `scripts/sync-local-env.mjs` |
| Tests | `scripts/sync-local-env.test.ts` |

`next dev` does not read `apps/web/apphosting.yaml`, so the web app's `predev` script copies every plain `value:` entry under `env:` into the development env file. Secret entries are never copied, and no value is printed.

### `deploy.propertyGuard`

| Field | Value |
|---|---|
| Status | documented |
| File | `scripts/property-guard.mjs` |
| Tests | `scripts/property-guard.test.ts` |

A Kiro `PreToolUse` hook (`.kiro/hooks/property-guard.json`) runs it on agent file writes. It reads the hook event on stdin and decides from the tool input and git's index alone, without opening the target: exit 0 allows the write (not a `*.property.test.ts` file, or one git does not track yet), exit 2 blocks it (a tracked property file, or a write it could not check).
