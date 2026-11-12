---
inclusion: fileMatch
fileMatchPattern: "apps/web/src/**"
---

# UI design rules

Source: `docs/design/ui-direction.md`. This file is a summary. If this file and the source differ, the source wins and this file must be fixed. Spec: `.kiro/specs/lab-ui-foundation/`.

The screen is Franki's lab at night. Franki floats in the middle. Everything else is lab equipment that wakes only when it has something true to show.

## Principles

1. **Talk, don't type.** Voice in; voice and expression out. No message log on the main screen.
2. **Text only to read or approve.** Text shows as a card when there is something to read or approve.
3. **The eyes do the acting.** Franki has no mouth. Eyes, glow, posture and bolts carry every state.
4. **Every glow means something.** Ecto green: present and paying attention. Electricity: work happening now. Brass: something you can touch. Gold: a win.
5. **Only true things on screen.** Every number traces to a source. Lab counts are real or `—`, never a placeholder zero. No fixture or demo data on the main screen. Simulated time is always labelled.
6. **Patterns, never causes.** Copy never uses a Banned_Cause_Word about a pattern (see Copy).
7. **Forget looks like gone.** On a completed forget the client drops every copy it holds of the forgotten turns. The receipt shows kinds and counts, never the forgotten words.
8. **Quiet by default.** No toasts, badges, "coming soon" or empty panels. A surface with nothing true to show renders nothing.
9. **Motion is ghost physics.** Things float, rise and settle. Nothing slides in on a straight line. Nothing bounces like a toy.
10. **Calm for everyone.** Reduced motion keeps every state readable. Contrast meets WCAG AA. Every control works by keyboard and has a 44 px target.
11. **Blueprint until it's true.** Inert things are `stitch` linework. Material (glass, brass, paper, glow) is only for what is live or touchable.

## Pages, materials, scenery, cursor

- **Pages:** the lab is one screen at `/lab`. The front door at `/` is the only other page and the only place sample data may show, always under a "Sample data" plate. Nothing reachable from `/lab` imports `components/landing/` or `ui/landing/`.
- **Materials:** use the utilities `mat-blueprint`, `mat-glass`, `mat-brass`, `mat-paper`, `mat-gold` and the shared parts in `components/lab/` (rivet, plate, lamp, fig label). A surface never mixes its own material.
- **Scenery:** blueprint linework only, `stitch` at 55% opacity or less, never filled or glowing, `aria-hidden`. It never draws a stand-in for a real surface.
- **Cursor:** the lab spider replaces the pointer only on a fine pointer with motion allowed and the "Lab spider" toggle on. Its body has no lag; text fields keep the native cursor. It never glows.
- **Display type:** Fraunces (`font-display`, sizes `text-title` and `text-hero`) on the front door and the 404 and error pages only. Never in the lab, never for numbers.
- **Front-door copy** lives in `apps/web/src/ui/copy-landing.ts` and follows the Copy rules below.

## Tokens

The only token source is `@theme static` in `apps/web/src/app/globals.css`, mirrored by hand in `apps/web/src/ui/motion.ts`. Components use tokens only: no raw hex, no ad hoc durations, no Tailwind default palette classes. `node scripts/token-check.mjs` enforces this.

### Colour

| Token | Value | Use |
|---|---|---|
| `night-0` | `#060A09` | Page background |
| `night-1` | `#0B1311` | Raised surfaces |
| `night-2` | `#13201C` | Cards, sheets |
| `ink` | `#E8F4EC` | Primary text |
| `ink-dim` | `#9DB3A8` | Secondary text |
| `ghost` | `#CDF3D3` | Franki's body |
| `ghost-deep` | `#93DDA2` | Body shading |
| `ecto` | `#7CFFB2` | Presence glow |
| `brass` | `#D9A441` | Controls, seals |
| `brass-hi` | `#F3CF7A` | Brass highlight |
| `gold` | `#FFD24D` | Wins, lightning core halo |
| `spark` | `#FFF6D8` | Lightning white-hot core |
| `stitch` | `#3B4C45` | Seams, dividers; decorative only, never the only boundary of a control |
| `ember` | `#FF6A4D` | Hang-up, errors, sparingly |

