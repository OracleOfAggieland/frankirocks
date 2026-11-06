# Implementation Plan: lab-ui-foundation

## Overview

This plan builds `design.md` for `requirements.md` (Brief 003). Requirement criteria are cited as R*n.m*; "FSC R*n.m*" is a `first-spoken-call` requirement. Code is TypeScript (Next.js 16.4.3, React 19.3.1, Tailwind 4, Vitest 5, fast-check 4.10.2).

Rules for every task:

- Work on branch `build/lab-ui`. Each leaf task (1.1, 2.1, …) is exactly one atomic commit, with no intermediate commits for that task. The message ends with the trailer line `Built-with: Kiro`, for example `git commit -m "ui: add Look_Mapper" -m "Built-with: Kiro"`. Never push or deploy (R22.6 to R22.8).
- The shell is Windows PowerShell 5.1: run commands separately or join them with `;`, never `&&`.
- Every property task is required. Each runs at least 100 fast-check cases (`{ numRuns: 100 }` or more), carries the comment `// Feature: lab-ui-foundation, Property N: <title>`, and relies on the default `fc.assert` report of seed and shrunk counterexample (R23.1, R23.2).
- "Depends on" lists task IDs that must be committed first. "Witness" is the test file, check or command whose exit 0 proves the task done. Every task also leaves `npm test` green at its commit.
- No file in `packages/server` or `docs/design/` changes. No API route is added. No Server Action, `use cache`, `next/og` or ISR (R20.6, R22.4, R22.5). Browser code imports no `@franki/server`, `firebase-admin`, `openai` or `@openai/*` (R22.3).
- No file in `apps/web/src/components/` or `apps/web/src/ui/` makes a Wall_Clock_Read; time comes from Frame_Time, CSS, `motion` or `AudioContext.currentTime` (R10.6). Nothing is added to `scripts/clock-allowlist.json`.
- Before writing a page, layout, config or other Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (R22.5).
- Never open, print or commit any `.env` file. No paid OpenAI call runs.
- Checkpoint tasks make no commit unless a fix is needed; a fix made at a checkpoint is one commit with the trailer.

## Tasks

- [x] 1. UI steering file
  - [x] 1.1 Write `.kiro/steering/ui-design.md` and its check
    - Actual time: 4 min
    - Front matter `inclusion: fileMatch` and `fileMatchPattern: "apps/web/src/**"`.
    - At most 119 lines including front matter. Summarizes UI direction principles (including 5 to 8 and 10), the colour, type, radius and motion tokens with their exact values, the motion rules including Reduced_Motion and the two-Electricity limit, and the copy rules including the Banned_Cause_Words. Names `docs/design/ui-direction.md` as the source and says the source wins on any difference.
    - Write `scripts/ui-steering.test.ts`: front matter fields, line count at most 119, the source path present, and every colour hex in UI direction "Colour" present with the same value (R1.6).
    - This is the first build task of this spec (R1.1, R1.2).
    - Depends on: none.
    - Witness: `npx vitest run scripts/ui-steering.test.ts`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Token source
  - [x] 2.1 Write the `@theme static` token block in `apps/web/src/app/globals.css`
    - Actual time: 5 min
    - First confirm `@theme static` in the installed Tailwind 4 docs or source under `node_modules/tailwindcss`; if it is missing, stop and ask the owner.
    - Colour tokens `--color-night-0` … `--color-ember` with the 14 exact UI direction values; `--font-sans`, `--font-mono`, `--text-xs` to `--text-display`; `--radius-card`, `--radius-chip`, `--radius-control`; `--shadow-ecto-glow`, `--shadow-brass-glow`, `--shadow-card`; spring, `--dur-*`, `--ease-ecto` and `--stagger` properties as in design "Data Models".
    - Remove the starter colours and `Arial`/`Helvetica`. Body uses `var(--color-night-0)`, `var(--color-ink)` and `var(--font-sans)`, with tabular figures for `font-mono`. Update `apps/web/src/app/layout.tsx` body classes to token classes only (read the Next.js layout guide first); the Footer stays last in `<body>`.
    - Depends on: 1.1.
    - Witness: `npm run build` exits 0; `npx vitest run apps/web/src/components/Footer.test.tsx`.
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7_
  - [x] 2.2 Write `apps/web/src/ui/motion.ts`
    - Actual time: 2 min
    - Hand-written mirror: `COLOR`, `SPRING.float/settle/press`, `DUR` in ms, `EASE.ecto`, `STAGGER`, and `EVENT_MS` (`wake` 1200, `present-card` 800, `celebrate` 1600). Not generated.
    - Depends on: 1.1.
    - Witness: `npm run typecheck`.
    - _Requirements: 2.4, 2.5, 6.2, 6.8, 6.10_
  - [x] 2.3 Write `scripts/token-sync.test.ts`
    - Actual time: 3 min
    - Parse the `@theme static` block and compare every mirrored value in `motion.ts`, normalizing hex case and `ms` units. Assert the starter colours and `Arial`/`Helvetica` are gone and the body rules use the three tokens.
    - Depends on: 2.1, 2.2.
    - Witness: `npx vitest run scripts/token-sync.test.ts`.
    - _Requirements: 2.6, 2.7_
  - [x] 2.4 Write `apps/web/src/ui/contrast.ts` and `contrast.test.ts`
    - Actual time: 3 min
    - WCAG relative-luminance ratio and `PAIRINGS` (foreground, background, use: normal text, large text or control boundary) from `COLOR`. The test fails below 4.5:1 for normal text and 3:1 for large text and control boundaries, and asserts `stitch` is never listed as a control boundary (contract question 6).
    - Depends on: 2.2.
    - Witness: `npx vitest run apps/web/src/ui/contrast.test.ts`.
    - _Requirements: 18.4_

