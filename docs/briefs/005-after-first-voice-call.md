# Brief 005: fixes after the first real voice call

The owner ran task 35's live check on Nov 8, 2026, in Chrome on Windows against `npm run dev` with real OpenAI and real Firestore. It passed: Franki was told "My dog is called Pip", the call was hung up, a new call was made, and Franki answered "Pip". Barge-in and mute/unmute both worked.

Two problems showed up before the first call connected. This brief fixes them and then records the check. Do the items in order, one commit each, every message ending with the trailer line `Built-with: Kiro`. Make edits and commits in separate calls. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green at every commit. Stop after item 3. Don't push or deploy.

## What the server log showed

The first press of call, on a server that had just started:

```
POST /api/session/open 200 in 4.7s (next.js: 148ms, application-code: 4.6s)
{"event":"route.dependency","route":"open","error":"Error"}
POST /api/session/open 503 in 2.7s (next.js: 1.9ms, application-code: 2.7s)
```

- The first open committed a Session and answered 200 after 4.7 s. The browser had already aborted it (`net::ERR_ABORTED`) at its 5 s limit (`OPEN_TIMEOUT_MS` in `apps/web/src/client/voice-client.ts`, R16.6), so the Browser_Client never learned about that Session.
- The retry, with a new `requestId`, found that Session as the prior one and failed with `DEPENDENCY` after 2.7 s. The only clue is `"error":"Error"`, because `runRoute` in `packages/server/src/routes/runtime.ts` logs the error's `name` and nothing else. The cause is not known. One guess: the first open's extract drain lost the 3,000 ms race and kept running through `schedule`, and the retry's transaction collided with it. Don't assume the guess; find out.
- Once the server was warm, every open took 2.0–3.3 s and every call connected. A recall tool call took 4.4 s.

## 1. Say what the dependency failure was

- When a route maps an error to `DEPENDENCY`, the `route.dependency` log line also carries the error's `code` when there is one (Firestore and gRPC errors carry one, such as `ABORTED`) and the first 200 characters of its message.
- Keep the existing log rule: IDs and times only. Never log a token, a request body, transcript text or Memory text. Infrastructure error messages from Firestore, the Admin SDK or OpenAI are fine at 200 characters. If you find an error type whose message can hold user content, log only its `code` for that type and say so in a comment.
- Add witnesses: a Firestore-style error with a `code`, a plain `Error`, a non-Error throw, and one showing a message over 200 characters is cut.

## 2. Session open must answer in time, and a retry after a lost answer must work

R16.6 gives the open response 5 seconds from the browser's point of view. The browser's timer starts after the ID token is read, so the 5 s covers the network round trip and all of the server's work. A cold open used 4.6 s of server time, leaving almost no margin. The `deadlines.test.ts` witness passes because it measures on the fake opsClock; real time also goes to `ensureCoreDocs`, the expiry `tick`, the transaction and the prior Session's close.

- Log one line per open with the milliseconds spent in each phase: core docs, tick, drain race, transaction, prior close. IDs and times only.
- Give session open one overall server budget comfortably inside R16.6, such as 3,500 ms, and let the drain race use only what is left of it, rather than a fixed 3,000 ms on top of everything else. Pick the number from your measurements and explain it. The drain still continues through `schedule` when it loses, as now.
- Don't raise the browser's 5 s limit. It is R16.6.
- **The lost-answer retry.** Reproduce the live sequence against the emulator: an open commits but its answer is lost, its drain is still running through `schedule` with a queued Extract_Job, and a second open arrives with a new `requestId`. The second open must answer 200 within the budget, close the first Session, and leave exactly one active Session. If it fails the way the live run did, use item 1's log to find out why, fix the cause, and say what it was.
- If a fix changes `OPEN_DRAIN_LIMIT_MS` or anything else the design names, update `.kiro/specs/first-spoken-call/design.md` and add an entry under "Contract questions". The files in `docs/design/` are read-only.
- You can't sign in to the live app. Measure against the emulator, and say in your report which numbers still need a live check.

## 3. Record the live check

Update `docs/briefs/001-report.md` and `.kiro/specs/first-spoken-call/tasks.md` from these facts:

- **Task 35 is done. Tick it,** with the date (Nov 8, 2026) and these results:
  - Steps 1, 3 and 4: the owner told Franki "My dog is called Pip", hung up, called again and heard Franki answer "Pip".
  - Step 5: barge-in worked; mute and unmute worked.
  - Step 2: nobody watched the Debug_Panel during the call. Say so. Recall across calls shows the Memory was written, but the panel itself was not checked.
  - The first open on a cold server timed out in the browser and the retry got a 503. Items 1 and 2 of this brief cover that.
  - The test ran in Chrome. The call needs microphone access, so use a browser that grants it.
- **Real OpenAI calls made:** WebRTC calls through `/api/session/sdp` on `FRANKI_VOICE_MODEL`, with transcription on `FRANKI_TRANSCRIBE_MODEL`; spoken turns through `/api/turn` on `FRANKI_BRAIN_MODEL`; extraction on `FRANKI_BG_MODEL`. Three calls connected, and two of them carried seven turns between them.
- **Server times seen while warm:** open 2.0–3.3 s, SDP 1.3–2.7 s, turn 1.4–2.6 s, receipt 0.6–1.5 s (about three per turn), state 0.6 s, one tool call 4.4 s. Add these to the report as observed numbers, not targets.
- Update the report's status line: no real WebRTC call has been made is no longer true.
- Task 35 asks for a final message with local run commands from a fresh clone, the owner actions, and the real OpenAI calls made. Put that in the report.
- Task 33 stays unticked until CI has run. Task 25 and task 13 stay unticked until the owner finishes their browser and hook checks.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:emulator` all exit 0. Say in your report what you changed, what you found the 503's cause to be, and what you couldn't check.
