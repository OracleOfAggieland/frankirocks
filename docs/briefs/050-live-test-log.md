# Brief 050: a log for live test sessions (lane `live-test`)

**Who builds this.** Claude builds it from this brief, in three parts that run at the same time. It is not Kiro's work, and its commits do not carry the Kiro trailer.

## What it is

The owner tests Franki by using it: a real call, typed lines, the phone, the bank, the radio, errands. Today almost nothing from such a session survives. The server prints JSON lines to a terminal buffer that scrolls away, the browser keeps 50 latency rows that vanish at hang-up, and nothing ties a number to the step the owner was on.

This brief adds a development-only recorder. Started through one launcher, the dev server writes every server event, every browser event and every step marker of a session into one folder on disk, and two scripts turn that folder into a report.

Nothing here changes what a production build does or contains.

## Rules that bind every part

1. **Off unless asked for.** Everything is inert unless `FRANKI_LIVE_TEST_DIR` is set and `NODE_ENV` is not `production`. The browser recorder is never imported unless `NEXT_PUBLIC_FRANKI_LIVE_TEST` is `"1"` at build time (a dynamic import behind that check, so a production bundle never holds it). The page and the route use the `page.dev.tsx` / `route.dev.ts` extensions, like `/recorder` and `/api/dev/takes`.
2. **No behavior change.** No change to the voice reducer, its golden corpus, `packages/core`, any wire schema, any committed property test, or what `consoleLog` prints. Hooks are optional fields that default to nothing. With the recorder off, every existing test passes untouched.
3. **Two files, two rules.** `events.ndjson` holds IDs, times, counts and enum values only, the same rule as `Log` in `packages/server/src/routes/runtime.ts`. `words.ndjson` is the only place words go (what was said, typed lines, the owner's notes). Never write a token, an SDP body, an `Authorization` header, a mail body or a secret to either file.
4. **Time comes from the clock ports.** Server code reads `deps.clock` or the live clock file. Browser code reads `client/clock.ts`, and `performance` only under `apps/web/src/client/`. `scripts/clock-check.mjs` and `scripts/ui-boundaries.mjs` must still pass. Files under `scripts/live-test/` are outside the clock scan and may read the wall clock.
5. **The server does not import `next`.** Route logic lives in `packages/server`; the `route.dev.ts` file is a thin shell, like `api/dev/takes/route.dev.ts`.
6. **The dev server may load a module more than once.** Write with append calls of whole lines (one `appendFileSync` per line or per batch). Keep no in-memory state the file depends on.
7. **Builders share one checkout.** Touch only the files your part owns. Do not commit, do not switch branches, do not start a dev server, do not sign in and do not start a call. Run your own tests by path (`npx vitest run <paths>`). Run `npm run typecheck` once at the end; if it fails in a file another part owns, report it and leave it.

## The run folder

`FRANKI_LIVE_TEST_DIR` is one run's folder. It holds:

| File | Written by | Holds |
|---|---|---|
| `meta.json` | launcher | start time, commit, branch, dirty flag, Node version, port, the `FRANKI_*_MODEL` values |
| `script.json` | launcher (a copy of `--script`) | the steps of this session, if a script was given |
| `server.log` | launcher | the dev server's raw stdout and stderr, each line prefixed with epoch ms |
| `events.ndjson` | sink | one event per line, from server, browser and runner |
| `words.ndjson` | sink | one line per utterance, typed line or note |
| `firestore/*.json` | export script | the test user's stored records after the session |
| `report.md`, `summary.json` | report script | the results |

## The event line (the contract between the parts)

One JSON object per line, flat. Values are string, number, boolean or an array of strings.

```json
{"t":1763159000123,"src":"server","kind":"route.done","route":"turn","status":200,"ms":412}
```

- `t`: epoch ms on the writer's own clock. Server and browser run on one machine, so they compare directly.
- `src`: `server`, `client` or `runner`.
- `kind`: a dotted name. A reader must skip kinds it does not know.
- Browser events add `m` (ms since page load, one decimal), `page` (a random ID per page load) and `seq` (a counter per page load).

Kinds the report reads. Other kinds are welcome; these names are fixed.

| src | kind | fields |
|---|---|---|
| server | `route.done` | `route`, `method`, `status`, `code` (the error code, when not 200), `ms`, `uid` |
| server | every event `consoleLog` already prints | its own name and fields, unchanged |
| server | `turn.slowParse` | `ms`, `ok`, plus the turn's IDs where the call site has them |
| server | `turn.fastSlots` | `ms`, `valid`, `reason` (when not valid), `kinds` |
| server | `model.call` | `purpose`, `model`, `ms`, `ok`, `inTok`, `outTok` (tokens when the answer carries them) |
| client | `page.load` | `path`, `ua` |
| client | `user` | `uid` (sent when sign-in state is known, and on change) |
| client | `voice.event` | `type`, plus IDs the event carries |
| client | `voice.cmd` | `type` |
| client | `rt.event` | `type`, `eventId`, `responseId`, `itemId` (one line per Realtime server event that is not a delta) |
| client | `rt.deltas` | `type`, `responseId`, `n`, `firstM`, `lastM` (one line per response and delta type, written when the response ends) |
| client | `rt.state` | `what` (`dc`, `pc`, `ice`), `state` |
| client | `api.call` | `route`, `method`, `status`, `ms`, `err` (`timeout`, `network`, or absent) |
| client | `latency.row` | every field of `LatencyRow` (`packages/core/src/voice/latency.ts`), written once when the row is final |
| client | `fps` | `avg`, `min`, `long` (frames over 50 ms), `n`, `windowMs`; every 2 s while the page is visible |
| client | `longtask` | `ms` |
| client | `rtc.stats` | every 1 s during a call: `micLevel`, `inLevel`, `jitterMs`, `lost`, `concealed`, `rttMs`, `jitterBufferMs` (omit what the browser does not report) |
| client | `radio` | the radio store's state name, `stationId`, `volume` |
| client | `phone` | the phone machine's state name |
| client | `card` | `kind`, `id`, `action` (`shown`, `closed`, `approved`, `declined`), where one hook reaches it |
| client | `error` | `where` (`window`, `promise`, `console`), `message` (capped at 300 characters) |
| client | `visibility` | `state` |
| runner | `step.start` | `step`, `title` |
| runner | `step.end` | `step`, `result` (`pass`, `fail`, `skip`) |
| runner | `mark` | `label` |

The words line:

```json
{"t":1763159000456,"src":"client","kind":"words.owner","text":"…","itemId":"…","responseId":"…","step":"B2"}
```

Kinds: `words.owner` (a completed input transcript), `words.franki` (a completed output transcript), `words.typed` (a typed line as sent), `note` (from the runner, with `step`). The browser sends these to the same route; the sink routes any kind starting `words.` and `note` to `words.ndjson`.

## The route (part A serves it, parts B and C use it)

`/api/dev/live-test`, development only.

- `POST` with `{"events":[…]}`: at most 500 events and 256 KB per post. Accepts only the app's own localhost origin, checked the way `saveTake` checks it. Each event must be a flat object with a string `kind`; `src` must be `client` or `runner`; anything else is dropped and counted. Answers `{"ok":true,"written":n,"dropped":n}`. When the recorder is off it answers `{"ok":false,"active":false}` with status 200 and writes nothing.
- `GET`: `{"active":bool,"run":"<folder name>"|null,"events":n,"words":n,"lastAt":<epoch ms>|null,"script":<the parsed script.json>|null}`. Counts may come from file sizes or a line count; they only show the owner that logging works.

No auth guard: it is absent from production, bound to localhost, and holds nothing that can be read back except the script.

## The script file

```json
{"title":"…","steps":[{"id":"B2","group":"Voice","title":"Interrupt Franki","do":["…"],"say":["…"],"watch":["…"],"account":"…"}]}
```

Only `id` and `title` are required in a step. `do`, `say` and `watch` are lists of short lines. `account` is free text shown as a label.

## Part A: the server (one builder)

Owns: `packages/server/src/live-test/**`, the edits named below in `packages/server/src/routes/live-deps.ts` and `routes/runtime.ts`, the timing call sites, the OpenAI port wrapper, the server package's exports, `apps/web/src/app/api/dev/live-test/route.dev.ts`, `scripts/live-test/dev.mjs`, `scripts/specimens-absent.mjs`, `.gitignore`.

1. **The sink.** A small module: is the recorder on (rule 1), append an event, append a words line, count lines, read `script.json`. Pure helpers (shaping and checking an event, choosing the file) are separate from the file writes and tested on their own.
2. **Mirror the log.** When the recorder is on, `consoleLog` also appends each event to `events.ndjson` with `t`, `src: "server"` and `kind` set to the event name. What it prints does not change.
3. **`trace`.** Add an optional `trace?: Log` to `RouteDeps`. `liveRouteDeps` sets it only when the recorder is on. New events go through `deps.trace?.(…)`, so production output and every existing test stay as they are.
4. **`route.done`.** In `runRoute`, one `trace` call per request on both the success and the error path, with the fields in the table. `uid` is whatever form the existing logs use for a user; omit it when the guard refused.
5. **The timings nobody logs.** `trace` the slow parse time (`intents/slow-parse.ts` returns `ms`) and the `FastSlotsV1` time, validity, reason and kinds (`onturn/fast-slots-port.ts`), at their call sites. Add the judge's time the same way if no existing event carries it. Numbers and enums only.
6. **`model.call`.** Wrap the OpenAI port that `liveOpenAI` builds, so each server-side model request traces purpose, model, time, outcome and token counts. If the port has no single place for this, trace at the call sites that have a model name and say in your report which you covered. The Realtime voice session itself is not a server request and is out of scope.
7. **The route.** Logic in `packages/server/src/live-test/` in the shape of `listTakes` / `saveTake`; the `route.dev.ts` file only adapts.
8. **The launcher.** `node scripts/live-test/dev.mjs --out <folder> [--script <file>] [--port 3000]`. It makes `<folder>/<YYYY-MM-DD_HHmmss>/`, writes `meta.json`, copies the script to `script.json`, runs `scripts/sync-local-env.mjs`, then starts `next dev` in `apps/web` with `FRANKI_LIVE_TEST_DIR` and `NEXT_PUBLIC_FRANKI_LIVE_TEST=1` set. It passes the child's output through to its own stdout and stderr and also appends it to `server.log` with an epoch-ms prefix per line. It forwards Ctrl+C and exits with the child's code. It must work on Windows (no shell-only syntax; resolve the `next` binary rather than relying on `npx`). `--out` defaults to `.live-test/` at the repo root; add that to `.gitignore`.
9. **Absent from production.** Extend `scripts/specimens-absent.mjs` so the `/live-test` page is checked as well (`api/dev` is already covered), and say in your report whether `next build` output is free of the string `live-test` in client chunks, or that you could not build while others were editing.

## Part B: the browser (one builder)

Owns: `apps/web/src/client/live-test/**`, the optional hooks named below in `apps/web/src/client/voice-client.ts` and `client/api.ts`, the wiring in `apps/web/src/components/App.tsx`, `apps/web/src/app/live-test/**`.

1. **The recorder.** A queue that stamps `t`, `m`, `page` and `seq`, posts to the route every second and whenever 200 events wait, and flushes on `pagehide` with `sendBeacon` (or `fetch` with `keepalive`). If a post fails it keeps the events, up to 5,000, and tries again. It never throws into the app.
2. **Taps, with the reducer untouched.** Give the voice client an optional observer. The choke points are in `voice-client.ts`: `dispatch()` (every voice event in and command out), `run()`, `dc.onmessage` (every Realtime server event) and the data channel and peer connection state handlers. `ApiClient.call` in `client/api.ts` covers every `/api/` request, including typed turns. From these produce `voice.event`, `voice.cmd`, `rt.event`, `rt.deltas`, `rt.state`, `api.call` and the three `words.*` kinds. Record names and IDs from Realtime events, never their text, except the two completed-transcript events, whose text goes out as `words.owner` and `words.franki`. Use the event names the reducer already handles.
3. **Latency rows.** Each `LatencyRow` goes out once, when it stops changing (the next turn starts, or the call ends), so the rows outlive the call.
4. **Samplers.** Frames (`fps`, from one `requestAnimationFrame` loop), `longtask` (a `PerformanceObserver`, where supported), `rtc.stats` (from `getStats` on the call's peer connection, with the microphone level and Franki's level), `error` and `visibility`.
5. **Stores.** `radio` and `phone` from the existing stores (`client/radio-watch.ts`, `client/phone-watch.ts`) by subscribing, with no edit to them if they already allow it. `card` where a single hook in `App.tsx` reaches cards and approvals; skip it and say so if it needs edits across surfaces.
6. **Wiring.** `App.tsx` starts the recorder by dynamic import behind the `NEXT_PUBLIC_FRANKI_LIVE_TEST` check and hands it the observer, the API client hook and the signed-in user's ID.
7. **The runner page, `/live-test`.** A plain page for a second window. It reads the script from `GET /api/dev/live-test` (and falls back to a short built-in one), shows one step at a time (group, title, what to do, what to say, what to watch for), and has Start, Pass, Fail, Skip, Back and a note box. Start posts `step.start`; Pass, Fail and Skip post `step.end` and move on; a note posts `note` with the step's ID. Keys: Enter starts or passes, F fails, S skips, N focuses the note box. A side list shows every step and its result. A status line shows whether the recorder is on, the run's name, the event count and how long ago the last event arrived, polled every 2 s. Results survive a reload (`sessionStorage`). Readable from across a desk: large type, high contrast, no decoration. It does not load the avatar or open a call.

## Part C: the scripts (one builder)

Owns: `scripts/live-test/export.mjs`, `scripts/live-test/report.mjs`, `scripts/live-test/lib/**`, their tests and fixtures under `scripts/live-test/`.

1. **Export.** `node scripts/live-test/export.mjs <run folder> [--uid <uid>]`. It reads the user IDs from the `user` events (or takes `--uid`), then with the Admin SDK and local Application Default Credentials writes that user's records to `<run folder>/firestore/<collection>.json`. Read `packages/server/src/store/paths.ts` for the paths and for how a user ID becomes a path. Sessions and their turns, ledger, jobs, memories, core, errands, errand marks, moments, blocks, overlays and effects are written whole. Evidence is written only for rows created or changed since five minutes before `meta.json`'s start time, with a count of the rest. Connectors are written with every sealed or token field replaced by `"[sealed]"`. It reads only; it never writes to Firestore. It prints counts, never content, and refuses a run folder inside the repo unless it is under `.live-test/`.
2. **Report.** `node scripts/live-test/report.mjs <run folder>` writes `report.md` and `summary.json`. It works with or without the export, and with or without a script.
   - **Steps:** one row per step with result, length, notes, and what happened inside its window: turns (the owner's words, Franki's words, path, `endToAudibleMs`, `commitDelayMs`), tools, errors.
   - **Latency:** p50, p95 and the largest value of `endToAudibleMs` and `commitDelayMs`, overall and per path, with the count beside each. Say plainly when a count is too small for a p95 to mean much (under 20).
   - **Routes:** per route, count, p50, p95, largest, and errors by code.
   - **Model calls:** per purpose and model, count, p50, p95, tokens.
   - **Server steps:** `turn.slowParse`, `turn.fastSlots` (share valid, share over 900 ms), `open.phases`.
   - **Smoothness:** lowest `fps` window and long-frame count overall and per step; `longtask` count.
   - **Call quality:** largest jitter, loss, round trip.
   - **Timelines:** phone, radio, errand, bank and Google events in order.
   - **Errors:** every `error`, every non-200 `route.done`, every failed `api.call`, with the step they fell in.
   - **Gaps:** steps with no result, steps with no events, events outside any step.
   - `summary.json` holds the same numbers for comparing runs. Words appear only in `report.md`.
3. **Tests.** A small fixture run folder (made-up words) and tests for the percentile math, the step windows, unknown kinds and a missing export.

## What it doesn't do

- It records nothing on the deployed site. The answering leg of a phone call runs there (the webhook needs a public address), so that leg's server events are not in the run folder.
- It does not record audio.
- Frame numbers are the browser's frames, not each three.js engine's own cost.
- The export holds the owner's stored words and amounts. The run folder belongs outside the repo.

## Outcome

Each part ends with a short report: what is built, what is tested and how, what was not done, and any file touched outside its list.

### What happened (Nov 14)

Three Claude builders (Opus 5.5) built the three parts at the same time in one checkout, directed and reviewed by Claude (Fable 5.2). Kiro wrote none of it.

- **Checked:** typecheck and lint pass; the whole suite passes in three shards (693 files, 5,577 tests, 21 expected failures). Under the launcher, the run folder, `meta.json` and the script copy were written, the runner page posted a step and a note, and the signed-out lab page reported frames, long tasks and the radio's state. The report ran on that trial folder. The export ran once against the real store, read-only, and wrote a connector with its token replaced.
- **Not checked:** anything that needs a call (`voice.*`, `rt.*`, `latency.row`, `rtc.stats`, the `words.*` lines), the server's turn timings on a real turn, and a production build (`next build` was not run, so the absence of the recorder from client chunks rests on the dynamic import and `specimens-absent`'s route check alone). Run the build before this merges.
- **Left out:** answers on ask cards are not recorded (`card` covers shown, closed, approved and declined). `route.done` names a route by its spec name (`open`, `state`, `bankStatus`) and `api.call` by its path (`session/open`), so the two join by hand.
