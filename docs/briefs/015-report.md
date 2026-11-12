# Brief 015 report: the UI and UX buildout

Built on `build/ui-ux` by Claude Code agents, from `docs/briefs/015-ui-ux-buildout.md`. One agent directed, reviewed and checked the pages on screen; the code was written by builder agents, one per package, each in its own files. None of this is Kiro's work: no commit in this brief carries the Kiro trailer.

**State:** every package in the brief is built and committed, in 23 commits from `732b71a` to `0844f5b` (187 files, about 17,650 lines added). `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0 (see Checks). The pages were looked at in a browser at 1440x900, 1280x720, 1024x768, 800x500 and 375x812. **No live call was made on this line**, reduced motion was not looked at on screen, and nothing was pushed or deployed.

The app moved: the lab is at `/lab`, and `/` is the front door.

## What was built, and where

| Package | What | Where | Commit |
|---|---|---|---|
| Direction | Principle 11 ("Blueprint until it's true"), materials, scenery, cursor, the front door, new tokens | `docs/design/ui-direction.md`, `.kiro/steering/ui-design.md` | `732b71a` |
| F0 Foundation | `/lab` route, Fraunces, materials and parts, new tokens, the landing-only boundary rule, stubs and frozen contracts | `app/`, `components/lab/`, `ui/landing/steps.ts`, `ui/copy-landing.ts`, `scripts/ui-boundaries.mjs`, `scripts/three-chunk-check.mjs` | `9ba1ffb` |
| A Spider | The pointer as a small lab spider on eight solved legs, with a footer toggle | `components/cursor/`, `ui/cursor/` | `2a4e33d` |
| B Scenery | Blueprint linework behind the lab, and a quieter front-door variant | `components/scenery/`, `components/screen/Backdrop.tsx` | `a38d3e9` |
| C Cards | Glass cards with a glyph per kind, source rows, the dock's enter and exit, chips, seal, time badge, captions | `components/surfaces/` (cards) | `d07684f` |
| D Memory | Strip, jar, What I know | `components/surfaces/` (memory) | `9a05ea9` |
| E Instruments | The Lab panel, the odometer, the printing receipt | `components/surfaces/` (instruments), `ui/instruments/` | `d431434` |
| F Shell | Stage, header rail, call button, mute, typed and reply lines, sign-in, footer | `components/`, `components/screen/` | `225d27e` |
| G Gaze | Eyes follow the pointer when `attend: "pointer"` is passed | `components/avatar/`, `ui/avatar/` | `d008fd0` |
| H1 Door page | Page, top bar, rail, hero, scroll story | `components/landing/` | `6af7e7f` |
| H2 Door stage | One Franki acting each step on sample data, under a "Sample data" plate | `components/landing/`, `ui/landing/` | `af1c2d4` |
| I Door, lower | House rules, the anatomy of the build, the knife switch | `components/landing/`, `ui/landing/` | `8ff3c10` |
| J System pages | 404, error page, icon, manifest | `app/`, `components/system/` | `33504df`, `606cbce` |
| K Controls | Company toggle and forget-last, as components with specimens | `components/surfaces/` | `747f984` |
| Integration | Machine index rows and two pages, specimens registration, pure modules, shared strings, the dock's exit (`ui/dock-layout.ts`) | `docs/machines/`, `scripts/`, `ui/` | `ad242ba` |
| Screen fixes | See the next section | | `62b3482`, `14fb921` to `0844f5b` |

Each package was built, reviewed by a second agent told to find faults, and fixed, before it was committed.

## Found on screen, and fixed

1. On the `noticed` and `connected` steps Franki sat in the stage's top right corner under the source tags: a narrow-stage rule applied at every width. (`62b3482`)
2. On phones and tablets Franki's stage started below the fold. The stage is now drawn above the hero text below `lg`. (`14fb921`)
3. From `lg` the stage frame's bottom edge sat on the window's edge. It is inset by 1rem. (`14fb921`)
4. The hero showed two "FIG. 1" labels, and on `suggested` Franki's line was printed in both the story and the stage. (`14fb921`)
5. In What I know, an item's three actions wrapped onto two rows at 343 px, and a hard rule's onto three, so the sheet was about twice as tall as it should be and was cut off at the top on the front door's stage. (`d596c42`, `2644790`)
6. The knife switch was a 220 px box on a 1440 px page. It grows to 320 px from `lg`. (`a8f550f`)
7. The mains label sat under the front door's top bar and on the lab's header rail. (`eadd602`)

## Looked at on screen

- **Front door, 1440x900:** the hero's entrance; all eleven steps of the story; the state picker (thinking, muted, celebrate); tapping Yes on the approval card; house rules; the anatomy; the switch thrown by click, which opens `/lab`; keyboard order and focus rings.
- **Front door, 1280x720 and 800x500:** the hero, `suggested` and `forget`.
- **Front door, 375x812:** the hero and seven of the steps.
- **Lab, signed out:** 1440x900, 1024x768, 375x812.
- **Specimens:** main screen with and without a card (the dock's exit holds the column until the card has gone), materials and parts, cards, strip, jar, What I know, the Lab and receipt, lab controls.
- **404 page**, and the spider following the pointer at 1:1.

## Not looked at on screen

- A live call in the new shell, signed in: microphone reactivity, frame rate, the three.js avatar during speech.
- Reduced motion, on any page.
- The error page (it shares its layout with the 404 page).
- Dragging the switch, as opposed to clicking it.
- Safari and Firefox. Everything above was Chromium.
- The spider at fast pointer speeds, over modals, and its brass ring on controls.
- The sheet as a modal: focus trap, Escape, the two-tap removal of a hard rule.
- The lab with real cards, a printing receipt and the typed line all present at once below about 1136 px wide.
- The icon at 16 px.

## Kept as built, where it differs from the brief

- The rail's active label shows from 1400 px, not `lg`: below that it would sit on the story column.
- The error page calls `retry()`: that is the prop this Next.js version passes.
- The company toggle's accessible name is "Company mode: " plus its label.
- Scenery labels are SVG text, so they scale with the drawing; the front door draws no mains label.
- The front door's sheet stays inline in the stage (no modal trap), and its sample month keeps four known things.
- The pointer-follow gaze has no blink on its first glance.
- `heading.ts` holds two filters, not a machine; its functions are named `smoothVelocity` and `smoothHeading` so the machine detector reads them as such.

The builders' own lists of smaller choices are in the commit bodies.

## Test pins changed

- **Backdrop:** the door expects no figure labels; the lab expects "FIG. 1 · the mains".
- **Seal, Strip, TimeBadge, CompanyToggle:** colour classes became material classes (`mat-brass`, `mat-gold`, `mat-glass`).
- **Chips:** the dashed border became an SVG stitch, since a border cannot animate.
- **CardDock, Lab:** rewritten for per-card source rows and the receipt slot.
- **Footer, sign-in, MainScreen stage, CallScreen knurl:** regexes follow the new markup; the Footer still asserts "Built with Kiro" exactly once.
- **Avatar input:** the closed key list gains `followPointer`.
- **ForgetLast:** pending is `aria-disabled`, not `disabled`.
- **WhatIKnowSheet:** the label spacer holds "Tap again", not the full sentence.
- **Landing:** stage heights and the inset; the story's quote carries `min-[472px]:sr-only`.
- **Switch:** the box is `clamp(220px, 31.25vw, 320px)`.
- **Scenery geometry:** the mains label's x is pinned to the cable's span, and its words must stay above the shelf.

No guard script was weakened. `scripts/machines-index` and its test are unchanged.

## Known limits

- The spider's feet slide when the pointer moves faster than about 0.15 px per ms.
- On the specimens page every slab follows the first floor shadow; the scenery assumes one stage per page.
- A card with its source rows open is about 440 px tall against 400 px of room at 375x667.
- While What I know is open as a modal, its Escape handler runs before any other.
- Any `receipt` element opens the Lab's slot, even one that renders nothing.
- On touch, the pointer-follow gaze moves only while a finger drags. The SVG ghost has no follow.
- On load the SVG ghost shows first and is larger than the three.js Franki that replaces it. The fix is in `components/avatar/canvas-frame.ts` and needs measuring on screen.
- The error page labels itself FIG. 500 whatever the error.
- First load: `/` is 287.7 kB gzip, `/lab` 308.3 kB gzip. three.js (186.5 kB gzip) stays in its own async chunk, outside both.

## What the lab still needs from the server

The surfaces are built and have specimens, but on the main screen nothing feeds them yet:

- cards and their source rows;
- the strip's terminals;
- the jar's motes, with `leavingIds` on a forget;
- the Lab's `receipt`;
- the company toggle and forget-last, which are not mounted. Whoever mounts forget-last must move focus when it leaves;
- `attend: "pointer"`, which nothing passes on the main screen.

The front door shows all of these working on sample data held in the page (`ui/landing/sample.ts`), under a "Sample data" plate. A boundary rule keeps that data out of anything reachable from `/lab`.

## Checks

On `0844f5b`:

| Check | Result |
|---|---|
| `npm test` | exit 0: 275 test files, 3,134 passed, 20 expected fail |
| `npm run lint` | exit 0, one warning in `components/avatar/three/brass.ts:113`, which this brief did not touch |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `specimens-absent` (postbuild) | no specimens page, recorder page or `/api/dev` route in the build |
| `three-chunk-check` (postbuild) | three is in 1 async chunk and not in the first load of `/` or `/lab` |
| `token-check`, `copy-check`, `ui-boundaries` | exit 0 |

All of these were run on `0844f5b` itself, after the last change to the code.
