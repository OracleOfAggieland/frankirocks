# UI: Electricity, the avatar's events and the screen loop

The main screen's moving parts. The call's own state comes from `voice.call` (see [voice-call](voice-call.md)); everything here reads it and never writes it. Rules: `.kiro/steering/ui-design.md`.

### `ui.electricity`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/ui/electricity-budget.ts` |
| Tests | `apps/web/src/components/avatar/Electricity.test.tsx` |

At most `MAX_ELECTRICITY` (two) Electricity effects run at once. The budget is a set of grant tokens: `request()` returns a new token, or null when the set is full, and `release(token)` removes it. A holder without a grant draws a still bolt instead. Holders on this branch:

| Holder | Requests | Releases |
|---|---|---|
| `Electricity` (`apps/web/src/components/avatar/Electricity.tsx`, `useGrant`) | on mount while not reduced | on unmount, or when Reduced_Motion turns on |
| The call button's ring spark (`ui.ringSpark`; its shell `RingSparkShell` in `apps/web/src/components/CallScreen.tsx`) | on pointer down in the start form, not reduced, while idle | when its own spark's animation ends or is cancelled, when the button leaves its start form, when Reduced_Motion turns on, and on unmount; a second grant while one is held goes straight back |
| The three.js ghost (`syncGrant` in `apps/web/src/components/avatar/three-ghost-controller.ts`) | while the renderer phase is `fading-in`, `three` or `fading-out` and the look is electric, holding no grant | when that stops holding, and at `stop()` |

Not modelled: telling a holder that was refused when a grant is released. A refused holder asks again on its own schedule: the SVG `Electricity` only when its effect runs again, the ring spark on the next press, and the three.js ghost on every look (`applyLook`) and after every renderer event (`drain`).

### `ui.avatarEvents`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/avatar/events.ts` |
| Decides | `reduceEvents`, `currentEvent` |
| State | `EventState` |
| Events | `EventInput` |
| Tests | `apps/web/src/ui/avatar/events.test.ts`, `apps/web/src/ui/avatar/events.property.test.ts` |

The only code that starts and clears Avatar_Events. Pure, driven by Frame_Time; no timers.

- Time never moves backward; a non-finite time is ignored. A timed event expires on any input once its `EVENT_MS` has passed.
- The wake starts once per Visit: on the first `connecting` state, or an explicit `wake` event, and `woke` stays true after that.
- During the wake, other timed events are dropped. Otherwise a new timed event replaces the running one.
- `closed` clears the awaited approval; `signOut` clears the timed event and the awaited approval.
- `currentEvent` shows the timed event first, then `await-approval`, then none.

### `ui.look`

| Field | Value |
|---|---|
| Status | view |
| File | `apps/web/src/ui/avatar/look.ts` |
| Decides | `lookFor`, `lookNameFor` |
| Tests | `apps/web/src/ui/avatar/look.test.ts`, `apps/web/src/ui/avatar/look.property.test.ts` |

The only code that decides an Avatar_Look. Pure: its inputs (`AvatarInput`: the avatar state, mic and output mute, the two levels, the current event and how long it has run, whether the wake runs, Reduced_Motion) go in and a look comes out; nothing is stored.

### `ui.sound`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/sound/schedule.ts` |
| Decides | `scheduleCues`, `gateOpen` |
| State | `SoundTrack`, `SoundGate` |
| Tests | `apps/web/src/ui/sound/schedule.test.ts`, `apps/web/src/ui/sound/sound.property.test.ts` |

`scheduleCues(track, look, extra, gate)` returns the next track and the cues for one step. A change of look name resets the track (and cues `wake` or `celebrate`); `Thinking` for more than `THINKING_CUE_AFTER_MS` cues `thinking` once. The track always updates, so a cue blocked by a closed gate never plays later. The gate is open only after a gesture, with the Sound_Toggle on and Franki's voice muted. The engine (`apps/web/src/ui/sound/engine.ts`) plays cues through one master gain on the shared AudioContext.

### `ui.audioContext`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/ui/audio/context.ts` |
| Tests | `apps/web/src/ui/audio/context.test.ts` |

