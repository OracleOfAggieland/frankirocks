# Brief 054 report: the Kiroween Demo

A visitor presses **Kiroween Demo**, is signed in anonymously, and arrives as Jeffrey Kisses: an invented man with an
invented bank, mailbox and calendar. Nothing asks for a login, and no real bank, Gmail or Calendar is reached. The
spec is `.kiro/specs/kiroween-demo/`, the brief is `054-kiroween-demo.md`, and the persona's plan is
`054-persona-bible.md`.

## Who built what

**Kiro** (six commits, each ending `Built-with: Kiro`):

- The spec's three documents: 28 requirements, a design with 21 correctness properties and contract questions 96 to
  103, and the tasks. Kiro's requirements pass raised 16 open questions; the answers are recorded under "Resolved
  questions" in `requirements.md`.
- The `persona-author` skill (`.kiro/skills/persona-author/`): how to write a seeded persona, four reference files and
  the persona check `scripts/check.mjs`.
- The denied-word list (`packages/server/src/testing/denied-words.ts`) and the taste steering file
  (`.kiro/steering/kisses-taste.md`, `inclusion: manual`).
- The whole persona, through the `stitch-persona` workflow: the bible, then turns, mail, calendar and bank written as
  four parallel steps, then a stitch step, then a review loop in which a second agent judged the result and wrote
  `persona-verdict.json`. The verdict was `APPROVED` with no findings on the first review.
- A fix to its own check (it scanned comments and field names; it now scans string literals only).

**Claude** (every other commit):

- The brief, the workflow file, the two step agents (`franki-persona-writer`, `franki-reviewer`) and the Stop hook
  `persona-witness`. Headless Kiro can't write `.kiro/workflows/`, `.kiro/agents/` or `.kiro/hooks/`, so these were
  written by hand between runs.
- All the code in parts C0 to C4, D1 and D2, the 23 property files, and the other tests.

Kiro features used here for the first time in this repo: Workflows (parallel steps, a repeat loop that stops on a file
check, a per-step model), Skills, a `Stop` hook, manual steering, and custom agents as workflow steps.

## What was built

| Part | What | Where |
|---|---|---|
| C0 | Fixture types for a demo persona, five more build checks, the simulator token, the switch, the taste scanner | `seed/fixture.ts`, `seed/build.ts`, `demo/token.ts`, `demo/switch.ts`, `demo/visit.ts`, `demo/taste-scanner.ts` |
| C1 | The anonymous flag read from the verified token on every request; anonymous tokens refused when the switch is off; `GET /api/demo` | `auth/guard.ts`, `auth/admin-verifier.ts`, `routes/runtime.ts`, `demo/guards.ts`, `apps/web/src/app/api/demo/` |
| C2 | A simulated bank and a simulated Gmail and Calendar behind the existing ports, answered from the fixture's own lines and routed by token | `demo/sim-bank.ts`, `demo/sim-google.ts`, `demo/gmail-query.ts`, `demo/routing.ts`, `demo/layout.ts`, `demo/config.ts` |
| C3 | Pairing (anonymous and the demo persona go together), connectors written at reset, the routes' refusals, reads on the visit's world clock | `seed/pairing.ts`, `seed/reset.ts`, `demo/install.ts`, `bank/routes.ts`, `google/routes.ts`, `bank/money-read.ts`, `errands/` |
| C4 | The visitor plays the persona (the name line, no first-meeting question), the phone never offered or dialed | `core/owner-name.ts`, `core/head.ts`, `core/voice/machine.ts`, `meet.ts`, `routes/open.ts`, `routes/turn.ts`, `phone/outbound.ts` |
| D1, D2 | The button on the landing and the signed-out panel, anonymous sign-in, the marker `/lab#demo`, the account menu, the two sheets' simulated state, the specimens section | `apps/web/src/client/demo.ts`, `client/auth.ts`, `ui/demo/marker.ts`, `components/DemoButton.tsx`, `components/DemoSwitchLine.tsx`, `landing/DemoLink.tsx` |
| E | Jeffrey Kisses: 16 spoken lines, 17 full emails and 16 bulk ones, 26 calendar events, 35 bank rows, three accounts | `packages/server/src/seed/kisses/` |

Everything above the two ports is the real product: the pull and import, `read_money`, the Gate, the errand runner,
the mail trust rule and the hero's pattern code read Jeffrey's rows exactly as they read a connected account's.

## How it holds together

- **No stored flag.** A demo tenant is one whose verified token says `sign_in_provider: "anonymous"`. The flag is read
  from the token on every request. Work with no token (the errand run endpoint) asks the tenant's connectors instead.
- **Pairing.** An anonymous tenant can be given only a demo fixture, and a signed-in tenant never can. A refusal is the
  same 404 as an unknown fixture and writes nothing.
