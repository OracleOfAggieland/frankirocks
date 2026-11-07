# Brief 004 report: interface polish

All six items are done, one commit each, in order. Each commit ends with `Built-with: Kiro`. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0 at every commit. `scripts/token-check.mjs`, `copy-check.mjs` and `ui-boundaries.mjs` also pass. Nothing was pushed or deployed, no dependency was added, and no `.env` file was opened.

| Item | Commit |
|---|---|
| 1. Franki in the middle | `269d08e` |
| 2. Strip labels | `2a94c48` |
| 3. Source tags | `b792979` |
| 4. The ghost | `5f562a4` |
| 5. Electricity | `ee29ef0` |
| 6. The jar | `79fd67d` |

## How I checked by eye

I can't see the running app. For items 4, 5 and 6 I rendered the components to static markup and took screenshots with headless Edge. These were throwaway files outside the commits, and they have been deleted. I used the screenshots to tune the ghost's silhouette, where the bolts run and the jar's layout. They don't show motion, hover, focus, Geist (the probe used a fallback font) or real screen widths. Those things are listed below for you to check.

## 1. Franki in the middle

- `MainScreen` takes an optional `cards` prop. With no Card that has content, the grid is a single column at every width (`data-layout="center"`). The stage then sits on the page's centre axis with the call button and the Wordmark. With a Card, the grid gains the `stage | dock` columns from 1024 px (`data-layout="dock"`), and the `CardDock` renders in the dock area.
- The stage content sits in a `motion.div` with `layout="position"` on `spring.settle`. When the grid changes, Franki glides between the two positions. Under Reduced_Motion, `layout` is off and the move is instant.
- The app still passes no Cards, because no card source reaches the Main_Screen yet.
- New specimen: **Main screen with a Card** (`data-specimen="main-screen"`). It has two tiles, one starting with no Card and one starting with a Card. Each tile has a toggle button ("Bring a Card" / "Take the Card away").
- Tests cover both layouts, the empty-Card case and the glide wrapper.

**Look at:** the Main screen specimen at 1024 px or wider. Press the toggle in both tiles and watch Franki glide, then turn on reduced motion and confirm the move is instant. Below 1024 px the Card should come up as a bottom sheet inside the tile. Check 375 px for sideways scroll. The specimen nests the Main_Screen's `<main>` inside the Specimens_Page `<main>`, which only happens in development.

## 2. Strip labels

- Every terminal owns a label box of one fixed width (`w-24`, 6 rem). The box holds at most two lines (`line-clamp-2`).
- Across: five 6 rem grid tracks with 1 rem gaps, labels centred under their terminals.
- Down: a column with the terminals at the side, labels to the right, and a 0.75 rem row gap. The wire runs vertically.
- I chose the column layout for narrow screens, because "Connected" and "Suggested" can't fit in five boxes across 343 px.
- **Deviation:** the switch is a container query at 34 rem of the Strip's own width, not a 640 px viewport query. Five boxes and four gaps need exactly 34 rem. Because the query follows the Strip's own width, the 375 px specimen shows the real narrow layout. On the Main_Screen the switch lands at about a 576 px viewport.
- New specimens: **at 375 px (343 px content)**, filled 2 and 5 (`data-specimen="strip-375"`).
- Tests: all five label boxes have the same single width class. The layout constants agree with the class strings, the gaps are greater than zero, and five boxes plus four gaps fit the switch width.

**Look at:** the Strip specimens, wide and at 375 px. Check that no two labels touch and that the wire meets each node's centre in both layouts.

## 3. Source tags

- A source tag is still a 44 px `button` that calls `onOpenSource`. The visible chip inside it is Geist Mono 12 px in `ink-dim`, with a thin `ink-dim` outline. `ink-dim` on `night-2` is at least 3:1, and a test checks this. On hover and keyboard focus, the outline and the text turn `brass`.
- A figure's tag sits inline, right after the figure's value.
- The pure function `sourceTagPlan` decides where each source appears. A source shows inline after the first figure that cites it. The sources row lists only sources no figure cited. A fast-check property shows that every source appears exactly once and none is dropped.
- **Judgement call:** if two figures cite the same source, only the first gets a tag. The brief asks for each source at most once per Card. The cost is that the second figure has no tag of its own. If you'd rather every figure keep its tag, the at-most-once rule would have to apply to the sources row only.