- [ ] 3. Token check and copy check
  - [x] 3.1 Write `scripts/token-check.mjs`
    - Actual time: 5 min
    - Pure `findTokenViolations(path, text)` returning `{ line, match, kind }` with kinds `hex`, `duration` and `palette`, using the patterns in design "Token_Check" (hex of 3, 4, 6 or 8 digits at a boundary; CSS transition and animation times; Tailwind `duration-*`/`delay-*` except `(--…)` and `[var(--…)]` forms; numeric `duration`/`delay` keys in `.ts`/`.tsx`; SVG `dur`/`begin` literals; Tailwind default palette, `-white` and `-black` classes).
    - `scanTokens(root)` over `.ts`, `.tsx`, `.css` and `.mjs` in `apps/web/src/components/` and `apps/web/src/ui/`, skipping the Token_Files and `*.test.*`. CLI prints `path:line: match` per violation and exits 1, else 0.
    - Depends on: 2.1, 2.2.
    - Witness: `node scripts/token-check.mjs` runs and lists the current violations in existing components (expected non-zero until 3.2).
    - _Requirements: 2.8, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 3.2 Move existing components to token classes
    - Actual time: 4 min
    - In `App.tsx`, `AuthPanel.tsx`, `CallScreen.tsx`, `DebugPanel.tsx`, `Footer.tsx`, `TypedInput.tsx` and `StandInAvatar.tsx`, replace every palette class, raw hex and ad hoc duration with token classes. Behavior and text stay the same. The call button keeps `rounded-full` with `bg-ecto` for start and a squared `bg-ember` form for hang-up; the six stand-in states keep six distinct token colours.
    - Update the class assertions in `StandInAvatar.test.tsx` from `bg-emerald-500`/`bg-red-600` to `bg-ecto`/`bg-ember`, keeping the shape assertions, so the same FSC R16.4 behavior stays checked (R23.4, R23.5).
    - Depends on: 2.1, 3.1.
    - Witness: `node scripts/token-check.mjs` exits 0; `npx vitest run apps/web/src/components`.
    - _Requirements: 2.8, 23.4, 23.5, 23.6_
  - [x] 3.3 Write `scripts/token-check.test.ts` examples and the repo scan
    - Actual time: 4 min
    - Runs `scanTokens` on the repo and expects no violation, so every `npm test` runs the Token_Check. Examples for each hex, duration and palette form, the accepted token forms, the skipped Token_Files and test files, and the CLI exit codes on a temporary tree.
    - Depends on: 3.1, 3.2.
    - Witness: `npx vitest run scripts/token-check.test.ts`.
    - _Requirements: 3.4, 3.5, 3.6, 3.7_
  - [x] 3.4 Write the property test for the Token_Check
    - Actual time: 4 min
    - **Property 18: Token_Check finds raw values**
    - In `scripts/token-check.test.ts`: random hex colours (3, 4, 6 or 8 digits) or ad hoc duration snippets inserted on a random line are reported on that line with the inserted text; text made only of token references reports nothing. At least 100 runs.
    - Depends on: 3.3.
    - Witness: `npx vitest run scripts/token-check.test.ts`.
    - **Validates: Requirements 3.2, 3.3, 3.4**
  - [x] 3.5 Write `scripts/copy-check.mjs` and `scripts/copy-check.test.ts`
    - Actual time: 5 min
    - Pure `findBannedCauseWords(text)` matching the Banned_Cause_Words as whole words or phrases in any letter case; a scan over string literals and JSX text in `apps/web/src/components/`, `apps/web/src/ui/` and `apps/web/src/app/specimens/`; CLI exit codes as in the Token_Check. The test runs the scan on the repo and expects none, plus examples ("Because", "led to", "becausey" passes).
    - Depends on: 1.1.
    - Witness: `npx vitest run scripts/copy-check.test.ts`.
    - _Requirements: 17.1_
  - [ ] 3.6 Write the property test for the copy check
    - **Property 17: Banned cause words are found**
    - In `scripts/copy-check.test.ts`: one Banned_Cause_Word inserted at a word boundary in random case is reported; text of non-banned words that do not contain one as a whole word reports nothing. At least 100 runs.
    - Depends on: 3.5.
    - Witness: `npx vitest run scripts/copy-check.test.ts`.
    - **Validates: Requirements 17.1**

- [ ] 4. Checkpoint: tokens and checks
  - Run `npm test` and `npm run typecheck`; both exit 0. Ensure all tests pass, ask the user if questions arise.

- [ ] 5. The `motion` dependency
  - [ ] 5.1 Install `motion@14.9.1` and confirm it
    - `npm install motion@14.9.1 -w @franki/web`; `apps/web/package.json` shows `"motion": "14.9.1"` with no range. Add nothing else (R22.2).
    - Read the docs and type definitions in `node_modules/motion` and `node_modules/framer-motion`. Confirm `MotionConfig` with `reducedMotion`, `AnimatePresence`, spring `stiffness` and `damping`, and the `motion/react` export.
    - Confirm `motion/react` builds under Turbopack: import it from a temporary `"use client"` component on `/`, run `npm run build`, then remove the probe before committing. The commit holds only `apps/web/package.json` and `package-lock.json`.
    - If any confirmation fails, stop and ask the owner before choosing another version.
    - Depends on: 3.4, 3.6.
    - Witness: `npm ls motion -w @franki/web` shows `motion@14.9.1`; the probe `npm run build` exited 0.
    - _Requirements: 22.1, 22.2_