- **Routing by token.** A demo visit's connectors hold sealed simulator tokens that carry the fixture, the visit's
  world start and its zone. A simulator token reaches the simulator and any other token reaches the live provider, so
  neither side can be handed the other's token.
- **The switch.** `FRANKI_DEMO` is on only when it is exactly `on`. Off, the button is hidden and every anonymous token
  is refused.
- **What a demo visitor can't do:** place a phone call, open Plaid Link, start Google's sign-in, or disconnect the
  simulated accounts. Each is not offered and is also refused on the server. Web search stays on.

## Where the build departed from the design

- The design capped the simulator token at 128 characters, but its own grammar allows 138. The grammar is enforced and
  there is no cap. The world start may not have a leading zero.
- Build check 5's mail half (IDs must not collide) became a count check that the mail lines fit the ID space.
- `playsOwner` puts the persona's name on the Head in a private audience only. The design's line would also have put a
  fixture name on a company Head.
- The fallback to the demo's placeholder provider settings applies only when the request is not a verified signed-in
  user's. A signed-in user on a deployment with no Plaid or Google settings is answered `CONFIG` as before, so contract
  question 103's side effect does not reach routed requests.
- The reset checks pairing before it creates core documents, so a refused or unknown fixture now writes nothing at all.
- Only the period of a money read follows the world clock. The freshness line and the notes' expiry stay on the ops
  clock.
- The trust property asserts the rule in force since Nov 19: a stranger's mail may be spoken, named by address. It does
  not assert "card only".
- The browser also refuses Disconnect and hides the Plaid and Google lines on a simulated sheet, and it removes the
  marker from the address before the anonymous sign-in starts.
- Property 10 lists the query string as an input. The guard never sees one, so the property covers the headers and
  the body.

## Contract questions

96 to 103 are in the spec's `design.md`. Two need the owner:

- **97.** A demo visit is never asked "What should I call you?", and the persona's name reaches the Head. This is an
  exception to ruling M-1 (Nov 18), which asks every sample visit.
- **101.** A forget of a simulated message writes a provider block that survives Start over, as it does for a real
  connection. Kept as designed.

## What it doesn't do

- **No balance.** `read_money` answers spending and money back. Nothing reads an account balance, so "how much is in
  my account?" has no answer; the large deposits are visible as money back.
- **Mail and calendar need a call.** A typed line with no call open reads money but starts no errand.
- **No cleanup of abandoned demo tenants,** and no per-visitor limit on model spend. Each visit is its own tenant.
- **Nothing is sent, drafted or changed.** The simulated accounts are read-only, like the real ones.
- **The switch is one value for the whole deployment.** There is no per-visitor gate.

## Review

One independent read-only review of the whole lane asked whether a demo visitor can reach a live provider, whether a
signed-in user can reach the persona or the simulators, and whether the switch fails closed. It traced every route and
found no path from a demo token to Plaid, Google or Twilio. It made two findings, both fixed:

1. **A demo tenant that stops being anonymous.** A visitor can link a real sign-in to the anonymous user by hand. The
   uid stays, later tokens are signed-in ones, and the next Start over clones the sample fixture, which used to leave
   the three simulated connectors on a sample visit. The reset now deletes a simulated connector from a tenant that
   is not a demo visit (`dropSimulatedConnectors` in `demo/install.ts`; `demo/linked.test.ts` was written red first).
   Until that Start over, such a tenant still reads the invented data; it gains nothing a signed-in user lacks.
2. **`guardRequest` counted the switch as on.** It has no caller outside tests, but a future route using it would
   have accepted anonymous tokens with the demo off. It now counts the switch as off.

## Checks (Nov 24, on the lane)

- `npm run typecheck` and `npm run lint` passed (lint with the one old warning in `components/avatar/three/brass.ts`).
- The whole suite, in four shards run two at a time: 787 files, 6,106 tests passed, 1 skipped, 21 expected failures.
  Five property tests in four `packages/core` files (one under `voice/`, three under `patterns/`) timed out at 15
  seconds under that load. The four files pass when run alone (6 tests in 6 seconds).
- `npm run build` passed, with both postbuild checks.
- The emulator suite was not run. Firestore rules, indexes and Functions are unchanged.
- After the two review fixes, the server folders they touch were run again (`demo`, `seed`, `bank`, `auth`, `google`,
  `account`, `errands`, `routes`: 164 files, 857 tests passed, 1 skipped) with the server typecheck. The whole suite
  and the build were not run again.
- No test that existed before the lane was edited.
- Kiro's persona check passes over `seed/kisses/` (no denied word, 19 tests), and the reviewer agent's verdict is
  `APPROVED`. The Taste property applies the same list to every string in the fixture.
