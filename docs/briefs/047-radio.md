# Brief 047: the radio and its globe (lane `radio`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

**Who builds this.** Claude builds it from this brief, in four parts. It is not Kiro's work, and its commits do not carry the Kiro trailer.

## What it is

A wooden radio sits on the stage beside Franki. When the owner says "Franki, you rock", the radio turns on, Franki celebrates, and a globe of radio stations opens tuned to a rock station. Pressing the radio does the same thing without the celebration. The globe shows up to 50 stations, one per city, as lights. The owner spins it, presses a light, and that city's station plays.

Product rules that bind every part:

- **At most 50 stations,** bundled with the app as a snapshot. Nothing is fetched at run time except the audio stream the owner tuned to.
- **Every station names its source.** Each row carries its Radio Browser station ID, and the snapshot file names the day it was taken.
- **Only the owner's own words turn it on.** The phrase is matched against the owner's spoken transcript and typed lines. Mail, tool results, card text and Franki's own speech never reach the matcher.
- **Nothing is stored.** The radio keeps no history, writes nothing to memory, and sets no browser storage. A reload starts with the radio off.
- **Franki's voice comes first.** While a call is open the radio plays quieter, and quieter still while the owner or Franki is speaking.
- **No model files and no drawings.** The radio and the globe are three.js, built from primitives and code-drawn textures. There is no SVG version. If WebGL fails, words stand in.
- **Reduced motion** draws both still. Every control works by keyboard and has a 44 px target.

## Rulings for this brief

These are the director's, made so the build can start.

1. **Client only.** No route, no tool, no change to `packages/core` or `packages/server`, no change to the voice reducer or its golden corpus. The model is not told the radio exists. That gap is listed under "What it doesn't do".
2. **Stations come from Radio Browser** (`https://de1.api.radio-browser.info`, a community list in the public domain). A script picks them; the app never calls that API.
3. **One station per city,** chosen from a hand-written list of world cities so the globe is covered on every continent and every light has a clean place name.
4. **Streams are HTTPS, MP3 or AAC, not HLS,** so a plain audio element plays them with no library. The script checks each one answers with audio before it is kept.
5. **Music first.** The script prefers music stations and skips news, talk, sport, religious and political stations by tag.
6. **The radio works signed out too.** It is on the lab screen in both auth states. The phrase needs a call or a typed line, so it works only signed in.
7. **The panel is not modal.** The owner can talk to Franki, read a card or type with the globe open. Closing the panel leaves the station playing. Only "off" stops it.
8. **Volume in a call.** No call: the owner's volume. Call open: 0.4 of it. While the owner speaks, a reply is being prepared, or Franki speaks: 0.12 of it. One function, three named constants.
9. **A dead stream hops.** When a station fails or does not start within 10 seconds, the radio tries the next station of the same kind (rock, then by longitude), at most 3 hops, then rests on "No signal".
10. **The phrase.** A Franki-like name (`franki`, `frankie`, `franky`, `frankey`, `frank`) and "you rock" in the same utterance in either order, or "Franki rocks". Case and punctuation are ignored. "You rock" alone does not turn it on. Off: "radio off", or "stop" or "turn off" with "the radio" or "the music", in either order, and only while the radio is on.
11. **The match happens on the owner's words as the browser holds them:** a spoken item's transcript when it completes, and a typed line when it is sent. It does not wait for the server's verdict on the turn, since it writes nothing and tells Franki nothing. Each utterance fires at most once.

## The contract (all parts code against this)

`apps/web/src/ui/radio/types.ts` is written and is not edited by parts A to C without saying so in the report: `Station`, `RadioView`, `RadioPropView`, `RadioControls`, `RADIO_OFF_VIEW`, `radioPropView`.

`COPY.radio` in `apps/web/src/ui/copy.ts` is written. A part that needs another string lists it in its report; part D adds it.

