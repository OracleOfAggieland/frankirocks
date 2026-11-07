# Brief 003 report: lab UI foundation

Status: **all tasks in `.kiro/specs/lab-ui-foundation/tasks.md` are done and ticked** (1.1 to 19.1 and this task, 20.1). The work is on branch `build/lab-ui`, one commit per leaf task, each ending with `Built-with: Kiro`. Nothing was pushed or deployed, so CI has not run. No paid OpenAI call was made and no `.env` file was opened.

The build was done with **Kiro**: the spec in `.kiro/specs/lab-ui-foundation` (requirements, design, tasks) drove every task; the first task wrote the new steering file `.kiro/steering/ui-design.md`; the clock-guard hook stayed on throughout; every commit ends with `Built-with: Kiro`; and the "Built with Kiro" footer still renders on every page, including the Specimens_Page.

## Checks (Nov 6, 2026, local, Windows)

| Check | Result |
|---|---|
| `npm test` | 125 files, 1140 tests passed (baseline before this spec: 68 files, 794 tests) |
| `npm run lint` | exit 0, no warnings |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0; the new `postbuild` step printed "no Specimens_Page in the build" |
| `git diff --stat a7b9c5b HEAD -- packages/server docs/design apps/web/src/app/api` | empty: no change in `packages/server`, `docs/design/` or the API routes |
| `GET /specimens` on `next start` returns 404 | **not checked by request** (see "What could not be checked") |

Property tests: Properties 1 to 21 each run at least 100 cases (most run 200 to 400).

## What changed

| Area | Files | Tasks |
|---|---|---|
| Steering | `.kiro/steering/ui-design.md` (98 lines, `fileMatch` on `apps/web/src/**`) and `scripts/ui-steering.test.ts` | 1.1 |
| Token source | `@theme static` block in `apps/web/src/app/globals.css` (14 colours, type, radius, shadow, easing, springs, durations, stagger); hand-written mirror `apps/web/src/ui/motion.ts`; `scripts/token-sync.test.ts`; WCAG pairings in `ui/contrast.ts` | 2.1 to 2.4 |
| Checks run by `npm test` | `scripts/token-check.mjs` (raw hex, ad hoc durations, Tailwind palette classes), `scripts/copy-check.mjs` (Banned_Cause_Words), `scripts/ui-boundaries.mjs` (pure-module imports, `performance` clock reads, Surface imports, mascot art, Specimens reachability, `.dev.tsx` suffix) | 3.1 to 3.6, 7.1, 7.2, 19.1 |
| Existing components on tokens | `App`, `AuthPanel`, `CallScreen`, `DebugPanel`, `Footer`, `TypedInput` (and the Stand_In_Avatar until it was retired) | 3.2 |
| Pure avatar model | `ui/avatar/types.ts` (Avatar_Contract), `ui/avatar/look.ts` (Look_Mapper), `ui/avatar/events.ts` (Event_Controller), `ui/copy.ts` | 6.1 to 6.18 |
| Audio and sound | `ui/levels/level-math.ts`, `ui/levels/level-meter.ts`, `ui/audio/context.ts`, `ui/sound/score.ts`, `schedule.ts`, `engine.ts`, `preference.ts` | 9.1 to 9.4, 10.5 to 10.10 |
| Voice_Client | `apps/web/src/client/voice-client.ts`: optional `onStreams` and a private `reportStreams()` only; `voice-client.test.ts` unchanged; new `voice-client.streams.test.ts` | 9.5 |
| Announcements, Electricity | `ui/announce.ts`, `ui/electricity.ts`, `ui/electricity-budget.ts` | 10.1 to 10.4 |
| Hooks | `ui/hooks/reduced-motion.ts`, `page-visible.ts`, `frame-loop.ts`, `screen-controller.ts` | 11.1 to 11.3, 16.10 |
| Avatar renderer | `components/avatar/SvgGhost.tsx`, `Avatar.tsx`, `Stage.tsx`, `Electricity.tsx`, CSS loops in `globals.css` | 13.1, 13.2 |
| Surfaces (props only) | `components/surfaces/`: Card (five kinds), CardDock, Strip, Jar, WhatIKnowSheet, Lab, Odometer, Receipt, TimeBadge, Captions, Chips, Wordmark, Seal, Seam; `components/motion/Materialize.tsx`; `ui/surface-props.ts`, `ui/receipt-from.ts`, `ui/format-time.ts` | 14.1 to 14.11 |
| Main screen | `components/screen/MainScreen.tsx`, `Backdrop.tsx`; rebuilt `CallScreen.tsx`; new `TypedLine.tsx`, `ReplyLine.tsx`, `LiveRegion.tsx`, `SoundToggle.tsx`; `AuthPanel.tsx` label; `App.tsx` wired to today's sources only; `app-controllers.ts`; `ui/turn-copies.ts`, `ui/debug-flag.ts`; `TypedTurns.dropTurnCopies()` | 16.1 to 16.10 |
| Retired | `components/StandInAvatar.tsx` and its test | 16.10 |
| Specimens_Page | `apps/web/src/app/specimens/page.dev.tsx`, `_fixtures/`, `_sections/`; `next.config.ts` became a function of phase (`dev.tsx` page extension only in `PHASE_DEVELOPMENT_SERVER`); `scripts/specimens-absent.mjs` runs as `postbuild` | 18.1 to 18.3 |