Glows are layered `box-shadow` or SVG blur at low opacity, never flat neon. Check every text pairing against WCAG AA (`apps/web/src/ui/contrast.test.ts`).

### Type, radius and shadow

- Geist for interface text; Geist Mono with tabular figures for numbers, counters, times and sources.
- Sizes 12, 14, 16, 20, 28, 44 px (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-2xl`, `text-display`). Body 16, card titles 20. One weight change per element at most.
- Radius: `radius-card` 18 px, `radius-chip` 999 px, `radius-control` 12 px, `radius-frame` 28 px.
- Shadow: `shadow-ecto-glow`, `shadow-brass-glow`, `shadow-gold-glow`, `shadow-card`, `shadow-glass`.

### Motion

| Token | Value | Use |
|---|---|---|
| `spring.float` | stiffness 60, damping 12 | Franki, the halo, motes |
| `spring.settle` | stiffness 170, damping 22 | Cards, sheets, chips |
| `spring.press` | stiffness 420, damping 30 | Button press and release |
| `dur.quick` | 160 ms | Hover, focus |
| `dur.base` | 320 ms | Most transitions |
| `dur.ritual` | 1200 ms | The wake, the receipt print |
| `dur.current` | 1600 ms | A pulse travelling a wire |
| `dur.drift` | 9000 ms | Slow ambient loops |
| `ease.ecto` | `cubic-bezier(.22, 1, .36, 1)` | Non-spring easing |
| `stagger` | 40 ms | Lists, strip terminals |

## Motion rules

- Use `motion` (`motion/react`) for springs, layout and presence; CSS for loops; SVG for electricity and sparks.
- **Materialize** (enter): rise 12 px, fade in, blur 6 px to 0. **Dematerialize** (exit): rise 8 px, fade out, blur to 6 px.
- **Idle float:** about ±6 px on a 4 s sine; the floor shadow narrows as Franki rises.
- **Electricity:** a jagged path regenerated every 60 to 90 ms by midpoint displacement, stroked `spark` with a `gold` glow. At most two electric effects at once.
- **Press:** brass controls depress 2 px with `spring.press`; a short spark runs around the call button's ring.
- **Counters** roll like an odometer when a Lab number changes.
- **Reduced motion** (`prefers-reduced-motion: reduce`, or forced by a specimen): no loops, no electricity, no blur. Enters and exits become plain fades. Thinking becomes a steady bolt glow. Each state stays distinct by eyes, glow and label.
- **Budget:** only `transform` and `opacity` move every frame; 60 fps on a mid-range laptop; loops pause when the tab is hidden.
- Animation time comes from `requestAnimationFrame` Frame_Time, CSS and `motion`. No wall-clock read in `components/` or `ui/`.

## Avatar

- One contract (`AvatarRendererProps`), rendered only through `<Avatar>`. The SVG ghost is drawn in code; `reference/mascot-reference.png` is never shipped.
- The pure Look_Mapper `lookFor` is the only code that decides a look; the Event_Controller is the only code that starts and clears events.
- Speaking motion follows the output level only while output audio is unmuted. Ghost mode (mic muted) changes the look, never the meaning or label.
- The accessible label names the state; changes are announced once per render in one polite live region.

## Sound

Synthesized with Web Audio in code, no audio files. Starts only after the first user gesture, never plays over Franki's voice, peak gain at most 0.25, one remembered on/off toggle.

## Copy

- Short, second person, warm and plain. Sentence case everywhere except the `FRANKIROCKS` wordmark.
- Banned_Cause_Words, in any letter case: "because", "caused", "thanks to", "led to", "won back". `scripts/copy-check.mjs` enforces this.
- Food copy never calls a place or dish "safe". Approvals say exactly what will happen: **Yes** and **Not now**, neither pre-selected.
- Strings live in `apps/web/src/ui/copy.ts`.
