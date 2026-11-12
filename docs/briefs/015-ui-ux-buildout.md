# Brief 015: the whole interface

Franki's interface is finished here, ahead of the server features that will feed it. Three things are built: a front door at `/` that shows the product working on a sample month, the lab at `/lab` dressed as a real laboratory at night, and every surface drawn to the level the design direction describes. A small lab spider replaces the pointer.

This work is designed, built and reviewed by Claude Code agents, on the branch `build/ui-ux`, cut from `build/voice-control`. Kiro takes no part in it.

Read first:

- `docs/design/ui-direction.md`, in full. It was amended for this brief: principle 11, "Materials", "The lab scenery", "The cursor", "The front door", and the display type.
- `.kiro/steering/ui-design.md`.
- `apps/web/src/ui/copy-landing.ts` and `apps/web/src/ui/landing/steps.ts`. Both are written and frozen.
- The section of this brief for your package, and "Rules for every package".

## What a visitor should experience

- At `/`, a dark lab. Franki sleeps on the right, then wakes with a strike of lightning and watches the spider that is now their pointer. As they scroll, the page tells one story on the left while the real surfaces act it out on the right: the strip fills, a card rises, Franki thinks, speaks, waits for a yes, and celebrates "$71, down from $186". Then the jar opens, a memory is forgotten and a receipt prints. Below: six house rules, the anatomy of the build, and a brass knife switch that opens the lab.
- At `/lab`, the same room from the inside: blueprint scenery in the dark, Franki larger than before, brass controls that feel like metal, glass cards, and nothing on screen that isn't true.
- Everywhere: the spider walks, glows nowhere, and gets out of the way of text. Reduced motion, touch and keyboard users lose nothing.

## Rules for every package

1. **Own your files.** Each package lists the files it owns. Create and edit only those. If you need a change in a file you don't own, don't make it: say so in your report. Frozen for everyone after the foundation: `globals.css` (except where a package says otherwise), `ui/motion.ts`, `ui/copy.ts`, `ui/copy-landing.ts`, `ui/landing/steps.ts`, `ui/surface-props.ts`, `app/layout.tsx`, `app/specimens/page.dev.tsx`, `app/specimens/_sections/SurfaceSections.tsx`, `app/specimens/_fixtures/`, `app/specimens/specimens.test.tsx`, `scripts/`.
2. **Tokens only.** No raw hex, no literal durations in `transition` or `animation`, no numeric `duration:` or `delay:` in motion props, no Tailwind default palette. Colours come from the 14 tokens; no new colour token. Times come from `DUR`, `SPRING`, `STAGGER`, `EVENT_MS` in `ui/motion.ts`, or from the `--dur-*` variables in CSS. `node scripts/token-check.mjs` must stay clean for your files.
3. **Materials.** Use `mat-blueprint`, `mat-glass`, `mat-brass`, `mat-paper`, `mat-gold` and the parts in `components/lab/`. Don't hand-mix a new panel or metal. Brass is only for things you can touch. Gold is only for a win. Ecto glow is only for presence. Electricity is only for work happening now, and every electric effect asks `electricityBudget` first and releases its grant on every exit.
4. **Motion is ghost physics.** Things rise, float and settle on the three springs. Nothing slides in on a straight line, nothing bounces like a toy, nothing hijacks scroll. Only `transform` and `opacity` change every frame. Loops are CSS, run only under `prefers-reduced-motion: no-preference`, stop under `[data-reduced="true"]`, and pause under `[data-paused="true"]`. Every moving thing has a reduced-motion form that is a plain fade or nothing.
5. **Time.** Animation time comes from `requestAnimationFrame` timestamps, CSS and `motion`. No `Date.now()`, no empty `new Date()`, no `performance.now()` in `components/` or `ui/`.
6. **three.js.** Nothing outside `components/avatar/three/` value-imports from it or from `three`. Show Franki only through `<Avatar>`.
7. **Copy.** Front-door strings come from `ui/copy-landing.ts`; lab strings from `ui/copy.ts`. If you need a string that isn't there, put it in a `const` at the top of your component and list it in your report. Sentence case. Never "because", "caused", "thanks to", "led to", "won back". Never the exact words "Built with Kiro" outside the footer: a test counts them. Never "safe" about food. Never another company's product name.
8. **Sample data** appears only on the front door, under the "Sample data" plate. Nothing reachable from `app/lab/page.tsx` may import `components/landing/` or `ui/landing/`.
9. **Accessibility.** Every control: keyboard reachable in DOM order, a visible focus ring (`FOCUS`), a 44 px target (`TARGET`), an accessible name. Decoration is `aria-hidden` and takes no pointer events. Text pairings meet WCAG AA; `stitch` is never text that must be read and never the only edge of a control. One `h1` per page.
10. **Tests.** Tests run in node with `renderToStaticMarkup`; there is no DOM. Put pure logic in `ui/` and test it there, with a property test where a rule should hold for every input. Keep every existing behavioural assertion. Where this brief deliberately changes a look that a test pins by class name, update that pin and list it in your report. Never delete an assertion to get green. Tests make no network call.
11. **Don't run** `git` commands that change anything, `next build`, `next dev`, `next typegen`, or `npm install`. No new dependency. The orchestrator commits, builds and looks at the screen.
12. **Check your work,** narrowest first, from the repo root: `npx vitest run <your test files>`; `node scripts/token-check.mjs`; `node scripts/copy-check.mjs`; `node scripts/ui-boundaries.mjs`; `npx vitest run scripts/clock-guard.test.ts`; `npx tsc --noEmit -p apps/web/tsconfig.json`; `npx eslint <your files>` from `apps/web`. Other packages are being built in the same tree at the same time, so these may report files that aren't yours. Fix only yours, and say what you saw.
13. **Report** as the last thing you write: files created and changed; each check you ran with its result; test pins you changed and why; strings you added locally; anything in the brief you did differently and why; anything you could not verify without a screen; changes you need in files you don't own.

