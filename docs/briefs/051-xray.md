# Brief 051: the X-ray machine (lane `xray`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here, with the changes under "How this lane runs". Then read `docs/briefs/047-radio.md`: this feature is built the way the radio was, and its files are the pattern to copy.

**Who builds this.** Claude builds it from this brief, in four parts. It is not Kiro's work, and its commits do not carry the Kiro trailer.

## What it is

An antique X-ray machine stands on the stage's floor beside Franki. Pressing it opens a large X-ray screen and asks for the camera. The camera's picture shows as dim film, and wherever the tracker finds a face or a hand it draws the bones on top: a skull that turns, tilts and opens its jaw with the person's own, and the bones of each hand. On a phone the owner can flip to the back camera and point it at a friend. Pressing the machine again, or closing the screen, turns the camera off.

The idea follows a public demo, X-Ray Mirror (`github.com/masterofvfx2070/xray-mirror`): a webcam picture, a face and hand tracker, and anatomy drawn over it with a glowing-edge look. That repository has no license, and its anatomy meshes are a third party's data set under a share-alike license. **Nothing is copied from it: no code, no numbers, no meshes.** Do not open it. Everything here is written new, and every bone is drawn in code.

Product rules that bind every part:

- **The camera opens only on the owner's own press.** Never from a spoken phrase, never from the model, never on page load.
- **The picture never leaves the browser.** No upload, no recording, no saved image, nothing written to storage, and nothing added to the voice call. The X-ray's own code names none of `MediaRecorder`, `RTCPeerConnection`, `toDataURL`, `toBlob`, `sendBeacon`, `localStorage`, `sessionStorage`, `indexedDB` or `fetch`; a test pins that.
- **No sound is asked for.** The camera request is video only.
- **Off means off.** When the screen closes, the tab is hidden, or the app goes away, every camera track is stopped in that same step. A camera that the browser hands over late, after the machine was turned off, is stopped at once.
- **It is not a medical scan.** The screen says so in one line, with where the picture stays (`COPY.xray.panel.note`). The owner dropped "A toy" from that line on Nov 15.
- **No model files and no drawings.** The machine, the skull and the hand bones are three.js, built from primitives and code-drawn textures. There is no SVG version. If WebGL fails, words stand in for the machine, and the screen shows the film alone.
- **Reduced motion** draws the machine still, and drops the screen's decoration (scan line, flicker, grain). The picture and the bones still follow the person: that is the content, not decoration.
- Every control works by keyboard and has a 44 px target.

## Rulings for this brief

These are the director's, made so the build can start. List each in the report for the owner to confirm.

