---
inclusion: fileMatch
fileMatchPattern: "{packages/core/src/voice/**,packages/core/src/writes/**,packages/core/src/eligible.ts,packages/core/src/dates.ts,packages/core/src/schema/records.ts,packages/core/src/schema/wire.ts,packages/server/src/sessions.ts,packages/server/src/audience.ts,packages/server/src/core-docs.ts,packages/server/src/head-build.ts,packages/server/src/config/env.ts,packages/server/src/store/port.ts,packages/server/src/ledger/request.ts,packages/server/src/worker/**,packages/server/src/routes/open.ts,packages/server/src/routes/sdp.ts,packages/server/src/routes/turn.ts,packages/server/src/routes/tool.ts,packages/server/src/routes/receipt.ts,apps/web/src/client/**,apps/web/src/ui/**,apps/web/src/components/App.tsx,apps/web/src/components/avatar/three/loop.ts,apps/web/src/app/api/_lib/adapter.ts,apps/web/src/app/recorder/_recorder/Recorder.tsx,scripts/judge-spike/**,scripts/sync-local-env.mjs,scripts/property-guard.mjs,.github/workflows/ci.yml,package.json}"
---

# State machine rules

Source: `docs/machines/README.md`, the machine index, and its pages. If this file and the code differ, the code wins and this file and the page must be fixed in the same change.

These files own a machine: state that moves between named states. **Look in the index before adding a status field, an in-progress boolean or a nullable that means "waiting"**: the machine may already exist, and a second copy of its state is how transitions get missed.

## Four shapes

Use the lightest shape that turns a missed transition into a compile error or a red test.

| Shape | Use when | Form |
|---|---|---|
| Decision | Several sites work out the same answer | `classifyX(facts): ClosedUnion`, pure |
| Table | The machine is a table | `const X = { ... } as const satisfies Record<State, ...>` plus one reader |
| View | State is spread over live fields that other code reads | `xMode(state): ClosedUnion`, never written; a property says no illegal mode is produced |
| Reducer | Timers, async answers, ordered effects | `step(state, event, now): { state, commands }` |

## Eight rules

1. **One place.** One file owns a machine's state type and its one deciding function. Its header starts `@machine area.thing` and says what always holds and what it never does.
2. **Pure.** No clock, random source, network or DOM. `now` is an argument. IDs arrive on the event or come from a counter in state.
3. **Closed unions.** Every `switch` over a union ends in `default: x satisfies never;`. This is compile-time only: at run time an unknown value does nothing. No throwing helper: the data channel hands any JSON with a string `type` to the reducer.
4. **Effects and timers are data.** A wait is an `armTimer` command plus a deadline in state. A timer whose deadline is absent or not reached does nothing.
5. **An answer names its request.** An event that answers a request carries what identifies it (attempt, request kind, Session). An answer that does not match changes only what the spec says it may.
6. **Exits are listed.** A new state field names its reset in every exit (`closedFields`, `onOpen`, `connectionRecovery` in the voice reducer), in the reset table on the machine's page.
7. **Fields other code reads keep their shape.** `hangingUp`, `retryVisible`, `recovery`, `outputMuted` and `micMuted` are read outside the reducer. New data goes beside them.
8. **Never throw in a transition.** Invariants run in tests.

Pure machines live in `packages/core/src/<area>/`, browser-only ones in `apps/web/src/ui/` or `apps/web/src/client/`, shells beside the I/O they own, and generators and views used only by tests under `testing/`.

## Tests

- Transition tests go in `<name>.transitions.test.ts`, titled `<FROM> + <event> -> <TO> (<why>)`, so `vitest -t "HELD +"` lists every exit from a state.
- One property per file, 1,000 runs, with the header the other property files use.
- A fix starts as an `it.fails` case on today's code with its seed or exact sequence; the fix commit removes `.fails`.
- A committed `*.property.test.ts` file is never edited to make it pass. A new property goes in a new file.

## Commits

Each commit is one kind: a pin (new tests of today's behaviour), a refactor, a fix, a generator change, a property-file edit, docs, a guard, or CI. A refactor changes no existing test and leaves recorded traces equal. A fix names the tests it flips. Stage by explicit path.

## The index stays true

`scripts/machines-index.test.ts` fails when a page names a file or an export that does not exist, when a diagram's states differ from its union, or when a file that looks like a machine (`*-phase.ts`, `*machine*.ts`, or an exported `step`, `*Step` or `next*` function) has no row. Add or fix the row and the page in the same change as the code.

## Across branches

- A revision raised in a Turn's own transaction cuts that Turn's reply: the browser cancels every reply under a lower Deck. Issue the Permit under the Stamp that includes the write.
- A change to a stored record shape ships with a read that fills defaults for records written before it, and a test over such a record.