`SharedAudio` holds the Visit's one AudioContext. It listens for the first `pointerdown` or `keydown` (the call button press counts), creates the context then, and stops listening. Before that gesture, or when Web Audio is missing, `getContext()` is null. `App` hands its `getContext` to the Level_Meter and the sound engine.

### `ui.reducedMotion`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/ui/hooks/reduced-motion.ts` |
| Tests | `apps/web/src/ui/hooks/reduced-motion.test.ts` |

A watcher over `prefers-reduced-motion: reduce`. The hook's server snapshot is true, so the first paint is calm, and an override context lets a specimen force it on. The screen controller and `CallScreen` each read it.

### `ui.screen`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/ui/hooks/screen-controller.ts` |

`ScreenController` runs the screen's one frame loop over today's sources: auth, the Voice_State, mic and output mute, and levels. Each frame it publishes the look, makes at most one coalesced announcement, schedules sound cues through the gate and advances Electricity's Frame_Time. `App` starts it on mount, stops it on unmount, and sets its sources when the signed-in controllers change.

### `ui.ringSpark`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/ring-spark.ts` |
| Decides | `ringSparkStep`, `ringSparkPropEvents` |
| State | `RingSpark` |
| Events | `RingSparkEvent`, `RingSparkCommand` |
| Tests | `apps/web/src/ui/ring-spark.test.ts`, `apps/web/src/components/CallScreen.spark.test.tsx` |

One spark around the start ring per press, only with Reduced_Motion off and an Electricity grant. `RingSpark` is `idle`, or `sparking` with the grant's token; a grant is held only in `sparking`. `ringSparkStep(state, event)` is pure and returns the next state and commands (`request`, `release`); it never reads the budget, a clock or the DOM, and an event it does not know returns the state as it was.

- `pressed` asks for a grant only from `idle`, in the start form, with Reduced_Motion off. `granted` with a token enters `sparking`; with null (the budget is full) nothing changes; a second grant while one is held is released at once.
- Every way out of `sparking` releases the grant and goes to `idle`: `animationEnd` or `animationCancel` naming the spark's own token (another token changes nothing), `formLeft` (the click that follows the press started a call and the span is gone), `reducedOn` and `unmount`. From `idle` these change nothing.
- `ringSparkPropEvents(start, reduced)` is what a render's props send: `formLeft` while the button is out of its start form, `reducedOn` while Reduced_Motion is on.

The shell, `RingSparkShell` in `apps/web/src/components/CallScreen.tsx`, holds the state, runs `request` against the screen's `electricityBudget` and feeds the answer back as `granted` in the same dispatch, runs `release`, and tells its listeners only when the state changes. `useRingSpark` reads it with `useSyncExternalStore`, dispatches `pressed` on pointer down in the start form, the prop events in an effect on every change of the form or Reduced_Motion, and `unmount` in an effect cleanup. The spark span is keyed by the grant's token; `onAnimationEnd` sends `animationEnd`, and a listener on the span's ref sends `animationCancel`, since React has no prop for it. `ring-spark.ts` is in `PURE_MODULES` in `scripts/ui-boundaries.mjs`. The React wiring (the effects, the ref listener and the key) has no test: the web app has no DOM test environment.

### `ui.levelTap`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/levels/level-meter.ts` |
| Decides | `audioTapStep` |
| State | `AudioTap` |
| Events | `AudioTapEvent` |
| Tests | `apps/web/src/ui/levels/level-meter-audio.test.ts` |

Each Level_Meter tap (one per stream: the mic and the remote output) carries a second analyser for the three.js ghost's audio reads (the meter's `audio`, an `AvatarAudioSource`). `AudioTap` is its life: `unbuilt` until its first read, `live` once connected to the tap's source, `failed` after a Web Audio error on it (it reads 0 from then on; the first analyser is untouched), `closed` once the tap is disconnected. `audioTapStep` is total: `built` moves only `unbuilt` to `live`, `error` goes to `failed`, `disconnected` to `closed`, and `failed` and `closed` absorb every event. The first analyser, `sample()` and `rawInput()` keep their own `failed` flag and are not part of this machine.

### `ui.rendererPhase`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/avatar/renderer-phase.ts` |
| Decides | `rendererStep`, `rendererView`, `fallbackFor`, `loopStep`, `loopRuns` |
| State | `RendererState`, `Phase`, `LoopState` |
| Events | `RendererEvent`, `LoopEvent` |
| Tests | `apps/web/src/ui/avatar/renderer-phase.test.ts`, `apps/web/src/ui/avatar/renderer-phase.property.test.ts` |