**Look at:** the `source` Card specimen. Check hover and Tab focus on the chips, and whether the 44 px rows still look tidy.

## 4. The ghost

- **Body:** one closed path made only of cubic curves. A dome widest across the head (at y 92) tapers into three hem lobes of unequal width (22, 36 and 54 units), trailing to the left like the concept art.
- **Shading:**
  - a vertical `ghost` to `ghost-deep` gradient
  - a faint `ecto` rim light: a wide stroke at 0.1 opacity under a thin one at 0.3, with no filter
  - one specular ellipse at the upper left of the head
- **Hair:** a flat top with volume and five tufts hanging to uneven depths, with one `ink-dim` highlight stroke and a faint ecto edge.
- **Bolts:** short horizontal cylinders shaded `brass` to `brass-hi`, with a darker cap made by mixing `brass` toward `night-0` with `color-mix`. They sit at the sides of the head, partly behind it.
- **Scar:** a curved seam at the upper right of the forehead, with four crossing stitches set at right angles to the seam.
- **Eyes:** unchanged.
- Every part name, state and existing test is kept. New tests cover:
  - a body of curves only that is widest at the head, with unequal lobes
  - hair made of curves, with uneven tufts
  - the stitch count
  - the shading parts
  - identical drawing parts with Reduced_Motion on and off

**Look at:** the Avatar specimens with Reduced_Motion off and on, next to the concept art. My screenshots showed a closer silhouette, but the upper head still reads a little square under the flat-top hair. If you want it rounder, tune `BODY` and `HAIR_TUFTS` in `SvgGhost.tsx`.

## 5. Electricity

- `boltPath` now moves each midpoint by between half and all of that level's amplitude, so every midpoint is a kink. A property test shows at least five turns of 20° or more for any bolt 40 units or longer at depth 4. Stage bolts are longer than that.
- `bolt(waypoints, seed, depth)` runs a jagged trunk through the waypoints and adds one or two short side branches from `boltBranches`.
- Each bolt is drawn as a `spark` core over a wider `gold` glow, blurred by its own small filter. The glow group is keyed on the bolt's seed, so each regeneration remounts it and replays a brief opacity flash. The flash lasts `--dur-quick` / 3 and runs only under `prefers-reduced-motion: no-preference`.
- **Wake strike:** two bolts come from above the head, around the outside of the face, onto both neck bolts at once. That keeps within the two-effect budget.
- **Thinking arc:** runs from bolt to bolt over the top of the head. A test over 400 seeds shows it stays above the hair.
- The SVG now has `overflow="visible"`, so bolts can leave the viewBox into the halo's space.
- Property 19 is kept and extended to waypoints and branches. Each branch:
  - starts exactly on an interior trunk point
  - has the expected point count
  - is no longer than its share of the trunk
  - stays near its own chord
  - comes out the same for the same seed

**Look at:** the Thinking and Waking specimens with Reduced_Motion off, at full stage size. Check that the flash reads as a flicker and not a strobe, and that no bolt is clipped at the top of the stage.

## 6. The jar

- The jar is redrawn as a glass specimen jar:
  - rounded shoulders and a short neck
  - a brass lid with a rim and two rivets
  - two thin vertical highlight streaks
  - an `ecto` gradient fill at the bottom, clipped to the glass
  - a brass label plate reading "What I know" in 12 px `night-0` on brass
- The SVG maps one unit to one pixel, so the plate text really is 12 px. The jar grew from 72 × 96 px to 96 × 128 px to make room for the plate.
- Motes sit above the plate, inside the glass. Each mote springs its x and y offsets back and forth on `spring.float` (`repeat: Infinity`, mirrored). The x and y springs start out of step, so each mote traces its own small loop. Only transforms move.
- Under Reduced_Motion the motes are plain circles and sit still.
- Mote kinds, the 48 cap, the button name and `onOpen` are unchanged.

**Look at:** the Jar specimens ("every mote kind", "over the cap"). Check that the drift is slow and calm, that "What I know" fits the plate in Geist, and that the bigger jar still fits the bottom-left corner at 375 px.

## Not changed

Several SVG ids are shared when more than one avatar is on a page. This was already true before this brief. The new gradient definitions are identical in every instance, so sharing them is harmless. The existing `franki-glow-gradient` changes colour by look, so on the Specimens_Page a gold glow may show as ecto. This is out of scope here and worth a small follow-up.