- [ ] 6. Pure avatar model
  - [ ] 6.1 Write `apps/web/src/ui/avatar/types.ts` and `apps/web/src/ui/copy.ts`
    - Types `AvatarEvent`, `TimedEvent`, `LookName`, `AvatarInput`, `Eyes`, `Glow`, `Posture`, `Bolts`, `BodyMotion`, `AnimationId`, `AvatarLook`, `AvatarRendererProps`, `AvatarRenderer` exactly as design "Avatar types and the Avatar_Contract". `copy.ts` holds the six avatar labels.
    - Depends on: 2.2.
    - Witness: `npm run typecheck`.
    - _Requirements: 4.1, 5.4_
  - [ ] 6.2 Write `apps/web/src/ui/test-arbitraries.ts`
    - `arbState`, `arbEvent`, `arbLevel`, `arbElapsed`, `arbInput` and `arbEventInputs` as in design "Correctness Properties". Imported by tests only.
    - Depends on: 6.1.
    - Witness: `npm run typecheck`.
    - _Requirements: 23.1_
  - [ ] 6.3 Write the Look_Mapper `apps/web/src/ui/avatar/look.ts`
    - `lookFor(input)`: sanitize, effective event, fixed priority order, record built from the look table, `follows`/`drive`/`body` rules, Ghost overlay; and the closed validator `isAvatarLook`. No Wall_Clock_Read, random source, DOM, storage or network.
    - Depends on: 6.1.
    - Witness: `npm run typecheck`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 7.1, 7.2, 8.2, 9.1, 9.2_
  - [ ] 6.4 Write `apps/web/src/ui/avatar/look.test.ts`
    - One example per look-table row in both motion settings; labels per state; speaking with output muted gives Thinking and "Franki is thinking"; wake over connecting, wake continuing into listening, hang-up and recovery ending it; Listening and Speaking differ in `posture` and `follows`.
    - Depends on: 6.3.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.test.ts`.
    - _Requirements: 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_
  - [ ] 6.5 Write the property test for look totality
    - **Property 1: Look totality and determinism**
    - In `apps/web/src/ui/avatar/look.property.test.ts`. At least 100 runs.
    - Depends on: 6.2, 6.3.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 5.1, 5.2**
  - [ ] 6.6 Write the property test for the priority order
    - **Property 2: Fixed priority order**
    - Same file; the oracle is written from the design's priority table; extra weight on `recovery` and `closed` with each event. At least 100 runs.
    - Depends on: 6.5.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 5.3, 5.4, 5.7, 6.5, 6.6**
  - [ ] 6.7 Write the property test for Ghost_Mode
    - **Property 3: Ghost_Mode overlay**
    - Same file. At least 100 runs.
    - Depends on: 6.6.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 6.11**
  - [ ] 6.8 Write the property test for output muted
    - **Property 4: Output muted never drives the body**
    - Same file. At least 100 runs.
    - Depends on: 6.7.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 7.1, 7.2, 7.4**
  - [ ] 6.9 Write the property test for invalid levels
    - **Property 5: Invalid levels count as zero**
    - Same file; `arbLevel` biased to invalid values. At least 100 runs.
    - Depends on: 6.8.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 5.5**
  - [ ] 6.10 Write the property test for returning to rest
    - **Property 6: Every look returns to rest**
    - Same file. At least 100 runs.
    - Depends on: 6.9.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 8.1**
  - [ ] 6.11 Write the property test for timed event expiry
    - **Property 7: Timed events expire in the look**
    - Same file; `eventElapsedMs` from `EVENT_MS[e]` to `EVENT_MS[e] + 10000`. At least 100 runs.
    - Depends on: 6.10.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 8.2, 6.8, 6.10**
  - [ ] 6.12 Write the property test for reduced motion
    - **Property 11: Reduced motion is calm**
    - Same file. At least 100 runs.
    - Depends on: 6.11.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 9.1, 9.2**
  - [ ] 6.13 Write the property test for distinct looks
    - **Property 12: Different looks look different**
    - Same file; random pairs plus one hand-built input per Look_Name so every pair is covered in each motion setting. At least 100 runs.
    - Depends on: 6.12.
    - Witness: `npx vitest run apps/web/src/ui/avatar/look.property.test.ts`.
    - **Validates: Requirements 6.12, 9.2**
  - [ ] 6.14 Write the Event_Controller `apps/web/src/ui/avatar/events.ts`
    - `EventInput`, `EventState`, `initialEventState`, `reduceEvents`, `currentEvent` with rules 1 to 6 of design "Event_Controller": monotonic Frame_Time, expiry on every input, wake once per Visit, timed replacement except over wake, approval slot cleared by `approvalDone`, `closed` and `signOut`. No timers and no Wall_Clock_Read.
    - Depends on: 6.1.
    - Witness: `npm run typecheck`.
    - _Requirements: 6.2, 6.9, 8.3, 8.4_
  - [ ] 6.15 Write `apps/web/src/ui/avatar/events.test.ts`
    - Examples: automatic wake on first `connecting`; explicit wake ignored after; `present-card` dropped during wake; backward Frame_Time ignored; `signOut` clears both slots.
    - Depends on: 6.14.
    - Witness: `npx vitest run apps/web/src/ui/avatar/events.test.ts`.
    - _Requirements: 6.2, 8.3_
  - [ ] 6.16 Write the property test for no dead ends
    - **Property 8: No dead ends in the Event_Controller**
    - In `apps/web/src/ui/avatar/events.property.test.ts`; final frame at the last new event plus 1600 plus `fc.nat(5000)`. At least 100 runs.
    - Depends on: 6.2, 6.14.
    - Witness: `npx vitest run apps/web/src/ui/avatar/events.property.test.ts`.
    - **Validates: Requirements 8.3, 8.4**
  - [ ] 6.17 Write the property test for approval waits
    - **Property 9: Approval waits end when the approval ends**
    - Same file. At least 100 runs.
    - Depends on: 6.16.
    - Witness: `npx vitest run apps/web/src/ui/avatar/events.property.test.ts`.
    - **Validates: Requirements 8.3, 6.9**
  - [ ] 6.18 Write the property test for wake once
    - **Property 10: Wake at most once per Visit**
    - Same file; many `connecting`/`closed` flips and explicit `wake` inputs. At least 100 runs.
    - Depends on: 6.17.
    - Witness: `npx vitest run apps/web/src/ui/avatar/events.property.test.ts`.
    - **Validates: Requirements 6.2**

- [ ] 7. UI boundary check
  - [ ] 7.1 Write `scripts/ui-boundaries.mjs`
    - Rule 3: the full list of design pure modules (files not yet present are skipped) may import only types, `@franki/core`, `ui/motion.ts`, `ui/copy.ts` and each other, and must not mention `window`, `document`, `navigator`, `localStorage`, `fetch`, `requestAnimationFrame`, `AudioContext` or `Math.random`.
    - Rule 4: no `performance`-form Wall_Clock_Read in `components/` or `ui/` (the existing clock check covers the `Date` forms).
    - Rule 5: nothing in `components/surfaces/` imports from `client/`.
    - No file under `apps/web/src` or `apps/web/public` references `mascot-reference`.
    - Depends on: 6.3, 6.14.
    - Witness: `node scripts/ui-boundaries.mjs` exits 0.
    - _Requirements: 4.4, 5.1, 8.3, 10.6, 16.1_
  - [ ] 7.2 Write `scripts/ui-boundaries.test.ts`
    - Runs the check on the repo (expects none) and on temporary fake trees showing each rule failing and passing.
    - Depends on: 7.1.
    - Witness: `npx vitest run scripts/ui-boundaries.test.ts`.
    - _Requirements: 4.4, 5.1, 10.6, 16.1_

- [ ] 8. Checkpoint: avatar model
  - Run `npm test` and `npm run typecheck`; both exit 0, including Properties 1 to 12, 17 and 18. Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Audio levels and the Voice_Client change
  - [ ] 9.1 Write `apps/web/src/ui/levels/level-math.ts` and `level-math.test.ts`
    - `rawLevel` (RMS of 8-bit samples centred on 128, scaled, clamped; invalid gives 0), `smoothLevel` (attack 0.5, release 0.12; non-finite prior counts as 0), `levelFrom`. Examples for silence, full scale and empty buffers.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/levels/level-math.test.ts`.
    - _Requirements: 11.1, 11.6_
  - [ ] 9.2 Write the property test for level bounds
    - **Property 13: Levels stay in bounds**
    - In `apps/web/src/ui/levels/level-math.property.test.ts`; `fc.uint8Array` of length 0 to 2048, `fc.array(fc.double())`, priors from `arbLevel`. At least 100 runs.
    - Depends on: 6.2, 9.1.
    - Witness: `npx vitest run apps/web/src/ui/levels/level-math.property.test.ts`.
    - **Validates: Requirements 11.6, 11.1**
  - [ ] 9.3 Write `apps/web/src/ui/audio/context.ts` and `context.test.ts`
    - One shared `AudioContext`, created on the first `pointerdown` or `keydown` of the Visit; `getContext()` returns null before. Tested with an injected fake window and context constructor.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/audio/context.test.ts`.
    - _Requirements: 11.7, 19.2_
  - [ ] 9.4 Write `apps/web/src/ui/levels/level-meter.ts` and `level-meter.test.ts`
    - `createLevelMeter(getContext)` with `setStreams`, `sample`, `pause`, `resume`, `dispose`; one `AnalyserNode` (`fftSize` 512) per stream, connected to nothing else; old nodes disconnected first; Web Audio errors caught and reported as 0.
    - Test with a fake context: 0 and 0 with no streams or no context, disconnect on `setStreams` with nulls, paused meter reads nothing, and no `fetch`, storage or `MediaRecorder` use.
    - Depends on: 9.1, 9.3.
    - Witness: `npx vitest run apps/web/src/ui/levels/level-meter.test.ts`.
    - _Requirements: 10.7, 11.1, 11.2, 11.4, 11.5, 11.7_
  - [ ] 9.5 Add `onStreams` to the Voice_Client
    - In `apps/web/src/client/voice-client.ts` only: the optional `onStreams` field on `VoiceClientDeps` and a private `reportStreams()` wrapped in `try`/`catch`, called after the mic is set in `connect`, in `ontrack` after `srcObject` is set, and at the end of `teardown` with both null. No other change.
    - Write `apps/web/src/client/voice-client.streams.test.ts`: the three reporting points, and a throwing callback leaves call state unchanged. `voice-client.test.ts` is not edited.
    - Depends on: 7.2.
    - Witness: `npx vitest run apps/web/src/client`; `git diff --quiet build/lab-ui~1 -- apps/web/src/client/voice-client.test.ts` exits 0 after the commit.
    - _Requirements: 11.3, 11.5_

- [ ] 10. Announcements, Electricity and sound
  - [ ] 10.1 Write `apps/web/src/ui/announce.ts` and `announce.test.ts`
    - `announcement(prev, next)` and `callStatus(voice)` as in design "Announcements"; call-status labels added to `copy.ts`. Examples: first render null, one change, three changes joined in order, cleared error not announced.
    - Depends on: 6.1.
    - Witness: `npx vitest run apps/web/src/ui/announce.test.ts`.
    - _Requirements: 4.6, 18.5, 18.6, 18.7, 18.8_
  - [ ] 10.2 Write the property test for announcements
    - **Property 14: One coalesced announcement**
    - In `apps/web/src/ui/announce.property.test.ts`; strings from the real label sets, `CALL_ERRORS` values and null. At least 100 runs.
    - Depends on: 10.1.
    - Witness: `npx vitest run apps/web/src/ui/announce.property.test.ts`.
    - **Validates: Requirements 4.6, 18.5, 18.6, 18.7, 18.8**
  - [ ] 10.3 Write `apps/web/src/ui/electricity.ts`, `electricity-budget.ts` and `electricity.test.ts`
    - Seeded mulberry32 `boltPath(a, b, seed, depth)` by midpoint displacement and `regenGapMs(seed)` in 60 to 90; a budget with at most two grants and release. Examples for the budget's third request.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/electricity.test.ts`.
    - _Requirements: 10.3_
  - [ ] 10.4 Write the property test for bolt paths
    - **Property 19: Electricity paths are well formed**
    - In `apps/web/src/ui/electricity.property.test.ts`; depth 1 to 6. At least 100 runs.
    - Depends on: 10.3.
    - Witness: `npx vitest run apps/web/src/ui/electricity.property.test.ts`.
    - **Validates: Requirements 10.3**
  - [ ] 10.5 Write `apps/web/src/ui/sound/score.ts` and `score.test.ts`
    - `scoreFor(cue)` for `wake`, `thinking`, `card`, `celebrate` and `receipt` as in design "Sound engine"; every `peakGain` at most 0.25.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/sound/score.test.ts`.
    - _Requirements: 19.1, 19.5_
  - [ ] 10.6 Write `apps/web/src/ui/sound/schedule.ts` and `schedule.test.ts`
    - `scheduleCues(prev, look, extra, gate)` with `SoundGate` and `SoundTrack`; the track still updates while the gate is closed. Examples for each cue and each closed gate.
    - Depends on: 6.1, 10.5.
    - Witness: `npx vitest run apps/web/src/ui/sound/schedule.test.ts`.
    - _Requirements: 19.2, 19.3, 19.4, 19.7, 19.8_
  - [ ] 10.7 Write the property test for cue scheduling
    - **Property 15: Sound plays only when allowed**
    - In `apps/web/src/ui/sound/sound.property.test.ts`; arrays of `{name, at}` with non-decreasing `at` and a random gate per step. At least 100 runs.
    - Depends on: 10.6.
    - Witness: `npx vitest run apps/web/src/ui/sound/sound.property.test.ts`.
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.7, 19.8**
  - [ ] 10.8 Write the property test for cue scores
    - **Property 16: Cue scores stay quiet and short**
    - Same file as 10.7. At least 100 runs.
    - Depends on: 10.7.
    - Witness: `npx vitest run apps/web/src/ui/sound/sound.property.test.ts`.
    - **Validates: Requirements 19.1, 19.5**
  - [ ] 10.9 Write `apps/web/src/ui/sound/engine.ts` and `engine.test.ts`
    - Plays a score on the shared context through a master `GainNode` never above 0.25; when `outputMuted` becomes false, ramps to 0 over 40 ms with `linearRampToValueAtTime` and stops sources. Loads no audio file.
    - Test with a fake context that records gain values: master never above 0.25, ramp ends within 50 ms, no play without a context.
    - Depends on: 9.3, 10.5.
    - Witness: `npx vitest run apps/web/src/ui/sound/engine.test.ts`.
    - _Requirements: 19.1, 19.4, 19.5_
  - [ ] 10.10 Write `apps/web/src/ui/sound/preference.ts` and `preference.test.ts`
    - `localStorage["franki.sound"]` as `"on"` or `"off"`; default on when missing or when storage throws. Tested with a fake storage.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/sound/preference.test.ts`.
    - _Requirements: 19.6_