## Shared pieces (built by the foundation, used by everyone)

- **Routes.** `/` renders `<Landing />` from `components/landing/Landing.tsx`. `/lab` renders `<App />`.
- **Tokens added to `@theme static`:** `--font-display`, `--text-title`, `--text-hero`, `--radius-frame` (28 px), `--shadow-gold-glow`, `--shadow-glass`, `--dur-drift` (9000 ms, slow ambient loops), `--dur-current` (1600 ms, a pulse travelling a wire). Utilities: `font-display`, `text-title`, `text-hero`, `rounded-frame`, `shadow-gold-glow`, `shadow-glass`.
- **Materials** in `components/lab/materials.css`, as Tailwind `@utility` rules.
- **Parts** in `components/lab/`: `Rivet`, `Plate`, `Lamp`, `FigLabel`.
- **One CSS file per package,** created empty and imported by `globals.css`: `components/cursor/cursor.css`, `components/scenery/scenery.css`, `components/surfaces/cards.css`, `components/surfaces/memory.css`, `components/surfaces/instruments.css`, `components/surfaces/controls.css`, `components/screen/screen.css`, `components/landing/landing.css`, `components/landing/stage.css`, `components/landing/lower.css`, `components/system/system.css`. Keyframes and loops for your package go in your file.
- **Stubs** with their final props, so every package compiles alone: `components/cursor/SpiderCursor.tsx`, `components/cursor/SpiderToggle.tsx`, `components/landing/DemoStage.tsx`, `HouseRules.tsx`, `Build.tsx`, `Switch.tsx`, and the rest of the landing files.
- **`AvatarInput.attend?: "camera" | "pointer"`** in `ui/avatar/types.ts`. Absent means camera.

## Packages

### F0. Foundation (runs first, alone)

Owns, for this run only: `apps/web/src/app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/lab/page.tsx`, `ui/motion.ts`, `ui/copy.ts`, `ui/contrast.ts` and its test, `ui/avatar/types.ts`, `components/lab/**`, `components/Footer.tsx` and its test, every stub and empty CSS file named above, `scripts/ui-boundaries.mjs`, `scripts/three-chunk-check.mjs` and their tests, `app/specimens/_sections/MaterialsSection.tsx`, `.kiro/specs/lab-ui-foundation/requirements.md` (one note only).

