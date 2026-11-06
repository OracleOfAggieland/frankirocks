# Requirements Document

## Introduction

This spec covers Brief 003, the interface foundation (`docs/briefs/003-lab-ui-foundation.md`). It builds Franki's design system, motion system, SVG avatar, one-screen layout and every surface as a component. The source for look, motion, sound and copy is `docs/design/ui-direction.md`, cited below as "UI direction". Behavior and contracts still come from `docs/design/memory-spec-v3.md` and `docs/design/memory-contracts-v2.md` (cited as "contracts §N"); where UI direction disagrees with them, they win and the conflict goes under "Contract questions" in this spec's `design.md`.

Work happens on branch `build/lab-ui`, in the spec directory `.kiro/specs/lab-ui-foundation/`.

### In scope

1. One token source for colour, type, radius, shadow and motion, and a steering file that summarizes UI direction.
2. A token check script, run by `npm test`.
3. An Avatar contract, a pure look-mapping function, and the SVG_Ghost renderer.
4. An audio levels module, with the smallest change to `apps/web/src/client/voice-client.ts` that exposes the streams.
5. The one-screen layout, desktop first, down to 375 px wide.
6. Every surface as a props-only component: card (five kinds), strip, jar and its "What I know" sheet, Lab, receipt, time badge, captions, chips and wordmark.
7. Wiring to the main screen of only what the Browser_Client has today: auth state, voice state, mic and output state, levels and typed turns.
8. A development-only `/specimens` route.
9. Synthesized sound cues with one remembered on/off toggle.
10. The Debug_Panel behind `?debug=1`, in development only.

### Out of scope

The Rive rig. Server data for the strip, jar, Lab, receipt and chips. Company mode ("Someone walked in"). New API routes. Any change to `packages/server`. Pushing to GitHub or deploying.

### Changes to `first-spoken-call` requirements

- This spec **supersedes** `first-spoken-call` Requirement 16 criteria 1 to 3 (the plain HTML and CSS Stand_In_Avatar with six states). Requirements 4 to 9 of this spec replace them, and the Stand_In_Avatar is retired.
- This spec **keeps** `first-spoken-call` Requirement 16 criteria 4 to 7 unchanged in meaning: one call button whose start and hang-up forms differ in shape and colour, with the accessible labels "Call Franki" and "Hang up"; the mute toggle only while listening, thinking or speaking; the hang-up and failure behavior of criteria 5 and 6; and the "Built with Kiro" footer with `data-testid="built-with-kiro"` on every page and no attribution in any `/api` response.
- `first-spoken-call` Requirement 18 criterion 6 (a typed reply shown as text while no call is open) is kept but narrowed by Requirement 14 criterion 8 of this spec to the latest reply only, because UI direction principle 1 forbids a message log on the main screen.
- No other `first-spoken-call` requirement changes. Call behavior, muting, Permits, admission and routes stay as they are.

### Open items for design

These are gaps found while writing requirements. The design records each under "Contract questions" with a proposal. `docs/design/` is not edited, and no wire field is invented here.

1. **Forgotten turns on the client.** UI direction principle 7 needs the Browser_Client to drop every copy it holds of forgotten turns. The contracts §1 ledger `forgetReceipt` payload holds `opId`, `blockedAt`, `cleanupCompleteAt`, `retainedRuleIds`, `scopePending` and `touched` counts by collection, but no turn IDs. `requestTurnIds` exists only on the forget job, which does not cross to the browser. So the client cannot yet tell which captions or typed lines to drop. Interim resolution (Requirement 17 criteria 5 to 7): any forget result is a full clear, and the Browser_Client drops every turn copy it holds. Design still raises this as a contract question; no wire field is invented.
2. **Signed-out chips.** UI direction "Signed out" says the chips show, disabled. The brief and UI direction "Surfaces" say chips show only when the server offers them, and no server data exists for chips in this slice. Requirement 13 renders no chips row on the signed-out screen; design confirms.
3. **Speaking while output is muted.** The avatar table gives the Speaking look only when voice state is speaking **and** `outputMuted` is false, and does not say what shows otherwise. Requirement 6 criterion 5 shows the Thinking look in that case; design confirms.
4. **Sound default.** UI direction says sound starts only after the first user gesture and has one remembered toggle, but gives no default. Requirement 19 makes sound on by default, starting after the first gesture; design confirms.
5. **Sign-in label.** UI direction names the signed-out button "Sign in to wake Franki". `first-spoken-call` Requirement 9 criterion 1 keeps Google as the only method. The label changes; the method does not.

## Glossary