- The end-to-end test runs a whole demo visit on fakes with no Plaid or Google settings: reset, open, the sheets, a
  money read to the cent, the mail errand and the calendar errand, on the visit's world clock. It asks the brief's own
  sentence, "How much did I spend on rocket fuel this month?", both ways the model may pass it (the merchant words,
  and the transportation group).
- In a browser, on a dev server with the switch on: the landing shows the button, `GET /api/demo` answers
  `{ "enabled": true }` with `no-store`, and a press goes to `/lab`, removes the marker and tries the anonymous
  sign-in. Firebase refused it (`auth/admin-restricted-operation`: the Anonymous provider is not enabled in the
  project), and the failure line showed under the button. The specimens section "Kiroween Demo" was seen at 1280 px:
  the button states, the account menu, the line a signed-in user gets at `/lab#demo`, and both simulated sheets.

## The first real visits (Nov 24, after the build shipped with the switch off)

The build was deployed with `FRANKI_DEMO` off, the Anonymous provider was then enabled in Firebase Authentication, and
three demo visits were walked on a dev server with the switch forced on (`http://localhost:3000`, against the real
Firebase project). No model was called and no call was opened.

Seen:

- **The way in.** The button on the landing and the one on the Lab's signed-out panel both start a visit with no
  popup and no form; the marker leaves the address.
- **The Lab as Jeffrey.** The account menu reads "Jeffrey Kisses" and "Demo"; the visit bar reads "Simulated: Fri
  8:40 AM" with its four bolts; the Lab counts 33 read emails; the "Built with Kiro" footer shows.
- **The sheets.** Bank: "This bank is simulated. No real bank is connected.", Brassmoor Savings and Trust, three
  accounts (Everyday Checking, Rainy Day Savings, Launch Operations), no Connect and no Disconnect. Gmail and
  Calendar: "This mail and calendar are simulated. No real Google account is connected.", both connected.
- **What I know.** Jeffrey's memories, each with its source.
- **A bolt.** "Today, 6 PM" moved the clock to Fri 6:00 PM and the bolts changed; a reload kept it.
- **Start over.** The confirmation, a new month, still Jeffrey.
- **Sign out.** `POST /api/account/delete` answered 200, the signed-out panel came back, and afterwards the
  Firebase user and the tenant's core documents were both gone (checked with the admin API).
- **The deployed site with the switch off.** A demo visitor's real token was sent to `https://frankirocks.com`: four
  reads and a reset all answered 401 with the same body as a request with no token, and `GET /api/demo` answered
  `{"enabled":false}`.

Found and fixed:

1. **The first load of a visit failed** with "Your month didn't load." The browser gave up on the reset at 8 s; the
   server finished it in 7.8 s. The deployed site's logs show the sample visit's reset taking 6.1 s and 7.9 s, so the
   limit was already too close for every visit. The browser now waits 20 s.
2. **The first press of a bolt failed** with "The clock didn't move." The browser gave up at 4 s; the server took
   3.1 s plus the dev server's first compile. No bolt has been pressed on the deployed site, so its real time is
   unknown. The browser now waits 10 s.
3. **One memory read badly:** "The owner works as runs a small rocket company at Kisses Launch Works." The role's
   value is now "the founder of a small rocket company".
4. **Each visit left one entry in the browser's storage** (the visit kept under a user that no longer exists).
   Leaving a demo visit now drops it.

Also found, and left alone: from an origin the guard does not list (a dev server on another port), the press makes
an anonymous user and then every write is refused, so the Lab never loads and the user stays in Firebase with no
data. The three listed origins are not affected.

## Shipping order

Deploy this build before the Anonymous provider is enabled in Firebase Authentication, never after. A build from
before this change has no notion of an anonymous token: it would accept one as an ordinary signed-in user, with the
phone, Plaid Link and Google's sign-in all offered. This build refuses every anonymous token while `FRANKI_DEMO` is
off, and pairs one with the demo persona, with those three refused, while it is on.

## Not tried

- **Any real model.** The persona's lines, the hero offer, the errands' planner and the name line have run against
  scripted model answers only. How the voice model plays to "Jeffrey" is unknown. The asks in task 10.3 (rocket fuel,
  mail from mission control, the calendar, the hero offer, "What do you know about me?", a stranger's mail) were not
  made: each is a paid model call, and mail and calendar also need a call with a microphone.
- **A live call on a demo visit,** and the phone refusal as the model would meet it.
- **Arriving at `/lab#demo` signed in with Google** in a real browser. Its one line and one button were seen on the
  specimens page only.
- **A demo visit on the deployed site.** The switch is still off there.
- **The whole suite and the build after the four fixes above.** The demo, seed, client and App tests, the web
  typecheck and lint were run.
