---
inclusion: always
---

# Repo structure and package boundaries

Source: `README.md`, `docs/design/architecture-decision.md` and `.kiro/specs/first-spoken-call/design.md` (Module layout).

| Path | Holds |
|---|---|
| `packages/core` | Pure code only: types, closed schemas, validators and pure functions. No I/O and no wall-clock reads. Time arrives as a `ClockPair` argument. |
| `packages/server` | Server I/O: Firestore (Admin SDK), OpenAI and route logic, independent of the web framework. Must not import `next` or `apps/web`. |
| `apps/web` | Next.js app. Route handlers are thin adapters: parse, Route_Guard, call one `packages/server` function, return. Browser code never imports `packages/server`, `firebase-admin` or `openai`. |
| `functions` | Cloud Functions for background jobs (currently the heartbeat only). |
| `scripts` | Repo checks and dev scripts (clock guard, import boundaries, env sync). |
| `.kiro` | Steering, hooks and specs. |
| `docs/design` | Read-only design and contracts. |

## Import rules

- `packages/core` must not import from `packages/server`, `apps/web` or `functions`.
- `packages/core` must not import `firebase`, `firebase-admin`, `@google-cloud/*`, `openai`, `@openai/*`, `next`, or Node I/O modules (`fs`, `net`, `http`, `https`, `child_process` and similar), bare or with `node:`.
- `packages/server` must not import `next` or `apps/web`.
- An import-boundary check in `npm test` enforces these rules.

## Clock

Only the files in `scripts/clock-allowlist.json` may read wall-clock time. Everything else takes time from the Clock_Port.