- **Browser_Client**: The code that runs in the owner's browser (as defined in `first-spoken-call`): sign-in, call button, voice client, typed input, avatar and Debug_Panel.
- **Web_App**: The Next.js 16 application in `apps/web`.
- **Voice_Client**: The class `VoiceClient` in `apps/web/src/client/voice-client.ts` that owns the `RTCPeerConnection`, the `oai-events` data channel, the microphone track and the output audio element.
- **Voice_State**: The `VoiceState` value of the pure call-state reducer in `packages/core/src/voice/machine.ts`, including `phase`, `micMuted` and `outputMuted`.
- **Avatar_State**: The value returned by `avatarState()` in `@franki/core`: `closed`, `connecting`, `listening`, `thinking`, `speaking` or `recovery`.
- **Avatar_Event**: One of the one-shot events `wake`, `celebrate`, `present-card` and `await-approval` from the UI direction avatar table, or none.
- **Event_Controller**: The pure reducer over Avatar_State changes, Avatar_Events, sign-out, approval answers and removals, and Frame_Times that decides which Avatar_Event is active and when it began. It makes no Wall_Clock_Read and runs no timers of its own; time reaches it only as Frame_Time inputs.
- **Avatar_Input**: The complete input to the look mapping: Avatar_State, `micMuted`, `outputMuted`, Input_Level, Output_Level, the current Avatar_Event or none (as decided by the Event_Controller), the elapsed time since that event began (from Frame_Time), whether this is the first `connecting` of the Visit, and the Reduced_Motion setting.
- **Avatar_Look**: A closed record that describes what the avatar shows: at least eyes, glow, posture, bolt effect, body motion, body opacity, which level the body follows (`none`, `input` or `output`), whether Electricity is present, every animation with its iteration count (finite or infinite), whether blur is used, and the accessible label.
- **Look_Name**: The name of one row of the UI direction avatar table: Dormant, Waking, Connecting, Listening, Thinking, Speaking, Recovery, Ghost_Mode, Presenting, Awaiting_Approval or Celebrate.
- **Ghost_Mode**: The look overlay shown while the microphone is muted: body at about 35% opacity, eyes solid. It changes the look of the underlying state, never its meaning or label.
- **Look_Mapper**: The pure, deterministic function that maps one Avatar_Input to exactly one Avatar_Look, placed in `@franki/core` or `apps/web/src/ui/`.
- **Avatar_Contract**: The TypeScript interface every avatar renderer implements: it takes an Avatar_Look and the Avatar_Input it came from as props and renders them. The SVG_Ghost implements it now; a Rive renderer implements it later.
- **SVG_Ghost**: The avatar renderer drawn in SVG in code, as described in UI direction "Franki: the avatar". It is also the reduced-motion and fallback renderer.
- **Visit**: One page load of the Browser_Client, until the page is closed or reloaded.
- **Idle**: The Listening look with no Avatar_Event active.
- **Input_Level** / **Output_Level**: A number from 0 to 1 inclusive, smoothed over time, measuring the loudness of the microphone stream or of Franki's output stream.
- **Level_Meter**: The module that computes Input_Level and Output_Level with a Web Audio `AnalyserNode`.
- **Frame_Time**: The timestamp the browser passes to a `requestAnimationFrame` callback.
- **Wall_Clock_Read**: A call to the `now` method of `Date` or of `performance`, or a `Date` construction with no arguments.
- **Reduced_Motion**: The state in which `prefers-reduced-motion: reduce` matches, or a specimen forces it on.
- **Electricity**: Any jagged lightning path, arc, spark or bolt strike effect.
- **Token_Source**: The CSS custom properties under `@theme` in `apps/web/src/app/globals.css`, mirrored for JavaScript in `apps/web/src/ui/motion.ts`.
- **Token_Files**: `apps/web/src/app/globals.css` and `apps/web/src/ui/motion.ts`.
- **Token_Check**: The script under `scripts/` that scans for raw hex colours and ad hoc durations, run by `npm test`.
- **UI_Steering**: The steering file `.kiro/steering/ui-design.md`.
- **Main_Screen**: The page served at `/` by `apps/web/src/app/page.tsx`.
- **Specimens_Page**: The development-only page served at `/specimens`.
- **Fixture**: Example props used only to show a component on the Specimens_Page.
- **Surface**: One of the components in UI direction "Surfaces": stage, call button, mute, Chips, Typed_Line, Card, Strip, Jar, What_I_Know_Sheet, Lab, Receipt, Time_Badge, Captions, Wordmark, Footer and Debug_Panel.
- **Card**: A glass panel with a stitched seam at the top, of kind `source`, `approval`, `food`, `ask` or `read`.
- **Card_Dock**: The area that holds Cards: at the right on desktop, a bottom sheet on narrow screens.
- **Strip**: The five terminals joined by a wire: Noticed, Connected, Suggested, You said yes, and the result.
- **Jar**: The glass specimen jar with one mote per memory, up to a visual cap.
- **What_I_Know_Sheet**: The sheet the Jar opens, grouped by area.
- **Lab**: The instrument panel of counters with a fold for honest limits.
- **Receipt**: The slip shown after a forget, with kinds and counts.
- **Time_Badge**: The brass badge that reads "Simulated: <day> <time>" while the clock is simulated.
- **Captions**: One line of what Franki is saying now, off by default.
- **Chips**: Glass capsules whose tap counts as the user's words.
- **Typed_Line**: The keyboard glyph that opens the typed input.
- **Reply_Line**: The single line on the Main_Screen that shows Franki's latest text reply to a typed turn while no call is open.
- **Wordmark**: "Franki" in the header, or `FRANKIROCKS` on the signed-out screen.
- **Footer**: The component `Footer` in `apps/web/src/components/Footer.tsx`.
- **Debug_Panel**: The existing panel in `apps/web/src/components/DebugPanel.tsx` backed by `GET /api/debug/memory`.
- **Sound_Cues**: The Web Audio cues in UI direction "Sound": wake, thinking, card arrives, celebrate and receipt.
- **Sound_Toggle**: The one on/off control for Sound_Cues.
- **Banned_Cause_Words**: "because", "caused", "thanks to", "led to" and "won back", in any letter case.
- **Test_Suite**: The Vitest 5 and fast-check tests run by `npm test`.

## Requirements

### Requirement 1: UI steering file

**User Story:** As the owner, I want a short steering file for interface work, so that every Kiro session that edits the web app follows the same look, motion and copy rules.

#### Acceptance Criteria

1. THE UI_Steering SHALL be written by the first task in this spec's `tasks.md`, before any other build work of this spec.
2. IF the task that writes the UI_Steering is not the first task in this spec's `tasks.md`, THEN the spec SHALL be treated as failing this requirement, whatever the order in which build work actually runs.
3. THE UI_Steering SHALL have front matter that sets `inclusion: fileMatch` and `fileMatchPattern: "apps/web/src/**"`.
4. THE UI_Steering SHALL be at most 119 lines long, including front matter.
5. THE UI_Steering SHALL summarize the UI direction principles, the colour, type and motion tokens, the motion rules (including Reduced_Motion) and the copy rules (including Banned_Cause_Words), and SHALL name `docs/design/ui-direction.md` as its source.
6. IF a token value, principle or rule stated in the UI_Steering differs from UI direction, THEN the UI_Steering SHALL be treated as failing this requirement until it is corrected to match UI direction.