- [ ] 11. Reduced motion, visibility and the frame loop
  - [ ] 11.1 Write `apps/web/src/ui/hooks/reduced-motion.ts` and `reduced-motion.test.ts`
    - `ReducedMotionWatcher` over a `MediaQueryList`-shaped object, `useReducedMotion()` on `useSyncExternalStore` with server snapshot `true`, and the `ReducedMotionOverride` context. Test: a `change` event applies synchronously; missing `matchMedia` stays `true`; the override wins.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/hooks/reduced-motion.test.ts`.
    - _Requirements: 9.4, 20.2_
  - [ ] 11.2 Write `apps/web/src/ui/hooks/page-visible.ts` and `page-visible.test.ts`
    - `VisibilityGate` over a `document`-shaped object and its hook. Test: listeners told on hidden and visible.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/hooks/page-visible.test.ts`.
    - _Requirements: 10.7_
  - [ ] 11.3 Write `apps/web/src/ui/hooks/frame-loop.ts` and `frame-loop.test.ts`
    - One `requestAnimationFrame` loop (scheduler injected) that samples the meter, feeds `{kind:"frame", at}` to the Event_Controller, calls `lookFor`, and publishes only when a discrete field changes or `drive` moves by at least 1/32; stops while hidden and pauses the meter, resumes on visible.
    - Test with a fake scheduler and meter: Frame_Time is the only time used, publish throttling, pause and resume.
    - Depends on: 6.3, 6.14, 9.4, 11.2.
    - Witness: `npx vitest run apps/web/src/ui/hooks/frame-loop.test.ts`.
    - _Requirements: 10.6, 10.7, 11.1_