1. **Client only.** No route, no tool, no change to `packages/core` or `packages/server`, no change to the voice reducer or its golden corpus. The model is not told the machine exists.
2. **Press only.** There is no phrase for it.
3. **The machine works signed out too.** It is on the lab screen in both auth states.
4. **On means open.** There is one state, not a power and a panel: closing the screen turns the machine off. Nothing runs behind a closed screen.
5. **Tracking is MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, Apache-2.0), added to `apps/web` as an exact version. Its JavaScript arrives through one `import()` made only after the browser hands over a camera, so a refused camera downloads nothing. Its WebAssembly files come from jsDelivr at the same version as the installed package, and its two models (Face Landmarker, Hand Landmarker) from Google's public model storage. All three addresses are constants in `apps/web/src/ui/xray/sources.ts`, so hosting them ourselves later is a one-file change. Read the installed package's own type files for its API; do not write it from memory.
6. **One face and two hands.** Nothing below the neck.
7. **The bones are the same for everyone:** one code-drawn skull, sized and pinned to the tracked face. It is not a scan and the screen does not say it is.
8. **Franki's marks.** The skull carries two neck bolts and a stitched seam across the brow, drawn as metal (brighter and solid, as metal shows on film). One named constant turns them off.
9. **The selfie camera is drawn mirrored; the back camera is not.** Tracker points are always measured on the unmirrored picture. The screen mirrors the picture and the bones together with one transform, and no words sit inside the mirrored layer.
10. **The selfie camera first.** `flip()` changes to the other camera and shows only when the device reports two or more.
11. **A hidden tab pauses.** The camera is stopped and the signal is `paused`. Coming back does not restart it; "Start again" does.
12. **A tracker that cannot load leaves the film.** If the tracker's files do not arrive within 20 seconds, or loading throws, the signal is `filmOnly`: the picture still shows, with no bones, and "Try again" is offered. A hand tracker that fails alone leaves the skull working.
13. **"Seeing" has a memory of 600 ms,** so the signal does not flicker when a face is lost for a frame.
14. **The tracker is closed when the machine turns off.** The next press loads it again (from the browser's cache).
15. **The X-ray screen is modal.** It covers the app, traps focus, and Escape closes it. A call that is open stays open, and Franki can still hear and speak.
16. **Credit.** The README's Credits name MediaPipe, and say the idea follows X-Ray Mirror with none of its code or models used.

## The contract (all parts code against this)

`apps/web/src/ui/xray/types.ts` is written and is not edited by parts A to C without saying so in the report: `XrayView`, `XrayPropView`, `XrayControls`, `XrayFrame`, `XrayFace`, `XrayHand`, `XrayPoint`, `XrayFeed`, `XRAY_OFF_VIEW`, `XRAY_CAMERA_FOV`, `xrayPropView`.

`COPY.xray` in `apps/web/src/ui/copy.ts` is written. A part that needs another string lists it in its report; part D adds it.

## How this lane runs

- The lane is `C:\Users\albeavi\Documents\Coding\frankirocks-lanes\xray` on `lane/xray`, started at `c95656e`, the tip of `build/plan-stages`. No merge and no opening run of the whole suite are needed.
- Parts A, B and C run at the same time in this one folder. **Touch only your own part's files.** Another part's files will be half-written while you work: when you run `npx tsc --noEmit -p apps/web`, read only the errors in your own files, and run only your own tests (`npx vitest run <paths>`) and `npx eslint <your paths>`.
- **No part commits.** The lead commits. No part runs `npm run build` or starts a dev server: the lead has one on port 3200, and a build would fight it for `.next`.
- Only part C looks at the screen, in the browser pane, at `http://localhost:3200/specimens/xray/view`. If its screenshots come back blank (the pane draws no frames while it is hidden), stop looking and say so in the report; the lead looks afterwards.
- Properties come first and run red first, as in brief 016. Record each seed and shrunk counterexample.
- Each part's final message to the lead: under 300 words. Built, not built, rulings you made, strings you need added, files you touched outside your list, and your check results.
- Contract questions take the prefix `X`.

## Part A: the machine, the camera, the tracker, the store

Files: `apps/web/package.json` and the lockfile (the one new dependency), `apps/web/src/ui/xray/{xray-machine,sources}.ts` with tests and `testing/xray-arbitraries.ts`, `apps/web/src/client/{xray-camera,xray-tracker,xray-watch,xray-live}.ts` with tests, and `docs/machines/xray.md` (with its line in that folder's README if the others have one).

- **`xray-machine.ts`.** `xrayStep(state, event)` and `xrayView(state)`. Pure. The state carries power, signal, facing, the camera count, whether a camera is open, and a session counter. Every press that asks for a camera, every flip and every retry raises the counter, and a camera or tracker report carrying an older counter changes nothing. Events cover everything in `XrayControls`, the camera's reports (opened with its camera count, refused, missing, ended), the tracker's reports (ready, failed, found, lost), and the tab (hidden, shown). The step also says what the store must do next, as data (open a camera facing a way, stop the camera, load the tracker, close the tracker), so the store holds no rules of its own. Properties, written red first:
  - off always means `dark`, with no camera open;
  - a stale report never changes the state;
  - `press` twice from off ends off;
  - `searching`, `seeing` and `warming` only ever hold while a camera is open;
  - after `hidden`, no camera is open, whatever came before;
  - `flip` never asks for a second camera before the first is told to stop.
- **`sources.ts`.** `XRAY_WASM_BASE`, `XRAY_FACE_MODEL`, `XRAY_HAND_MODEL`, `XRAY_TRACKER_VERSION`. A test pins that the version in the address equals the installed package's version. Check by hand that all three addresses answer, and say so in the report.
- **`xray-camera.ts`.** The browser adapter behind a small port: `open(facing)` resolves to a stream and the count of cameras, or rejects with one of `blocked`, `noCamera`; `stop(stream)` stops every track; it reports a track that ends on its own. The request is `audio: false` with the facing mode as an ideal and 1280 by 720 as an ideal. `NotAllowedError` and `SecurityError` are `blocked`; everything else, and a page with no `mediaDevices`, is `noCamera`.
- **`xray-tracker.ts`.** The MediaPipe adapter behind a small port: `load()` (the lazy import, the GPU delegate first and CPU second), `detect(video, at)` returning an `XrayFrame`, `close()`. The turn from MediaPipe's results into an `XrayFrame` is a pure function with table tests: the matrix comes out column by column whatever layout it arrived in; `jaw` is the `jawOpen` blendshape; a hand's `side` is its owner's own, with MediaPipe's mirrored naming undone; a missing face is `null`.
- **`xray-watch.ts`.** The store, in the shape of `client/radio-watch.ts`: `subscribe`, `getSnapshot` (an `XrayView`, stable between changes), `controls`, `feed` (an `XrayFeed`), `dispose()`. It takes the camera port, the tracker port, a timer port and a tab-visibility port as arguments. It runs the tracker once for each new picture of the attached element (never two at once, never while hidden), turns found and lost into events with ruling 13's memory, and counts three thrown detections in a row as a failed tracker. Properties with a fake camera whose answers arrive in any order and at any time: never more than one stream is live; none is live when the view says off or paused; a stream that arrives for an old session is stopped before anything else happens; `dispose()` stops everything.
- **`xray-live.ts`.** `createLiveXray()` (the browser camera, the MediaPipe tracker, the window's timers, the document's visibility), `createXrayHost` (the one watch for the app's life, in the shape of `createRadioHost`), and `createPictureCamera(url)`: a camera port for the specimens that plays one still picture as a stream (an image drawn to a canvas, `captureStream()`), so the real tracker can be tried on a photograph with no camera.

## Part B: the machine on the stage

Files: `apps/web/src/components/xray/three/{model,motion,engine}.ts`, `ThreeXray.tsx`, `XrayOnStage.tsx`, with tests, and `apps/web/src/app/specimens/_sections/XrayPropSection.tsx`. Copy the radio's structure file for file (`apps/web/src/components/radio/three/`, `ThreeRadio.tsx`, `RadioOnStage.tsx`).

- **The look.** An antique fluoroscope from Franki's lab, in the phone's and the radio's oak and brass: a standing oak cabinet with a dark glass viewing screen in a brass bezel, a brass tube head on a jointed arm aimed at the glass, a small coil or valve on top, one dial, rivets and stitched seams. The glass shows a code-drawn picture of hand bones when it is lit. It should read at a glance as an X-ray machine at 110 px wide. Colours come from `COL`.
- **States, from `XrayPropView`.** Off: dark glass. Hover or keyboard focus: the glass warms. `asking` and `warming`: the glass flickers and a small arc crackles at the tube. `searching`, `seeing` and `filmOnly`: the glass glows ghost green with the bone picture and a scan line passes over it. `blocked` and `noCamera`: the glass shows the ember colour. `paused`: the glass blinks slowly.
- **`XrayOnStage({ view, onPress })`.** Always present. It stands on the floor at Franki's lower right, the radio's mirror image, inside the stage's `aside`, and takes no room. A real `<button>` with `data-xray-button` covers the canvas: its label comes from `COPY.xray.prop` by what a press would do, with `aria-haspopup="dialog"` and `aria-expanded`, a visible focus ring, and a 44 px minimum target. The canvas is `aria-hidden`. If WebGL fails the button shows `COPY.xray.prop.fallback` as words in the chip style.
- **Reduced motion** draws the settled pose of each state, with no loop.
- **`XrayPropSection`.** The machine in every state, the still machines under reduced motion, and the no-WebGL fallback, for part D to place.

## Part C: the X-ray screen

Files: `apps/web/src/components/xray/anatomy/*.ts` with tests, `ThreeBones.tsx`, `XrayPanel.tsx` with its test, `apps/web/src/ui/xray/testing/scripted-frames.ts`, `apps/web/src/app/specimens/_sections/XrayViewSection.tsx` and `apps/web/src/app/specimens/xray/view/page.dev.tsx`.

- **The picture.** The camera plays in a `<video>` (`playsInline`, `muted`), filling the screen like `object-fit: cover`. It is drawn as film: no colour, dimmed, tinted toward the ghost's cool green, so the bones are the brightest thing on the screen. Over a tracked face and each tracked hand a soft dark veil dims the flesh further, and a faint outline of the flesh stays, as soft tissue does on film.
- **The skull.** Built in code from primitives and custom geometry: cranium, brow, eye sockets and nose opening as real holes, cheekbones, upper jaw, both rows of teeth, a lower jaw that swings on its hinge with `XrayFace.jaw`, and three or four neck bones that fade out downward. Franki's marks by ruling 8. It is sized to MediaPipe's canonical head. Take the dozen key points you need (chin, forehead, nose tip, eye corners, the sides of the face, mouth corners) from MediaPipe's own `canonical_face_model.obj` in the `google-ai-edge/mediapipe` repository (Apache-2.0), write them into a constants file that names the source, and fit the skull to them.
- **Pinning it.** Place the skull with `XrayFace.matrix` in front of a camera `XRAY_CAMERA_FOV` degrees tall at the frame's aspect. Then correct what is left over on the screen: project the skull's own key points, compare them with the same landmarks in `XrayFace.points`, and apply the least-squares scale and shift, clamped. That correction is a pure function with tests.
- **The hands.** One bone for each pair of joined joints, shaped like a bone (a thin shaft with knuckle ends), a cluster of small wrist bones, and the two forearm bones leaving the picture's edge of the wrist and fading out. A bone's ends sit exactly on its two joints. That placement is a pure function, with properties: the ends land on the joints; two joints in the same place never make a `NaN`.
- **The glow.** One shared shader material for bone: edges that turn away glow and flat faces stay nearly clear, added over the picture, in a pale ghost green-white. Metal is solid and brighter.
- **Movement.** Smooth the pose and the points between tracker frames by time, not by frame count; cap a long frame; when a face or hand is lost, fade it out over about 300 ms instead of dropping it. A pure module with properties (the ease ends exactly on its target; a long frame is capped; still changes nothing).
- **From picture to screen.** The mapping from a point on the picture to a point on the screen, under the cover fit and the mirror, is one pure function with properties, used by both the bones and the veil.
- **`XrayPanel({ view, feed, controls, reduced, onClosed })`.** `role="dialog"`, `aria-modal`, labelled by `COPY.xray.panel.title`; copy the bank sheet's handling of focus, the scrim and Escape. Below 640 px it fills the screen. From 640 px it is a large glass screen in an oak and brass frame, centred, as big as fits. On the picture: the `Wordmark` at small size with the signal's words as a polite live region; a close button; a flip button when `view.canFlip`; the note line; `COPY.xray.panel.hint` while `searching`. For `blocked`, `noCamera`, `paused` and `filmOnly`: the help line, and "Try again" or "Start again". It calls `feed.attach` with its video element and hands `feed` to the bones. If WebGL fails it shows the film alone with the `filmOnly` help line.
- **Loading.** three.js arrives only through one `import()` in `ThreeBones.tsx`. `XrayPanel` itself must be cheap to load with the page.
- **`scripted-frames.ts`.** A pure function from a time to an `XrayFrame`: a head that turns, nods and talks, and two hands that wave and close. `createScriptedFeed` wraps it as an `XrayFeed` with no camera. The specimens and the tests use it.
- **`XrayViewSection` and its page.** The screen with the scripted feed in `seeing`; one tile for each other signal; the reduced-motion screen; the no-WebGL screen. Keep the page to six WebGL contexts or fewer.

## Part D: wiring, specimens, docs (after A, B and C)

- `App.tsx`: one `XrayWatch` for the app's life, in both auth states, made and disposed the way the radio's is. `StageFor` gets `XrayOnStage` beside `RadioOnStage`. The screen rides in the `sheet` slot with the radio's panel, above it, so `MainScreen.tsx` is not edited. When it closes, focus goes back to the machine's button.
- `apps/web/src/app/specimens/_sections/XraySection.tsx` and `apps/web/src/app/specimens/xray/page.dev.tsx`: a walk of the whole thing beside the ghost with the scripted feed; a live tile with the real store, offering the real camera and a "still picture" box that takes a picture's address (served with CORS) and runs the real tracker on it through `createPictureCamera`; part B's and part C's sections, or links to them. Listed on the main specimens page after the radio.
- The test that pins the "never leaves the browser" rule over every X-ray source file.
- README: one bullet under "It's alive", the X-ray added to what Claude built, and the Credits line by ruling 16.
- `docs/machines/`: checked against part A's rows.
- This brief's Outcome and "What it doesn't do", brought up to date.
- Then the whole checks, each in the foreground: `npm run lint`, `npm run typecheck`, and `npx vitest run` in three shards (`--shard=1/3` and so on; never in the background). The lead runs `npm run build`.

## What it doesn't do

Check these before promising the X-ray anywhere.

- **Never tried with a real camera by its builders.** The build machine's browser pane has none. Until the owner tries it in Chrome and on a phone, the camera path is checked by tests with a fake camera only.
- **The real tracker has run on still pictures only.** The lead ran it in the browser pane through the still-picture tile on `/specimens/xray` (see Outcome). It has never followed a moving picture, so the new-picture loop has met a still stream only, and nothing is known about how the bones keep up with a person.
- **Which hand is which is a guess** (X-1). The bones of a hand don't depend on it, but anything that reads `side` may have left and right swapped.
- **The face matrix's layout is inferred** (X-2), from where its move sits. On one still portrait the skull sat on the head at the head's own turn. It has not been checked on a face that moves.
- **Never tried in a live call, or signed in.** Whether opening a camera disturbs the call's microphone, on iOS above all, is not known. The lead tried the screen on the signed-out lab only.
- **MediaPipe writes its start-up notes to the console as errors.** In development the Next overlay counts them as one issue. Nothing is wrong when it does.
- **The model is not told the machine exists.** Franki may say he has no X-ray machine while it runs.
- **It is not a scan.** Everyone gets the same code-drawn skull and the same hand bones, sized to what the tracker sees.
- **One face and two hands.** A second face is ignored, and nothing is drawn below the neck.
- **The tracker's files are third parties'.** The first use downloads them from jsDelivr and Google (about 12 MB with the WebAssembly). If either is unreachable the screen shows film only.
- **Some devices may get film only.** The bones' WebGL check is the avatar's, which also asks for float buffers.
- **No saved picture.** There is no snapshot button.
- **Nothing is remembered across a reload,** not even which camera was in use.
- **Frame rate is unmeasured,** on a phone above all, and with the ghost, the radio, the machine and the bones drawn together.

## Outcome

Built by Claude in four parts, with no Kiro run. Nothing here is committed by the builders; the lead commits.

**Part A: the machine, the camera, the tracker, the store.** `@mediapipe/tasks-vision` 1.2.3, exact; the lockfile gained only that package. `ui/xray/xray-machine.ts`, `sources.ts`, `testing/xray-arbitraries.ts`; `client/xray-camera.ts`, `xray-tracker.ts`, `xray-watch.ts`, `xray-live.ts` (with `createXrayHost` and `createPictureCamera`), `client/testing/xray-fakes.ts`; `docs/machines/xray.md` and its row in that folder's README. All four tracker addresses answered 200 with CORS `*` (the WebAssembly loader and `.wasm` on jsDelivr, the face model at 3.76 MB, the hand model at 7.82 MB). Properties, each run red first:

| Property | Seed | Counterexample |
|---|---|---|
| Off is always `dark`, with no camera open | -1615185084 | `[opened]` |
| A stale report changes nothing | -469703017 | `[]` and a stale report |
| `press` twice from off ends off | 372711390 | `[]` |
| After `hidden`, no camera is open | -1288314229 | `[opened]` |
| `flip` tells the first camera to stop before it asks for a second | -1057777573 | `[opened, press]` |
| `warming`, `searching`, `seeing` only while a camera is open | 245727618 | `[opened, hidden]` (passed on the first stub, red on a second) |
| Store: `dispose()` stops everything | -1363541152 | `[press]` |
| Store: a stream for an old session is stopped first | 2058925950 | `[press, press, answer ok]` |
| Store: no stream is live while off or paused | -637693824 | `[press, press, answer ok]` |
| Store: never more than one live stream | 721614160 | `[press, answer ok(2), flip, answer ok]` (needed runs of 40 actions) |

The store was drafted before its properties, so they were run red on copies with the stop paths cut.

Part A's rulings, for the owner to confirm: (1) `retry` from `filmOnly` restarts the camera and the tracker together; (2) `flip` acts only while a camera is open, and `canFlip` needs an open camera and two or more cameras; (3) a hidden tab while `blocked` or `noCamera` changes nothing; (4) every camera stop raises the session; (5) a face that can't be placed (no 4 by 4 matrix, or a number that isn't finite) counts as no face; (6) the tracker is ready once the face model loads, with hands optional; (7) `XRAY_HANDEDNESS_MIRRORED = true`, though the package's own type file says the names are the subject's own (X-1); (8) MediaPipe's JavaScript gives no matrix layout, so `matrixColumns` reads it from where the move sits (X-2).

**Part B: the machine on the stage.** `components/xray/three/{model,motion,engine}.ts` with tests, `ThreeXray.tsx`, `XrayOnStage.tsx` with its test, and `_sections/XrayPropSection.tsx`. Drawn from primitives and code-drawn textures: an oak cabinet on a walnut plinth with a walnut crown and stitches; a 0.40 by 0.44 glass in a brass bezel with 8 rivets, carrying a per-pixel hand X-ray texture computed in code (forearm, wrist, hand and finger bones, faint flesh, a ring as solid metal), a scan band, a clear cover and a glow sprite; a dial, three vents and a knob; a glass valve with an amber filament; a turret with a jointed arm; and a brass tube head with an arc between two electrodes and a faint beam cone. States: off, dark with the arm folded; hover, a dim amber; a press swings the arm down on a critically damped spring; `asking`, flickering amber with the arc; `warming`, greener, with faint bones and the arc; `searching`, green with the bones at half and a fast scan; `seeing`, full bones, a slow scan, the beam, breathing; `filmOnly`, film grey with faint bones and no beam; `blocked`, a steady ember; `noCamera`, a dim stuttering ember with the arm drooping; `paused`, a slow green blink. Properties of the machine's motion, red first: range, seed 1517934447 (dt = 1e9, off and dark); the long-frame cap, seed -840968088 (dt = 0.25000000000000006); settling, seed -1879692826 (aim 0.001, off and dark). The property that the settled pose stays in range was never red.

Part B's rulings, for the owner to confirm: `XRAY_PLACE` mirrors `RADIO_PLACE`; the no-WebGL chip sits at the machine's bottom left, nearest Franki; `XRAY_YAW = -0.42`; `XrayProp` takes an optional `place` for the specimens; a lit glass held still keeps its scan line where it is.

**Part C: the X-ray screen.** Pure modules in `components/xray/anatomy/`: `screen-map`, `fit`, `bone-place`, `smooth`, `hand-rig`, `veil`, and `canonical.ts` (MediaPipe's canonical face vertices, with the source named); the three.js parts `skull-shape` and `skull`, `hand`, `material` (one shared bone shader and a metal shader), `shapes` and `engine`; `ThreeBones.tsx` (the only `import()`); `XrayPanel.tsx` with its test; `ui/xray/testing/scripted-frames.ts` with its test; `XrayViewSection.tsx` and `/specimens/xray/view`. Seen by its builder in the browser pane at 648 px wide, on the scripted feed: the skull reads as a skull and the jaw moves, the bolts and the stitched brow show, the hands show fingers, wrist bones and fading forearms, the modal opens and Escape closes it, and the console showed no errors. Properties, red first:

| Property | Seed | Counterexample |
|---|---|---|
| Picture to screen mapping | -719420403, -1859724237, then -1637476157, 2035949195 | `[0.2,1,1,false]`; `[NaN,0,0,false,0,0]`; `[0,-1,5e-324,…]`; `[Infinity,5e-324,Infinity,…]` |
| Smoothing (the ease lands, a long frame is capped, still changes nothing) | 1414282044, 2064359830, 335254243, 2080672948, 104854116 | `[0,0,0.005,0.10000000000000002]` (335254243) |
| A bone's ends land on its joints, with no `NaN` | 545764057 | two joints in one place |
| The fit correction | 91724201 | `[[],0.3]` |

The hand-rig property was not run red first.

Part C's rulings, for the owner to confirm: the screen correction lines up the upper face only (nose tip, nasion, forehead, the four eye corners, the face's sides), since the chin and mouth move with the jaw; the correction is clamped to a scale of ±25% and a slip of 0.15 picture heights; each palm bone starts 30% of the way from the wrist to its knuckle (`PALM_BASE`), with no bone from knuckle to knuckle; one material per part, so each fades alone; the bolts sit at neck height (y −7.5 cm); the WebGL check reuses the avatar's `probeWebGL2`, which also asks for float buffers (it fails safe, and may leave a few devices with film only); `XrayPanel` gained `presentation: "inline"` and `bones: "none"` for the specimens.

**Part D: wiring, specimens, docs.**
- `App.tsx`: one X-ray for the app's life in both auth states, held as the radio is (`createXrayHost(() => createLiveXray())` kept in state, started in an effect and disposed for good on cleanup, so StrictMode's second run makes its own watch). `StageFor` puts `XrayOnStage` beside `RadioOnStage` in the stage's `aside`. The screen rides in the `sheet` slot of both `MainScreen` renders, after the radio's panel so it paints over it, shown exactly while the machine is on, and its `onClosed` puts focus on `[data-xray-button]`. Nothing in `App.tsx` presses the machine but the stage's own button. `MainScreen.tsx` is unchanged. Tests beside the radio's in `App.test.tsx`: a server render with the machine off and the screen closed, and source pins for the host, the press, the slot order and the focus return.
- The pin for "the picture never leaves the browser" (`ui/xray/stays-in-browser.test.ts`): every source file under `ui/xray/` and `components/xray/`, the client's `xray-*` files and their fakes (test files aside) names none of `MediaRecorder`, `RTCPeerConnection`, `toDataURL`, `toBlob`, `sendBeacon`, `localStorage`, `sessionStorage`, `indexedDB` or `fetch`, matched as plain text, comments included. It also pins that the camera request says `audio: false`. No file tripped it.
- Specimens: `/specimens/xray` holds the walk (the machine beside the ghost, pressed, the screen opening on the scripted feed through `asking`, `warming`, `searching` and `seeing`, then closed; a press or the screen's close moves it by hand), the live tile (the real store through the real machine button with the browser's camera, or a still picture's web address run through `createPictureCamera` and the real tracker, with the store's signal, the camera, and what the tracker found under the screen as words), and part B's short section. Eight WebGL contexts at most. `/specimens/xray/machine` holds part B's full section, and `/specimens/xray/view` part C's. The main Specimens_Page lists the X-ray after the radio, as links only, with no context.
- `XrayPropSection` (part B's file) now shows its state row five at a time, with a switch for the other five, so `/specimens/xray/machine` holds seven contexts instead of twelve.
- README: the "It's alive" bullet, the X-ray under what Claude Code built, and the Credits line by ruling 16.
- `docs/machines/xray.md`, checked against `xray-machine.ts` as built: every row, transition and reset matches; it was left as part A wrote it.

Part D's rulings, for the owner to confirm: the X-ray screen comes after the radio's panel in the `sheet` slot, so the modal paints over the globe; in the specimens only, the still-picture tile's "Run the tracker on it" press turns the machine on at once (the camera tile waits for a press on the machine); the address box takes `http` and `https` only, made whole against the page.

**Checked in the browser pane by the lead, Nov 15** (the pane has no camera):
- On the signed-out lab at 1280 px and 390 px: the machine stands at Franki's lower right, the radio's mirror image, inside the viewport at both widths. A press opened the screen and asked for the camera; the pane refused it, and the screen showed "Camera blocked" with "Try again". Escape closed the screen, turned the machine off and put focus back on the machine's button.
- On `/specimens/xray`, the still-picture tile with the real tracker: MediaPipe's files arrived and both trackers started. On a painted portrait in three-quarter view the signal went to "X-ray on" (478 points), and the skull sat on the head at the head's own turn, with the neck bones and bolts down the neck. On a photograph of two hands, bones were drawn along every finger of both. On a fresco with no face the tracker could find, the screen stayed on "Looking for bones" with the hint.
- On `/specimens/xray/view` at 1280 px: the modal screen on the scripted feed, its frame, the skull, the jaw moving, both hands.

**Changed after looking:** the bolts first drew as one rod through the jaw at mouth height; they are now two short bolts beside the neck bones, below the jawline (y -12.2, z -4.4), and the neck bones run on below the jaw. The film-only line no longer shows before a picture is on the glass (it showed during `asking` when the bones could not draw).

**Checked by tests only:** the machine and its store against a fake camera and tracker; the signed-in wiring in `App.tsx`; the specimens' markup.

**Not checked at all:** a real camera, a moving picture, a phone, the back camera, a live call with the screen open, and frame rate.

**The build, Nov 15:** `npm run build` passes. three.js stays in one async chunk, and MediaPipe's library is in an async chunk of its own (155 kB), neither in the lab's first load.

**Checks on the lane, Nov 15:** `npm run lint` exit 0 (one warning, in `components/avatar/three/brass.ts`, from before this lane); `npm run typecheck` exit 0; `npx vitest run` in three shards, each exit 0: 238 files with 2,050 passed and 17 expected fails, 238 files with 1,853 passed and 2 expected fails, 237 files with 1,784 passed and 2 expected fails, so 713 files and 5,687 tests passing with 21 expected fails. The third shard first failed once: `scripts/ui-boundaries.test.ts` refused the three new `.dev.tsx` pages under `specimens/xray/` (part C's `view` page among them) until they were added to `DEV_FILES` in `scripts/ui-boundaries.mjs`.

### Contract questions

- **X-1. Which hand is which.** MediaPipe's type file says a hand's `categoryName` is the subject's own side, while the picture a selfie camera takes is the mirror of what the person sees. Part A took the mirrored reading (`XRAY_HANDEDNESS_MIRRORED = true`), one constant to flip. Needs one real hand in front of a real camera: raise the right hand and read the hands line on the live tile.
- **X-2. The face matrix's layout.** MediaPipe's JavaScript returns each facial transformation matrix as 16 numbers with no stated order. Part A's `matrixColumns` decides it from where the move sits (elements 12 to 14 for column order, 3, 7 and 11 for row order). Needs one real face: on the live tile the skull should sit on the face and turn with it.
