# Brief 001 report (draft): first spoken call

Status: **draft, not complete.** Tasks 1–12, 14–24 and 26–32 are done and ticked. Task 25 (sign-in) and task 13 (save hook) stay open because their remaining checks need a person, and tasks 34 (index deploy) and 35 (paid live check) have not started. No real OpenAI call and no real WebRTC call has been made. This draft is written at task 33 on branch `build/first-spoken-call` and has not been pushed, so CI has not run on it.

The build was done with **Kiro**: the `.kiro/steering` files set the stack, structure, product and memory rules; the spec in `.kiro/specs/first-spoken-call` (requirements, design, tasks) drove every task; a Kiro PreToolUse hook (`.kiro/hooks/clock-guard.json`) blocks wall-clock reads outside the Clock_Port; every commit ends with `Built-with: Kiro`; and the web app shows a "Built with Kiro" footer on every page.

## Checks at task 33 (2026-11-03, local)

| Check | Result |
|---|---|
| `npm test` | 65 files, 702 tests passed, about 15 s; no network, no Java, no `OPENAI_API_KEY` |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:emulator` (Java 21) | 2 files, 35 tests passed |
| `GET /api/health` fields | unchanged: `apps/web/src/app/api/health/route.test.ts` pins `ok`, `service`, `node`, `configured{openaiKey, smokeToken, brainModel, voiceModel}`, and `POST` still refuses without the smoke token. Not checked against a running server. |
| CI `verify` and emulator jobs | not run: needs the owner to approve a push |

## What was built

| Area | Tasks |
|---|---|
| Kiro steering files; clock guard hook (`clock-guard.json`, written by the owner's operator) | 1, 3 |
| Clock_Port (server, browser, functions), clock allow-list and static wall-clock check | 2 |
| Model_Config module, model-ID literal check, local env sync from `apphosting.yaml` | 4, 5 |
| Import-boundary check; no-network Vitest setup (`tests/setup/`); Fake_OpenAI | 6 |
| Closed record and wire schemas, text normalization, Slices, IDs | 7, 8, 9 |
| Store_Port, Memory_Store, Firestore_Store, conformance suite, indexes file, rules tests | 10, 14 |
| Lineage property (red, then green), schema round-trip and slice-hash properties | 11, 12, 22 |
| Route_Guard, idempotency, core documents, route adapter pattern | 15 |
| `eligible`, `spokenGrade`, `compileHead` with properties | 16, 17 |
| Session open, state and close; tick; hangup jobs | 18 |
| `/api/turn` with clientSeq serialization property | 19 |
| Admission_Seam and `devAdmit` | 20 |
| Typed reply with no call | 21 |
| ExtractV1 extractor, drain, open race and route deadlines | 22, 23 |
| `GET /api/debug/memory` and the Debug_Panel | 24, 27 |
| Sign-in, browser clock, API client, "Built with Kiro" footer | 25 (open) |
| Typed input and conversation view; typed memory path end to end | 26, 28 |
| Voice call-state reducer | 29 |
| SDP proxy and receipts (assistant Turns) | 30 |
| Recall tool and the spoken-grade wire property | 31 |
| Voice_Client, call screen, Stand_In_Avatar, sign-out closing open Sessions | 32 |
| Checks and this report | 33 |

## Stubs and stand-ins, and what replaces them

| Stub or stand-in | Replaced by |
|---|---|
| `devAdmit` as the only Admission_Seam implementation; refuses in production | F2 (the judge) |
| Voice turns admitted by ASR with `judge:"timeout"` and `slowOrdinary` (contracts §6 needs judge `O`) | F2 |
| `generation` fixed at 1 per Session; reconnect opens a new Session | F2 |
| Stand_In_Avatar (plain HTML and CSS) | Rive avatar |
| Typed-turn source mapping: ordinary typed lines are stored as Evidence `source:"voice"`, class U, with `Turn.source:"typed"`, because the Evidence `Source` union has no `typed` (contract question 12) | contracts v3 `typed` source, or a later typed-input feature |
| Memory placeholders: `endWhen:{kind:"standing"}`, `nextReviewAt = assertedAt + 365 d`, `when:{kind:"none"}` (contract question 7) | F6 `derive` |
| Empty `lastTurns` and empty roster in the ExtractV1 packet | later pronoun context and the entity feature |
| Mention IDs `H("mention", type, name)` instead of entity rows (contract question 30) | the entity feature |
| Recall reads the Owner's own Memories, not a 40-memory seed (contract question 8) | F8 seed |
| Recall `purpose:"inspect"` returns empty notes (no `snapshot()`) | the inspect/overview feature |
| No speaker model: a Turn under the Owner's token counts as a certain speaker | a later speaker feature |
| Tick gate held in process, not in `core/state` (contract question 31) | contracts v3 `core/state.lastTickOpsAt` |
| Background retry, not a `hangup` Job, for a call whose ID could not be stored (contract question 32) | contracts v3 call IDs on hangup jobs |
| `GET /api/debug/memory` (development only), not the contract's `/api/memory` | the `/api/memory` views |
| Allergies and hard rules from ExtractV1 are held, not written | F3 FastSlots and the rule path |

## Deviations from the design

- **Typed-turn source mapping** (above; contract question 12, owner-approved deviation).
- **Voice admission without a judge** (contract questions 2 and 3, owner-approved deviation).
- **Invariant save hook is open (task 13, R3.4 not confirmed).** `.kiro/hooks/invariants-on-save.json` exists and its matcher is tested, but on Nov 3, 2026 saving a file in the Kiro IDE did not start `npm run test:fast` in six tries. The hook could not be confirmed to run.
- **Tick gate** (task 18): in process instead of a compare-and-set on `core/state`, which has no field for it (contract question 31).
- **Hangup for an unstored call ID** (task 30): R12.4 asks for a `hangup` Job, but no Job field can hold a raw Realtime call ID. The route hangs up at once and retries in the background for 10 minutes, which does not survive a restart (contract question 32).
- **Transcription model in the browser** (task 32): R13.1 puts the transcription model in the browser's `session.update`, and no route returns it. `next.config.ts` inlines `FRANKI_TRANSCRIBE_MODEL` from `apphosting.yaml` as `NEXT_PUBLIC_FRANKI_TRANSCRIBE_MODEL` at build time, using the `env` option that the Next 16 docs mark as legacy. A model change needs a rebuild.
- **Recall asked test** (task 31): one-character tokens are not recall terms, so the "s" in "dog's" does not make every Turn count as asked.
- **Unchecked API shapes**: the live `/v1/realtime/calls` request and `Location` header, and the Realtime event names and `response.create` input items, follow contracts §6 and the installed `openai` 7.45.1 SDK types. Web access was not permitted while building tasks 29–32, so they are checked only by task 35's live call.
- **Test folder merge** (owner request): `test/setup.ts` and `test/setup.test.ts` moved to `tests/setup/`.

## Estimate against actual

Actual hours are the build's own working time per task.

| Task | Estimate (h) | Actual (h) |
|---|---|---|
| 1 Steering files | 1.5 | 0.3 |
| 2 Clock port and static check | 2 | 0.5 |
| 3 Clock Guard_Hook | 1 | 0.4 |
| 4 Model config and literal check | 1.5 | 0.5 |
| 5 Local env sync | 1 | 0.3 |
| 6 Import boundaries and test harness | 1.5 | 0.5 |
| 7 Record schemas | 4 | 0.3 |
| 8 Wire and debug schemas | 2.5 | 0.2 |
| 9 Text, slices and IDs | 2 | 0.2 |
| 10 Store_Port, Memory_Store, conformance | 4 | 0.4 |
| 11 Lineage property (red) | 2.5 | 0.4 |
| 12 Round-trip and slice-hash properties | 1.5 | 0.4 |
| 13 Invariant save hook (open) | 0.5 | — |
| 14 Firestore_Store, indexes, rules tests | 3.5 | 0.4 |
| 15 Route_Guard, idempotency, core docs | 3.5 | 0.5 |
| 16 Eligibility and spoken grade | 2.5 | 0.3 |
| 17 Head compiler | 3 | 0.4 |
| 18 Session open, state, close | 4 | 0.7 |
| 19 `/api/turn` and serialization | 4 | 0.5 |
| 20 Admission seam and `devAdmit` | 2 | 0.3 |
| 21 Typed reply without a call | 1.5 | 0.3 |
| 22 Extractor (lineage green) | 6 | 1.0 |
| 23 Drain, open race, deadlines | 2.5 | 0.2 |
| 24 `GET /api/debug/memory` | 2.5 | 0.4 |
| 25 Sign-in and API client (open) | 2.5 | 0.6 |
| 26 Typed input | 2 | 0.5 |
| 27 Debug_Panel | 3 | 0.6 |
| 28 Typed path end to end | 1 | 0.3 |
| 29 Voice state machine | 4 | 0.8 |
| 30 SDP proxy and receipts | 3 | 0.6 |
| 31 Recall tool | 3 | 0.8 |
| 32 Voice_Client, controls, avatar | 5 | 0.9 |
| 33 Checks and report draft | 1.5 | 0.4 |
| **Total, tasks 1–33** | **85.5** | **14.9** |
| 34 Index deploy approval (not started) | 0.25 | — |
| 35 Paid live check (not started) | 1 | — |

## Contract questions

From `.kiro/specs/first-spoken-call/design.md` "Contract questions". `docs/design/` was not changed.

**Answered by the owner**

1. ID hashing key: secret `FRANKI_ID_HMAC_KEY`, read locally from `apps/web/.env.local`; tests use a fixed fake key.
2, 3. Voice turns post after the final transcript with `judge:"timeout"`, and `devAdmit` issues `slowOrdinary`. Deviation from contracts §6 (judge `O`); F2 restores it.
4. ExtractV1 allergies and hard rules are held; F3 adds FastSlots.
5. A development-only `GET /api/debug/memory`, refused in production; the contract's `/api/memory` is untouched.
6. Extraction is an in-process server worker, started after each `/api/turn` response, drained at close and at open (raced against 3,000 ms).
9. `/api/health` behavior is unchanged; its fallbacks moved into `config/models.ts`.
10. The transcription model is `FRANKI_TRANSCRIBE_MODEL`.
11. The exact `Origin` check is the CSRF check.
12. Ordinary typed turns are Evidence `source:"voice"`, class U, with `Turn.source:"typed"`. Deviation.

**Proposed in the design**

7. Memory placeholder fields until F6 `derive` (see stubs).
8. Recall reads the Owner's own Memories, at most 200 lines; the seed is F8.
13. A request hash mismatch is 409 `HASH`; an in-flight duplicate is 429 `LIMIT` with `retryAfterMs:1000`.
14. Oversize `LIMIT` is HTTP 413.
15. `worldClock.zone = core/state.currentZone`, set from `clientZone` at each open; `homeZone` unchanged.
16. No stored field carries the Permit issuer; the debug route reports `issuer:"devAdmit"`. Proposal: a stored issuer in v3 if F2 needs it.
17. Admissions write ledger `decision` (purpose `answer`); the Permit kind is derived from the stored Turn. Proposal: `permitKind` on `decision`, or a nullable `delivery.momentId`.
18. Franki's authorship: assistant Evidence uses `authorship:"unknown"`, `authorId:null` and a class-M Slice; the Turn's role marks the author. Proposal: a `franki` value in v3.
19. Barge-in receipts: `playbackEnded` when started audio stops for any reason; `cancelled` when a permitted response is cancelled before its first audio.
20. Failed or missing transcripts commit the Turn as `failed` or `transcriptMissing`, consume the clientSeq, and write no Evidence or job.
21. `rev`: records start at 1 and each commit adds 1 under compare-and-set.
22. Act `rule` is an ExtractV1 act and is held with `hard_rule`.
23. User `turnId` comes from the browser (random 32 bytes, 43 characters); a replay with a different ID is `HASH`.
24. Typed reply with no call comes back as one `W` note of kind `result`. Proposal: a `replyText` field in v3.
25. Job "pending" maps to `retry` with `error`, then `failed` after 3 attempts.
26. Every state response re-issues the Deck from the stored Head and current revisions, ignoring `core/bundle.expiresAt`.
27. `generation` stays 1 per Session; reconnects open a new Session.
28. `TS` is stored as the fixed-width RFC3339 UTC string in both stores. Proposal: name one stored form in v3.
29. Snapshot `refs[i]` describes `rows[i]`. Proposal: Snapshot rows as `Dependent[]`.
30. Mentions resolve to `H("mention", type, name)` until entity rows exist.
31. The tick gate is in process. Proposal: `core/state.lastTickOpsAt`.
32. A call whose ID could not be stored is hung up through a background retry, not a `hangup` Job. Proposal: `callIds` on the `hangup` work payload.

## Still needs a person or a push

- **Push and CI** (owner approval): run the CI `verify` and emulator jobs on this branch.
- **Task 25 browser checks** on `http://localhost:3000` (`npm run dev`): sign in with Google and see the email within 5 s; close the popup and see the "window was closed" message with the button enabled again; reload while signed in and stay signed in; see the "Built with Kiro" footer signed in and signed out.
- **Task 13 save hook**: confirm in the Kiro IDE that saving a file under `packages/` runs `npm run test:fast` once, or decide to drop R3.4.
- **Call screen look** (no paid call needed): signed out, the call button and typed input show disabled; signed in, the call button shows its start form and the closed avatar.
- **Task 34**: approve or run `firebase deploy --only firestore:indexes`; the build never runs it.
- **Task 35** (paid, after notice): the live call on localhost, which is also the first real check of the Realtime API shapes listed under deviations.