- [ ] 12. Checkpoint: browser modules
  - Run `npm test` and `npm run typecheck`; both exit 0, including Properties 13 to 16 and 19, and `voice-client.test.ts` unchanged. Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Avatar renderer
  - [ ] 13.1 Write `apps/web/src/components/avatar/Electricity.tsx`
    - `"use client"`. Draws `boltPath` as an SVG polyline stroked `spark` with a `gold` glow, regenerating when Frame_Time passes `regenGapMs`; asks the budget for a grant and draws a steady glow without one; renders nothing under Reduced_Motion; releases its grant on unmount.
    - Test in `Electricity.test.tsx`: no output with Reduced_Motion on; steady glow when the budget is full; token colours only.
    - Depends on: 5.1, 10.3.
    - Witness: `npx vitest run apps/web/src/components/avatar/Electricity.test.tsx`.
    - _Requirements: 9.1, 10.3_
  - [ ] 13.2 Write `SvgGhost.tsx`, `Avatar.tsx`, `Stage.tsx` and the CSS loops
    - `SvgGhost` implements the Avatar_Contract and draws the parts of R4.3 with `data-part` names `hem`, `hair`, `bolt-left`, `bolt-right`, `scar`, `eye-left`, `eye-right`, and no mouth. Squish scale follows `drive` only when `follows` is `output`; float only with Reduced_Motion off; glows use blur in full motion and radial gradients when reduced.
    - `Avatar` is the only place a renderer is chosen (default `SvgGhost`), with `role="img"`, `aria-label={look.label}`, `data-look`, `data-ghost` and `data-reduced`. `Stage` holds the halo and the floor shadow that narrows as Franki rises.
    - In `globals.css`: keyframes for float, breathe, blink and the other `AnimationId`s using duration tokens, inside `@media (prefers-reduced-motion: no-preference)`, switched off by `[data-reduced="true"]` and paused by `[data-paused="true"]`. Only `transform` and `opacity` animate per frame.
    - Tests in `SvgGhost.test.tsx` and `Avatar.test.tsx`: every Look_Name renders the named parts, no mouth, no `<img>`, `<video>`, `<audio>`, `<canvas>` or `<image>`, `role="img"` and the label; squish scale 1 at drive 0 and while output is muted; float class only with Reduced_Motion off.
    - Depends on: 6.3, 11.1, 13.1.
    - Witness: `npx vitest run apps/web/src/components/avatar`; `node scripts/token-check.mjs` exits 0.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.13, 7.3, 7.4, 9.1, 9.3, 10.5, 10.7, 18.1_

