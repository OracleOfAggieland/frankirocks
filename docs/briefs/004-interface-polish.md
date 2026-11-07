# Brief 004: interface polish

The `lab-ui-foundation` spec is built and green. A review of the running app and the Specimens_Page found the items below. This brief fixes them. It is a polish pass on existing components, not a new spec: work straight from this brief, `docs/design/ui-direction.md` and `.kiro/specs/lab-ui-foundation/`.

Do the items in order, one commit each, every message ending with the trailer line `Built-with: Kiro`. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green at every commit. Every rule in `requirements.md` and `.kiro/steering/ui-design.md` still holds: tokens only, no wall-clock reads, Reduced_Motion respected, props-only Surfaces, no new dependency. Don't push or deploy.

The reference art is `docs/design/reference/mascot-reference.png`. Use it for proportions and shading only; never ship or import it.

## 1. Franki in the middle

On a wide screen with no Card open, Franki sits left of center, because the Card_Dock column keeps its width while empty.

- With no Card, the stage is centered on the page, on the same axis as the call button and the Wordmark.
- When a Card arrives (on the Specimens_Page today), the layout moves to stage plus dock, and Franki glides to the left with `spring.settle` as a layout animation rather than jumping. When the last Card leaves, Franki glides back to the center. Under Reduced_Motion the move is instant.
- Add a "Main screen with a Card" specimen that shows both layouts, so the move can be seen.
- Keep R12.2 (dock at the right from 1024 px, bottom sheet below) and R12.3 (no sideways scroll from 375 px).

## 2. Strip labels

The terminal labels run together ("ConnectedSuggestedYou said yes").

- Each terminal owns a label box of one fixed width, centered under it, at most two lines, with a gap between neighbouring boxes. No two labels touch at any width from 375 px up.
- Below 640 px the Strip may switch to a vertical layout (terminals down the side, labels to the right) if five labels can't fit across. Pick whichever reads better, and add a specimen at 375 px.
- Add a test that the label boxes are equal in width and the layout leaves a gap between them.

## 3. Source tags

The source Card shows each source tag twice (once beside its figure and again in the sources row), and the tags are heavy brass pills.

- A source tag is a quiet chip: Geist Mono 12 px, `ink-dim` text, a thin outline that meets 3:1 against the Card, turning `brass` on hover and focus. It is still a button that calls `onOpenSource`.
- A figure's tag sits inline, right after the figure.
- The sources row lists only sources no figure has already cited. Each source appears at most once on a Card. Test both rules.

## 4. The ghost, closer to the concept art

The SVG ghost reads well, but its silhouette is boxy next to the reference: straight sides and a slab of hair. Redraw the body and hair. Keep every part name, state and test.

- **Body:** one smooth closed path. A rounded dome at the top, widest across the head, then a gentle taper with soft, slightly uneven sides, into a wavy hem of three lobes of unequal size. No straight vertical edges.
- **Shading:** a soft vertical gradient from `ghost` to `ghost-deep`, a faint `ecto` rim light along the edge, and one glossy specular highlight (a soft ellipse at the upper left of the head). Use tokens only.
- **Hair:** a flat top with volume, and a ragged fringe of uneven tufts hanging over the forehead, not a rectangle. Dark, with one subtle highlight.
- **Bolts:** short cylinders with a `brass`-to-`brass-hi` gradient and a darker cap, sitting at the sides of the head where the neck would be.
- **Scar:** a short curved seam at the upper right of the forehead, with three or four crossing stitches.
- **Eyes:** big glossy ovals with one small highlight each, as now.
- Under Reduced_Motion the drawing is the same; only motion changes.

## 5. Electricity

The wake strike and the thinking arcs read as thin straight lines.

- A bolt is visibly jagged at stage size, from midpoint displacement deep enough to show at least five clear kinks, with one or two short side branches.
- Draw each bolt as a bright `spark` core over a wider, blurred `gold` glow, with a brief flash in the glow on each regeneration.
- The wake strike comes down from above onto both neck bolts at once. The thinking arc crosses over the top of the head from bolt to bolt.
- Keep Property 19 (well-formed paths) and the two-effect budget, and extend the property to cover branches.

## 6. The jar

The jar is a plain rectangle with dots.

- A glass specimen jar: rounded shoulders, a short neck, a brass lid with a rim and two rivets, two thin vertical highlight streaks on the glass, and a faint `ecto`-tinted fill at the bottom.
- Motes drift slowly on `spring.float`, each on its own small loop, and sit still under Reduced_Motion. Keep the mote kinds (solid, dashed, brass, frosted) and the cap.
- A small brass label plate on the jar reads "What I know".

## Checks before you stop

The four commands above exit 0. In `docs/briefs/004-report.md`, list each item, what changed, and anything you couldn't check by eye (you can't see the screen, so say which specimens the owner should look at for each item).
