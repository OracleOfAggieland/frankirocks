# Brief 003: the interface foundation

Build the foundation of Franki's interface: the design system, the motion system, the SVG avatar, the one-screen layout, and every surface as a component. The direction is `docs/design/ui-direction.md`. Read it in full before writing anything; it is the source for look, motion, sound and copy.

Work as a new spec, `lab-ui-foundation`, in `.kiro/specs/lab-ui-foundation/`. Work on branch `build/lab-ui`.

## Phases. Stop after each one.

1. **Requirements.** Write `requirements.md` in EARS form from `ui-direction.md` and this brief. Stop for review.
2. **Design.** Write `design.md`, including a Correctness Properties section and a "Contract questions" section. Stop for review.
3. **Tasks.** Write `tasks.md`. Every property task is required, not optional. Each task names its dependencies and its test witness. Stop for review.
4. **Build.** Run the tasks in order. One commit per task, each ending with the trailer `Built-with: Kiro`.

## Scope

- **Tokens.** One token source for colour, type, radius, shadow and motion, as CSS custom properties under `@theme` in `apps/web/src/app/globals.css`, mirrored for JS in `apps/web/src/ui/motion.ts`. Replace the starter colours and the `Arial` body font.
- **Steering.** As the first task, write `.kiro/steering/ui-design.md` with `inclusion: fileMatch` and `fileMatchPattern: "apps/web/src/**"`. It summarizes the principles, tokens, motion and copy rules from `ui-direction.md` in under 120 lines and points to it as the source.
- **Token check.** A script under `scripts/` that fails when a file in `apps/web/src/components/` or `apps/web/src/ui/` contains a raw hex colour or an ad hoc `transition`/`animation` duration outside the token files, run by `npm test`. Test it.
- **Avatar.** An `Avatar` contract and an `SvgGhost` renderer with every state and event in the avatar table of `ui-direction.md`. A pure function in `@franki/core` or `apps/web/src/ui/` maps inputs to a look, so it can be property-tested.
- **Audio levels.** A small module that reads input and output levels (0 to 1, smoothed) with a Web Audio analyser from the streams the voice client already has. Make the smallest change in `voice-client.ts` needed to expose the streams. Don't change muting, permits or any call behaviour.
- **Layout.** The one-screen layout in `ui-direction.md`: stage, call button, mute, chips row, typed line, card dock, strip, jar, Lab, time badge, captions, wordmark, footer. Desktop first, down to 375 px.
- **Surfaces as components.** Card (all five kinds), strip, jar and its "What I know" sheet, Lab, receipt, time badge, captions, chips, wordmark. Each renders from props only and has no data fetching of its own.
- **Wiring.** Wire to the main screen only what the client has today: auth state, voice state, mute and output state, levels, typed turns. Every other surface stays unrendered on the main screen until real data exists.
- **Specimens page.** A development-only route, `/specimens`, that shows every component in every state with fixture props, including the avatar in every state and event and with reduced motion on. It returns 404 in production builds. Fixtures live only under this route.
- **Sound.** The Web Audio cues in `ui-direction.md`, synthesized in code, with one remembered on/off toggle.
- **Debug panel.** Keep it, behind `?debug=1` in development only.
- **Dependencies.** You may add `motion` (motion.dev), pinned to an exact version that supports React 19.3 and Next 16.4.3; check its docs in `node_modules` after installing. Add nothing else without asking.

## Requirement changes

This spec supersedes `first-spoken-call` Requirement 16 criteria 1 to 3 (the plain HTML and CSS stand-in). Say so in `requirements.md`. Keep R16 criteria 4 to 7: one call button whose two forms differ in shape and colour, the labels "Call Franki" and "Hang up", the mute toggle only while listening, thinking or speaking, and the "Built with Kiro" footer with `data-testid="built-with-kiro"` on every page. Update the existing tests to the new requirements honestly; never delete a check without replacing what it protected.

## Properties to write

At least these, with fast-check:

1. Every combination of voice state, mute, output-muted and event maps to exactly one avatar look.
2. While the mic is muted, the look is ghost mode, whatever the other inputs.
3. While output is muted, the speaking look never follows the output level.
4. Every state can return to idle or dormant: no dead ends.
5. With reduced motion on, no look contains an infinite animation or electricity.
6. Any two different avatar states differ in at least one non-text property.

## Rules that apply here

- `ui-direction.md` principles 5 to 7: only true things on screen, patterns never causes, and forget looks like gone. If the receipt payload in the contracts lacks what the client needs to drop forgotten turns, record it as a contract question; don't invent a field.
- Animation timing comes from `requestAnimationFrame` and CSS. Never read wall-clock time; the clock guard applies.
- Browser code never imports `packages/server`, `firebase-admin` or `openai`.
- Accessible names on every control and on the avatar; keyboard access everywhere; WCAG AA contrast; reduced motion respected.

## Out of scope

The Rive rig. Server data for the strip, jar, Lab, receipt and chips. Company mode. New API routes. Changes to `packages/server`. Don't push or deploy.

## Checks before you stop

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0. In your report, list what you changed, the dependency and version you added, any requirement you changed, and what you couldn't check.