No part runs `npm run build` or a second dev server: the lead has one on port 3200 and a build would fight it for `.next`. No part commits. The lead commits.

## Part A: stations, the machine, the phrase, the player

Files: `scripts/radio-stations.mjs`, `apps/web/src/ui/radio/{stations,radio-machine,phrase,gain}.ts` with tests, `apps/web/src/client/{radio-player,radio-watch}.ts` with tests, and the machine's rows in `docs/machines/`.

- **`scripts/radio-stations.mjs`.** Run by hand: `node scripts/radio-stations.mjs --date 2026-11-13`. It holds the city list (about 90 cities with latitude and longitude, every continent, both polar edges where a station exists). It fetches Radio Browser with a plain client name in the User-Agent, finds candidates within 80 km of each city, filters by ruling 4 and 5, ranks by clicks and votes, checks the stream answers 200 or 206 with an `audio/*` content type after redirects (8 second limit), and writes `apps/web/src/ui/radio/stations.ts` with at most 50 rows. It keeps at least 6 rock stations when the list allows, and spreads the 50 so no continent is empty. The date comes from the argument, not the clock. `--check` re-tests the streams of the file as it stands and prints which ones failed, without writing.
- **`stations.ts`.** Generated. `export const STATIONS: readonly Station[]` sorted by longitude, and `STATIONS_SNAPSHOT = { source, date }`. Names are trimmed to 40 characters. A test pins: 1 to 50 rows, unique IDs, unique cities, HTTPS URLs, coordinates in range, sorted by longitude, at least 3 rock stations.
- **`radio-machine.ts`.** `radioStep(state, event, stations)` and `radioView(state, stations)`. Pure. The state carries power, panel, station ID, signal, volume, the duck level, a tune counter and the hop count. Every tune raises the counter, and a player event carrying an older counter is dropped. Events cover everything in `RadioControls`, the two phrases, the player's reports (playing, waiting, failed, blocked, timed out), and the call's level (none, call, speech). The random pick for `spin` arrives in the event as a number from 0 to 1, so the machine stays pure. Properties, written red first: a stale player event never changes the state; off always means silent and panel closed; the station ID is always null or in the list; hops never pass 3; volume stays in 0 to 1; `press` twice from off leaves the radio on with the panel closed.
- **`phrase.ts`.** `radioPhrase(text): "rock" | "off" | null`, by ruling 10. Table tests with the spellings a transcriber produces ("Frankie, you rock!", "you rock franky", "Franki rocks") and near misses ("you rock", "rock and roll", "Frank Sinatra rocks the house" is a hit by the rule and is listed as one).
- **`gain.ts`.** `radioGain(volume, duck)`, by ruling 8.
- **`radio-player.ts`.** The browser adapter behind a small port: load a URL with its tune counter, stop, set gain, report events. One `Audio` element, `preload="none"`, no `crossOrigin`. Gain changes ramp over about 200 ms so ducking has no click. A refused `play()` reports "blocked".
- **`radio-watch.ts`.** The store the screen reads, in the shape of `client/phone-watch.ts`: `subscribe`, `getSnapshot` (a `RadioView`, stable between changes), `controls` (a `RadioControls`), `onVoice(voiceState)`, `onTypedLine(text)`, `dispose()`. It takes the player port, a timer port and a random source as arguments, and an `onRock` callback that part D wires to the celebration. It reads the owner's newest completed spoken transcript from the voice state and fires each utterance once. It derives the duck level from the voice state. Tests use a fake player and fake timers.

## Part B: the radio on the stage

Files: `apps/web/src/components/radio/three/{model,motion,engine}.ts`, `ThreeRadio.tsx`, `RadioOnStage.tsx`, with tests. Copy the wall phone's structure file for file (`apps/web/src/components/phone/`).