### Requirement 2: Token source

**User Story:** As a developer, I want one source for every visual value, so that a colour or timing change happens in one place.

#### Acceptance Criteria

1. THE Token_Source SHALL define, under `@theme` in `apps/web/src/app/globals.css`, every colour token in UI direction "Colour" (`night-0`, `night-1`, `night-2`, `ink`, `ink-dim`, `ghost`, `ghost-deep`, `ecto`, `brass`, `brass-hi`, `gold`, `spark`, `stitch`, `ember`) with the exact hex value given there.
2. THE Token_Source SHALL define the type tokens (Geist for interface text, Geist Mono with tabular figures for numbers, and the sizes 12, 14, 16, 20, 28 and 44 px) and the radius and shadow tokens the Surfaces use.
3. THE Token_Source SHALL define every motion token in UI direction "Motion" (`spring.float`, `spring.settle`, `spring.press`, `dur.quick`, `dur.base`, `dur.ritual`, `ease.ecto`, `stagger`) with the exact values given there.
4. THE file `apps/web/src/ui/motion.ts` SHALL export the motion tokens and the colour tokens for JavaScript use, with each value written by hand in `motion.ts`.
5. THE custom properties in `globals.css` SHALL be the authoritative token values: `motion.ts` SHALL mirror them and SHALL NOT be generated, and `globals.css` SHALL NOT be derived from `motion.ts`.
6. THE Test_Suite SHALL include a sync test that parses the custom properties in `globals.css` and fails when any value hardcoded in `motion.ts` differs from the matching custom property.
7. THE `globals.css` file SHALL contain none of the starter colours (`#ffffff`, `#171717`, `#0a0a0a`, `#ededed`) and no `Arial` or `Helvetica` font, and THE page body SHALL use the `night-0` background, the `ink` text colour and Geist.
8. THE components in `apps/web/src/components/` and `apps/web/src/ui/` SHALL take every colour from a colour token, and SHALL use no Tailwind default palette colour class (for example `zinc-*`, `emerald-*`, `red-*` or `amber-*`).

### Requirement 3: Token check

**User Story:** As a developer, I want a check that catches raw colours and timings, so that components keep using tokens.

#### Acceptance Criteria

1. THE Token_Check SHALL scan every `.ts`, `.tsx`, `.css` and `.mjs` file under `apps/web/src/components/` and `apps/web/src/ui/`, except the Token_Files.
2. WHEN a scanned file contains a raw hex colour literal (`#` followed by exactly 3, 4, 6 or 8 hex digits), THE Token_Check SHALL report a violation.
3. WHEN a scanned file contains an ad hoc duration for a transition or animation (a CSS `transition`, `transition-duration`, `animation`, `animation-duration` or `animation-delay` value with a literal `ms` or `s` time, a Tailwind `duration-*` or `delay-*` class, or a numeric literal `duration` or `delay` passed to a motion or animation call), THE Token_Check SHALL report a violation.
4. IF the Token_Check finds one or more violations, THEN THE Token_Check SHALL report each violation's file path, line number and matched text, and SHALL exit with a failing status, so that `npm test` fails.
5. WHEN the Token_Check finds zero violations, THE Token_Check SHALL exit with status 0.
6. THE Test_Suite SHALL run the Token_Check on every `npm test` run.
7. THE Test_Suite SHALL include tests of the Token_Check with sample inputs that show each violation kind in criteria 2 and 3 being reported, token references (CSS custom properties and `motion.ts` imports) being accepted, and the Token_Files being skipped.

### Requirement 4: Avatar contract

**User Story:** As a developer, I want the avatar defined by a contract, so that the Rive rig can replace the SVG renderer later without touching the screen.

#### Acceptance Criteria

1. THE Browser_Client SHALL define an Avatar_Contract whose props are the Avatar_Look and the Avatar_Input it came from, and THE SVG_Ghost SHALL implement it.
2. THE Main_Screen and the Specimens_Page SHALL render the avatar only through the Avatar_Contract, so that replacing the renderer changes no other component.
3. THE SVG_Ghost SHALL draw, in SVG in code: a soft-green glossy ghost body wider at the top with a wavy three-lobe hem, flat-top dark hair with a ragged fringe, two brass neck bolts (one each side of the head), a short stitched scar on the forehead at the upper right, and two big glossy black oval eyes with a small highlight, and no mouth.
4. THE SVG_Ghost SHALL use no raster image, video or audio file, and the build SHALL ship no copy of `reference/mascot-reference.png`.
5. THE SVG_Ghost SHALL expose `role="img"` and an accessible label taken from the Avatar_Look that names the state (for example "Franki is listening").
6. WHEN the Avatar_Look's accessible label changes, THE Browser_Client SHALL announce the new label through a polite live region (`aria-live="polite"`), as part of the single coalesced announcement of Requirement 18 criterion 8 and not as a separate announcement.

### Requirement 5: Look mapping

**User Story:** As a developer, I want one pure function that decides how Franki looks, so that every look rule can be property-tested.

#### Acceptance Criteria