1. **Routes.** Move the app to `app/lab/page.tsx`. `app/page.tsx` renders `<Landing />`. Give each page its own `metadata` title. Read `node_modules/next/dist/docs/` for anything you're unsure of in this version of Next.js.
2. **Guards follow the move.** In `scripts/ui-boundaries.mjs`: add `app/lab/page.tsx` to the entry points, and add a rule that nothing reachable from `app/lab/page.tsx` lives under `components/landing/` or `ui/landing/` (with a test). In `scripts/three-chunk-check.mjs`: check the first load of both `/` and `/lab` (with tests). Update `Footer.test.tsx` so it covers the home page and the lab page, and mock the new font.
3. **Tokens, type and base.** Add the tokens listed above. Load Fraunces with `next/font/google` (variable weight, axes `SOFT`, `WONK`, `opsz`, variable `--font-fraunces`) beside the Geist fonts. Add base rules: `color-scheme: dark`; a `::selection` in ecto at low opacity with `ink` text; a thin scrollbar with a `stitch` track and a `brass` thumb; smooth anchor scrolling only under `no-preference`; `scroll-padding-top` for the front door's bar; `.font-display` variation settings (`"SOFT" 100`, `"WONK" 0`, optical size auto). Keep everything `scripts/token-sync.test.ts` and `scripts/ui-steering.test.ts` check.
4. **Materials and parts,** as "Materials" in the direction describes, with a `MaterialsSection` specimen showing each material and part. Each part is small: `Rivet` (decorative, `aria-hidden`), `Plate` (`children`, optional `tone: "brass" | "gold"`), `Lamp` (`on: boolean`, with an sr-only state word), `FigLabel` (`n: string`, `children`, optional `side`).
5. **Copy.** Add to `COPY` in `ui/copy.ts`: `cursor: { toggle: "Lab spider" }`; `company: { walkedIn: "Someone walked in", alone: "We're alone" }`; `forgetLast: "Forget last thing"`; `auth.about: "About Franki"`; `card.rows: "Rows behind this number"`, `card.total: "Total"`, `card.when: "When"`, `card.what: "What"`, `card.amount: "Amount"`; `sheet.confirmRule: "Tap again to remove this rule"`; `lab.on: "Counting"`, `lab.off: "No counts yet"`.
6. **Contrast.** Add pairings for `night-0` text on `spark`, on `gold` and on `brass-hi`.
7. **Stubs and CSS files,** as listed under "Shared pieces". `Landing.tsx` composes the stubs in page order so the page renders and its tests pass. The layout mounts `<SpiderCursor />` once. The footer renders `<SpiderToggle />` beside its text.
8. **Spec note.** In `.kiro/specs/lab-ui-foundation/requirements.md`, add one line to the `Main_Screen` glossary entry: since brief 015 it is served at `/lab`, and `/` is the front door.

Done when `npm test`, `npm run lint` and `npm run typecheck` exit 0.

### A. The lab spider

Owns: `components/cursor/**`, `ui/cursor/**`.

Build "The cursor" from the direction. The numbers:

- **Body.** About 14 px long. A round head (r 3.2) and an oval abdomen behind it (4.6 by 5.6), filled `ghost`, with a 1 px `night-0` edge at 60% so it reads on glass and on paper. Three tiny cross-ticks on the abdomen, in `night-0`: the stitch. Two `night-0` eyes (r 0.8). The pointer's hot spot is the centre of the head.
- **Legs.** Four each side, in `ghost-deep`, 1.2 px, round caps. Upper segment 7 px, lower 9 px, joined by a two-bone solve with the knee bent up and out. Rest feet sit at about 35°, 70°, 110° and 145° from the heading, 13 to 15 px out.
- **Gait.** A foot stays planted in viewport space. It steps when it is more than 7 px from its rest point, or the leg would stretch past 15.5 px. Two groups (L1 R2 L3 R4, and R1 L2 R3 L4); a group starts only when the other is planted. A step takes 80 ms of frame time and lands ahead of the rest point by the pointer's velocity, clamped to 6 px. Above about 1.6 px per ms both groups may step, half a phase apart, at 50 ms. The heading follows the direction of travel through a low-pass of about 90 ms and holds when the pointer is nearly still.
- **Touchable.** Over `a`, `button`, `summary`, `label`, `select`, `[role=button]`, `[role=switch]`, `[role=link]`, `[role=radio]`, checkboxes, radios and `[data-touch]`, when not disabled: a 30 px `brass` ring (1.5 px) grows from 60% on `spring.settle`, and the front legs lift.
- **Text.** Over text inputs, textareas and `contenteditable`: the native text cursor shows, the spider moves 14 px down and right, tucks its legs and drops to 70% opacity.
- **Press and web.** On press the legs pull in to 72% and the body to 92%. On release, a web at the click point: six 11 px spokes and two rings (r 5 and 9), `ink-dim` at 55%, 0.8 px. It grows from 50% over `dur.quick` and fades over `dur.ritual`. At most three.
- **Rest.** After 2000 ms of frame time without movement, the body lowers 10 px on `spring.float` on a 46 px thread that fades upward, and sways ±4° on the float loop.
- **Switching on.** Only with `(hover: hover) and (pointer: fine)`, motion allowed, and the preference on. The native cursor is hidden only after the first pointer move, by setting `data-spider="on"` on `<html>`; the CSS that hides it lives in `cursor.css`. Mouse and pen only. Nothing is rendered on the server.
- **Structure.** The gait, the leg solve and the heading filter are pure, in `ui/cursor/`, with unit and property tests: feet never leave their reach, the two groups never swing together below the gallop speed, the same input sequence gives the same output. The component writes transforms straight to the DOM from one frame loop, without a React render per move, and stops when the tab is hidden.
- **The toggle.** `SpiderToggle`: a `role="switch"` labelled `COPY.cursor.toggle`, default on, remembered in `localStorage` the way `ui/sound/preference.ts` remembers sound. It shows nothing on devices where the spider can't run.

### B. The lab scenery

Owns: `components/screen/Backdrop.tsx`, a new `Backdrop.test.tsx`, `components/scenery/**`.

Build "The lab scenery" from the direction as one SVG layer inside the backdrop, above the grid and under the vignette. Keep `data-backdrop` and the three `data-layer` textures as they are.

- Draw it like a technical drawing: thin construction lines, centre marks, dimension ticks, a little hatching on the bench. Jars have lids; the flask is round-bottomed; the Jacob's ladder is two diverging rods on a base, with no arcs; the coil is stacked ellipses; cables are catenaries with small insulator discs; the cobweb is a quarter web with five threads and four scalloped rings.
- One 1440 by 900 drawing, `preserveAspectRatio="xMidYMax slice"`, `vector-effect: non-scaling-stroke`. Groups carry `data-scenery="shelf|bench|cables|web|floor|slab|figs"`. Near things at up to 55% opacity, far things at about 30%.
- `Backdrop` takes `variant?: "lab" | "door"`. `"lab"` is the default and the full room. `"door"` keeps only the cables, the web, the floor line and one fig label, so it sits quietly behind a page of text.
- Parallax in two depths (3 px and 6 px) against the pointer, through motion values on `spring.float`, with no React render per move. Off under reduced motion. No listener while the tab is hidden.
- Below 1024 px drop the shelf and the bench. Below 640 px keep only the floor and the slab.

### C. Cards and small surfaces

Owns: `components/surfaces/Card.tsx`, `CardDock.tsx`, `Chips.tsx`, `Seal.tsx`, `Seam.tsx`, `TimeBadge.tsx`, `Captions.tsx`, their tests, a new `SourceRows.tsx` with its test, `components/surfaces/cards.css`, `app/specimens/_sections/CardExtrasSection.tsx`.

