# Machine index

Every piece of code that holds state and moves it between named states is listed here: one row per machine, by its `area.thing` name, with what it alone decides, the file that owns it and the page that describes it. Look here before adding a status field, an in-progress boolean or a nullable that means "waiting": the machine may already exist.

`scripts/machines-index.test.ts` keeps this index and the pages true; the checker is `scripts/machines-index.mjs`. It checks that every row has one block, on its page, with the same status and file, that every file a page names exists, that the functions and types a block names are exported by its file (or by a file the same cell names) and that the tests it lists exist, that an `explicit`, `table` or `view` block names its deciding function and its tests, that a diagram's states equal the union its block names, and that every source file named `*-phase.ts` or `*machine*.ts`, or exporting a function `step`, `*Step` or `next*`, is the home file of some row.

## Statuses

| Status | Meaning |
|---|---|
| `explicit` | One pure function decides, over a closed union. The block names the function and its types. |
| `table` | A `const` table typed with `satisfies Record<State, ...>`, read by one function. |
| `view` | A pure function that derives a closed union from live state and is never written. |
| `documented` | The state lives in fields or records that several functions write. The page says which, and what holds. |
| `planned` | The home file is not on this branch yet. Its page block says where it will live; the test does not require the file. |

## Index

| Machine | Status | What it alone decides | Home file | Page |
|---|---|---|---|---|
| `voice.call` | explicit | What the call does next, for every event: phase, waits and the commands the Voice_Client runs | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.permit` | explicit | Whether a Permit may play now, and if not, why | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.fastO` | explicit | Whether the browser may issue a `fastO` Permit | `packages/core/src/voice/fast-o.ts` | [voice-call](voice-call.md) |
| `voice.judge` | explicit | The judge's verdict, read from its `response.done` | `packages/core/src/voice/judge.ts` | [voice-call](voice-call.md) |
| `voice.avatar` | view | The avatar state, the call button's form and whether mute shows, from `VoiceState` | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.turn` | documented | Where a spoken or typed Turn is between its first commit and its post | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.posts` | documented | Which `/api/turn` posts are outstanding and when a Turn is posted again | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.stateAck` | documented | When the state poll goes out and whether its StateAck is kept | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.recovery` | documented | Connection recovery and the neutral-line screen, and when "Try again" shows | `packages/core/src/voice/machine.ts` | [voice-call](voice-call.md) |
| `voice.latency` | documented | When a Turn's latency row opens and closes | `packages/core/src/voice/latency.ts` | [voice-call](voice-call.md) |
| `voice.transport` | documented | Which peer connection, data channel and mic track are live | `apps/web/src/client/voice-client.ts` | [voice-call](voice-call.md) |
| `voice.turnAnswer` | planned | What a `/api/turn` answer means for the request that asked | `packages/core/src/voice/turn-answer.ts` | [voice-call](voice-call.md) |
| `voice.turnMode` | view | The Turn's mode, derived for tests | `packages/core/src/voice/testing/turn-mode.ts` | [voice-call](voice-call.md) |
| `voice.replyStage` | view | The reply's stage, derived for tests | `packages/core/src/voice/testing/reply-stage.ts` | [voice-call](voice-call.md) |
| `time.deadlines` | documented | The order of the limits that nest inside each other | `packages/core/src/voice/machine.ts` | [deadlines](deadlines.md) |
| `client.api` | documented | What one route call returns: a body or a failure kind | `apps/web/src/client/api.ts` | [client-api](client-api.md) |
| `client.retries` | documented | How a turn post and a receipt are sent again | `apps/web/src/client/voice-client.ts` | [client-api](client-api.md) |
| `client.clock` | documented | The offset between the browser's opsClock and the server's | `apps/web/src/client/clock.ts` | [client-api](client-api.md) |
| `client.auth` | documented | Whether the screen is loading, signed out or signed in, and when controllers exist | `apps/web/src/components/App.tsx` | [client-api](client-api.md) |
| `client.debugRefresh` | documented | Whether a Debug panel load runs, waits or joins a queued one | `apps/web/src/client/debug-panel.ts` | [client-api](client-api.md) |
| `client.authSession` | planned | The signed-in session's phase and its one exit | `apps/web/src/client/auth-session.ts` | [client-api](client-api.md) |
| `client.reaction` | planned | What the screen does with a failed route call | `apps/web/src/client/reaction.ts` | [client-api](client-api.md) |
| `typed.line` | documented | The typed Session, the line being sent and its clientSeq | `apps/web/src/client/typed-turns.ts` | [typed-line](typed-line.md) |
| `ui.avatarEvents` | explicit | Which timed Avatar_Event is running, and the awaited approval | `apps/web/src/ui/avatar/events.ts` | [ui-electricity](ui-electricity.md) |
| `ui.look` | view | The avatar's look from its inputs | `apps/web/src/ui/avatar/look.ts` | [ui-electricity](ui-electricity.md) |
| `ui.sound` | explicit | Which sound cues play on a step, and whether the gate is open | `apps/web/src/ui/sound/schedule.ts` | [ui-electricity](ui-electricity.md) |
| `ui.electricity` | documented | Who holds one of the two Electricity grants | `apps/web/src/ui/electricity-budget.ts` | [ui-electricity](ui-electricity.md) |
| `ui.audioContext` | documented | When the Visit's one AudioContext is created | `apps/web/src/ui/audio/context.ts` | [ui-electricity](ui-electricity.md) |
| `ui.reducedMotion` | documented | Whether Reduced_Motion is on | `apps/web/src/ui/hooks/reduced-motion.ts` | [ui-electricity](ui-electricity.md) |
| `ui.screen` | documented | The main screen's live sources and its one frame loop | `apps/web/src/ui/hooks/screen-controller.ts` | [ui-electricity](ui-electricity.md) |
| `ui.ringSpark` | explicit | The call button's ring spark and its grant | `apps/web/src/ui/ring-spark.ts` | [ui-electricity](ui-electricity.md) |
| `ui.levelTap` | explicit | The life of each Level_Meter tap's second analyser | `apps/web/src/ui/levels/level-meter.ts` | [ui-electricity](ui-electricity.md) |
| `ui.rendererPhase` | explicit | Which renderer shows the avatar, and the engine's loop | `apps/web/src/ui/avatar/renderer-phase.ts` | [ui-electricity](ui-electricity.md) |
| `ui.frameLoop` | documented | When the three.js engine requests and cancels frames | `apps/web/src/components/avatar/three/loop.ts` | [ui-electricity](ui-electricity.md) |
| `ui.acting` | explicit | The three.js engine's pose and one-shot edges | `apps/web/src/ui/avatar/acting.ts` | [ui-electricity](ui-electricity.md) |
| `server.tick` | documented | Which maintenance runs for an Owner this ops minute | `packages/server/src/worker/tick.ts` | [server-tick](server-tick.md) |
| `server.session` | documented | A Session's stored status, from open to closed | `packages/server/src/sessions.ts` | [server-tick](server-tick.md) |
| `server.sdp` | documented | Which Realtime calls a Session has registered | `packages/server/src/routes/sdp.ts` | [server-tick](server-tick.md) |
| `server.open` | documented | The order of the steps of a session open | `packages/server/src/routes/open.ts` | [server-tick](server-tick.md) |
| `server.turn` | documented | The order of the steps of one `/api/turn` request | `packages/server/src/routes/turn.ts` | [server-tick](server-tick.md) |
| `server.background` | documented | What runs after a response is sent | `apps/web/src/app/api/_lib/adapter.ts` | [server-background](server-background.md) |
| `server.job` | documented | A Job's status and lease | `packages/server/src/worker/jobs.ts` | [server-jobs](server-jobs.md) |
| `server.drain` | documented | Which Extract_Job runs next for an Owner | `packages/server/src/worker/drain.ts` | [server-jobs](server-jobs.md) |
| `server.storeTx` | documented | Whether a transaction commits | `packages/server/src/store/port.ts` | [server-store-tx](server-store-tx.md) |
| `server.request` | documented | Whether a mutation runs, replays or is refused | `packages/server/src/ledger/request.ts` | [server-store-tx](server-store-tx.md) |
| `memory.eligible` | explicit | Whether a row may be used for a verb at a stage | `packages/core/src/eligible.ts` | [memory](memory.md) |
| `memory.parseGap` | documented | The Effective_Audience and the parse watermark of a Session | `packages/server/src/audience.ts` | [memory](memory.md) |
| `memory.epoch` | documented | The current epoch and revisions, and the active Session | `packages/server/src/core-docs.ts` | [memory](memory.md) |
| `memory.forget` | documented | The forget barrier's phase | `packages/core/src/schema/records.ts` | [memory](memory.md) |
| `memory.head` | documented | Which Head a Deck carries | `packages/server/src/head-build.ts` | [memory](memory.md) |
| `memory.recall` | documented | What one recall tool call answers | `packages/server/src/routes/tool.ts` | [memory](memory.md) |
| `memory.assistantTurn` | documented | Where Franki's spoken words are stored | `packages/server/src/routes/receipt.ts` | [memory](memory.md) |
| `memory.spokenTime` | documented | The one civil day spoken words name, or none | `packages/core/src/dates.ts` | [memory](memory.md) |
| `memory.status` | table | Which Memory status moves are allowed | `packages/core/src/writes/status.ts` | [memory](memory.md) |
| `memory.slots` | explicit | When the FastSlots call of a request starts and settles | `packages/core/src/writes/slots-phase.ts` | [memory](memory.md) |
| `memory.ruleState` | explicit | A hard-rule slot's next state | `packages/core/src/writes/rule-state.ts` | [memory](memory.md) |
| `memory.bundle` | explicit | The bundle state a compile or a burn leaves behind | `packages/core/src/writes/bundle.ts` | [memory](memory.md) |
| `deploy.ci` | documented | The checks a push runs, in order | `.github/workflows/ci.yml` | [deploy](deploy.md) |
| `deploy.secretScan` | documented | Which commits a push or pull request scans for secrets | `.github/workflows/secret-scan.yml` | [deploy](deploy.md) |
| `deploy.order` | documented | What one deploy command updates | `package.json` | [deploy](deploy.md) |
| `deploy.config` | documented | Whether a server variable is present | `packages/server/src/config/env.ts` | [deploy](deploy.md) |
| `deploy.wire` | documented | The closed wire shapes both sides share | `packages/core/src/schema/wire.ts` | [deploy](deploy.md) |
| `deploy.records` | documented | The closed stored record shapes | `packages/core/src/schema/records.ts` | [deploy](deploy.md) |
| `deploy.envSync` | documented | Which variables `next dev` sees | `scripts/sync-local-env.mjs` | [deploy](deploy.md) |
| `deploy.propertyGuard` | documented | Whether an agent write to a property test is allowed | `scripts/property-guard.mjs` | [deploy](deploy.md) |
| `spike.session` | documented | Which Realtime session a probe line runs on | `scripts/judge-spike/harness.ts` | [spike](spike.md) |
| `spike.fakeRealtime` | documented | What the fake Realtime transport answers | `scripts/judge-spike/fake-realtime.ts` | [spike](spike.md) |
| `spike.runFile` | documented | The shape of a saved run and its summary | `scripts/judge-spike/summary.ts` | [spike](spike.md) |
| `dev.recorder` | documented | The probe-take recorder's steps | `apps/web/src/app/recorder/_recorder/Recorder.tsx` | [spike](spike.md) |
