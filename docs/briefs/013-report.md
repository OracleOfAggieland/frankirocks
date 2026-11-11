# Brief 013 report: the three.js avatar in the app

Built on `build/avatar-three` by Claude Code agents, from `docs/briefs/013-threejs-avatar.md` and the design note `docs/briefs/013-design.md`. None of this is Kiro's work, and no commit carries the Kiro trailer.

**State:** the engine, the renderer, the pure machines, the wiring, the specimens section and the guards are built and committed. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all exit 0. **Nothing has run in a browser yet.** Every claim below about how it looks or moves on screen is untested until the owner's checks at the end.

## What was built, and where

| Part | Where | What it is |
|---|---|---|
| The engine | `apps/web/src/components/avatar/three/` (27 modules) | The prototype's code, section by section, each inside a `createX(rc)` factory that destructures its inputs from one shared rig context. Geometry, shader source, materials, constants, springs, timing, build order and the seeded streams are the prototype's. |
| The facade | `three/engine.ts` | `createEngine(container, size, initial, options, host, signal)` and `AvatarEngine` (`setTargets`, `settle`, `resize`, `pause`, `dispose`, `timings`, `stats`). It is the only module imported from outside `three/`, and only through a dynamic `import()`. |
| The acting mapper | `apps/web/src/ui/avatar/acting.ts` | `actingFor(look)`: pose, overlay, one-shot and the two audio gates. `oneShotStep`: whether a one-shot starts, is cut or was missed. Pure. |
| The fallback and phase machines | `apps/web/src/ui/avatar/renderer-phase.ts` | `fallbackFor` (the truth table), `rendererStep` and `rendererView` (the 11 phases and their fades), `loopStep` and `loopRuns` (the engine's frame loop). Pure. |
| The renderer | `apps/web/src/components/avatar/ThreeGhost.tsx`, `three-ghost-controller.ts`, `three-host.ts` | `ThreeGhost` implements `AvatarRenderer`: an SVG layer over a canvas layer in one box that never changes size. One controller per mount runs the machines and owns the engine handle, the Electricity grant and the size observer. `three-host.ts` holds the browser side: the WebGL 2 probe, the one `import("./three/engine")`, the scheduler, visibility, clock and size observer. |
| The audio source | `apps/web/src/ui/levels/level-meter.ts`, `components/avatar/avatar-audio.ts` | A second analyser per Level_Meter tap, set up as the prototype's (FFT 1024, smoothing 0, -140 to 0 dB), exposed as `meter.audio`. `App.tsx` provides it to the avatar by context. The first analyser, `sample()` and `rawInput()` are unchanged. |
| The default renderer | `components/avatar/Avatar.tsx` | The default is now `ThreeGhost`. |
| One screen across sign-in | `components/App.tsx` | One `Screen` component for both auth states, so the stage and its engine stay mounted when you sign in. |
| CSS | `app/globals.css` | `body { overflow-x: clip }`, the stage's halo and floor hidden while the 3D ghost shows, and a signed-out mask that keeps the canvas off the Wordmark. |
| Specimens | `app/specimens/_sections/ThreeSection.tsx`, `app/specimens/_sim/speech-synth.ts` | The SVG ghost and the three.js ghost side by side for every look, ghost mode over Listening and Speaking, and one reduced-motion pair. Speaking and Listening read a dev-only copy of the prototype's speech simulator. Each tile shows its engine's tier, fps and build timings. A still parity panel builds one `still: true` engine at a time in a 1280 x 900 box. |
| Guards | `scripts/token-check.mjs`, `scripts/three-chunk-check.mjs` | token-check flags `0xRRGGBB` colour numbers in `components/` and `ui/`, with one allow-list entry for `components/avatar/three/`. three-chunk-check runs in `postbuild` and fails if three.js is missing from its own chunk or is in the first load of `/`. |
| Words | `ui/avatar/types.ts`, `components/avatar/Avatar.tsx`, `docs/design/ui-direction.md`, `docs/design/memory-spec-v3.md` | "Rive" is now "three.js" in all four places. |

Commits, in order: `1c4c0be` engine, `9a92440` renderer and pure machines, `8b5abb1` default renderer wiring, `493602b` specimens, `4ab1a05` guards, `7ac4890` words, then this report.

### Changes the integration made beyond the porters' files

- **CANVAS_FRAME** is now `{ left: -0.24, top: -0.23, width: 1.47, height: 1.47 }`. The first estimate failed the design's own alignment test, with the bottom edge 0.099 off against a 0.044 limit. The new value puts every edge within about 0.016 box widths. It comes from arithmetic on the camera and the silhouettes, not from a measurement.
- **One-shot order in the controller.** In the `waiting` phase, a new wake or celebrate that started moved the phase into `fading-in`, and the settle before the fade ended every one-shot, including the one just started. The controller now sends the phase event first and the start command after it. A new controller test pins the order.
- **errors.ts** no longer has the scaffold's `notPorted` helper. `grep -rn "not ported yet\|notPorted\|NOT_PORTED" apps/web/src` returns nothing.
- **postbuild** in `apps/web/package.json` runs `three-chunk-check.mjs` after `specimens-absent.mjs`.

### Verbatim check

The team's `verbatim-diff.mjs` was run on every ported module. Logs are in `_sm/logs/avatar/vdiff/` (team notes, outside the repo).

- **No differences:** `glsl`, `uniforms`, `materials-body`, `materials-hair-brass`, `surface`, `character`, `mouth`, `fx-world`, `fx-sparks`, `fx-lightning` and `probe`.
- **Only the allowed edits:**
  - `stage`: the renderer wrapper, and `size` for `innerWidth` and `innerHeight` (E5).
  - `brass` and `hair`: the merge failures throw `EngineError("merge")`.
  - `fx-catch`: the `_view` scratch vector (E11).
  - `rig`: `doze` and `approve`, `pointerWin`, and `clock.T`.
  - `state`, `apply`, `quality` and `loop`: the contract edits of design §2.3, E5 to E7 and E10.
- **Comments:** only three prototype comments are missing, and each sat on a line the design removes: the voice gate at 2783, `call.tick` at 3372, and the wall-clock comment at 3395.

## The mapping

`actingFor(look)` maps the look alone. The engine never decides a look.

| LookName | Pose | Overlay | One-shot | Notes |
|---|---|---|---|---|
| Dormant | idle | dormant | none | New acting: the wake's start pose held (lids shut, glow x 0.2, body -0.15, through a `doze` spring, w 4), with head-follow, saccades and the brass glint stilled |
| Waking | idle | none | wake | The prototype's wake: strike at 0.35 s, eyes open at 0.55-0.64 s, ends at 1.4 s |
| Connecting | thinking | none | none | The prototype's own mapping, so in three.js it looks like Thinking |
| Listening | listening | none | none | Mic gate open |
| Thinking | thinking | none | none | Arcs only while the Electricity grant is held |
| Speaking | speaking | none | none | Voice gate open; the mouth shows |
| Recovery | idle | recovery | none | New acting: lids 0.30, tilt -8, the muted fizzle every 4-7 s |
| Presenting | from `follows` | none | none | No acting of its own yet (no card position reaches the browser) |
| Awaiting_Approval | from `follows` | awaiting | none | New acting: lids 0, pupil 0.5, a 2 degree nod at 0.8 Hz (an `approve` spring, w 6) |
| Celebrate | from `follows` | none | celebrate | The prototype's 1.6 s celebrate; leaving early cuts it over 0.25 s |
| Ghost overlay | any | any | any | `look.ghost` turns on the prototype's muted dissolve; the recovery and approve lid numbers yield to it |

For the three event looks, the pose comes from `follows`: input gives listening, output gives speaking, and none gives thinking. The gates also come from `follows`. The mic gate is open only when it is input, and the voice gate only when it is output, so a reply that admission held never moves the body. Events reach the engine only through their LookName: `wake` is Waking, `present-card` is Presenting, `await-approval` is Awaiting_Approval, and `celebrate` is Celebrate.

**When the SVG ghost shows instead of the 3D ghost** (`fallbackFor`):

- on the server and on the first paint;
- with no WebGL 2 or no float colour buffer;
- while three.js loads or builds;
- after any failure: import, create, build, shader, or 30 bad frames in a row;
- after a lost context that hasn't come back;
- under reduced motion;
- while the look is a one-shot whose start the engine didn't see.

The 3D ghost shows only when WebGL 2 is there, the engine is ready, reduced motion is off and no one-shot was missed.

## Build time

**Measured, in node only.** The CPU geometry steps were timed with `process.hrtime` in a temporary vitest file, which was deleted afterwards. Each step ran 6 times on this machine (AMD Ryzen 5 PRO 215). Raw numbers are in `_sm/logs/avatar/cpu-build-timing.json`.

| Step | First run | Median of runs 2-6 | Worst of runs 2-6 |
|---|---:|---:|---:|
| surface | 3.1 ms | 0.5 ms | 1.2 ms |
| character (body geometry and eyes) | 39.1 ms | 18.0 ms | 21.8 ms |
| brass | 28.9 ms | 12.9 ms | 19.5 ms |
| hair, hair prepass, fur and the brass prepass | 54.7 ms | 41.3 ms | 46.5 ms |
| mouth | 8.9 ms | 7.8 ms | 11.7 ms |

`buildRig` yields to the browser between steps, so each step is at most one task. The longest is the hair step, at about 41-55 ms. Cold, it is just over the design's 50 ms target for `longestCpuStepMs`. These numbers leave out three kinds of work: anything that needs a GPU (the renderer, the PMREM environment bake, the material and texture uploads, the program warm-up and the two settle frames), the 2D-canvas brush texture, and all browser JIT effects.

**Not measured:** the real build in a browser. `engine.timings()` reports each step, `warmMs`, `settleMs`, `totalMs`, `longestCpuStepMs` and the program counts. The specimens page shows them on every tile.

The voice path is WebRTC with audio off the main thread. The build runs in yielded steps after the page has painted. Whether clicking Call during a build stays responsive is not checked.

## Bundle sizes

From `npm run build`, with Next 16.4.3 and Turbopack. The postbuild check printed:

```
three-chunk-check: three is in 1 async chunk(s) and not in the first load of /.
  static/chunks/2m_bmqeeimxel.js  702.3 kB raw  186.3 kB gzip
  three chunks total: 702.3 kB raw, 186.3 kB gzip
  first load of /: 7 file(s), 883.4 kB raw, 269.2 kB gzip (from server/app/page_client-reference-manifest.js and server/app/index.html, plus build-manifest.json rootMainFiles)
```

- **Proof that three is not in the first load:** the check reads every first-load file of `/`, from the client reference manifest, the prerendered `index.html` and `build-manifest.json`. It fails the build if any of them contains three's `begin_vertex` text. It passed.
- **The async chunk** also holds the engine's own code: its `fk-ground-1` cache key is in it.
- **Earlier comparison:** WP13 read an older build from before three was added, where the first load of `/` was 868.5 kB raw over 6 files. So the React side of the renderer adds roughly 15 kB raw to the first load. That older build is from a different checkout, so the difference is approximate.
- **Not checked:** the hashed chunk name changes from build to build.

## What was checked

- **`npm test`:** 184 files, 2278 tests, all pass. Every test that existed before this brief is unchanged. The porters' new tests pin:
  - the PRNG streams;
  - every shader source and `onBeforeCompile` output, by SHA-256 against goldens taken from the prototype in node;
  - the geometry checksums;
  - the probe formulas;
  - the render scale;
  - the holder rule;
  - the canvas frame alignment;
  - the pure machines (tables and properties);
  - the controller with fakes;
  - the server render with a `three` import that throws;
  - the static-import walk from `Avatar.tsx`;
  - the second analyser;
  - both guards.
- **`npm run lint`:** exit 0. The one warning, `no-unused-expressions`, is on the prototype's own `i ? hex.lineTo : hex.moveTo` line in `brass.ts`, which was kept as written.
- **`npm run typecheck`:** exit 0.
- **`npm run build`:** exit 0, with `specimens-absent` and `three-chunk-check` passing.
- **The guard scripts:** `token-check`, `ui-boundaries`, `copy-check`, `clock-check` and `import-boundaries` all exit 0. No guard was weakened. The only new exceptions are the `0x` directory entry and `holders.test.ts`'s one entry (`fx-sparks.ts`'s own `size = 1` parameter default), each with its reason.
- **`verbatim-diff`** on every ported module, as above.