## Dependency added

`motion@14.9.1`, pinned exact in `apps/web/package.json` (task 5.1). Its transitive packages are `framer-motion@14.9.1`, `motion-dom@14.9.1`, `motion-utils@14.7.0` and `tslib`. Before use I confirmed `MotionConfig` with `reducedMotion` (`"always" | "never" | "user"`), `AnimatePresence`, spring `stiffness`/`damping`, and the `motion/react` export in the installed type definitions, and a temporary `"use client"` probe on `/` built under Turbopack (probe removed before the commit). No other dependency was added.

## Requirement changes

- **FSC R16.1 to R16.3 superseded.** The plain HTML Stand_In_Avatar is gone; the SVG ghost behind the Avatar_Contract replaces it (R4 to R9 of this spec).
- **FSC R18.6 narrowed.** With no call open, only Franki's latest typed reply shows, in the Reply_Line; there is no list of earlier lines (R14.8). During a call the Reply_Line is hidden, as before when replies were spoken.
- **Sign-in label.** "Sign in with Google" became "Sign in to wake Franki" (R13.1). The method is still Google only (FSC R9.1).
- FSC R16.4 to R16.7 are kept: one call button with "Call Franki" and "Hang up", forms that differ in shape (`data-shape` round vs square) and colour (`ring-brass` with an `bg-ecto` core vs `bg-ember`), mute only while listening, thinking or speaking, and the footer.

## Test mapping for changed existing tests

| Old file and check | Where it is protected now |
|---|---|
| `StandInAvatar.test.tsx`: six states with distinct non-text styling | Property 2 (priority order) and Property 12 (different looks look different) |
| `StandInAvatar.test.tsx`: accessible labels and `role="img"` | `SvgGhost.test.tsx` and `Avatar.test.tsx` |
| `StandInAvatar.test.tsx`: no image, video, canvas or Rive | `SvgGhost.test.tsx` (no `<img>`, `<video>`, `<audio>`, `<canvas>`, `<image>`); `<svg>` is now required (R4.3), so the old "no svg" assertion is replaced, not kept |
| `StandInAvatar.test.tsx`: one call button, start vs hang-up classes | `CallScreen.test.tsx`: one `data-form`, `data-shape` round vs square, `ring-brass`/`bg-ecto` vs `bg-ember` (class names changed in 3.2, then the tests moved in 16.7) |
| `StandInAvatar.test.tsx`: mute visibility, `aria-pressed`, muted indicator, disabled states, failed step, retry after 30 s | Moved unchanged to `CallScreen.test.tsx` (16.7) |
| `StandInAvatar.test.tsx`: `data-state="recovery"` | Kept in `StandInAvatar.test.tsx` until 16.10, then `App.test.tsx` asserts `data-look="Recovery"` on a call error |
| `Footer.test.tsx` | Label changed to "Sign in to wake Franki" (16.8); the Specimens_Page added to the page list (18.2); footer once per page, last in `<body>`, email, enabled and disabled sign-in all kept |
| `TypedInput.test.tsx` | The escaping test renders `ReplyLine` instead of `ConversationView`, with a reply that holds markup; every `TypedTurns` behavior test unchanged (16.6) |
| `DebugPanel.test.tsx`, `voice-client.test.ts` | Unchanged; Debug_Panel gating is new coverage in `debug-flag.test.ts` and `App.test.tsx` |