1. THE Look_Mapper SHALL be a pure function: it SHALL make no Wall_Clock_Read and read no random source, DOM, storage or network, and SHALL return equal Avatar_Looks for equal Avatar_Inputs.
2. FOR ALL Avatar_Inputs (every Avatar_State, every `micMuted` and `outputMuted` value, every Avatar_Event or none, every Input_Level and Output_Level, every elapsed event time, both first-connecting values and both Reduced_Motion values), THE Look_Mapper SHALL return exactly one Avatar_Look and SHALL NOT throw (property).
3. THE Look_Mapper SHALL map each Avatar_State to a Look_Name as follows: `closed` to Dormant; `connecting` on the first `connecting` of the Visit to Waking; `connecting` after that to Connecting; `listening` to Listening; `thinking` to Thinking; `speaking` with `outputMuted` false to Speaking; `recovery` to Recovery.
4. WHERE an Avatar_Event is active, THE Look_Mapper SHALL show the event's Look_Name (Waking for `wake`, Presenting for `present-card`, Awaiting_Approval for `await-approval`, Celebrate for `celebrate`) over the state's Look_Name, except as criterion 7 sets, and SHALL keep the state's accessible label. Ghost_Mode stays an overlay as Requirement 6 criterion 11 sets. The design SHALL state one fixed priority order for every case that criterion 7 does not settle.
5. IF an Avatar_Input has an Input_Level or Output_Level that is outside 0 to 1 or is not a finite number, THEN THE Look_Mapper SHALL treat that level as 0.
6. THE Look_Mapper SHALL be exported so that the Test_Suite can call it directly, and SHALL be the only code that decides an Avatar_Look.
7. THE Look_Mapper SHALL show Recovery over every Avatar_Event, so that an event never hides an error, and SHALL show Dormant over `present-card`, `await-approval` and `celebrate`: FOR ALL Avatar_Inputs with Avatar_State `recovery`, the Look_Name SHALL be Recovery whatever the Avatar_Event, and FOR ALL Avatar_Inputs with Avatar_State `closed` and Avatar_Event `present-card`, `await-approval` or `celebrate`, the Look_Name SHALL be Dormant (property). Ghost_Mode applies over both as Requirement 6 criterion 11 sets.

### Requirement 6: Avatar states and looks

**User Story:** As the owner, I want Franki's face to show what's happening, so that I can see call state without reading text.

#### Acceptance Criteria

1. THE Dormant look SHALL show a dim glow, eyes closed, the body sunk low and slow breathing.
2. THE Waking look SHALL show a bolt strike on both neck bolts, a glow flare, eyes popping open and Franki rising, SHALL last `dur.ritual` (1200 ms) measured in Frame_Time, and SHALL show at most once per Visit.
3. THE Connecting look SHALL show flickering bolts and half-open eyes.
4. THE Listening look SHALL show Franki leaning in a little, a glow that follows Input_Level, and blinks at irregular intervals.
5. THE Thinking look SHALL show Electricity arcing between the bolts and the eyes glancing up and to the side. WHILE Avatar_State is `speaking` and `outputMuted` is true, THE Look_Mapper SHALL return the Thinking look.
6. THE Speaking look SHALL show the body squishing with Output_Level, and THE Look_Mapper SHALL return the Speaking look only while Avatar_State is `speaking` and `outputMuted` is false.
7. THE Recovery look SHALL show a squint, a small wobble and one bolt fizzling.
8. THE Presenting look SHALL show Franki glancing toward the Card_Dock and then back, and SHALL end after a finite duration stated in the design.
9. THE Awaiting_Approval look SHALL show expectant eyes and a small nod loop, and SHALL end when the Event_Controller clears the `await-approval` event (Requirement 8 criterion 3).
10. THE Celebrate look SHALL show a small rise and gold sparks off the bolts, and SHALL end after a finite duration stated in the design.
11. WHILE `micMuted` is true, THE Look_Mapper SHALL return the Ghost_Mode look whatever the other inputs are: body opacity 0.35, eyes at opacity 1, and every other property and the accessible label equal to the look the same inputs give with `micMuted` false (property).
12. FOR ALL pairs of different Look_Names, THE two Avatar_Looks SHALL differ in at least one non-text property (eyes, glow, posture, bolt effect, body motion, body opacity or level followed), both with Reduced_Motion off and with Reduced_Motion on (property).
13. WHILE Reduced_Motion is off, THE SVG_Ghost SHALL apply the idle float (about ±6 px on a 4 s sine, with the floor shadow narrowing as Franki rises) in every look.

### Requirement 7: Output level and speaking motion

**User Story:** As the owner, I want Franki's body to move only when I can actually hear Franki, so that a held or cancelled reply never looks like speech.

#### Acceptance Criteria

1. WHILE `outputMuted` is true, THE Look_Mapper SHALL return an Avatar_Look whose followed level is not `output`, whatever the Output_Level, Avatar_State and Avatar_Event (property).
2. FOR ALL Avatar_Inputs with `outputMuted` true, changing only the Output_Level SHALL leave the Avatar_Look unchanged (property).
3. WHILE `outputMuted` is false and the look is Speaking, THE SVG_Ghost SHALL scale its body squish with Output_Level, so that Output_Level 0 gives no squish.
4. WHILE `outputMuted` is true, THE SVG_Ghost SHALL show no body squish, whatever the look and the Output_Level.

### Requirement 8: No dead ends

**User Story:** As the owner, I want Franki to always settle back, so that a missed event never leaves the avatar stuck.

#### Acceptance Criteria

1. FOR ALL Avatar_Inputs, setting the Avatar_Event to none and the Avatar_State to `closed` SHALL give the Dormant look, and setting the Avatar_Event to none, the Avatar_State to `listening` and `micMuted` to false SHALL give the Idle look (property).
2. FOR ALL Avatar_Inputs with Avatar_Event `wake`, `present-card` or `celebrate`, once the elapsed event time reaches that event's finite duration, THE Look_Mapper SHALL return the same Avatar_Look as with the Avatar_Event set to none (property).
3. THE Event_Controller SHALL be a pure reducer driven by Frame_Time, with no Wall_Clock_Read and no timers of its own, SHALL be exported so that the Test_Suite can call it directly, and SHALL be the only code that starts and clears Avatar_Events. THE Event_Controller SHALL clear an active `wake`, `present-card` or `celebrate` event once its duration has passed in Frame_Time, and SHALL clear an active `await-approval` event when the approval it waits for is answered or removed, when the Avatar_State becomes `closed`, or when the Owner signs out.
4. FOR ALL sequences of 1 to 50 Event_Controller inputs (Avatar_State changes, Avatar_Events and Frame_Times), once Frame_Time passes the longest timed event duration (of `wake`, `present-card` and `celebrate`) after the last new event, with no new event since, THE Event_Controller SHALL report no active `wake`, `present-card` or `celebrate` event (property).

