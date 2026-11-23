# Review of first-spoken-call requirements

The requirements are faithful to the contracts and stay in scope. Apply these fixes to `.kiro/specs/first-spoken-call/requirements.md`, then write the design.

## Must fix: these would stop the agent from working

1. **Voice admission happens after the transcript, on the contract's existing fallback.** Requirement 15.2 asks for admission through `/api/turn` as soon as the audio item is added, but `TurnRequest.transcriptState` only allows `final`, `failed` or `missing`, so there's no transcript to send yet. Contracts §3 already define the path for a missing verdict: ASR admits the turn instead. So in this slice:
   - The browser waits for the final transcript, then posts `/api/turn` with `judge:"timeout"` and `transcriptState:"final"`.
   - `devAdmit` issues `slowOrdinary` for voice turns, and the design records the deviation: `slowOrdinary` audio normally also needs judge `O`, and F2 restores that.
   - This resolves contract questions 2 and 3. Replies will start about 1.1 to 1.6 seconds after speech ends until F2.
   - If no transcript arrives by end of speech plus 1.5 seconds, the turn goes to RECOVERY with the fixed neutral line. It never plays unadmitted audio.
   - Update Requirements 15.2, 15.10, 17.8 and 20.5 to match. A pending `Turn` written before the transcript is no longer needed for this path, so keep `transcriptMissing` only for a failed or missing transcript.

2. **The ack freshness check would block almost every reply.** Requirement 13.2 refreshes every 45 seconds, but 13.7 refuses to admit audio unless the ack is under 2.5 seconds old. KV13 applies to `fastO` only, and this slice issues no `fastO` permits. Scope 13.7 to `fastO`. Keep the rule that a reply is never built from an expired Deck, and make the Deck refresh in time for that (it lasts 60 seconds, so 45-second refresh works).

3. **No requirement creates the core documents.** Requirements 11.2 and 11.6 read `core/epoch` and other core documents, but nothing creates them for a new Owner. Add this: the first authenticated route for an Owner creates `core/epoch`, `core/state`, `core/counters`, `core/rules` and `core/bundle` idempotently, in a transaction, with safe initial values and `clockMode:"live"`.

4. **The extractor must run in the server.** Answer Requirement 22.12 this way: a server-side worker in `packages/server`, not `jobWake`. Functions won't be running on localhost. Typed turns start extraction after the reply returns. Voice turns do the same rather than waiting for hang-up, because the debug panel should show memories during the call. Session close and session open both drain the Owner's remaining extract jobs, and session open waits for them up to a short limit, so a quick re-call hears the memory. State the limit in the design. If the limit passes, open anyway and show the unfinished jobs in the Debug_Panel. This resolves contract question 6.

5. **Sign-in needs a setting change.** Requirement 9.1 is right that Google is enabled; I checked the live project on Nov 3, 2026. But the authorized domains are only `frankirocks.firebaseapp.com` and `frankirocks.web.app`, so a Google popup on localhost will fail. List adding `localhost` and `franki-web--frankirocks.us-central1.hosted.app` as owner actions under Requirement 9.3. Don't change them yourself.

## Should fix: contradictions

6. **Deck revision order.** Requirement 26.10 increments `bundleRev` at session open, while 11.5 says the Deck carries the values from when the Session was created. Make one transaction do all of it, and have the Deck, ack and Session carry the post-compile `bundleRev`.

7. **"Parse" has no meaning yet.** Requirements 27.2 and 27.3 wait for the turn's parse to commit, but `TurnIntents` is out of scope. In this slice, parse committed means the user Turn and Evidence transaction committed. Say so in the Glossary.

8. **Speaker certainty.** Requirement 27.9 refers to a speaker being certain, but this slice has no speaker model. Treat the signed-in Owner's turn as certain, and note that a later feature replaces this.

## Contract questions: answers

Use these and don't reopen them.

| # | Answer |
|---|---|
| 1 | Add a secret named `FRANKI_ID_HMAC_KEY`. Local runs read it from `apps/web/.env.local`. List it as an owner action. Tests use a fixed fake key |
| 4 | Yes, hold allergies and hard rules. F3 adds FastSlots |
| 5 | Add a separate development-only route, `GET /api/debug/memory`, with the same auth, and leave the contract's `/api/memory` views alone. Requirement 29 moves to this route. It refuses when `NODE_ENV` is `production`. It is the development carve-out asked for in 28.4, not the `inspect` carve-out |
| 9 | Keep `/api/health` behavior exactly. Move its model fallbacks into one config module, so no route holds a literal ID |
| 10 | Add `FRANKI_TRANSCRIBE_MODEL` |
| 11 | With bearer tokens and no cookies, the exact `Origin` check is the CSRF check. Add no other mechanism |
| 12 | Store ordinary typed turns as `source:"voice"` with class U and `Turn.source:"typed"`, and record it as a deviation |

Propose answers to the others in the design.

## Keep the design short

The requirements are already 115 KB, which is more detail than this slice needs. For the design:

- Aim for under 40 KB. Reference requirement numbers and contract sections instead of restating them.
- Cover the architecture, module layout, data flow for one voice turn and one typed turn, the state machine, error handling, the testing strategy, Contract questions, and owner actions.
- Don't use sub-agents. Read only the contract sections you need.
- Stop after `design.md`. Don't write `tasks.md` yet, because the design gets reviewed first.