- **Card.** `mat-glass`, the seam at the top, and an identity for each kind: a 16 px line glyph beside the title (source: two joined terminals; approval: a switch; food: a fork; ask: a question mark in a ring; read: three lines). An approval card has four corner rivets and its Yes is `mat-brass`. Figures: label in mono 12 `ink-dim`, value in mono 28, the source tag beside it. A card lifts 2 px on hover on `spring.press`.
- **Source rows.** `Card` accepts an optional `sourceRows?: Record<string, SourceRow[]>` (declare the type in `SourceRows.tsx`: `{ id, when, what, amount }`). Tapping a source tag opens that source's rows inside the card, and still calls `onOpenSource`. `SourceRows` is a real table in mono with a caption for screen readers, headed When, What, Amount, with a total row; rows materialize on `STAGGER`.
- **Card dock.** Cards enter from Franki's side by materializing, and leave by dematerializing (wrap them in `AnimatePresence`). Cards behind the first stay glass shells.
- **Chips.** Glass capsules with the stitched inner outline. On hover the stitches run (a dash-offset loop on `--dur-base`); on press they settle 3% smaller on `spring.press`; they enter on `STAGGER`.
- **Seal.** An embossed brass disc: `mat-brass`, a scalloped edge, an inner ring, the lock.
- **Time badge.** A brass plate with the bolt, using `Plate`.
- **Captions.** Unchanged in behaviour; bring the toggle onto the shared class recipes.
- A `CardExtrasSection` specimen shows a card with its rows open (rows: $30, $28, $34, $34, $24, $36; total $186).

### D. Strip, jar and What I know

Owns: `components/surfaces/Strip.tsx`, `Jar.tsx`, `WhatIKnowSheet.tsx`, their tests, `components/surfaces/memory.css`, `app/specimens/_sections/MemoryExtrasSection.tsx`.