## What was not checked

- **Nothing ran in a browser.** The following are all unverified:
  - shader compile and link on a real GL context;
  - the look and the acting;
  - pixel parity with the prototype's `?still=1` frames;
  - the swap's timing (about 640 ms in, 320 ms out) and that it has no jump or flash;
  - the CANVAS_FRAME alignment on screen;
  - the radial mask stop;
  - the signed-out mask stops (9% and 17%, computed from CANVAS_FRAME at the 240 px stage);
  - Strict Mode and Fast Refresh leaving one canvas;
  - dispose freeing everything, and no "Too many active WebGL contexts" warning;
  - a hidden tab scheduling no frames;
  - the DPR and resize handling;
  - a lost and restored context;
  - the real build timings;
  - fps and the quality tier.
- **The three.js readings from the design.** The warm-up hitting the same program keys, `renderer.dispose()` leaving the output targets, and the float colour buffer extension r187 needs were not confirmed.
- **The second analyser without the prototype's gain-0 sink.** It was not checked that it gets fresh data, in Chrome or in any other browser. The existing meter works without a sink in Chrome.
- **Safari and Firefox:** not tried at all.
- **The goldens** come from node on this machine. Exact float equality across other machines and CI is assumed, not tested.

## Open items for the director and the owner

- **Decisions this build assumed "yes" on, for the director to confirm:**
  - **D-1, the audio source by context.** It is built: the Level_Meter's second analyser feeds the engine's probes while the look's gate is open.
  - **D-2, the dev-only speech simulator copy on specimens.** It is built under `app/specimens/_sim/`.