- **The look.** A small tabletop radio in the phone's oak and brass: a cabinet with a rounded top, a round cloth speaker behind a brass grille, a dial window with a needle, two brass knobs, stitched seams, and a short antenna with a ball tip. It should read at a glance as a radio at 110 px wide. Colours come from `COL`.
- **States.** Off: dark dial. Hover or keyboard focus: the dial warms. Tuning: the needle sweeps and a small arc crackles at the antenna tip. Playing: the dial glows, the speaker cone pulses, the cabinet bobs a little, and a few notes or rings drift up from the speaker. No signal: the dial shows the ember colour and nothing drifts. Tap to play: the dial blinks slowly.
- **`RadioOnStage({ view, onPress })`.** Takes a `RadioPropView`. Always present. It sits on the floor at Franki's lower left, inside the stage's `aside`, and takes no room. A real `<button>` covers the canvas: its label comes from `COPY.radio.prop` by what a press would do, with `aria-expanded` for the panel, a visible focus ring, and a 44 px minimum target. The canvas is `aria-hidden`. If WebGL fails the button shows `COPY.radio.prop.fallback` as words in the chip style.
- **Reduced motion** draws the settled pose of each state, with no loop.

## Part C: the globe panel

Files: `scripts/radio-land.mjs`, `apps/web/src/components/radio/globe/{land,texture,model,motion,engine}.ts`, `ThreeGlobe.tsx`, `RadioPanel.tsx`, with tests.

- **`scripts/radio-land.mjs`.** Run by hand. Reads Natural Earth's 1:110m land (public domain; the `world-atlas` package's `land-110m.json` from a CDN is fine), decodes it without adding a dependency, and writes `globe/land.ts` as compact rings. Keep the file under 60 KB.
- **The globe.** A sphere whose texture is drawn in code on a canvas: night-coloured sea, land in a dim ghost green with a brighter coast, and dashed lines every 30 degrees like stitches. A thin green rim of light around the edge. Each station is a small brass light. The tuned station is larger and green, and sends out rings while it plays.
- **Moving it.** Drag to spin with a little coast after release; latitude is clamped so the poles never flip. It turns slowly on its own while nothing is tuned and nobody is touching it. Tuning eases the globe round to face the station. The motion is a pure module with property tests (the clamp holds; easing ends exactly on the station; a long frame is capped).
- **Picking.** A press that moved less than 6 px picks the nearest station on the near side within 28 px. Hovering one shows its city in a small label and a pointer cursor.
- **`RadioPanel({ view, stations, controls })`.** A floating glass panel in the cards' material, not modal: `role="dialog"` with `COPY.radio.panel.title`, no scrim, no focus trap. Escape closes it when focus is inside. From 640 px up it sits at the lower left of the screen, 16 rem wide, and 22 rem from 1800 px (changed after the first look on screen: at 22 rem it covered the radio on the stage). Below 640 px it sits under the header across the width with a shorter globe. Top to bottom: the `Wordmark` at small size with a close button; the globe; the station's name, its place and the signal word; then previous, spin, next, a volume slider and off. When the signal is "tap to play" or "no signal" a "Try again" button shows. The station line is a polite live region. If WebGL fails, a scrolling list of station buttons stands in for the globe.
- **Loading.** three.js arrives only through one `import()` in `ThreeGlobe.tsx`. `RadioPanel` itself must be cheap to load with the page.

## Part D: wiring, specimens, docs (after A, B and C)

- `App.tsx`: one `RadioWatch` for the app's life, in both auth states. `StageFor` gets `RadioOnStage` beside `PhoneOnStage` in the stage's `aside`. The panel rides in the `sheet` slot beside the bank sheet, so `MainScreen.tsx` is not edited. Voice snapshots feed `onVoice`. Typed lines feed `onTypedLine` when sent, in and out of a call.
- `ScreenController` gets one public method that feeds the avatar's existing `celebrate` event, and the radio's `onRock` calls it.
- `apps/web/src/app/specimens/_sections/RadioSection.tsx`: the radio in each state beside the ghost, the panel in each signal state with a silent fake player, a reduced-motion row, and the no-WebGL fallbacks. Listed in `page.dev.tsx` after the phone.
- README: one bullet under "It's alive", the station source and Natural Earth under a credit line, and the radio added to what Claude built.
- `docs/machines/`: checked against part A's rows.