### Requirement 9: Reduced motion

**User Story:** As someone sensitive to motion, I want Franki to stay readable without movement, so that I can use Franki comfortably.

#### Acceptance Criteria

1. WHILE Reduced_Motion is on, THE Look_Mapper SHALL return Avatar_Looks with no infinite animation, no Electricity and no blur, whatever the other inputs (property).
2. WHILE Reduced_Motion is on, THE Thinking look SHALL show a steady bolt glow in place of arcing Electricity, and every look SHALL stay distinct from every other look by eyes, glow or posture (Requirement 6 criterion 12).
3. WHILE Reduced_Motion is on, THE Surfaces SHALL replace every enter and exit motion with a plain opacity fade, and SHALL run no loop, no blur and no Electricity.
4. WHEN the `prefers-reduced-motion` setting changes during a Visit, THE Browser_Client SHALL apply the new setting to the avatar and the Surfaces within 500 ms.

### Requirement 10: Motion system

**User Story:** As the owner, I want motion that feels like a ghost, so that the screen is calm and alive.

#### Acceptance Criteria

1. THE Surfaces SHALL enter by rising 12 px, fading in and unblurring from 6 px to 0 (Materialize), and SHALL exit by rising 8 px, fading out and blurring to 6 px (Dematerialize).
2. THE Surfaces SHALL use the spring tokens for springs (`spring.float` for Franki, the halo and motes; `spring.settle` for Cards, sheets and Chips; `spring.press` for button press and release) and the duration and easing tokens for every other transition.
3. THE Electricity effect SHALL be a jagged path regenerated every 60 to 90 ms of Frame_Time by midpoint displacement, stroked `spark` with a `gold` glow, and THE Browser_Client SHALL show at most two Electricity effects at once.
4. WHEN a brass control is pressed, THE Browser_Client SHALL move the control down 2 px with `spring.press`, and WHILE Reduced_Motion is off, WHEN the call button is pressed, THE Browser_Client SHALL run a short spark around the call button's ring.
5. THE Browser_Client SHALL animate only `transform` and `opacity` for anything that moves on every frame.
6. THE Browser_Client SHALL take animation time only from Frame_Time, CSS animations and the `motion` library, and SHALL contain no Wall_Clock_Read in `apps/web/src/components/` or `apps/web/src/ui/`; the existing clock check in `npm test` SHALL keep passing.
7. WHEN the document becomes hidden, THE Browser_Client SHALL pause every animation loop, Electricity effect and Level_Meter read, and WHEN the document becomes visible again, THE Browser_Client SHALL resume them.

### Requirement 11: Audio levels

**User Story:** As the owner, I want Franki's glow and body to follow the sound of the call, so that the avatar feels present, without anything being recorded.

#### Acceptance Criteria

1. THE Level_Meter SHALL compute Input_Level from the microphone stream and Output_Level from Franki's output stream with a Web Audio `AnalyserNode`, each as a smoothed number from 0 to 1 inclusive.
2. THE Level_Meter SHALL record, store and send no audio or level data: it SHALL write no Record, call no route, and use no network, no storage and no `MediaRecorder`.
3. THE change to `apps/web/src/client/voice-client.ts` SHALL be limited to exposing the microphone stream and the remote output stream, and their removal on teardown, to the Level_Meter. It SHALL change no muting, Permit, admission, timer, route or call behavior, and every existing Voice_Client test SHALL pass unchanged.
4. WHILE no stream is available (signed out, no call, or after teardown), THE Level_Meter SHALL report Input_Level and Output_Level as 0.
5. WHEN the Voice_Client tears down a call, THE Level_Meter SHALL disconnect its analyser nodes from the old streams.
6. FOR ALL analyser sample buffers and prior levels, THE Level_Meter's level computation and smoothing SHALL return a level from 0 to 1 inclusive, and THE Test_Suite SHALL test this computation as a pure function (property).
7. THE Level_Meter SHALL create its `AudioContext` only after a user gesture; the call button press counts as one.

### Requirement 12: One-screen layout

**User Story:** As the owner, I want one calm screen with Franki in the middle, so that I talk to Franki instead of navigating an app.

#### Acceptance Criteria

1. THE Main_Screen SHALL lay out, with no navigation, the Wordmark and Time_Badge in the header, the Strip below the header, the stage with Franki, the halo and the floor shadow in the center, the Card_Dock, the Chips row, the call button with mute beside it, the Typed_Line, the Jar at the bottom left, the Lab at the bottom right, the Captions and the Footer, in the arrangement of the UI direction "The screen" diagram. Surfaces that Requirement 14 leaves unrendered keep their place in the layout without showing anything.
2. WHILE the viewport is at least 1024 px wide, THE Card_Dock SHALL sit at the right of the stage; WHILE the viewport is narrower, THE Card_Dock SHALL be a bottom sheet.
3. WHEN the viewport is any width from 375 px up, THE Main_Screen SHALL show every rendered Surface with no horizontal scrolling and no overlap of interactive controls.
4. THE Main_Screen background SHALL show a blueprint grid at about 3% opacity fading toward the edges, film grain from an SVG `feTurbulence` filter at about 4% opacity, and a soft vignette, so that Franki's halo is the only bright area on an empty screen.
5. THE Footer SHALL keep `data-testid="built-with-kiro"` and the text "Built with Kiro", and SHALL be rendered on every page including the Specimens_Page (`first-spoken-call` R16.7).

