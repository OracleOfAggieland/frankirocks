# Brief 002: fixes after the first real typed run

The owner ran the typed path against real OpenAI and real Firestore on Nov 3, 2026. These three items came out of that run and the review of tasks 29-33. Do them in order, one commit each, with the `Built-with: Kiro` trailer. Make edits and commits in separate calls. Stop after item 3. Don't start task 35, and don't push or deploy.

## 1. Local Admin SDK quota project

On this machine, Application Default Credentials are a user login with no quota project. `verifyIdToken(token, true)` then fails with `auth/internal-error`, while Firestore reads work. Setting `GOOGLE_CLOUD_QUOTA_PROJECT` to the Firebase project ID fixes it for the local app.

- `scripts/sync-local-env.mjs` writes `GOOGLE_CLOUD_QUOTA_PROJECT` into the generated `apps/web/.env.development.local`, with the same value as `FRANKI_FIREBASE_PROJECT_ID`.
- Don't add it to `apphosting.yaml`. Hosted code runs as a service account and doesn't need it.
- Add or extend a test of the sync script. It must still write plain values only.
- You can't read `apps/web/.env.local`, and you don't need to. Claude removes the temporary copy there after this run.

## 2. The route guard must tell token failures from infrastructure failures

`packages/server/src/auth/guard.ts` turns every verifier failure into `authError("token rejected")`. That hid the problem in item 1: the owner saw `AUTH` for a valid token.

- A token that is bad, expired, revoked or malformed stays `AUTH`.
- Any other verifier failure, such as `auth/internal-error` or a network or credential error, becomes `DEPENDENCY` with a retry hint, using the existing error helpers.
- Read the Admin SDK's error codes in `node_modules` to decide which codes count as token failures. Treat an unknown code as `DEPENDENCY`.
- Log the failing error code on the server. Never log the token.
- Add witnesses for an expired token, a revoked token, `auth/internal-error` and a plain thrown `Error`, and do one mutation check.
- Check what the Browser_Client does with `DEPENDENCY` here. The message must not tell the owner to sign in again.

## 3. Correct the record

The report and tasks file are out of date. Correct them from these facts:

- **Task 34 is done. Tick it.** The owner approved it and Claude ran the deploy. All five indexes in `firestore.indexes.json` showed READY at 21:44:23 on Nov 3, 2026 (Pacific).
- **Real typed calls have happened.** `docs/briefs/001-report.md` says no real OpenAI call has been made. Replace that with: the typed path has run against real OpenAI and real Firestore; the two extract jobs completed on the first attempt, and one active Memory was written with lineage. No real WebRTC call has been made.
- **Realtime API shapes.** Claude compared the voice code with the types in the installed `openai` 7.45.1 SDK: the event names, `session.update`, `response.create`, `tracing`, and the multipart `sdp` and `session` fields of `/realtime/calls`. They match. Claude couldn't load OpenAI's docs. The SDK types don't confirm the `Location` header, so task 35 is still the first real check.
- **Add a stub row for cost.** `costMicros` is written as a hard-coded 0 in `packages/server/src/worker/extract.ts`, and token counts are correct. Add a row to the report's stubs table and a new contract question: real cost needs a dated price table. Don't invent prices.

Task 33 stays unticked until CI has run. Task 25 stays unticked until the owner finishes the browser checks.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` all exit 0. Say in your report what you changed and what you couldn't check.