- [ ] 14. Surfaces
  - [ ] 14.1 Write `apps/web/src/ui/surface-props.ts` and the Surface copy
    - Type-only module with the props in design "Data Models" (`SourceTag`, `HardRule`, `CardProps`, `StripProps`, `MoteKind`, `JarProps`, `Area`, `KnownItem`, `WhatIKnowProps`, `LabProps`, `ReceiptProps`, `TimeBadgeProps`, `CaptionsProps`, `ChipsProps`, `TurnCopies`).
    - Add every Surface and control string from the design to `copy.ts` ("Yes", "Not now", "Checked for", "Guessed", "Wrong", "Forget", "Don't bring it up", "What I know", "Blocked now", "Cleaned up", "Simulated:", "Captions", "Sound effects", "Sign in to wake Franki", "Type to Franki", the area names), short, second-person and sentence case.
    - Depends on: 7.1.
    - Witness: `npm run typecheck`; `npx vitest run scripts/copy-check.test.ts`.
    - _Requirements: 16.1, 16.7, 17.4_
  - [ ] 14.2 Write `components/motion/Materialize.tsx`, `surfaces/Seal.tsx` and `surfaces/Seam.tsx`
    - `Materialize`: `AnimatePresence` wrapper; enter rises 12 px, fades in, unblurs 6 px to 0; exit rises 8 px, fades out, blurs to 6 px; springs and durations from `motion.ts`; a plain opacity fade under Reduced_Motion. `Seal`: brass lock seal. `Seam`: stitched dashed divider in `stitch`, `aria-hidden`.
    - Tests in `Materialize.test.tsx` and `Seal.test.tsx`: variants with and without Reduced_Motion; the seal has an accessible name; the seam is hidden from assistive tech.
    - Depends on: 5.1, 11.1.
    - Witness: `npx vitest run apps/web/src/components/motion apps/web/src/components/surfaces`.
    - _Requirements: 9.3, 10.1, 10.2, 15.5_
  - [ ] 14.3 Write `surfaces/Card.tsx` with all five kinds
    - Title, content, sources, actions in that order; numbers in mono tabular figures, each with a source tag that calls `onOpenSource(id)`. Approval: exactly **Yes** (brass) and **Not now** (quiet), neither focused nor pre-selected. Food: "Checked for" line per person with seals, no "safe" copy. Hard rules: seal with lock and a separate **Remove** button; no swipe or dismiss removes them. Returns `null` when nothing true to show.
    - `Card.test.tsx`: each kind's markup order, the source callback, two approval actions with no `autofocus`, `aria-pressed` or `checked`, "safe" absent, Remove the only removal path, `null` for empty props.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Card.test.tsx`.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 16.1, 16.12_
  - [ ] 14.4 Write `surfaces/CardDock.tsx`
    - First card primary; up to two older ones behind at scale 0.96 and 0.92; right column at 1024 px and wider, bottom sheet below; enters from the stage side with `spring.settle`; `null` with no cards.
    - `CardDock.test.tsx`: one primary, stacked scales, breakpoint classes, `null` when empty.
    - Depends on: 14.3.
    - Witness: `npx vitest run apps/web/src/components/surfaces/CardDock.test.tsx`.
    - _Requirements: 12.2, 15.6, 15.7, 16.12_
  - [ ] 14.5 Write `surfaces/Strip.tsx`
    - Five terminals (Noticed, Connected, Suggested, You said yes, result label); filled per props; current along the wire to each newly filled terminal with `STAGGER`; last terminal `gold` when filled; `null` when `open` is false.
    - `Strip.test.tsx`: every fill level 0 to 5, gold last terminal, `null` when closed.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Strip.test.tsx`.
    - _Requirements: 16.1, 16.2, 16.12_
  - [ ] 14.6 Write `surfaces/Jar.tsx` and `surfaces/WhatIKnowSheet.tsx`
    - Jar: one mote per memory up to 48, solid, dashed, brass and frosted by kind; a button named "What I know" that calls `onOpen`; `null` with no motes. Sheet: hard rules first under their seal, then the five areas in order; "Guessed" with dashed outline; text, origin and **Wrong**, **Forget**, **Don't bring it up** per item, each calling its prop with the item ID.
    - `Jar.test.tsx` and `WhatIKnowSheet.test.tsx`: cap at 48, mote kinds, callbacks, grouping order, `null` when empty.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Jar.test.tsx apps/web/src/components/surfaces/WhatIKnowSheet.test.tsx`.
    - _Requirements: 16.1, 16.3, 16.4, 16.12_
  - [ ] 14.7 Write `surfaces/Lab.tsx` and `surfaces/Odometer.tsx`
    - Mono tabular counters; `—` for null and no placeholder zero; odometer roll on change (transform only, fade under Reduced_Motion); a `<details>` fold for honest limits; `null` with no counters.
    - `Lab.test.tsx`: real values, `—` for null, no "0" for null, the fold, `null` when empty.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Lab.test.tsx`.
    - _Requirements: 16.1, 16.5, 16.12_
  - [ ] 14.8 Write `surfaces/Receipt.tsx` and `apps/web/src/ui/receipt-from.ts`
    - Receipt prints up over `dur.ritual`; shows "Blocked now", "Cleaned up", "Kept: n safety rule(s)" and counts by kind; `null` when nothing completed. Pure `receiptFrom(payload)` maps a `forgetReceipt`-shaped value with the fixed collection-to-kind map (contract question 7); `scopePending` adds no line. Add `receipt-from.ts` to the pure list in `scripts/ui-boundaries.mjs`.
    - `Receipt.test.tsx`: lines and counts, `null` when empty, and an `expectTypeOf` test that `ReceiptProps` has no string field that could carry item text; `receipt-from.test.ts` for the mapping.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Receipt.test.tsx apps/web/src/ui/receipt-from.test.ts scripts/ui-boundaries.test.ts`.
    - _Requirements: 16.1, 16.6, 16.7, 16.12, 17.7_
  - [ ] 14.9 Write `surfaces/TimeBadge.tsx` and `apps/web/src/ui/format-time.ts`
    - "Simulated: Thu 6:00 PM" with a bolt glyph, rendered whenever `simulated` is true and `null` otherwise. `format-time.ts` uses `Intl.DateTimeFormat` over a `Date` built from the supplied milliseconds and zone, never a Wall_Clock_Read.
    - `TimeBadge.test.tsx` and `format-time.test.ts`: fixed instants in two zones, `null` when not simulated.
    - Depends on: 14.1.
    - Witness: `npx vitest run apps/web/src/components/surfaces/TimeBadge.test.tsx apps/web/src/ui/format-time.test.ts`.
    - _Requirements: 16.1, 16.8, 16.12_
  - [ ] 14.10 Write `surfaces/Captions.tsx` and `surfaces/Chips.tsx`
    - Captions: one line, fades after it ends, no history, off by default with a "Captions" toggle calling `onToggle`. Chips: glass capsules with a stitched outline, each a button calling `onChip(text)`, disabled per props; `null` with no chips.
    - `Captions.test.tsx` and `Chips.test.tsx`: off by default, one line only, toggle, chip callback, `null` when empty.
    - Depends on: 14.1, 14.2.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Captions.test.tsx apps/web/src/components/surfaces/Chips.test.tsx`.
    - _Requirements: 16.1, 16.9, 16.10, 16.12_
  - [ ] 14.11 Write `surfaces/Wordmark.tsx` and its keyframes
    - "Franki" for `header`; `FRANKIROCKS` for `signedOut` with K, I, R, O (letters 5 to 8) lighting gold once by a one-iteration CSS animation in `globals.css` using duration tokens, and a fade only under Reduced_Motion.
    - `Wordmark.test.tsx`: both variants, the four lit letters, one iteration.
    - Depends on: 13.2, 14.1.
    - Witness: `npx vitest run apps/web/src/components/surfaces/Wordmark.test.tsx`; `node scripts/token-check.mjs` exits 0.
    - _Requirements: 13.2, 16.11_

- [ ] 15. Checkpoint: components
  - Run `npm test`, `npm run typecheck` and `npm run lint`; all exit 0, including the token check and copy check over the new components. Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Main screen
  - [ ] 16.1 Write `apps/web/src/ui/turn-copies.ts` and `TypedTurns.dropTurnCopies()`
    - Pure `latestReply(entries)` and `clearTurnCopies(s)`. In `apps/web/src/client/typed-turns.ts`, add only `dropTurnCopies()`, which empties `entries` and `text`.
    - `turn-copies.test.ts`: examples for both functions and the method.
    - Depends on: 14.1.
    - Witness: `npx vitest run apps/web/src/ui/turn-copies.test.ts apps/web/src/client`.
    - _Requirements: 14.8, 17.5_
  - [ ] 16.2 Write the property test for forget clearing
    - **Property 20: Forget clears every turn copy**
    - In `apps/web/src/ui/turn-copies.property.test.ts`. At least 100 runs.
    - Depends on: 16.1.
    - Witness: `npx vitest run apps/web/src/ui/turn-copies.property.test.ts`.
    - **Validates: Requirements 17.5**
  - [ ] 16.3 Write the property test for the latest reply
    - **Property 21: Only the latest reply shows**
    - Same file; unique marker text per entry. At least 100 runs.
    - Depends on: 16.2.
    - Witness: `npx vitest run apps/web/src/ui/turn-copies.property.test.ts`.
    - **Validates: Requirements 14.8**
  - [ ] 16.4 Write `apps/web/src/ui/debug-flag.ts` and `debug-flag.test.ts`
    - Pure `debugVisible(nodeEnv, search)`: true only when `nodeEnv` is not `production` and `search` has `debug=1`.
    - Depends on: 7.1.
    - Witness: `npx vitest run apps/web/src/ui/debug-flag.test.ts`.
    - _Requirements: 21.1, 21.3, 21.4_
  - [ ] 16.5 Write `ReplyLine.tsx`, `LiveRegion.tsx` and `SoundToggle.tsx`
    - `ReplyLine` shows `latestReply` as one line in a polite region, escaping stored markup. `LiveRegion` is one visually hidden `aria-live="polite" aria-atomic="true"` region that alternates two child nodes so a repeated message is spoken again. `SoundToggle` is one button named "Sound effects" with `aria-pressed`, using `preference.ts`, at least 44 px.
    - Tests: `ReplyLine.test.tsx` (latest only, escaping), `LiveRegion.test.tsx` (one region, alternation), `SoundToggle.test.tsx` (name, `aria-pressed`, toggling writes the preference).
    - Depends on: 10.1, 10.10, 16.1.
    - Witness: `npx vitest run apps/web/src/components/ReplyLine.test.tsx apps/web/src/components/LiveRegion.test.tsx apps/web/src/components/SoundToggle.test.tsx`.
    - _Requirements: 4.6, 14.8, 18.1, 18.3, 18.5, 18.8, 19.6_
  - [ ] 16.6 Write `TypedLine.tsx` and update `TypedInput`
    - Collapsed: a keyboard-glyph button "Type to Franki". Open: a one-row `<textarea>` that sends on Enter, keeps line feeds on Shift+Enter and paste, respects IME composition, and collapses on Escape when empty; existing send rules (FSC R18.1, R18.8 to R18.10). Remove `ConversationView` from `TypedInput.tsx`; keep `TypedInput` exported.
    - In `TypedInput.test.tsx`, the conversation-view escaping test renders `ReplyLine` instead; every `TypedTurns` behavior test stays. Add `TypedLine.test.tsx` for collapse, open, Enter, Shift+Enter, paste line feeds, IME and Escape.
    - Depends on: 16.5.
    - Witness: `npx vitest run apps/web/src/components/TypedInput.test.tsx apps/web/src/components/TypedLine.test.tsx`.
    - _Requirements: 14.7, 14.8, 18.1, 18.2, 18.3, 23.4, 23.5_
  - [ ] 16.7 Rebuild `CallScreen.tsx` and move its tests
    - Same file name, `CALL_ERRORS` export and props. One button with `data-form` `start`/`hangup`, `aria-label` "Call Franki"/"Hang up", 64 px target; start `data-shape="round"` with `ring-brass` and an `bg-ecto` core; hang-up `data-shape="square"` with `bg-ember`; disabled exactly as today. Press moves down 2 px with `spring.press`; with Reduced_Motion off and an Electricity grant, one spark runs around the ring. Mute toggle as R14.5 with the muted indicator. Retry and errors stay inline.
    - Write `CallScreen.test.tsx` with the call-control tests moved from `StandInAvatar.test.tsx` (one button, `data-shape` round vs square, `ring-brass`/`bg-ecto` vs `bg-ember`, labels, disabled states, mute only while listening, thinking or speaking, `aria-pressed`, muted indicator, failed step named, retry after 30 s) and remove them from `StandInAvatar.test.tsx` in the same commit.
    - Depends on: 3.2, 5.1, 10.3, 13.1.
    - Witness: `npx vitest run apps/web/src/components/CallScreen.test.tsx apps/web/src/components/StandInAvatar.test.tsx`.
    - _Requirements: 10.4, 14.4, 14.5, 14.6, 18.1, 18.2, 18.3, 23.4, 23.6_
  - [ ] 16.8 Update `AuthPanel.tsx`, `Footer.tsx` and `Footer.test.tsx`
    - Signed out: one brass "Sign in to wake Franki" button calling the same Google sign-in, disabled while `loading` or `busy`, with the existing inline error and cause. Signed in: the email and "Sign out" for the header. Footer changes token classes only; same text and `data-testid`.
    - In `Footer.test.tsx`, change the sign-in label to "Sign in to wake Franki" and keep every other check (footer once per page and last in `<body>`, email, enabled and disabled sign-in).
    - Depends on: 3.2.
    - Witness: `npx vitest run apps/web/src/components/Footer.test.tsx`.
    - _Requirements: 12.5, 13.1, 13.4, 13.5, 14.9, 23.4, 23.5, 23.6_
  - [ ] 16.9 Write `screen/MainScreen.tsx` and `screen/Backdrop.tsx`
    - Read the Next.js App Router guides for client components first. CSS grid with the named areas of design "Main screen"; empty slots keep their area and render nothing; dock bottom sheet below 1024 px; corners stack below 640 px; no fixed width above 343 px. `Backdrop` draws the blueprint grid at about 3%, `feTurbulence` grain at about 4% and the vignette, `aria-hidden`.
    - Signed out: Dormant avatar, `FRANKIROCKS` Wordmark, the sign-in button, the call button in start form disabled, the typed-line glyph disabled, no Chips or other Surface.
    - `MainScreen.test.tsx`: signed-out and signed-in screens with fake sources; grid areas; Card, Strip, Jar, What_I_Know_Sheet, Lab, Receipt, Time_Badge, Chips and Captions absent; header email; controls in DOM order with no positive `tabindex`, a visible focus class and a 44 px minimum size class on every control.
    - Depends on: 13.2, 14.11, 16.5, 16.6, 16.7, 16.8.
    - Witness: `npx vitest run apps/web/src/components/screen/MainScreen.test.tsx`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1, 13.3, 13.4, 14.1, 14.2, 14.9, 17.2, 17.3, 18.1, 18.2, 18.3_
  - [ ] 16.10 Wire `App.tsx` and retire the Stand_In_Avatar
    - `App.tsx` keeps the auth, controllers and sign-in/out flow and feeds only today's sources: `AuthState`, `VoiceState` via `avatarState()`, `callButton()` and `muteVisible()`, `micMuted`, `outputMuted`, Level_Meter levels via `onStreams`, and `TypedTurns`. It runs the frame loop, the Event_Controller (`signOut` on sign-out), `lookFor`, the announcement into `LiveRegion`, `scheduleCues` into the sound engine with the gesture, preference and `outputMuted` gate, `MotionConfig reducedMotion` with `data-reduced` and `data-paused` on the root, and `onForgetComplete()` calling `clearTurnCopies` and `dropTurnCopies` (wired, no caller in this slice). The `DebugPanelModel` is created and polled only when `debugVisible(process.env.NODE_ENV, window.location.search)` read once after mount is true.
    - Delete `StandInAvatar.tsx` and `StandInAvatar.test.tsx`. Each remaining check maps per design "Existing tests that change": six distinct states → Properties 2 and 12; labels and `role="img"` → `SvgGhost.test.tsx`; no image, video or canvas → `SvgGhost.test.tsx` (`<svg>` now required, R4.3); `data-state="recovery"` → `data-look="Recovery"` asserted in `App.test.tsx`.
    - `App.test.tsx` with a fake API and fake sources: no `/api/` call while signed out except `/api/health`; no `GET /api/debug/memory` without `debug=1` or in production; one call with `debug=1` in development; one coalesced announcement on a state and call change; Recovery look on a call error; `onForgetComplete` empties the reply line.
    - Depends on: 9.5, 10.9, 11.3, 16.1, 16.4, 16.9.
    - Witness: `npx vitest run apps/web/src/components`; `npm run build` exits 0.
    - _Requirements: 4.2, 4.6, 9.4, 10.7, 11.4, 11.7, 13.3, 14.1, 14.2, 17.5, 17.6, 18.5, 18.6, 18.7, 18.8, 19.2, 19.3, 19.4, 19.7, 21.1, 21.2, 21.3, 21.4, 23.4, 23.5_

- [ ] 17. Checkpoint: main screen
  - Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`; all exit 0, including Properties 20 and 21. Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Specimens page
  - [ ] 18.1 Make `apps/web/next.config.ts` a function of phase
    - Read `pageExtensions.md` and the "Phase" section of `next.config.js` docs under `node_modules/next/dist/docs/` first. `config(phase)` keeps every existing setting and sets `pageExtensions` to `["tsx", "ts", "jsx", "js"]`, adding `"dev.tsx"` only for `PHASE_DEVELOPMENT_SERVER`.
    - Write `apps/web/src/next-config.test.ts`: `dev.tsx` appears only for the development-server phase; existing settings kept for every phase.
    - Depends on: 16.10.
    - Witness: `npx vitest run apps/web/src/next-config.test.ts`; `npm run build` exits 0.
    - _Requirements: 20.3, 22.5_
  - [ ] 18.2 Write `app/specimens/page.dev.tsx`, `_fixtures` and `_sections`
    - A plain Server Component rendering client sections, no Server Action, `use cache`, `next/og`, ISR or `/api/` call. `_fixtures/index.ts` exports `SPECIMENS_SENTINEL_9c41`. Sections show the avatar for every Look_Name, every Avatar_Event over every state and Ghost_Mode over each state, each with Reduced_Motion off and forced on through `ReducedMotionOverride`; every Card kind including hard rules and approval; the Strip at fills 0 to 5; the Jar with every mote kind and over the cap; the What_I_Know_Sheet; the Lab with real counts and `—`; the Receipt; the Time_Badge; Captions on and off; Chips; both Wordmarks; the call button in every form; the forget clear before and after. Fixture copy passes the copy check.
    - `app/specimens/specimens.test.tsx` imports `page.dev.tsx` and asserts one `data-look` per Look_Name × Avatar_Event × Reduced_Motion combination and every Surface kind. Add the Specimens_Page to the page list in `Footer.test.tsx`.
    - Depends on: 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 18.1.
    - Witness: `npx vitest run apps/web/src/app/specimens apps/web/src/components/Footer.test.tsx scripts/copy-check.test.ts`.
    - _Requirements: 12.5, 17.1, 20.1, 20.2, 20.5, 20.6_
  - [ ] 18.3 Write `scripts/specimens-absent.mjs`, its test and the `postbuild` script
    - Run `npm run build` once and confirm the 16.4.3 route manifest names under `apps/web/.next/` before writing the check. The check fails if any manifest key contains `specimens` or any file under `.next/server` or `.next/static` contains `SPECIMENS_SENTINEL_9c41`. Add `"postbuild": "node ../../scripts/specimens-absent.mjs"` (path adjusted to the repo layout) to `apps/web/package.json`.
    - `scripts/specimens-absent.test.ts` on temporary fake `.next` trees: a manifest with `/specimens/page` fails, a file with the sentinel fails, a clean tree passes.
    - Depends on: 18.2.
    - Witness: `npx vitest run scripts/specimens-absent.test.ts`; `npm run build` exits 0 with the postbuild check run.
    - _Requirements: 20.3, 20.4_