### Requirement 13: Signed-out screen

**User Story:** As the owner, I want a dark, quiet room when I'm signed out, so that waking Franki feels like an event.

#### Acceptance Criteria

1. WHILE no Owner is signed in, THE Main_Screen SHALL show the avatar in the Dormant look, the `FRANKIROCKS` Wordmark, one brass sign-in button labeled "Sign in to wake Franki" that starts the existing Google sign-in, and the call button in its start form, disabled.
2. WHEN the signed-out screen loads, THE Wordmark SHALL light the letters K, I, R and O gold once and then stay still; WHILE Reduced_Motion is on, the letters SHALL fade to gold with no other motion.
3. WHILE no Owner is signed in, THE Main_Screen SHALL render no Chips, Card, Strip, Jar, Lab, Receipt, Time_Badge or Captions, and SHALL send no request to any `/api/` route except `/api/health` (`first-spoken-call` R9.4).
4. WHILE Firebase has not yet reported whether a user exists, THE Main_Screen SHALL show the signed-out screen with the sign-in button disabled (`first-spoken-call` R9.7).
5. IF sign-in fails, THEN THE Main_Screen SHALL show the existing error message naming the cause next to the sign-in button, as inline text and not as a toast (`first-spoken-call` R9.6).

### Requirement 14: Main-screen wiring

**User Story:** As the owner, I want the main screen to show only what is real today, so that nothing on it is a placeholder.

#### Acceptance Criteria

1. THE Main_Screen SHALL wire to Surfaces only these sources that the Browser_Client has today: auth state, Voice_State (through `avatarState()`, `callButton()` and `muteVisible()`), `micMuted`, `outputMuted`, Input_Level, Output_Level and typed turns.
2. THE Main_Screen SHALL render no Card, Strip, Jar, What_I_Know_Sheet, Lab, Receipt, Time_Badge, Chips or Captions, because no source in criterion 1 feeds them.
3. THE Main_Screen and every module it imports SHALL import no Fixture, and THE Test_Suite SHALL include a check that fails when any module reachable from `apps/web/src/app/page.tsx` imports from the Specimens_Page directory.
4. THE call button SHALL keep `first-spoken-call` R16.4 to R16.6: one button with the accessible label "Call Franki" in its start form and "Hang up" in its hang-up form; a round power glyph with a green core inside a brass ring for start and a squared `ember` form for hang-up, so that the forms differ in shape and colour; and disabled while signed out, while an open is pending and while a hang-up is in progress.
5. THE mute toggle SHALL be a small brass toggle beside the call button, shown only while `muteVisible()` is true, with `aria-pressed` equal to `micMuted` and the accessible labels "Mute microphone" and "Unmute microphone", and SHALL keep the muted indicator text "Your microphone is muted."
6. THE Main_Screen SHALL keep the existing call error messages (`CALL_ERRORS`) and the Retry control of `first-spoken-call` R13.8 and R15.8, shown as inline text and controls.
7. THE Typed_Line SHALL be collapsed to a keyboard glyph button by default, SHALL open a single-line-looking input when pressed, SHALL send on Enter with the behavior of `first-spoken-call` R18.1 and R18.8 to R18.10, and SHALL keep line feeds in pasted text so that the server's pasted classification (`first-spoken-call` R18.2) is unchanged.
8. WHILE no call is open, THE Main_Screen SHALL show Franki's latest reply to a typed turn in the Reply_Line, replacing any earlier reply, and SHALL show no list of earlier typed lines or replies (UI direction principle 1; narrows `first-spoken-call` R18.6).
9. THE Main_Screen SHALL show the signed-in Owner's email and a sign-out control in the header.

### Requirement 15: Card component

**User Story:** As the owner, I want text to appear only as a card when there is something to read or approve, so that the screen stays about Franki.

#### Acceptance Criteria

1. THE Card SHALL render each of the five kinds `source`, `approval`, `food`, `ask` and `read` from props only, with a one-line title, then the content, then sources, then actions, and numbers in Geist Mono with tabular figures.
2. THE Card SHALL render every number in its props with a source tag (for example "Bank · 6 purchases"), and WHEN the owner activates a source tag, THE Card SHALL call its `onOpenSource` prop with that tag's ID.
3. WHERE the Card kind is `approval`, THE Card SHALL say exactly what will happen, SHALL offer exactly two actions, **Yes** (brass, primary) and **Not now** (quiet), and SHALL pre-select neither.
4. WHERE the Card kind is `food`, THE Card SHALL show a "Checked for" line naming every hard rule applied, per person, with the safety seal, and SHALL contain no copy that calls a place or dish "safe".
5. WHERE a hard rule appears on a Card, THE Card SHALL show a brass seal with a lock, and SHALL remove the rule only through a deliberate activation of a remove control, never through a swipe or a dismiss of the Card.
6. THE Card_Dock SHALL show one primary Card at a time, with older Cards stacked behind it, slightly smaller.
7. WHEN a Card enters the Card_Dock, THE Card SHALL rise in from Franki's side of the screen with `spring.settle`.

### Requirement 16: Strip, Jar, Lab, Receipt, Time_Badge, Captions, Chips and Wordmark

**User Story:** As a developer, I want every surface built as a props-only component, so that server data can be connected later without rebuilding the interface.

#### Acceptance Criteria