## What it doesn't do

Check these before promising the radio anywhere.

- **Never heard through speakers by a person** as of this build. The lead checked it in the browser pane with the audio element muted (see Outcome); nobody has listened to it.
- **Never tried in a live call.** Whether the microphone picks up the radio, and whether Franki then answers the song, is not known. Echo cancellation is the browser's, not ours. The ducking (0.4 in a call, 0.12 while anyone speaks or a reply is prepared) is checked by tests only.
- **The model is not told the radio exists.** Franki may say he has no radio while it plays, or answer "radio off" in words while the radio turns off on its own.
- **Franki celebrates only in a call.** The celebration is the avatar's own celebrate event, and the avatar shows nothing for it while the call is closed (Dormant), in recovery, or during the wake. So a typed "Franki, you rock" outside a call turns the radio on and opens the globe, with no celebration.
- **The radio hears a typed line when it is sent, not when the server admits it.** Outside a call that is when the box can send; in a call, when the call takes the line. A line the server later refuses has still been heard. Pasted lines are never heard.
- **Station streams are third parties'.** Any of the 50 may be dead on a given day. The hop rule covers it (at most 3 hops, then "No signal"). `node scripts/radio-stations.mjs --check` lists the dead ones; re-run the script to refresh the snapshot.
- **A light's city is where Radio Browser lists the station.** Nobody checked where each one broadcasts from. Six East Asian lights (Tokyo, Seoul, Taipei, Hong Kong, Shanghai, Hanoi) came from a search by country and are named by the listing's coordinates, name or state. The Tokyo light, for one, is a Chinese-language classical stream listed under Japan. Station names are the listing's own, tidied by rule.
- **"Rock" is the listing's tag, not our ear.** A station is rock when one of its tags has the word rock, other than pop rock, soft rock and slow rock. Ten of the 50 are. Nobody listened to check.
- **iOS ignores an audio element's `volume`,** so ducking and the volume slider do nothing there.
- **Nothing is remembered across a reload.** The radio starts off, at the default volume, every time.
- **The radio does not follow the sound toggle.** It has its own volume and its own off. Signing out leaves it playing.
- **Frame rate with the ghost, the phone, the radio and the globe together is unmeasured.** The full specimens page holds up to nine WebGL contexts; the lab holds two to four (the ghost and the radio, the phone during a call, the globe while open).

## Outcome

Built by Claude in four parts, with no Kiro run. Nothing here is committed by the builders; the lead commits.

**Part A: stations, the machine, the phrase, the player.** `scripts/radio-stations.mjs` and its snapshot `ui/radio/stations.ts` (50 stations in 50 cities, 10 of them rock, Radio Browser, dated 2026-11-13); `radio-machine.ts`, `phrase.ts`, `gain.ts`; `client/radio-player.ts` and `client/radio-watch.ts`; the `ui.radio` rows in `docs/machines/`. Properties, each run red first:

| Property | Seed | Counterexample |
|---|---|---|
| A stale player report changes nothing | -1872267973 | |
| Off is silent, with the panel closed | -2043776838 | |
| The station is null or in the list | 1154255017 | |
| Hops never pass 3 | 2023039787 | failed, failed, timedOut, failed reached 4 |
| Volume stays in 0 to 1 | 210071348 | `setVolume(-5e-324)` |
| Press twice from off leaves it on, panel closed | -164755508 | |

Part A's rulings, for the owner to confirm: adult-contemporary tags count as music; a line with both phrases matches neither; a negation blocks the off phrase; tune, step, spin and retry do nothing while off; the rock phrase keeps a rock station already playing; a stream that starts resets the hop count; pasted text is never read.

