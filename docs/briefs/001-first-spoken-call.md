# Brief 001: first spoken call

You are building Franki, a voice-first life assistant with a serious memory system, for Kiroween 2026. Judges score how well Kiro was used, so make the work visible: specs, steering, hooks and property tests all live in this repo.

## Goal

The owner can sign in on localhost, press one button, talk to Franki out loud, say something about their life, hang up, call again, and hear Franki use it. A plain debug panel shows exactly what was stored and where it came from.

This is the F0 and F1 work in the build plan, plus just enough of F3 and F5 to test memory. It is a real foundation, not a throwaway demo.

## Read these first

| File | Use it for |
|---|---|
| `docs/design/memory-spec-v3.md` | Behavior. Start with sections 1-4, 11 and 14 |
| `docs/design/memory-contracts-v2.md` | Records, prompts, wire types and routes. It is compressed, so read it carefully. Requirement IDs are in section 10 |
| `docs/design/architecture-decision.md` | Stack, and the deploy gotchas |
| `README.md` and `apps/web/AGENTS.md` | Repo layout. Next.js 16 differs from your training data, so read its local docs before writing routes |

## In scope

1. **Kiro setup.** Steering in `.kiro/steering/` (product, tech, structure, and memory rules). A guard hook that blocks `Date.now()` outside the clock port. A save hook that runs the fast in-memory invariants.
2. **Contracts.** Typed records and closed schemas for what this slice uses: `evidence`, `memories`, `sessions`, `turns`, `core`, plus `Head`, `Deck`, `Stamp`, `StateAck`, `TurnRequest`, `TurnResponse`. Pure code in `packages/core`, I/O in `packages/server`.
3. **Ports.** A clock port and a store port, with an in-memory store for tests and a Firestore store for real use. Add the Firestore indexes this slice needs. Client rules stay deny-all, and the server uses the Admin SDK.
4. **Auth.** Firebase ID tokens on every route, with every record scoped to the signed-in user. Propose the simplest sign-in that works on localhost and on the deployed app.
5. **Voice.** WebRTC from the browser to `gpt-realtime-2.1` through the server SDP proxy. Routes: `/api/session/open`, `/sdp`, `/state`, `/close`, with barge-in and mute. Use a stand-in avatar, not Rive.
6. **Typed input.** A text box that takes the same `/api/turn` path, so memory can be tested without a microphone.
7. **Memory write.** `/api/turn` and `/api/receipt` save transcripts serialized by `clientSeq`. Each user turn is kept whole as evidence, then `ExtractV1` writes memories that point back to exact spans, following the Authority and Policy rules.
8. **Memory read.** At session open, pure code compiles the `Head` from current memories, so the next call knows them. Add a single-read `recall` tool per F5.
9. **Debug panel.** Backed by `GET /api/memory`: turns, evidence, memories, lineage and the compiled Head, refreshed during a call. Function over looks.

## Out of scope for now

The judge and slow gate (F2), corrections and bitemporal repair beyond what the schema needs (F3), forget (F4), time and moments (F6), food and the hero (F7), seed and reset (F8), the Gate and whispers (F11), Rive, Gmail, Calendar and Plaid.

**Admission stays a real seam.** Every reply goes through one admission function that issues a permit. For now it is an explicit development implementation named `devAdmit`, which F2 replaces. It must refuse to run when `NODE_ENV` is `production`. If that blocks a deployed test, stop and ask rather than loosening it.

Do not stub these, because they cannot be retrofitted: the clock port, a source on every field, lineage from each memory back to its evidence, and transcript order.

## Tests

- Fast unit and fast-check property tests run on the in-memory store, with faked OpenAI calls.
- Write the lineage property first: no memory exists without a resolvable path to evidence spans.
- Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green. Keep `/api/health` working.
- Java isn't installed on this machine, so the Firestore emulator can't run here. CI runs the rules tests. Tell the owner if you truly need the emulator locally.
- Spend real OpenAI money only for a final live check, and say when you do.

## How to work

- Use one spec, `first-spoken-call`, with requirements, design and tasks. Cite contract row IDs such as KC03 and KV10. Each task records its dependencies, estimate, actual time and test. Property tasks are required, not optional.
- Work on the branch `build/first-spoken-call`, with small commits.
- If the contracts conflict with each other or can't be built as written, list the conflict in the design under "Contract questions" with your proposal. Don't silently change `docs/design/`.
- OpenAI model IDs come from config, as in `apps/web/apphosting.yaml`, never from code.

## Stop and ask before

- Reading, printing, or committing any secret. Local runs need `OPENAI_API_KEY` in `apps/web/.env.local`, which is gitignored. If it's missing, say so and wait; the owner will add it.
- Deploying, pushing to GitHub, or changing Firebase, Google Cloud, IAM or Secret Manager settings, including enabling a sign-in provider. Say exactly what's needed.
- Installing anything system-wide, or reading or writing outside this repo.

## Done means

1. All checks above are green.
2. The final message gives the exact commands to run it locally and lists anything the owner must do first.
3. `docs/briefs/001-report.md` records what was built, what was stubbed, actual time against the estimates, and the open contract questions.
