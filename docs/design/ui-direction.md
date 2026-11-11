# Franki interface: design direction

Status: design direction for the web app's interface. Read-only for build work. Behavior and contracts still come from `memory-spec-v3.md` and `memory-contracts-v2.md`; where this file and those disagree, they win, and the conflict goes under "Contract questions" in the spec's `design.md`.

## The idea in one line

The screen is Franki's lab at night. Franki floats in the middle. Everything else is lab equipment that wakes only when it has something true to show.

## Principles

1. **Talk, don't type.** Voice goes in; voice and expression come out. This is not a chat UI. There is no message log on the main screen.
2. **Text only to read or approve.** Text appears as a card when there is something to read (a source, a list, ingredients) or approve (a side effect). Everything else is Franki's face and voice.
3. **The eyes do the acting.** Franki has no mouth. Eyes, glow, posture and the bolts carry every state.
4. **Every glow means something.** The theme is the signal system, not decoration:
   - **Ectoplasm green glow** means Franki is present and paying attention.
   - **Electricity** means work is happening right now: thinking, connecting, a time jump. No work, no electricity.
   - **Brass** means something you can touch: a control, an approval, a rule you own.
   - **Gold** means a win: a closed loop, a good outcome.
5. **Only true things on screen.** Every number traces to a source, and the card can show it. Lab counts are real or shown as `—`, never a placeholder zero. The main screen never shows fixture or demo data that the server didn't send. Simulated time is always labeled.
6. **Patterns, never causes.** Copy never says "because", "caused", "thanks to", "led to" or "won back" about a pattern. "Mostly on nights with meetings after 6" and "$115 less" are fine.
7. **Forget looks like gone.** When a forget completes, the client drops every copy it holds of the forgotten turns: captions, typed lines, cards, cached jar items. The receipt shows what kind of thing was touched and how many, never the forgotten words.
8. **Quiet by default.** No toasts, no badges, no "coming soon", no empty panels. A surface with nothing true to show is not rendered.
9. **Motion is ghost physics.** Things float, rise and settle. Nothing slides in on a straight line. Nothing bounces like a toy.
10. **Calm for everyone.** Reduced motion keeps every state readable without movement. Contrast meets WCAG AA. Every control works by keyboard and has a 44 px target.

## The screen

One screen, no navigation. Desktop first, down to 375 px wide.

```
┌───────────────────────────────────────────────────────────┐
│ Franki                     [⚡ Simulated: Thu 6:00 PM]     │  wordmark · time badge (only when simulated)
│        ●───────●───────●───────●───────◉                  │  the strip (only while a loop is open)
│                                                           │
│                      ╭─────────╮                ┌───────┐ │
│                      │ FRANKI  │                │ card  │ │  card dock: right on desktop,
│                      ╰─────────╯                └───────┘ │  bottom sheet on mobile
│                   ~~ halo / floor ~~                      │
│                                                           │
│        ( What do you know about me? )  ( … )              │  chips
│                        (( ⏻ ))   🎙                        │  call button, mute
│ [jar]                                         [the Lab]   │  bottom corners
│                      Built with Kiro                      │
└───────────────────────────────────────────────────────────┘
```

### Surfaces

| Surface | What it is | Shows when |
|---|---|---|
| **Stage** | Franki, a soft halo, and a faint floor shadow that tracks the float | Always |
| **Call button** | One round brass-ringed button. Start form: a round power glyph with a green core. Hang-up form: a squared ember-red form. They differ in shape and colour, not just text. Labels stay "Call Franki" and "Hang up" | Always (disabled while signed out) |
| **Mute** | A small brass toggle beside the call button. Muted puts Franki in ghost mode | Listening, thinking, speaking |
| **Chips** | Glass capsules with a stitched outline. A tap counts as the user's words. Chips are code constants | When the server offers them |
| **Typed line** | A keyboard glyph that opens a single-line input. Secondary to voice and chips | Always available, collapsed by default |
| **Cards** | Glass panels with a stitched seam at the top. One primary card at a time; older ones stack behind it, slightly smaller | When there is something to read or approve |
| **The strip** | Five terminals joined by a wire: Noticed, Connected, Suggested, You said yes, and the result (for the hero, "$115 less"). Current runs along the wire as each one fills; the last one turns gold | While a loop is open |
| **The jar** | A glass specimen jar with glowing motes, one per memory, up to a visual cap. Tap opens "What I know" | Signed in |
| **The Lab** | A small instrument panel of counters in mono figures, such as *Read {n} emails · Guessed {n} private things · Said {n}*, plus a fold for honest limits | Signed in, when the server sends counts |
| **Receipt** | A slip that prints up out of the Lab after a forget: "Blocked now" and "Cleaned up", what was kept (for example "Kept: 1 safety rule"), counts by kind | After a forget |
| **Time badge** | A brass badge with a small bolt: "Simulated: Thu 6:00 PM". Never hidden while the clock is simulated | While simulated |
| **Captions** | One line of what Franki is saying now, fading out after. Not a history. Off by default; a toggle turns it on | When turned on |
| **Wordmark** | "Franki" in the header. On the signed-out screen, `FRANKIROCKS` with the letters K-I-R-O lighting gold once | Header; signed-out screen |
| **Footer** | "Built with Kiro", small | Every page |
| **Debug panel** | The existing Debug_Panel | Development only, behind `?debug=1` |