1. THE Card, Strip, Jar, What_I_Know_Sheet, Lab, Receipt, Time_Badge, Captions, Chips and Wordmark components SHALL render from props only, and SHALL contain no data fetching, no route call, no storage read and no import of `apps/web/src/client/api.ts`.
2. THE Strip SHALL render five terminals joined by a wire (Noticed, Connected, Suggested, You said yes, and the result label from props), SHALL fill the terminals that props mark filled, SHALL run current along the wire to each newly filled terminal, and SHALL turn the last terminal `gold` when it is filled.
3. THE Jar SHALL render one mote per memory in props up to a visual cap stated in the design, with solid motes for told, dashed for guessed, brass for hard rules and frosted for private, and WHEN the owner activates the Jar, THE Jar SHALL call its `onOpen` prop.
4. THE What_I_Know_Sheet SHALL group items by the areas Time and work, Food and health, Money, People and Goals, SHALL put hard rules at the top under their seal, SHALL label guesses "Guessed" with a dashed outline, and SHALL give each item its text, where it came from, and the three actions **Wrong**, **Forget** and **Don't bring it up**.
5. THE Lab SHALL render each counter in Geist Mono with tabular figures, SHALL show `—` for any counter whose value in props is null, SHALL show no placeholder zero, SHALL roll a counter like an odometer when its value changes, and SHALL have a fold for honest limits.
6. THE Receipt SHALL print up out of the Lab over `dur.ritual`, and SHALL show "Blocked now", "Cleaned up", what was kept (for example "Kept: 1 safety rule") and counts by kind.
7. THE Receipt props SHALL hold only kinds, counts, kept-rule counts and the two status lines, and no text of any forgotten item, so that the Receipt cannot show forgotten words (UI direction principle 7).
8. THE Time_Badge SHALL render "Simulated: <day> <time>" with a small bolt, from props that give the simulated instant and zone, and SHALL be rendered whenever its props say the clock is simulated.
9. THE Captions SHALL show one line of what Franki is saying now, SHALL fade that line out after it ends, SHALL keep no history, SHALL be off by default and SHALL offer a toggle that turns them on.
10. THE Chips SHALL render glass capsules with a stitched outline from a list of code-constant labels in props, and WHEN the owner activates a Chip, THE Chips component SHALL call its `onChip` prop with that Chip's text.
11. THE Wordmark SHALL render "Franki" in the header and `FRANKIROCKS` on the signed-out screen.
12. WHEN a Surface's props say it has nothing true to show (no items, no counts, no open loop), THE Surface SHALL render nothing, not an empty panel (UI direction principle 8).

### Requirement 17: Copy and truth rules

**User Story:** As the owner, I want every word and number on screen to be true and plainly worded, so that I can trust what Franki shows.

#### Acceptance Criteria

1. THE Browser_Client SHALL show no Banned_Cause_Word in any Surface copy or Fixture, and THE Test_Suite SHALL include a check that fails when a string literal or JSX text in `apps/web/src/components/`, `apps/web/src/ui/` or the Specimens_Page directory contains a Banned_Cause_Word.
2. THE Main_Screen SHALL show no fixture or demo data that the server did not send (UI direction principle 5).
3. THE Browser_Client SHALL show no toast, no badge count, no "coming soon" text and no empty panel (UI direction principle 8).
4. THE Surfaces SHALL use short, second-person, sentence-case copy, except the `FRANKIROCKS` Wordmark.
5. WHEN the Browser_Client receives a completed forget result, THE Browser_Client SHALL drop every turn copy it holds (Captions, Reply_Line, typed text, Cards and cached Jar items), whatever the forget result covers, because the contracts §1 `forgetReceipt` payload carries no turn IDs (open item 1).
6. WHEN the Browser_Client drops turn copies after a forget, THE Browser_Client SHALL animate their removal with Dematerialize.
7. THE design SHALL record under "Contract questions" that the contracts §1 `forgetReceipt` payload carries no turn IDs (open item 1), and this slice SHALL add no wire field for them.

### Requirement 18: Accessibility

**User Story:** As someone using a keyboard or a screen reader, I want every control and state to be reachable and named, so that I can use Franki without a mouse or without seeing the screen.

#### Acceptance Criteria

1. THE Browser_Client SHALL give every interactive control an accessible name, and the avatar an accessible label naming its state.
2. THE Browser_Client SHALL make every interactive control reachable and operable with the keyboard alone, in visual order, with a visible focus indicator.
3. THE Browser_Client SHALL give every interactive control a target of at least 44 by 44 CSS px.
4. THE Test_Suite SHALL include a test that computes the contrast ratio of every text and background token pairing the Surfaces use, and SHALL fail if normal text is below 4.5:1 or large text or a control boundary is below 3:1 (WCAG 2.2 AA).
5. WHEN the Avatar_State changes, THE Browser_Client SHALL announce the change through the polite live region; the announcement of Requirement 4 criterion 6 is this announcement.
6. WHEN the call state changes, THE Browser_Client SHALL announce the change through the polite live region.
7. WHEN a call error changes, THE Browser_Client SHALL announce the change through the polite live region.
8. WHEN one or more of the changes in criteria 5 to 7 land in the same render, THE Browser_Client SHALL make exactly one polite live-region announcement that joins all of them (for example "Franki is listening. Call connected."), so that a screen reader speaks once for one moment and a change on its own is announced exactly once.

### Requirement 19: Sound cues

**User Story:** As the owner, I want small sounds that mark moments, so that Franki feels alive without getting in the way of the voice.

#### Acceptance Criteria

1. THE Browser_Client SHALL synthesize every Sound_Cue with Web Audio in code: wake (a rising three-note figure with a crackle, under 1.5 s), thinking (a very faint crackle), card arrives (a soft glassy tap), celebrate (a short bright chime) and receipt (a quick paper-printer whirr), and SHALL load no audio file and no third-party sound.
2. THE Browser_Client SHALL play no Sound_Cue before the first user gesture of the Visit, so that at any later time in the Visit it is false that a Sound_Cue played before that gesture.
3. WHEN the Waking look starts, THE Browser_Client SHALL play the wake cue; WHEN the Thinking look has lasted more than 1 s of Frame_Time, THE Browser_Client SHALL play the thinking cue once for that thinking period.
4. WHILE `outputMuted` is false, THE Browser_Client SHALL start no Sound_Cue, and WHEN `outputMuted` becomes false while a Sound_Cue plays, THE Browser_Client SHALL fade that cue to silence within 50 ms.
5. THE Browser_Client SHALL keep every Sound_Cue at a peak gain of at most 0.25, so that cues sit well below Franki's voice.
6. THE Sound_Toggle SHALL be one on/off control with an accessible name and `aria-pressed`, SHALL remember its value in `localStorage` across Visits, and SHALL default to on.
7. WHILE the Sound_Toggle is off, THE Browser_Client SHALL play no Sound_Cue.
8. THE Sound_Cue scheduling logic (which cue plays for which look change, given the gesture state, `outputMuted` and the Sound_Toggle) SHALL be a pure function, and THE Test_Suite SHALL test it.