The lead's rulings on the snapshot, made while looking at its rows: the stored address is Radio Browser's resolved one, and an address carrying a session token is refused, since it would expire; a pop, soft or slow rock tag alone is not rock (two pop stations carried the flag before this); a country the 80 km search left dark in East Asia is searched by country, at most 8 lights for the region; five crowded cities were dropped to keep 50 (Vienna, Miami, San José, Helsinki, Dhaka).

**Part B: the radio on the stage.** `components/radio/three/{model,motion,engine}.ts`, `ThreeRadio.tsx`, `RadioOnStage.tsx`. Properties of the radio's motion, red first: range, seed 1730430777 (dt = -5e-324); long-frame cap, seed 590105957; settling, seed 220134589.

**Part C: the globe panel.** `scripts/radio-land.mjs` and `globe/land.ts`, `globe/{texture,model,motion,engine}.ts`, `ThreeGlobe.tsx`, `RadioPanel.tsx`. Properties of the globe's motion, red first: pitch clamp, seed 1907373861; yaw normalised, seed -1983708416; the ease lands exactly, seed -802828243; a long frame is capped, seed -1644466976; still changes nothing, seed -327849215.

**Part D: wiring, specimens, docs.**
- `client/radio-live.ts`: `createLiveRadio(onRock)` (the browser player, the window's timers, `Math.random`, `STATIONS`), `createRadioHost` (the one watch, made in an effect and disposed for good on cleanup, so StrictMode's second run makes its own), `radioHears(text, pasted)`, and `feedRadioVoice`, which feeds one closed call when it ends so the radio stops ducking.
- `App.tsx`: one radio for the app's life in both auth states; the radio in the stage's `aside` beside the phone; the panel in the `sheet` slot of both `MainScreen` renders, with focus back on the radio's button when it closes; voice snapshots fed while signed in with a voice client; typed lines, in and out of a call, and chips passed to `onTypedLine` where they are sent. `MainScreen.tsx` is unchanged.
- `ScreenController.celebrate()` feeds the avatar's existing celebrate event through the frame loop.
- `RadioPanel` gains `presentation` ("floating" or "inline") and `globe` ("auto" or "list").
- Specimens: the main page holds the walk alone (two WebGL contexts) and a link to `/specimens/radio`, which holds the walk, the live tile (silent or real player, with a "Say it to Franki" line whose rock phrase makes the tile's ghost celebrate), the still radios, inline panels for tuning, no signal and tap to play, and the still globe under Reduced_Motion (at most nine contexts).
- README: the "It's alive" bullet, the radio under what Claude Code built, and a Credits line.

**Checked in the browser pane by the lead, with the sound muted** (not heard):
- On the signed-out lab at 1024 px and 375 px: a press started a real rock stream (the element reported playing and its clock ran); closing the panel left it playing; the volume slider set the element's volume; spin and next tuned other real stations; off paused the element and removed its source.
- On `/specimens/radio`: dragging the globe, the ease round to a station, the hover label and pressing a light, with real pointer events. Typing "Frankie, you rock!" into the live tile's line made the ghost celebrate, turned the radio on and opened the globe on a rock station.
- All 50 streams started in a muted audio element on Nov 13 (one needed a second try).

Changed after looking: the radio on the stage is larger than first built, and the panel is 16 rem wide below 1800 px so it stands clear of the radio.

**Checked by tests only:** the signed-in wiring in `App.tsx` (the typed-line seam, the voice feed and its reset), the celebration in the real lab, the ducking, and the phrase from a real spoken transcript.

**Not checked at all:** a live call and a signed-in typed turn with the radio on. Both need a paid model call.

**Checks on the lane, Nov 13:** lint, typecheck and the production build pass; 625 test files, 5,066 tests pass and 23 fail as expected. three.js stays in one async chunk, out of the lab's first load.
