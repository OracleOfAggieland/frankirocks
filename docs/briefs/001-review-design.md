# Review of first-spoken-call design

The design is approved with the fixes below. Apply them to `design.md`, apply the pending requirement edits, then write `tasks.md`.

## Apply the pending requirement edits

Your earlier edits to `requirements.md` failed on a tool permission. That is fixed now. Apply every edit you listed, using targeted replacements:

- 15.2, 15.10, new 15.11, 17.8, 20.5, 20.8
- 13.3, 13.7
- new 10.13
- 18.4, 22.12
- 9.1, 9.3, changed as described below
- 11.5, 26.10
- Glossary: "parse committed"
- 27.9
- Requirement 29 and other `/api/memory` mentions, including 29.7, move to `GET /api/debug/memory`
- 30.2

Also apply the changes that fixes 1 and 2 below require.

## Must fix in the design: these would stop a live call

1. **Model IDs are missing on localhost.** `next dev` doesn't read `apphosting.yaml`, and Requirement 30.3 fails any operation whose Model_Config variable is unset. With only the two secrets in `.env.local`, every call returns `CONFIG`.
   - Add `scripts/sync-local-env.mjs`, run from `predev` in `apps/web`. It copies only the plain `value:` entries from `apphosting.yaml` into `apps/web/.env.development.local`. It never copies `secret:` entries and never prints values.
   - `apphosting.yaml` stays the single source of these values. Check that `git check-ignore` reports the generated file as ignored, and add a test for the parsing.
   - Add this to Requirement 30 as a new criterion. The Firebase `NEXT_PUBLIC_*` values reach localhost the same way, so the owner doesn't copy them by hand.

2. **Session open can use up the connect timer.** The state table starts the 5 s `CONNECTING` limit when open is sent, but open alone can take about 4 s when its drain waits. A quick re-call with an unfinished job is the demo path, so it would go to `RECOVERY`.
   - Start the 5 s limit when the open response returns. It then covers SDP and the data channel only.
   - The Requirement 16.6 limit on the open response itself stays.
   - Update any requirement this changes.

3. **Background work can block the state route.** `tick` runs on open and on state and "runs due jobs", and an Extract call has a 10 s deadline. Requirement 13.6 gives `/api/session/state` 1.5 s, and a late first ack closes the call.
   - In the state route, `tick` only schedules its work with `after()` and never awaits it.
   - Session open bounds its own wait the same way. Race the drain against the 3,000 ms limit, and let running jobs finish in the background. A job's deadline never extends the wait.
   - Add a route test with a Fake_OpenAI that never answers. State and open must still meet their limits.

4. **The clock guard would fail on existing code.** `packages/server/src/live.ts:16` calls `Date.now()`, and the design's allow-list leaves it out. `functions/src/index.ts:50` also reads the clock. Route `live.ts` through `clock/live-clock.ts`. Move the `functions` read behind a port, or allow-list one file there. `health.ts:73` only formats a supplied time, so make sure the guard's patterns don't flag it.

5. **The Admin SDK needs an explicit project on localhost.** Application Default Credentials from a user account don't reliably supply a project ID. Initialize `firebase-admin` with `projectId` taken from config, and state the variable in the design. It is not a secret and it belongs in `apphosting.yaml`.

## Should fix: small contradictions

6. **Transcript wait wording.** The design says "every item's final transcript is missing". It should be **any** item's final transcript, so a Turn is admitted only when all of its items have one.
7. **Bundle expiry.** `core/bundle.expiresAt` is set once at open, while re-issued Decks get a new 60 s. State that re-issue depends only on the stored Head and current revisions, and ignores the bundle's `expiresAt` in this slice.
8. **Head during a call.** State plainly that nothing recompiles the Head during a call in this slice. A memory made during a call reaches the Head at the next session open, and reaches the call only through `recall`. If that's so, a mid-call `seen` mismatch can't arise from extraction.
9. **Pronoun antecedents.** Contracts §5 says `lastTurns:[]` "except recorded pronoun antecedents". This slice doesn't record antecedents, so `lastTurns:[]` is right for now. Record it as a known limit: "She's a beagle" can't be attributed to the earlier turn. Don't add a mechanism for it.

## Owner actions: replace the list

- `localhost` **is already authorized**, done Nov 3, 2026. Only `franki-web--frankirocks.us-central1.hosted.app` remains, and only for testing the deployed app. Deployed calls are refused by `devAdmit` until F2 anyway. Update Requirements 9.1 and 9.3 to match.
- Application Default Credentials already exist on this machine, so remove that action from the required list. Keep one line for a fresh machine.
- `apps/web/.env.local` holds exactly `OPENAI_API_KEY` and `FRANKI_ID_HMAC_KEY`.
- Firebase web config values are public. The owner's operator will supply them for `apphosting.yaml`, so keep this as one line.
- Firestore index deployment needs owner approval and must happen **before the first live call**, because job draining and supersede lookups depend on those indexes. Make it an explicit task that stops and asks. Never run the deploy yourself.

## Tasks

Write `tasks.md` after the fixes above.

- Keep the build order from the brief. The lineage property test is written first and run red (R24.5, R24.6).
- Small tasks that each end with passing tests and one commit on `build/first-spoken-call`.
- No optional tasks, and no sub-agents.
- Group the tasks so that typed turns, extraction and the Debug_Panel work before any voice task. That lets memory be tested cheaply before the first paid call.
- The final tasks are the index approval stop, then the paid live check after notice (R31.10).

Stop after `tasks.md`. Don't start any task, write code, run commands or commit. Don't read any `.env` file.