### Cards

- **Kinds:** *source* (a pattern or a fact, with its sources), *approval* (a side effect waiting for Yes), *food* (a choice, its ingredients and the rules it was checked against), *ask* (a question Franki needs answered on screen, such as an ambiguous forget), *read* (something to read, such as a list).
- **Layout:** a one-line title, the content, then sources, then actions. Numbers in mono with tabular figures.
- **Sources:** every number has a source tag ("Bank · 6 purchases", "Calendar · 4 meetings"). Tapping a tag opens the rows behind it.
- **Approvals:** say exactly what will happen. Two actions: **Yes** (brass, primary) and **Not now** (quiet). A spoken "yes" and a tap do the same thing. No approval is pre-selected.
- **Food:** a "Checked for" line names every hard rule applied, per person, with the safety seal. Copy never says a place or dish is "safe".
- **Hard rules** (allergies) carry a brass seal with a lock everywhere they appear, and only a deliberate tap can remove one.
- **Presentation:** a card rises in from Franki's side of the screen; Franki glances at it, then back at the user.

### The jar

"What I know", grouped by area: Time and work, Food and health, Money, People, Goals. Each item shows its text, where it came from, and three actions: **Wrong**, **Forget**, **Don't bring it up**. Hard rules sit at the top under their seal. Guesses are labeled "Guessed" with a dashed outline. Motes inside the jar use the same coding: solid for told, dashed for guessed, brass for hard rules, frosted for private.

## Franki: the avatar

The avatar is a contract with more than one renderer. This foundation builds an **SVG ghost** drawn in code. A **three.js ghost** (brief 013), ported from the three.js prototype, replaces it as the default behind the same contract, and the SVG ghost stays as the reduced-motion and fallback renderer. The three.js engine under `components/avatar/three/` keeps the prototype's tuned `0x` colour numbers rather than the tokens, so a token edit never changes the 3D look; token-check waives only that rule there.

**Look** (drawn fresh in code; `reference/mascot-reference.png` is concept art for proportions only, never shipped):
- A glossy, soft-green ghost body, wider at the top, with a wavy three-lobe hem.
- Flat-top dark hair with a ragged fringe.
- Two neck bolts, one each side of the head, in brass.
- A short stitched scar on the forehead, upper right.
- Two big glossy black oval eyes with a small highlight. No mouth.

**Inputs:** voice state (`avatarState()` from `@franki/core`), `micMuted`, `outputMuted`, an input level and an output level (0 to 1, smoothed), and one-shot events (`wake`, `celebrate`, `present-card`, `await-approval`).

| State | Source | Look |
|---|---|---|
| Dormant | `closed` | Dim glow, eyes closed, sunk low, slow breathing |
| Waking ("It's alive!") | `connecting`, first time in a visit | A bolt strikes both neck bolts, glow flares, eyes pop open, Franki rises. About 1.2 s, once per visit |
| Connecting | `connecting` after that | Bolts flicker, eyes half open |
| Listening | `listening` | Leans in a little; glow follows the input level; random blinks |
| Thinking | `thinking` | Electricity arcs between the bolts; eyes glance up and to the side |
| Speaking | `speaking` **and** `outputMuted` is false | Body squishes with the output level |
| Recovery | `recovery` | Squint, a small wobble, one bolt fizzles |
| Ghost mode | `micMuted` | Body fades to about 35% opacity, eyes stay solid. Overrides the look of every other state, never its meaning |
| Presenting | `present-card` | Glances toward the card, then back |
| Awaiting approval | `await-approval` | Expectant eyes, a small nod loop |
| Celebrate | `celebrate` | A small rise and gold sparks off the bolts |

