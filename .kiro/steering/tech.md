---
inclusion: always
---

# Tech stack

Source: `docs/design/architecture-decision.md` and `.nvmrc`. If this file and a source disagree, the source wins and this file must be fixed.

## Pinned versions

| Part | Version |
|---|---|
| Next.js (App Router, `apps/web`) | 16.4.6 (16.4.3 until Nov 17: two cache advisories); fallback 15.5.28; never 15.2.x |
| Node | 24 (`.nvmrc`) |
| TypeScript | 6.0.3 |
| Tests | Vitest 5 with fast-check (property tests) |
| Lint | ESLint 10 |
| Repo | npm workspaces with Turborepo |

Hosting is Firebase App Hosting (backend `franki-web`, us-central1), Firestore for data, Cloud Functions 2nd gen on nodejs24 for scheduled work, and OpenAI for voice and reasoning. Model IDs are config in `apps/web/apphosting.yaml`, never code.

## Banned Next.js features

Server Actions, `use cache`, `next/og` and ISR are banned. They were the 2026 Next.js CVE and out-of-memory hot spots.

## Read the local Next.js docs first

From `apps/web/AGENTS.md`: this Next.js version has breaking changes, so read the relevant guide in `node_modules/next/dist/docs/` before writing any route, `after()` or other Next.js code, and heed deprecation notices.

## Commands

- `npm test`: Vitest unit and property tests (no network, no Java, no `OPENAI_API_KEY`).
- `npm run lint`, `npm run typecheck`, `npm run build`: Turborepo across workspaces.
- `npm run test:emulator`: Firestore emulator tests. Needs Java 21, which runs in CI only.
- The shell on the owner's machine is Windows PowerShell 5.1, which has no `&&`.

## Secrets

Secrets are referred to by name only: `OPENAI_API_KEY`, `FRANKI_ID_HMAC_KEY`, `SMOKE_TOKEN`. Local secrets live in `apps/web/.env.local`, which is gitignored and is never opened, printed or committed by build work.