### Requirement 20: Specimens page

**User Story:** As the owner, I want one page that shows every component in every state, so that I can review the interface without making a call.

#### Acceptance Criteria

1. WHILE `NODE_ENV` is not `production`, THE Specimens_Page SHALL render every Surface component in every state its props allow, with Fixture props, including each Card kind, the Strip at each fill level, the Lab with real and `—` counters, and the Receipt.
2. THE Specimens_Page SHALL render the avatar in every Look_Name and with every Avatar_Event, each once with Reduced_Motion off and once with Reduced_Motion forced on, and with Ghost_Mode over each state.
3. THE production build of the Web_App SHALL exclude the Specimens_Page route and every file under its directory, including the Fixtures, so that no Specimens_Page code runs in production.
4. WHEN `/specimens` is requested from a production build, THE Web_App SHALL respond with HTTP 404 from the Next.js default not-found, because no handler for `/specimens` exists.
5. THE Fixtures SHALL live only under the Specimens_Page route directory.
6. THE Specimens_Page SHALL use no Server Action, `use cache`, `next/og` or ISR, and SHALL call no `/api/` route.

### Requirement 21: Debug panel

**User Story:** As the owner, I want the debug panel out of the way but still there, so that I can check memory without cluttering the main screen.

#### Acceptance Criteria

1. WHILE `NODE_ENV` is not `production` and the page URL has the query parameter `debug=1`, THE Main_Screen SHALL render the Debug_Panel for a signed-in Owner, with its existing behavior (`first-spoken-call` R29).
2. WHEN the Debug_Panel renders, THE Debug_Panel SHALL send `GET /api/debug/memory` at once, as part of its existing behavior.
3. WHILE the page URL lacks `debug=1`, THE Main_Screen SHALL render no Debug_Panel and SHALL send no `GET /api/debug/memory` request.
4. WHILE `NODE_ENV` is `production`, THE Main_Screen SHALL render no Debug_Panel and SHALL send no `GET /api/debug/memory` request, whatever the query parameters.

### Requirement 22: Dependencies and boundaries

**User Story:** As the owner, I want the interface built on what we already have, so that the app stays small and safe.

#### Acceptance Criteria

1. WHERE the build adds the `motion` package (motion.dev), THE `apps/web/package.json` SHALL pin it to one exact version (no range) whose peer dependencies accept React 19.3.1 and that works with Next.js 16.4.3, and the build SHALL read its docs in `node_modules` after installing.
2. THE build SHALL add no dependency other than `motion` without asking the owner first.
3. THE Browser_Client SHALL import no `packages/server`, `firebase-admin` or `openai` module, and the existing import-boundary check in `npm test` SHALL keep passing.
4. THE build SHALL change no file in `packages/server` or `docs/design/`, and SHALL add no API route.
5. THE build SHALL use no Server Action, `use cache`, `next/og` or ISR, and SHALL read the relevant guide in `node_modules/next/dist/docs/` before writing any route or page.
6. THE build SHALL commit each task as exactly one atomic commit on branch `build/lab-ui`, with no intermediate commits for that task.
7. THE build SHALL end each commit message with the trailer line `Built-with: Kiro`.
8. THE build SHALL NOT push or deploy.

### Requirement 23: Tests and checks

**User Story:** As the owner, I want the tests updated honestly and every check green, so that the new interface is safe to build on.

#### Acceptance Criteria

1. THE Test_Suite SHALL include fast-check property tests, each run for at least 100 generated cases, for: Look_Mapper totality (Requirement 5 criterion 2), Ghost_Mode (Requirement 6 criterion 11), output-muted speaking (Requirement 7 criteria 1 and 2), event priority (Requirement 5 criterion 7), no dead ends (Requirement 8 criteria 1, 2 and 4), Reduced_Motion (Requirement 9 criterion 1), distinct looks (Requirement 6 criterion 12) and level bounds (Requirement 11 criterion 6).
2. IF a property test fails, THEN THE Test_Suite SHALL report the fast-check seed and the shrunk counterexample.
3. THE spec's `tasks.md` SHALL mark every property-test task as required, and SHALL name each task's dependencies and test witness.
4. WHEN this spec changes a behavior that an existing test checks (for example `StandInAvatar.test.tsx` and its class-name assertions on the call button), THE build SHALL update or replace that test so that it checks the new requirement, and SHALL NOT delete a check without adding one that protects the same behavior or citing the requirement that removed the behavior.
5. WHERE the build updates an existing test file in place, THE updated test file SHALL keep covering every behavior the file covered before, except a behavior that a requirement of this spec removed.
6. THE Test_Suite SHALL keep checking every kept `first-spoken-call` R16 criterion: one call button, the distinct shape and colour of its two forms, the labels "Call Franki" and "Hang up", the mute toggle only while listening, thinking or speaking, and the Footer with `data-testid="built-with-kiro"`.
7. WHEN the slice is complete, `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` SHALL each exit with code 0.
8. WHEN the slice is complete, the final report SHALL list what changed, the `motion` version added, every requirement this spec changed, and what could not be checked (for example contrast in a real browser, 60 fps on a mid-range laptop, and sound levels by ear).