- **D-3, the mouth in the docs: not done.** `ui-direction.md` still says "No mouth" in the avatar's look, while the three.js ghost shows a mouth while speaking. The director rules, then the sentence changes.
- **New acting for the owner to review:**
  - Dormant: doze w 4, glow x 0.2, the head and glint stilled.
  - Recovery: lids 0.30 and -8, the fizzle, no wobble.
  - Awaiting_Approval: lids, pupil, the 2 degree nod at 0.8 Hz.
  - Connecting looks the same as Thinking.
  - Presenting has no glance yet.
- **Other owner calls:**
  - the stage size (the 3D ghost is about 250 px tall at the 240 px stage);
  - `REF_FRAME_H` 900;
  - the square frame's backdrop shift;
  - the stage gliding on sign-in instead of being replaced.
- **Known gaps left as they are:**
  - **An import failure is reported as `build`.** `EngineFailure` has no `load` member. Adding one would mean changing a new test's expectation, so it was left for its own change.
  - **No timeout backs up a missing fade end.** If `transitionend` or `animationend` never fires, the phase stays in `fading-in` or `fading-out`. In `fading-in` the screen still looks right: the canvas shows and the SVG sits at opacity 0.
  - **The plosive snap never fires at a live frame rate,** in the prototype as well as here. It is kept as the prototype has it.
  - **In still mode, `lastCelebLoop` is never reset.** The parity panel builds a fresh engine for each still frame, so this does not matter there.
  - **A celebrate re-triggered while Celebrate already shows is not replayed.**