Two pure machines. The renderer phase says which of the SVG ghost and the three.js engine shows. `fallbackFor` is the truth table: three.js only with WebGL 2, a ready engine, Reduced_Motion off and no skipped one-shot; anything else is the SVG. `rendererStep` moves the `Phase` (`svg`, `loading`, `mounting`, `building`, `waiting`, `fading-in`, `three`, `fading-out`, `held`, `lost`, `failed`) toward what the table says, with the crossfades. It is total: an event a phase does not take only records `reduced` or `skipped`. `failed` absorbs everything but `stopped`, and `stopped` returns to `svg` from any phase. `INITIAL_RENDERER` starts with `reduced: true`. `rendererView` shows the SVG ghost only as the fallback (`svg` under Reduced_Motion, where it fades in, and `fading-out`, `held`, `lost` and `failed`): before the canvas has shown, the box is empty, so the SVG never appears ahead of the 3D ghost, and the server render and the first client render draw the empty box. The canvas layer's own transition ends `fading-in`. `rendererView` says, per phase, what the SVG and canvas layers do, what the engine must do (`probe`, `load`, `await-size`, `build`, `keep`, `dispose`) and whether the loop runs. `seesOneShots` is true in `waiting`, `fading-in`, `three` and `fading-out`.

The loop machine, `LoopState`, is four independent facts (`life`, `hold`, `page`, `gl`) and a frame-error counter. `loopStep` is total; `disposed` absorbs every event; `frame-ok` resets the counter, and `FRAME_ERROR_LIMIT` errors in a row set `life` to `failed`. `loopRuns` is true only when the engine is live, not held, the page is visible and the context is not lost.

The shell of the renderer phase is `apps/web/src/components/avatar/three-ghost-controller.ts`: each renderer transition it makes is `rendererStep`, and on each look it runs `actingFor` and `oneShotStep` (`ui.acting`). The shell of the loop machine is `ui.frameLoop`.

### `ui.frameLoop`

| Field | Value |
|---|---|
| Status | documented |
| File | `apps/web/src/components/avatar/three/loop.ts` |
| Tests | `apps/web/src/components/avatar/three/loop.test.ts` |

The three.js engine's frame loop, the shell of the loop machine in `ui.rendererPhase`. `createLoop` keeps a `LoopState` (from `INITIAL_LOOP`), and only `send(event)` changes it: it runs `loopStep`, reports `failed` with reason `frames` to the host when `life` goes from `live` to `failed`, then calls `run()` or `halt()` as `loopRuns` says. `run()` requests the next frame from the host's scheduler and clears the previous frame time, so the first frame back has a zero step; `halt()` cancels the pending request. `running` mirrors that decision for the scheduler and is set nowhere else. A frame that throws sends `frame-error`, and the next good frame after one sends `frame-ok`. The host's visibility (`show`, `hide`) and the WebGL context's lost and restored events reach the machine through `send`.

### `ui.acting`

| Field | Value |
|---|---|
| Status | explicit |
| File | `apps/web/src/ui/avatar/acting.ts` |
| Decides | `actingFor`, `oneShotStep` |
| State | `EdgeState`, `Acting` |
| Events | `OneShot`, `OneShotCommand` |
| Tests | `apps/web/src/ui/avatar/acting.test.ts`, `apps/web/src/ui/avatar/acting.property.test.ts` |

`actingFor(look)` maps an Avatar_Look onto what the engine acts: a `Pose` (from the look's name, or for Presenting, Awaiting_Approval and Celebrate from `look.follows`), an `Overlay`, the look's one-shot, and the two audio gates (`mic` open only when the look follows input, `voice` only when it follows output). Nothing is stored. `oneShotStep(state, next, running)` is the edge machine of the wake and the celebration; `running` is `seesOneShots` of the renderer state. Entering a one-shot gives `start` while running, otherwise marks it `skipped`. Leaving the celebration always gives `cut`; leaving a wake that started gives `cut`, and a skipped wake needs none. Staying in the same one-shot keeps `skipped`; a look with no one-shot clears it.
