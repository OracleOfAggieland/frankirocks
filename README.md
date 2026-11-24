# Franki

**Franki Rocks at making your life easier.**

Franki is a friendly Frankenstein ghost you talk to: a very good friend who is also the best personal assistant you've had, stitched from your health, finances, and productivity by one memory. You speak, Franki answers out loud, and text shows up only when there's something to read or approve.

Franki is a Kiroween 2026 entry in the Frankenstein category, and it is built with [Kiro](https://kiro.dev). The name says so: FRAN**KIRO**CKS.

**It's live at [frankirocks.com](https://frankirocks.com).** Press Wake Franki, sign in with Google, then press the power button and talk.

## It's alive

This is a working build, not a mock-up. What runs today:

- **You can call Franki and talk.** The first live call passed all 14 of its checks, end to end. On your first call Franki speaks first, asks what to call you, and uses your name from then on.
- **Franki has a body.** A 3D ghost drawn entirely in code listens, thinks with electricity between its neck bolts, speaks, goes translucent on mute, and celebrates your wins.
- **A judge sits in every call.** Each thing you say is admitted before Franki may answer it, so a "forget that" or a hard moment is never talked over.
- **Franki remembers, and forgets.** What you say becomes memories that each keep their source, Franki brings up a check-in on his own at a quiet moment, and "forget that" means gone from the next thought.
- **The lab is open.** The front door walks a sample month, and the Lab, the memory jar, the receipt and the "What I know" sheet are all on screen.
- **Patterns across your life.** In the sample month Franki notices that takeout spending lands on nights with meetings after 6, offers to plan quick dinners for those nights, and later says what changed: $71, down from $186.
- **Franki can make a phone call for you.** An oak wall phone floats up by his shoulder and shows where the call stands, and a short report of the call comes back to your private conversation.
- **Franki can look things up while you keep talking:** your mail, your calendar or the web, read-only. The answer comes at the next pause, with a card on screen. See [Asking about your mail, calendar and the web](#asking-about-your-mail-calendar-and-the-web).
- **Connect a bank, read-only, and ask what you spent.** Plaid takes the sign-in, and every amount traces to a transaction.
- **Say "Franki, you rock"** and the wooden radio at his feet turns on, Franki celebrates, and a globe of 70 radio stations opens, tuned to rock. Spin the globe and press a city's light to hear it. One press on the radio does the same.
- **Press the X-ray machine** at Franki's other side and a big X-ray screen opens on your camera. Your picture shows as old film, with a skull that turns and talks with you and the bones of your hands drawn over it. On a phone, flip to the back camera and point it at a friend. It's not a medical scan, and the picture never leaves your device.
- **6,106 tests pass in the full suite,** and a full-history secret scan runs on every push.

What comes next is listed plainly under [Still on the slab](#still-on-the-slab).

## Built with Kiro

Kiro is the lab Franki was assembled in. Every body part below is a Kiro feature doing real work, and every claim links to its file.

| Body part | Kiro feature | How we used it | Why it mattered | Evidence |
|---|---|---|---|---|
| Skeleton | **Specs** | Four specs, each with requirements, design and tasks: 108 requirements and 118 tasks, 115 of them done | Franki's voice path has dozens of ways to go wrong. The specs named each one before any code existed, so the first live call worked | [`.kiro/specs/`](.kiro/specs/) |
| Brain | **Steering** | Nine steering files: four always on, four loaded only for the files they govern, and one pulled in by hand when a persona is written | Kiro kept the memory rules, the clock rule and the product's hard rules in mind on every task without being told twice | [`.kiro/steering/`](.kiro/steering/) |
| Reflexes | **Hooks** | Four hooks: one blocks a write that reads the wall clock, one blocks an edit to a committed property test, one runs the invariant tests on save, and one runs the persona check each time an agent stops | A property can never be quietly edited to make it pass, and time stays testable | [`.kiro/hooks/`](.kiro/hooks/) |
| Immune system | **Property-based tests** | 62 spec tasks are properties, such as "every wait ends" and "a held reply never resumes". 272 property test files in all, 24 of them added by Kiro | Properties catch the sequence nobody thought to write a test for. Kiro's "an admitted turn is always posted" failed about 1 run in 30 until the real bug it caught was fixed; then 0 of 30 failed | [`voice-control/tasks.md`](.kiro/specs/voice-control/tasks.md), [`admitted-turn-posted.property.test.ts`](packages/core/src/voice/admitted-turn-posted.property.test.ts), [`017-report.md`](docs/briefs/017-report.md) |
| Muscle | **Custom agents** | Four. `franki-builder` builds spec tasks headless from the Kiro CLI: it can edit, test and commit, and cannot read secrets, push or deploy. `franki-release` can only read and run commands, and refuses force pushes, deletes, resets, commits, secrets and deploys. Kiro ran it to push the last reviewed commit and make this repo public. `franki-persona-writer` and `franki-reviewer` run as workflow steps: the writer can write only the persona's folder, and the reviewer only its verdict file | Long builds ran unattended, the release step can't rewrite history, and a reviewer can't quietly fix what it reviews | [`.kiro/agents/`](.kiro/agents/) |
| Stitches | **Workflows** | One, `stitch-persona`. It writes a persona's plan, then its spoken lines, mail, calendar and bank rows as four steps side by side, stitches them into one fixture, and loops between a fix step and a review step until a verdict file says approved. Kiro ran it headless and wrote the whole demo persona through it | Four writers kept to one plan, so the dates, names and amounts agree across a month of mail, meetings and purchases | [`.kiro/workflows/`](.kiro/workflows/) |
| Muscle memory | **Skills** | One, `persona-author`, written by Kiro: how a seeded persona is laid out, what the loader checks, the trust rules for mail, and a check script that scans for real names and runs the persona's tests | Every workflow step loaded the same know-how, and the check gave each step the same pass or fail | [`.kiro/skills/`](.kiro/skills/) |
| Lab notes | **Briefs** | 101 files of assignments, reviews and reports. Kiro read briefs 001 to 011 before its runs and wrote their reports | Every run has a paper trail: what was asked, what was built, what was seen | [`docs/briefs/`](docs/briefs/) |

### The winning numbers

As of Nov 24, 2026:

| | |
|---|---|
| Commits by Kiro | **255 of 1,085**, each ending `Built-with: Kiro` |
| Spec requirements | **108** |
| Spec tasks done | **115 of 118** |
| Property test files | **272** |
| Tests passing | **6,106** |
| State machines mapped | **20 pages** in [`docs/machines/`](docs/machines/) |

## Still on the slab

The parts not yet stitched on, said plainly:

- **The Kiroween Demo is built and switched off.** A visit with no sign-in, as an invented persona with a simulated bank, mailbox and calendar. The button stays hidden until anonymous sign-in is turned on for the project and a real visit has been walked. The spec is [`.kiro/specs/kiroween-demo/`](.kiro/specs/kiroween-demo/) and the report is [`docs/briefs/054-report.md`](docs/briefs/054-report.md).
- **Reminders.** One-shot reminders are planned and tested, but no route offers one yet, and nothing recurs.
- **Goals.** Franki saves a goal you mention, but nothing acts on it yet.
- **An approval card before a phone call.** A call dials as soon as you ask, so your own "call this number" is the confirmation, and the call's log row is the audit entry. A forget doesn't end a call already in progress.
- **Acting on mail and calendar.** Look-ups only read: no sending, drafting or changing events. They start only in a call, never from a typed line.
- **Spoken allergies wait for a yes.** When the quick allergy parse misses its 900 ms deadline, the allergy is saved as not yet clear and Franki asks before suggesting food. It becomes a hard rule once you answer.
- **Company mode.** Franki's check for another person in the room misfired in live calls, so it is off unless `FRANKI_COMPANY_MODE=on`.
- **A stalled reconnect.** In one live call, a reconnect after the call dropped stalled before it reached the server. The cause isn't found yet.
- **Franki doesn't know about his radio.** The voice model isn't told it exists, so he may say he has none while it plays.
- **Bank balances.** Only transactions are read.
- Two `first-spoken-call` tasks stay open: the invariant save hook (task 13), which never fired in the IDE, and the sign-in checks (task 25), which need a person at a browser.

## Asking about your mail, calendar and the web

Connect Google from the Gmail and Calendar button at the foot of `/lab` (setup in [`docs/setup.md`](docs/setup.md)). Google shows a warning page first, because it hasn't reviewed Franki yet, and the sheet walks you past it. Then, in a call, ask in your own words: "Did Dana write about the lease?", "What's on tomorrow?", "Am I free Thursday afternoon for 45 minutes?", "Anything important in my inbox?". Franki says one short line ("Let me look."), a helper on the server looks through your mail or calendar while you keep talking, and the answer comes at the next pause, with a card on screen. Ask "did it come back?" and Franki checks.

A question about the world, such as "Which museums in Austin are open this Sunday?", goes to a web search helper instead. It sees none of your accounts. Up to three findings come back, the first one said out loud, and the card links every source. If the sources don't back an answer, Franki says so.

What it doesn't do:

- **Read-only.** It never sends, replies, deletes, accepts an invite or changes an event.
- **Mail can inform, never order.** A message can't call a number, change a rule, write a memory or grant a permission. The planner never sees a message body; a separate reader with no tools reads one message at a time.
- **Senders are named with care.** A sender is said by name only if you have written to them or Gmail's DMARC check passed for their domain. Anyone else is named by address, so a forged "Amazon" is read out as the address it really came from. The most sensitive lines are shown on the card and never said.
- **Bounded.** At most two look-ups at once, a 14-day calendar window, up to three messages for a broad ask, and a cap on model and tool calls; a cut list says so. One web search runs at a time, and its result lasts an hour.
- **Only when you ask, only in a call.** Mail and events are read only when you ask, and a look-up needs a call open. A result nobody heard within five minutes stays on the card and is not said.
- **Tested on a scripted fake,** and tried in live calls on a real Google account.

## Run it

You need Node 24 (see `.nvmrc`). The emulator tests also need Java 21.

```bash
npm install
npm run dev              # http://localhost:3000
npm test                 # unit and property tests
npm run test:emulator    # store rules against the emulator
npm run lint && npm run typecheck && npm run build
```

`http://localhost:3000/specimens` shows every state of the ghost and every surface without calling anyone (development only).

Keys, phone calls, web search, the read-only bank and Google connections, and deploy are in [`docs/setup.md`](docs/setup.md). The Google connection needs an OAuth client of your own (Gmail and Calendar, read-only) and one redirect URI per deployment (`GOOGLE_OAUTH_REDIRECT_URI`); the steps are there.

## Layout

```
.kiro             Specs, steering, hooks and the custom agents
apps/web          The app
packages/core     Pure TypeScript shared by everything, with the property tests
packages/server   Server-only logic
functions         Scheduled jobs
scripts           The hooks' guard scripts, build checks, the radio's station snapshot, the live-test recorder
docs              Briefs, design documents and the state machine pages
tests             Smoke test and emulator tests
```

## Credits

The radio's station list comes from [Radio Browser](https://www.radio-browser.info/) (public domain). The globe's coastlines are [Natural Earth](https://www.naturalearthdata.com/) (public domain), via [world-atlas](https://github.com/topojson/world-atlas).

The X-ray finds faces and hands with [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) by Google (Apache-2.0), and its skull is fitted to a few points of MediaPipe's canonical face model. The idea follows [X-Ray Mirror](https://github.com/masterofvfx2070/xray-mirror) by masterofvfx2070; none of its code or models are used, and every bone is drawn in code.

## License

[MIT](LICENSE)