- [ ] 19. Fixture-import check
  - [ ] 19.1 Extend `scripts/ui-boundaries.mjs` with the Specimens rules
    - Rule 2: walk the import graph (relative imports and `@franki/*` names) from `app/page.tsx` and `app/layout.tsx` and fail on any module under `app/specimens/`; fail if any file other than `app/specimens/page.dev.tsx` uses the `.dev.tsx` suffix; fail if any file outside `app/specimens/` imports from it. Also fail if any module in the pure list does not exist.
    - Extend `scripts/ui-boundaries.test.ts` with fake trees for each new rule, and the repo run.
    - Depends on: 16.10, 18.2.
    - Witness: `npx vitest run scripts/ui-boundaries.test.ts`; `node scripts/ui-boundaries.mjs` exits 0.
    - _Requirements: 14.3, 17.2, 20.3, 20.5_

- [ ] 20. Final checks
  - [ ] 20.1 Run every check and write the report
    - `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` each exit 0 (R23.7). Confirm `git diff --stat` shows no change in `packages/server`, `docs/design/` or `apps/web/src/app/api/`.
    - Manual check: after the build, start `npx next start` in `apps/web` as a background process, request `/specimens`, expect HTTP 404 from the default not-found, then stop the process.
    - Report to the owner: what changed; `motion@14.9.1` added; requirement changes (FSC R16.1 to R16.3 superseded, FSC R18.6 narrowed to the latest reply, the sign-in label); the test mapping from `StandInAvatar.test.tsx`, `Footer.test.tsx` and `TypedInput.test.tsx`; the open contract questions; and what could not be checked (contrast and focus rings in a real browser, 60 fps on a mid-range laptop, sound levels by ear, layout at 375 px by eye, and the 404 if it could not be run).
    - No commit unless a fix was needed; a fix is one commit with the trailer.
    - Depends on: 18.3, 19.1.
    - Witness: the four commands exit 0; the `/specimens` request returns 404.
    - _Requirements: 20.4, 22.4, 22.8, 23.7, 23.8_

