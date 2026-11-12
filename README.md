# Franki

**Franki Rocks at making your life easier.**

Franki is a friendly Frankenstein ghost you talk to: a very good friend who is also the best personal assistant you've had, stitched from your inbox, calendar, food and money by one memory. You speak, Franki answers out loud, and text shows up only when there's something to read or approve.

Franki is a Kiroween 2026 entry in the Frankenstein category, and it is built with [Kiro](https://kiro.dev). The name says so: FRAN**KIRO**CKS.

## It's alive

This is a working build, not a mock-up. What runs today:

- **You can call Franki and talk.** The first live call passed all 14 of its checks, end to end.
- **Franki has a body.** A 3D ghost drawn entirely in code listens, thinks with electricity between its neck bolts, speaks, goes translucent on mute, and celebrates your wins.
- **A judge sits in every call.** Each thing you say is admitted before Franki may answer it, so a "forget that" or a hard moment is never talked over.
- **The lab is open.** The front door walks a sample month, and the Lab, the memory jar, the receipt and the "What I know" sheet are all on screen.
- **Franki can make a phone call for you** and shows where the call stands on a wooden wall phone.
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

Claude Code built the 3D avatar, the first wave of memory writes, the state machine safety net, the UI build-out and phone calls. Those commits carry its own trailer. The split is in the history, commit by commit.

## Still on the slab

The parts not yet stitched on, in build order:

- **Memory that writes.** The write planners exist and are tested. No route calls them yet.
- **Forget.** "Forget what I said about my brother" and its No Resurrection property.
- **Time.** Check-ins and reminders that Franki raises on its own.
- **The pattern across your life.** Noticing takeout spending against late meetings, and closing the loop with the number that changed.
- **The seeded month** that the lab runs on. Franki runs on fixtures, not on live mail or bank connections.
- Nine `voice-control` tasks and eight call-path fixes, each already written down as a failing test in [`docs/briefs/014-report.md`](docs/briefs/014-report.md).

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

Keys, phone calls and deploy are in [`docs/setup.md`](docs/setup.md).

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

## License

[MIT](LICENSE)