**Rules:**
- Speaking motion follows the output level only while output audio is unmuted. A reply that admission held or cancelled must not move the body.
- Levels are read with a Web Audio analyser. Nothing is recorded or sent anywhere.
- Animation time comes from `requestAnimationFrame` timestamps and CSS, never from wall-clock reads. The clock guard still applies.
- The accessible label names the state ("Franki is listening"), and state changes are announced politely.

## Visual tokens

All colour, type, radius, shadow and motion values live in one token source (CSS custom properties in `globals.css` under `@theme`, mirrored in `motion.ts` for JS). Components use tokens only, never raw hex or ad hoc durations.

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
| `stitch` | `#3B4C45` | Seams, dividers. Decorative only: it is below 3:1 on `night-0`, so it is never the only boundary of a control |
| `ember` | `#FF6A4D` | Hang-up, errors, sparingly |

Check every text pairing against WCAG AA before use. Glows are layered `box-shadow` or SVG blur at low opacity, never a flat neon.

### Texture

- A blueprint grid at about 3% opacity on the background, fading toward the edges.
- Fine film grain from an SVG `feTurbulence` filter at about 4% opacity.
- A soft vignette. Franki's halo is the only bright area on an empty screen.
- Seams are stitched: a dashed `stitch` line with short cross-ticks, used as card tops and dividers.

### Type

- **Geist** for interface text. **Geist Mono** with tabular figures for numbers, counters, times and sources.
- Sizes: 12, 14, 16, 20, 28, 44. Body 16. Card titles 20. One weight change per element at most.
- Copy is short, second person, warm and plain. Sentence case everywhere except the `FRANKIROCKS` wordmark.

## Motion

Motion uses the `motion` library (motion.dev) for springs, layout and presence, CSS for loops, and SVG or canvas for electricity and sparks.

| Token | Value | Use |
|---|---|---|
| `spring.float` | stiffness 60, damping 12 | Franki, the halo, motes |
| `spring.settle` | stiffness 170, damping 22 | Cards, sheets, chips |
| `spring.press` | stiffness 420, damping 30 | Button press and release |
| `dur.quick` | 160 ms | Hover, focus |
| `dur.base` | 320 ms | Most transitions |
| `dur.ritual` | 1200 ms | The wake, the receipt print |
| `ease.ecto` | `cubic-bezier(.22, 1, .36, 1)` | Non-spring easing |
| `stagger` | 40 ms | Lists, strip terminals |

- **Materialize** (enter): rise 12 px, fade in, blur 6 px to 0.
- **Dematerialize** (exit): rise 8 px, fade out, blur to 6 px. Forgotten things leave this way and don't come back.
- **Idle float:** Franki bobs about ±6 px on a 4 s sine; the floor shadow narrows as Franki rises.
- **Electricity:** a jagged path regenerated every 60 to 90 ms by midpoint displacement, stroked `spark` with a `gold` glow. At most two electric effects at once.
- **Counters** roll like an odometer when a Lab number changes.
- **Press:** brass controls depress 2 px with `spring.press`; a short spark runs around the call button's ring on press.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no loops, no electricity, no blur. Enters and exits become plain fades. Thinking becomes a steady bolt glow. Each state stays distinct by eyes, glow and label.
- **Budget:** transform and opacity only for anything that moves every frame; 60 fps on a mid-range laptop; loops pause when the tab is hidden.

## Sound

Sound effects are synthesized with Web Audio in code: no audio files, no third-party sounds.

| Cue | Sound |
|---|---|
| Wake | A rising three-note figure with a crackle, under 1.5 s |
| Thinking | A very faint crackle, only if thinking lasts over 1 s |
| Card arrives | A soft glassy tap |
| Celebrate | A short bright chime |
| Receipt | A quick paper-printer whirr |

Sound starts only after the first user gesture, never plays over Franki's voice, sits well below voice level, and has one on/off toggle that is remembered.

## Signed out

The room is dark. Franki is dormant, eyes closed, barely glowing. `FRANKIROCKS` sits above with K-I-R-O lighting gold once on load. One brass button: "Sign in to wake Franki". The call button shows, disabled. No chips while signed out.

## Out of scope for the foundation

The three.js renderer (brief 013 builds it), server data for the strip, jar, Lab, receipt and chips, company mode ("Someone walked in"), and any new API route. The foundation builds these surfaces as components that render props, shows them with fixture props on a development-only specimens page, and wires to the main screen only what the client already has today: auth, voice state, mic and output state, levels, and typed turns.