- **Strip.** Terminals become binding posts: at rest a 14 px ring in `ink-dim`; filled, an `ecto` core with the ecto glow; the fifth, filled, is `mat-gold` and gives one burst of six short rays when it fills. The wire's track is a dashed `stitch` line; the filled part is solid `ecto`. While the loop is open and not complete, one soft `ecto` pulse travels the newest filled segment on `--dur-current`. Labels in mono 12, the newest in `ink`, the rest in `ink-dim`. Keep the across and column layouts and every data attribute.
- **Jar.** A proper specimen jar: a body gradient, two rim highlights, a curved meniscus, a faint refraction band, an inner shadow at the base. Motes glow softly (one blurred copy of the mote group at low opacity) and twinkle. The lid is brass with knurl lines and two rivets; the plate is engraved. On hover the lid lifts 2 px and the motes brighten. Optional local props `arrivingIds` and `leavingIds` make those motes materialize or dematerialize. Keep every `data-jar-part`, mote attribute and exported constant.
- **What I know.** Add `presentation?: "inline" | "sheet"` (default `"inline"`, which keeps today's markup). As a sheet it is modal: `aria-modal`, focus moves to the heading on open and back on close, focus stays inside, Escape closes; from 1024 px it is a drawer on the right (max 420 px), below that a bottom sheet (max 80svh, scrolling inside). Each group has a small line glyph and a seam. An item is a specimen tag: text in 16, "From …" in mono 12, then the three quiet actions. Guesses keep the dashed outline and the "Guessed" tag. Hard rules sit first under the seal, and their Forget needs a second tap: the first turns the button into `COPY.sheet.confirmRule` until it loses focus. Items leave by dematerializing.

### E. The Lab panel, odometer and receipt

Owns: `components/surfaces/Lab.tsx`, `Odometer.tsx`, `Receipt.tsx`, their tests, `components/surfaces/instruments.css`, `app/specimens/_sections/InstrumentExtrasSection.tsx`.

- **Lab.** An instrument panel: `mat-glass` with four corner rivets; a top bezel carrying a `Plate` reading "The Lab" and a `Lamp` (on when any counter has a value, with `COPY.lab.on` and `COPY.lab.off` for screen readers). Each counter is a row: the label in 14 `ink-dim`, then an odometer in a dark inset well. The limits fold keeps `<details>`; its chevron turns on open, and the lines are 14 `ink-dim`. An optional local prop `receipt?: ReactNode` draws a slot along the top edge that the receipt prints out of.
- **Odometer.** One drum per digit. Each digit column rolls by itself on `spring.settle`; separators stand still; width never changes. A null value is a blank drum showing `—`, never `0`. Reduced motion swaps without rolling. Keep `formatCount` and `data-odometer`.
- **Receipt.** `mat-paper`: perforated top and bottom edges (a mask of scallops), mono `night-0` text, dashed rules, drawn ticks, a small seal on the "Kept" line. It prints upward in eight steps over `dur.ritual`, like a slip feeding out of a slot. Keep every pinned line and attribute.
- An `InstrumentExtrasSection` specimen shows the Lab with a receipt printing from its slot, and an odometer stepping through values.

### F. The lab's shell and controls

Owns: `components/screen/MainScreen.tsx` and its test, `components/screen/screen.css`, `components/avatar/Stage.tsx`, `components/CallScreen.tsx` and its tests, `TypedLine.tsx`, `SoundToggle.tsx`, `AuthPanel.tsx`, `ReplyLine.tsx`, `Footer.tsx`, `components/surfaces/Wordmark.tsx`, their tests, `components/App.test.tsx`, and in `globals.css` only the rules about the stage and the signed-out mask.

Read the notes on what must not move in `App.tsx` and `CallScreen.tsx` before you start (the orchestrator gives you the file). Change looks, never controllers, effects, keys or the order of slots.

- **Stage.** Width `clamp(240px, 34vh, 340px)`. The halo and floor scale with it. Recompute the signed-out canvas mask so the wordmark stays clear at every size in that range, and say how you computed it.
- **Header.** A slim rail: the wordmark with a small brass bolt, the time-badge slot, then the sound toggle, the email in mono 12 and Sign out. A seam under it that fades at both ends.
- **Call button.** Keep the 64 px core and its classes. Add a knurled brass bezel around it (a ring of fine ticks). On hover the bezel turns slowly; on press the core sinks 2 px and the existing ring spark runs. The hang-up form keeps its squared ember core inside a squared bezel. Signed out, the bezel is dim and the core dark. The status line under it is mono 12.
- **Mute.** A brass toggle with a microphone glyph; muted, the glyph is struck through.
- **Typed line.** Collapsed: a quiet keyboard glyph. Open: one glass capsule with the stitched inner outline and a brass Send; it materializes.
- **Reply line.** One glass capsule with a small ghost glyph.
- **Auth panel.** The sign-in button is large `mat-brass` with a bolt glyph. Under it, signed out, a quiet link `COPY.auth.about` to `/`.
- **Footer.** A seam, then the footer text exactly once, then the spider toggle. Keep `data-testid="built-with-kiro"`.
- **Main screen.** Use `<Backdrop />` as it is. Keep the grid, the glide wrappers and every slot.

### G. Franki follows the pointer

Owns: `ui/avatar/**` (except the `attend` field's declaration, which exists), `components/avatar/**` except `Stage.tsx`.

When `input.attend === "pointer"`, the look is Listening, and no event is showing, Franki's eyes and head follow the pointer the way the idle pose already does, returning to the camera when the pointer has been still for 2.5 s. Every other look is unchanged, and without `attend` nothing changes at all. The rig is a checked port: follow its existing convention for marking a deliberate difference, and keep its diff check passing. Add unit and property tests for the acting. The SVG ghost has no pointer input; leave it and say so.

### H1. The front door: page, bar, rail, hero, story

Owns: `components/landing/Landing.tsx`, `TopBar.tsx`, `Rail.tsx`, `Hero.tsx`, `Story.tsx`, `components/landing/landing.css`, `ui/landing/scroll-step.ts`, tests for all of them.

- **Grid.** From 1024 px: two columns. The left holds the hero block, then one block per step, with a section intro before the first loop step and the first memory step. The right holds the stage, spanning every row, sticky under the bar, as tall as the viewport minus the bar. Below 1024 px: one column; the stage comes right after the hero block and sticks under the bar at 44svh, and each story block has a `night-0` ground so text passes cleanly beneath it.
- **Step.** `ui/landing/scroll-step.ts` is pure: given each block's top and height and the viewport, it returns the step whose centre is nearest 55% of the viewport height; `hero` at the top of the page. The page measures on scroll and resize inside one frame callback and holds `step` in state. `onYes` scrolls the `yes` block to the centre (smooth only when motion is allowed). The toy state lives here too.
- **Blocks.** Each step block is about one viewport tall from 1024 px (85svh) and 70svh below. Kicker in mono 12 `brass`; title in `font-display` at 44; body in 20 `ink-dim`, at most 30rem wide; `says` as a quote with a stitched left edge; `hint` in mono 12. The active block is full strength, the others at 35%.
- **Hero.** The eyebrow, then the one `h1` in `font-display text-hero`, its words materializing on `STAGGER`. The word "stitched" is italic, and a stitched underline draws itself under it. Then the lede, the brass "Wake Franki" link to `/lab`, the quiet "Watch a loop close" link to `#loop`, and a fig label with `hero.scroll`.
- **Bar.** Fixed, 64 px (56 below 768). Clear at the top of the page; `mat-glass` with a seam once the page has scrolled 24 px. The wordmark links to the top; the four section links show from 768 px; a small brass "Wake Franki" on the right; a skip link first.
- **Rail.** Fixed at the left from 1024 px, 56vh tall, centred. A dashed `stitch` track, an `ecto` fill scaled by scroll progress through `useScroll` and a spring, and six terminals that are links with 44 px targets; the label shows for the active one and on hover or focus. The last terminal is `mat-gold` once the switch is thrown. Below 1024 px the rail becomes a 2 px progress line under the bar.
- The page reads completely with scripting off: every word is in the HTML, and the stage shows Franki asleep.

### H2. The front door: the stage

Owns: `components/landing/DemoStage.tsx`, `DemoAvatar.tsx`, `StateToy.tsx`, `StageFrame.tsx`, `components/landing/stage.css`, `ui/landing/stage-script.ts`, `ui/landing/sample.ts`, `ui/landing/demo-voice.ts`, tests for all of them.

- **Script.** `stageFor(step, toy)` is pure and returns everything the stage shows: Franki's state, mute, event, whether Franki is speaking and where Franki looks; the strip; the tags; the cards; the line being said; the jar, the Lab, the sheet, the forgotten item, the receipt; the toy; the fig label; the plate. It follows the table in "The front door". Test it for every step, and as properties: the strip never goes backwards through the loop; the plate shows whenever any sample datum shows; the receipt shows only at `forget`.
- **Sample data** in `ui/landing/sample.ts`: the source card "Takeout nights" ("Mostly on nights with meetings after 6.", "This month" $186 from "Bank · 6 purchases", "Late meetings" 4 from "Calendar · 4 meetings", rows $30, $28, $34, $34, $24, $36); the approval card "Three quick dinners" ("I'll plan three quick dinners for your late-meeting nights and add the groceries to your list."); the read card "Your list" (a short grocery list); the result card "Three weeks on" ("$71, down from $186 over the same three weeks.", figure "$115 less"); strip result "$115 less"; the known items (the hard rule "You: no shellfish"; "Late meetings on Thursdays" from Calendar; "You like spicy food", guessed from orders; "Takeout runs high on late-meeting nights" from Bank and Calendar; "Your brother is having a hard time", which is the one forgotten); Lab counters Read emails 128, Guessed private things 3, Said `null`; the receipt (blocked, cleaned, kept one safety rule, touched one conversation turn and one memory).
- **Franki.** One `<Avatar>` for the whole page, in a box `clamp(200px, 46cqw, 420px)` wide, never inside `<Stage>` and never under `data-screen`. Drive it from the script with the existing pure event reducer on a frame clock. The wake fires once the three.js layer reports it is showing, or at once on the SVG ghost; under reduced motion Franki is simply awake. After the wake, Listening with `attend: "pointer"`. Celebrate goes to no event first so it replays on re-entry.
- **Voice.** While the script says Franki is speaking, give the avatar an `AvatarAudioSource` through `AvatarAudioContext`: a small pure generator in `ui/landing/demo-voice.ts` (a syllable envelope over a harmonic stack, advanced by `dt`, filling the time and dB buffers as the contract describes). Franki speaks for about as long as the sentence takes to say, then listens. Don't import anything from `app/specimens/`.
- **Layout,** by container query on the stage box. With nothing else showing, Franki is centred and large. With equipment showing, Franki settles left and smaller on `spring.settle`, the strip runs across the top, the dock sits on the right, the jar bottom left, the Lab bottom right. In a narrow box the card rises over the lower half and Franki moves up. `StageFrame` draws the chrome that appears with the equipment: a `rounded-frame` edge, blueprint corner ticks, the fig label, and the "Sample data" `Plate`.
- **Tags.** At `noticed` and `connected`, the two source tags float beside Franki; at `connected` a stitched wire draws between them.
- **What works.** Yes on the approval card calls `onYes`. The four toy chips are a radio group. Everything else on the stage is `inert`. The stage is a `<section>` labelled `stage.label`, with no live region.
- On the server the stage renders Franki asleep and no sample data.

### I. The front door: house rules, the build, the switch

Owns: `components/landing/HouseRules.tsx`, `Build.tsx`, `Anatomy.tsx`, `Switch.tsx`, `components/landing/lower.css`, tests for all of them.

- **House rules.** Six plaques, three by two (two by three from 640 px, one column below). Each is `mat-glass` with four rivets, a number `Plate` ("01"), a blueprint line glyph for its rule, the title in 20 and the body in 16 `ink-dim`. They materialize on `STAGGER` once, on entering view. On hover a plaque lifts 2 px and its glyph turns from `stitch` to `brass-hi`.
- **The build.** The word `FRANKIROCKS` in large mono, as a paragraph with an `aria-label` (the page's only `h1` is the hero's), using the exported `SIGNED_OUT_WORD` and `LIT` from the wordmark: K-I-R-O turn gold once when it enters view. Then the section title and body. Then `Anatomy`: a blueprint drawing of Franki from the front (the body outline with its three-lobe hem, the flat-top hair, two bolts, the stitch, the eyes) with four callouts on leader lines: Skeleton to the centre line, Brain to the head, Reflexes to the bolts, Immune system to the body's edge. Each callout has a fig label, the part in `font-display` 28, the feature in mono 12 `brass`, and one line of body. As a callout enters view its leader line draws and its part of the drawing turns from `stitch` to `ecto` linework. Below 1024 px the drawing sits above the callouts.
- **The switch.** A brass knife switch about 220 px tall: a glass base plate with rivets, two brass contact clips, a brass blade pivoting at the bottom, a dark handle at the top, resting open at about 38°. It is a `<button>` named `wake.lever`. A click, Enter or Space throws it; dragging the handle moves the blade with the pointer, and letting go past halfway throws it, otherwise it settles back. When the blade meets the clips: ask the electricity budget for one spark across the contacts (about 600 ms of frame time), call `onThrown` once, then go to `href` with the router. Under reduced motion it goes at once. Under it, the signature line, a plain link `wake.walkIn` to `href` that works with scripting off, and the note. The blade settles without overshoot.

### J. Empty room and blown fuse

Owns: `app/not-found.tsx`, `app/error.tsx`, `app/icon.svg`, `app/manifest.ts`, `components/system/**`.

- **404.** The title in `font-display`; a blueprint drawing of the empty slab with a dashed outline where Franki would float, and a fig label; a brass link to `/` and a quiet link to `/lab`.
- **Error.** A client component. The title in `font-display`; a blueprint fuse with its break drawn in `ember`; a brass button that calls `reset()`, and a quiet link to `/`.
- **Icon.** `app/icon.svg`: Franki's head, drawn fresh from the look in the direction, readable at 16 px. This one file may use the token hex values directly.
- **Manifest.** Name, short name, colours from the tokens, the icon.
- Both pages use `<Backdrop variant="door" />` and render the footer through the root layout only.

### K. Two lab controls

Owns: `components/surfaces/CompanyToggle.tsx`, `ForgetLast.tsx`, their tests, `components/surfaces/controls.css`, `app/specimens/_sections/ControlsSection.tsx`.

- **Company toggle.** Props `{ company: boolean; disabled?: boolean; onChange(next: boolean): void }`. A `role="switch"`. Off: a brass-edged capsule with a small door glyph, reading `COPY.company.walkedIn`. On: filled `mat-brass` with a drawn curtain glyph, reading `COPY.company.alone`.
- **Forget last.** Props `{ available: boolean; pending?: boolean; onForget(): void }`. Nothing when not available. A quiet capsule reading `COPY.forgetLast` with a small glyph of a mote dissolving; while pending it is disabled and shows a `Lamp`.
- Neither is mounted on the main screen yet: nothing feeds them. A `ControlsSection` specimen shows each state.

## Out of scope

`packages/core`, `packages/server`, `functions`, every API route, the voice client and its controllers, wiring any surface to server data, new avatar art.

## Report

`docs/briefs/015-report.md` after the build: what was built and where, what was checked on a screen and what wasn't, test pins that changed, and what each surface still needs from the server.

## Checks before the work is done

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0.
