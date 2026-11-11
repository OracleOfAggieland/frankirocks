# Brief 013: Franki's three.js avatar in the app

Franki's avatar is a 3D ghost drawn in code with three.js. A working prototype exists as one page: scene, materials, the character, effects, a rig of spring channels, a state machine and a quality ladder. This brief moves that avatar into the app as the hero renderer behind the Avatar_Contract. The SVG ghost stays as the fallback.

This feature is built by Claude Code agents from this brief, on the branch `build/avatar-three`, cut from `build/voice-control`.

Read first, in full:

- The prototype page and its three specs (art direction, the three.js recipe, open items). The builders are given their location.
- `apps/web/src/ui/avatar/` (types, look, events and their tests) and `apps/web/src/components/avatar/` (Avatar, Stage, SvgGhost, Electricity, frame time).
- `apps/web/src/app/specimens/` and how the main screen renders `<Avatar>`.
- `docs/design/ui-direction.md` and `.kiro/steering/ui-design.md`.

## What the owner should experience

- Franki on the main screen is the three.js ghost, with the same look and the same acting as the prototype in every state: dormant, waking, connecting, listening, thinking, speaking, recovery, presenting, awaiting approval and celebrate, with ghost mode while the microphone is muted.
- While Franki speaks, the body and the mouth move with Franki's voice. While the owner speaks, Franki reacts to the owner's voice.
- The avatar never delays the call, never freezes the page and never shows a blank box. Where three.js can't run, the SVG ghost shows instead and nothing else changes.

## Rules

1. **The look comes first.** The port keeps the prototype's geometry, shaders, materials, constants, springs and timing. Nothing is simplified to make the code shorter or easier to read. The open visual items listed with the prototype are not fixed here.
2. **One contract.** The three.js renderer implements `AvatarRenderer` and is driven only by `look` and `input`. Every `LookName`, the ghost overlay, every `AvatarEvent`, and the `inputLevel` and `outputLevel` drives map onto the prototype's states and channels. The design note has the full mapping table, and names anything in the contract the prototype has no acting for, with the choice made.
3. **Fallback to the SVG ghost** when WebGL is missing, when the context can't be created or is lost and not restored, when `reducedMotion` is true, and while the three.js code is still loading. The swap between the two is smooth: no jump in size or position, no flash.
4. **`three` is pinned to the prototype's exact version** as an npm dependency of the web app. It loads only in the browser, only when the avatar mounts, in its own chunk. It is never imported on the server and never in the first load of a page that has no avatar.
5. **Lifecycle.** One renderer per mount. On unmount everything is disposed: geometries, materials, textures, render targets, listeners and the frame loop. The loop pauses while the tab is hidden. Resize and device pixel ratio changes are handled. React Strict Mode's double mount and Fast Refresh leave exactly one live renderer.
6. **Performance.** The prototype's quality ladder is kept. The device pixel ratio is capped. Building the character must not block the voice path; measure the build time and record it.
7. **Not ported:** the prototype's own voice code and server, its page chrome, its debug drawer, its URL test hooks and its simulator. The app already has its own voice client. The specimens page may drive levels from a simulated signal.
8. **Time.** Animation runs on frame time through the existing frame-time helper. Nothing reads the wall clock.
9. **Tests.** The mapping, the fallback decision and any controller that can be separated are pure and unit-tested. Every existing test keeps passing unchanged. The specimens page shows the three.js renderer and the SVG ghost side by side for every look.
10. **Words.** Comments and design lines that say a Rive rig is coming now say three.js: `apps/web/src/components/avatar/Avatar.tsx`, `apps/web/src/ui/avatar/types.ts`, `docs/design/ui-direction.md` and the additions table in `docs/design/memory-spec-v3.md`.

## Out of scope

`packages/core` and `packages/server`. The voice state machine and the voice client's call behaviour. New avatar art. The celebration sound.

## Rules that apply here

- One commit per task, with a plain message. These commits are Claude's and never carry `Built-with: Kiro`.
- `three` is the only new dependency, with its type package at the matching version if TypeScript needs one.
- No network call from a test. No push or deploy.
- New state is explicit: a status or phase is a closed union with one pure function that decides every transition, never a set of loose flags.

## Report

`docs/briefs/013-design.md` before the build and `docs/briefs/013-report.md` after it: what was built and where, the mapping table, the measured build time and bundle sizes, what was checked in a browser and what wasn't, and the steps for the owner to check it on a live call.

## Checks before the work is done

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` exit 0.