## How the owner checks it

**In Chrome on localhost, in `next dev`:**

1. Open `/specimens` and scroll to the three.js section.
   - Each pair should show the SVG ghost and, after a short build, the 3D ghost.
   - Compare the acting for every look. Watch the Waking and Celebrate cycles.
   - Read each tile's tier, fps and timings: `longestCpuStepMs`, `warmMs`, `settleMs`, and the two program counts.
   - The reduced-motion pair should stay SVG.
2. In the parity panel, build idle, thinking, muted and celebrate. Compare each with the prototype at `?still=1&state=<name>` in a 1280 x 900 window.
3. On `/`, signed out:
   - The ghost should swap from SVG to 3D with no jump or dark flash.
   - The Wordmark and the sign-in button should not be darkened.
   - At a 360 px width there should be no horizontal scroll.
   - Sign in: the stage should glide, with no second swap.
4. Lifecycle:
   - Each avatar should have exactly one `<canvas>` (DevTools Elements).
   - Hide the tab and come back: the ghost resumes with no jump.
   - Resize the window and move it to another display: the ghost reframes.
   - In the console, get the `WEBGL_lose_context` extension on the canvas's context and call `loseContext()`: the SVG should show at once. Then call `restoreContext()`: the 3D ghost should fade back in.
5. Turn on reduced motion in the OS: the SVG ghost shows, and the network panel shows the three.js chunk is never fetched on a fresh load.

**On a live call:**

1. Start a call. The first connect plays the wake: the bolts strike, the eyes open and Franki rises. Then Connecting acts Thinking.
2. Speak. The listening nods should follow your voice, and the rim and halo should brighten with your level.
3. Let Franki answer. The mouth and body should move with Franki's voice: vowel shapes, the syllable nods, the brow lift and the squash.
4. Mute the mic. Ghost mode should dissolve the body; the eyes stay.
5. During a reply that admission holds, the body must not move with any audio.
6. End the call. Franki should drift back to Dormant: eyes close, glow dims, the head stills.
7. Note anything that looks different from the prototype. The look comes first, so a difference is a bug in the port, not something to tune.
