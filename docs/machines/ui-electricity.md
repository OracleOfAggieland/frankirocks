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
| The call button's ring spark (`apps/web/src/components/CallScreen.tsx`, `useRingSpark`) | on pointer down in the start form, not reduced, holding no grant | when the spark's animation ends (`onAnimationEnd`) |

Not modelled: telling a holder that was refused when a grant is released. A refused holder asks again only when its effect runs again.

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
| Status | planned |
| File | `apps/web/src/ui/ring-spark.ts` |

A pure step over `idle | sparking` for the call button's ring spark, so every way the spark can end releases its grant. Today the spark lives in `useRingSpark` in `apps/web/src/components/CallScreen.tsx`, as in the table above.

### `ui.levelTap`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/ui/levels/level-meter.ts` |

A tap state per Level_Meter analyser, with its own step function.

### `ui.rendererPhase`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/ui/avatar/renderer-phase.ts` |

The renderer phase (which of the SVG ghost and the three.js engine shows, with the crossfades) and the engine's loop machine, as pure steps.

### `ui.frameLoop`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/components/avatar/three/loop.ts` |

The three.js engine's frame loop. It starts and stops frames only as the loop machine of `ui.rendererPhase` decides.

### `ui.acting`

| Field | Value |
|---|---|
| Status | planned |
| File | `apps/web/src/ui/avatar/acting.ts` |

The mapping from an Avatar_Look to the engine's pose and overlay, and the one-shot edge machine for the wake and the celebration.
