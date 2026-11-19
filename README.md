# Franki

**Franki Rocks at making your life easier.**

Franki is a friendly Frankenstein ghost you talk to: a very good friend who is also the best personal assistant you've had, stitched from your health, finances, and productivity by one memory. You speak, Franki answers out loud, and text shows up only when there's something to read or approve.

Franki is a Kiroween 2026 entry in the Frankenstein category, and it is built with [Kiro](https://kiro.dev). The name says so: FRAN**KIRO**CKS.

## It's alive

This is a working build, not a mock-up. What runs today:

- **You can call Franki and talk.** The first live call passed all 14 of its checks, end to end.
- **Franki has a body.** A 3D ghost drawn entirely in code listens, thinks with electricity between its neck bolts, speaks, goes translucent on mute, and celebrates your wins.
- **A judge sits in every call.** Each thing you say is admitted before Franki may answer it, so a "forget that" or a hard moment is never talked over.
- **The lab is open.** The front door walks a sample month, and the Lab, the memory jar, the receipt and the "What I know" sheet are all on screen.
- **Franki can make a phone call for you** and shows where the call stands on a wooden wall phone. The phone specialist can return a short report to your private conversation.
- **Say "Franki, you rock"** and the wooden radio at his feet turns on, Franki celebrates, and a globe of 70 radio stations opens, tuned to rock. Spin the globe and press a city's light to hear it. One press on the radio does the same.
- **Press the X-ray machine** at Franki's other side and a big X-ray screen opens on your camera. Your picture shows as old film, with a skull that turns and talks with you and the bones of your hands drawn over it. On a phone, flip to the back camera and point it at a friend. It's not a medical scan, and the picture never leaves your device.
- **3,186 tests pass on every push,** with a full-history secret scan beside them.

What comes next is listed plainly under [Still on the slab](#still-on-the-slab).

## Built with Kiro

Kiro is the lab Franki was assembled in. Every body part below is a Kiro feature doing real work, and every claim links to its file.

| Body part | Kiro feature | How we used it | Why it mattered | Evidence |
|---|---|---|---|---|
| Skeleton | **Specs** | Three specs, each with requirements, design and tasks: 80 requirements and 108 tasks, 97 of them done | Franki's voice path has dozens of ways to go wrong. The specs named each one before any code existed, so the first live call worked | [`.kiro/specs/`](.kiro/specs/) |
| Brain | **Steering** | Eight steering files: four always on, four loaded only for the files they govern | Kiro kept the memory rules, the clock rule and the product's hard rules in mind on every task without being told twice | [`.kiro/steering/`](.kiro/steering/) |
| Reflexes | **Hooks** | Three hooks: one blocks a write that reads the wall clock, one blocks an edit to a committed property test, one runs the invariant tests on save | A property can never be quietly edited to make it pass, and time stays testable | [`.kiro/hooks/`](.kiro/hooks/) |
| Immune system | **Property-based tests** | 20 spec tasks are properties, such as "every wait ends" and "a held reply never resumes". 49 property test files in all, 23 of them written by Kiro | Properties catch the sequence nobody thought to write a test for. One still fails about 1 run in 30, and it is the real bug it was written to catch | [`voice-control/tasks.md`](.kiro/specs/voice-control/tasks.md), [`packages/core/src/voice/`](packages/core/src/voice/) |
| Muscle | **Custom agent** | `franki-builder` builds spec tasks headless from the Kiro CLI. It can edit, test and commit. It cannot read secrets, push or deploy | Long builds ran unattended and safely | [`.kiro/agents/franki-builder.json`](.kiro/agents/franki-builder.json) |
| Lab notes | **Briefs** | 15 briefs, each one a short assignment Kiro read before a run, with a report after | Every run has a paper trail: what was asked, what was built, what was seen | [`docs/briefs/`](docs/briefs/) |

### The winning numbers

| | |
|---|---|
| Commits by Kiro | **249 of 434**, each ending `Built-with: Kiro` |
| Spec requirements | **80** |
| Spec tasks done | **97 of 108** |
| Property test files | **49** |
| Tests passing | **3,186** |
| State machines mapped | **14 pages** in [`docs/machines/`](docs/machines/) |

### Who built what

Kiro wrote the specs and built Franki's foundation and voice path from them: the first spoken call, the lab UI foundation, the judge spike, and the judge in the call. Those commits end `Built-with: Kiro`.

Claude Code built the 3D avatar, the first wave of memory writes, the state machine safety net, the UI build-out, phone calls, the radio with its globe, the X-ray machine, and the read-only bank and Google connections. Those commits carry its own trailer. The split is in the history, commit by commit.

## Still on the slab

The parts not yet stitched on, in build order:

- **Memory that writes.** The write planners exist and are tested. No route calls them yet.
- **Forget.** "Forget what I said about my brother" and its No Resurrection property.
- **Time.** Check-ins and reminders that Franki raises on its own.
- **The pattern across your life.** Noticing takeout spending against late meetings, and closing the loop with the number that changed.
- **The seeded month** that the lab runs on. The demo runs on fixtures. A real bank (Plaid) and a real Google account (Gmail and Calendar, read-only) can also be connected; see [Asking about your mail and calendar](#asking-about-your-mail-and-calendar).
- Nine `voice-control` tasks and eight call-path fixes, each already written down as a failing test in [`docs/briefs/014-report.md`](docs/briefs/014-report.md).

## Asking about your mail and calendar

Connect Google from the Gmail and Calendar button at the foot of `/lab` (setup in [`docs/setup.md`](docs/setup.md)). Then, in a call, ask in your own words: "Did Dana write about the lease?", "What's on tomorrow?", "Am I free Thursday afternoon for 45 minutes?". Franki says one short line ("Let me look."), a helper on the server looks through your mail or calendar while you keep talking, and the answer comes at the next pause, once, with a card on screen. A look-up needs a call open; a typed line with no call open can't start one.

What it doesn't do:

- **Read-only.** It never sends, replies, deletes, accepts an invite or changes an event.
- **Mail can inform, never order.** A message can't call a number, change a rule, write a memory or grant a permission. Its text never reaches the planner; a separate reader with no tools reads one message at a time.
- **Strangers stay on the card.** Mail from someone you have never written to (checked by Gmail's own DMARC result and your sent mail) is never read out; the card names the sender by address only.
- **Bounded.** At most two look-ups at once, a 14-day calendar window, and a capped number of messages and events per look-up; a cut list says so.
- **Not in the background.** Mail and events are read only when you ask. A look-up whose call has ended is shown on the card only.
- **Never tried against a real Google account.** Everything is tested against a scripted fake.

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

Keys, phone calls, the read-only bank and Google connections, and deploy are in [`docs/setup.md`](docs/setup.md). The Google connection needs an OAuth client of your own (Gmail and Calendar, read-only) and one redirect URI per deployment (`GOOGLE_OAUTH_REDIRECT_URI`); the steps are there.

## Layout

```
.kiro             Specs, steering, hooks and the custom agent
apps/web          The app
packages/core     Pure TypeScript shared by everything, with the property tests
packages/server   Server-only logic
functions         Scheduled jobs
docs              Briefs, design documents and the state machine pages
tests             Smoke test and emulator tests
```

## Credits

The radio's station list comes from [Radio Browser](https://www.radio-browser.info/) (public domain). The globe's coastlines are [Natural Earth](https://www.naturalearthdata.com/) (public domain), via [world-atlas](https://github.com/topojson/world-atlas).

The X-ray finds faces and hands with [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) by Google (Apache-2.0), and its skull is fitted to a few points of MediaPipe's canonical face model. The idea follows [X-Ray Mirror](https://github.com/masterofvfx2070/xray-mirror) by masterofvfx2070; none of its code or models are used, and every bone is drawn in code.

## License

[MIT](LICENSE)