## Deviations and choices made during the build

- **Sound gate.** Design says cues play only when `gestured`, `soundOn` and `outputMuted` are all true. I read `outputMuted` true as "Franki's voice is not audible", which matches R19.4 and UI direction ("never plays over Franki's voice"), and built it that way.
- **`--dur-float: 4000ms`** was added to the `@theme static` block for the 4 s idle float. UI direction gives the value but no token name; it is CSS-only and not mirrored in `motion.ts`.
- **Frame loop.** `FrameLoop` gained an optional `onFrame` callback in 16.10, so announcements, sound cues and Electricity time run once per frame in `ScreenController`. Announcements are made only on frames, so all changes seen in one frame join into one message.
- **Electricity regeneration.** Instead of a ref timer, the bolt's seed is derived from Frame_Time in 150 ms windows split at 60 to 90 ms, so every bolt lasts 60 to 90 ms and the render stays pure.
- **Debug flag** is read with `useSyncExternalStore` (server snapshot `false`) rather than an effect, so the panel never renders on the server and the lint rule against `setState` in effects stays clean.
- **Transitional edits.** `App.tsx` was touched in 16.6 (Reply_Line and Typed_Line in place of the conversation view) and 16.7 (rendering the Stand_In_Avatar beside the rebuilt controls) so every commit kept `npm test` and the build green before the full wiring in 16.10. `Footer.tsx` needed no change in 16.8 because 3.2 had already moved it to tokens.
- **Commit contents.** Task 5.1 says its commit holds only `package.json` and `package-lock.json`; it also holds the `tasks.md` tick, as the run instructions asked.
- **Actual time** values in `tasks.md` were first estimated by hand and came out too high (they summed to 298 minutes for a run of about 110). This commit replaces each with the minutes between that task's commit and the one before it, so they now sum to about 110. They are machine time between commits, not effort.

## Open contract questions

All eleven are in `design.md` "Contract questions"; none is resolved by this build.

1. `forgetReceipt` carries no turn IDs, so any completed forget clears every turn copy on the client. `onForgetComplete` is wired with no caller in this slice. Proposal: `forgottenTurnIds` in contracts v3.
2. Signed-out chips: none rendered; proposal to amend UI direction "Signed out" (it now already says "No chips while signed out").
3. Speaking with output muted shows Thinking and "Franki is thinking".
4. Sound is on by default and starts only after the first gesture.
5. Sign-in label changed; method unchanged.
6. `stitch` is about 2.2:1 on `night-0`, so it is decorative only; `contrast.test.ts` asserts it is never a control boundary.
7. Receipt kinds come from a fixed collection-to-kind map in `ui/receipt-from.ts` (`turns`/`sessions` → conversation turns, `memories` → memories, `evidence`/`chunks` → sources, anything else → other records). The label set needs confirming when the forget route lands.
8. No source says the clock is simulated, so the Time_Badge is not on the Main_Screen.
9. Captions need transcript deltas behind the Permit gate; not on the Main_Screen.
10. Jar and What I know need the contracts §6 memory views and audience rules before they show item text.
11. Spoken "yes" and a tap should go through one approval function in the effects slice.

## What could not be checked

- **The `/specimens` 404 from `next start`.** I started `next start` but could not request the page: this workspace's permission rules block HTTP clients (`Invoke-WebRequest`, `curl` and similar), and I did not work around them. What is proven instead: the production route manifests have no `specimens` key, the `postbuild` check finds no Fixture sentinel in `.next/server` or `.next/static`, and `next-config.test.ts` shows `dev.tsx` is a page extension only for the development server. To check by hand: `npm run build`, then `npx next start` in `apps/web`, then open `/specimens`.
- Contrast and focus rings as seen in a real browser (the ratios are computed in `contrast.test.ts`; focus classes are asserted in markup).
- 60 fps on a mid-range laptop, and that only `transform` and `opacity` animate per frame in practice.
- Sound levels and the feel of each cue by ear.
- Layout at 375 px and the 1024 px dock switch by eye. The Specimens_Page under `npm run dev` is the place to look.
- The Level_Meter on a real WebRTC call: no call was made, so input and output levels driving the glow and squish are tested only with fake analysers.
- CI: needs a push, which the owner has not asked for.