## Notes

- No task is optional. All property tasks (Properties 1 to 21) and all test work are required (R23.3).
- Updates to existing tests happen in the task that changes the behavior they check, so every commit keeps `npm test` green: `StandInAvatar.test.tsx` in 3.2, 16.7 and 16.10; `Footer.test.tsx` in 16.8 and 18.2; `TypedInput.test.tsx` in 16.6. Task 20.1 reports the full mapping.
- Existing components move to token classes in 3.2, before the Token_Check repo scan is wired in 3.3, because the scan would otherwise fail on today's palette classes.
- Property tests that share a file (`look.property.test.ts`, `events.property.test.ts`, `sound.property.test.ts`, `turn-copies.property.test.ts`, `token-check.test.ts`, `copy-check.test.ts`) are chained so no two tasks edit the same file in one wave.
- `copy.ts` gets every Surface and control string in 14.1 so later tasks read it rather than edit it in parallel.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.5"] },
    { "id": 2, "tasks": ["2.3", "2.4", "3.1", "3.6", "6.1"] },
    { "id": 3, "tasks": ["3.2", "6.2", "6.3", "6.14", "10.1"] },
    { "id": 4, "tasks": ["3.3", "6.4", "6.5", "6.15", "6.16", "7.1", "10.2"] },
    { "id": 5, "tasks": ["3.4", "6.6", "6.17", "7.2"] },
    { "id": 6, "tasks": ["5.1", "6.7", "6.18", "9.1", "9.3", "9.5", "10.3", "10.5", "10.10", "11.1", "11.2", "14.1", "16.4"] },
    { "id": 7, "tasks": ["6.8", "9.2", "9.4", "10.4", "10.6", "10.9", "13.1", "14.2", "14.9", "16.1"] },
    { "id": 8, "tasks": ["6.9", "10.7", "11.3", "13.2", "14.3", "14.5", "14.6", "14.7", "14.8", "14.10", "16.2", "16.5", "16.7", "16.8"] },
    { "id": 9, "tasks": ["6.10", "10.8", "14.4", "14.11", "16.3", "16.6"] },
    { "id": 10, "tasks": ["6.11", "16.9"] },
    { "id": 11, "tasks": ["6.12", "16.10"] },
    { "id": 12, "tasks": ["6.13", "18.1"] },
    { "id": 13, "tasks": ["18.2"] },
    { "id": 14, "tasks": ["18.3", "19.1"] },
    { "id": 15, "tasks": ["20.1"] }
  ]
}
```
