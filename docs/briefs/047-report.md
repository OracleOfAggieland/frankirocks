# Report 047: forget, part two (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 047, on branch `lane/forget-b`. No commit ends `Built-with: Kiro`. This report is kept current as the work lands; sections marked "in progress" are not done yet.

## Lane start

`npx vitest run --maxWorkers=3` at `8e7868c` (before any change): 601 files, 4,757 passed, 2 failed, 23 expected fail. The two failures were there before this lane touched anything: `packages/core/src/dates-period.property.test.ts` (property 2) and `packages/core/src/patterns/takeout-sources.property.test.ts` (property P1, 16 s, a timeout under load). Neither is this lane's.

## Red first

### No Resurrection (`packages/server/src/forget/no-resurrection.property.test.ts`)

Run against commit `36b0d11`, the red-run scaffold: install exactly as brief 021 left it, then a closure that does nothing, a resume that releases the barrier, and a purge that does nothing. Not a `NotBuilt` throw. 1,000 runs requested; it failed on the first.

- Seed: `-529705103`
- Path: `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`
- Shrunk counterexample, verbatim:

```
[{"sentences":[{"person":"Danny","food":"gumbo","text":"Danny loves gumbo."}],"turns":[{"sentences":[0],"mail":false,"allergy":false}],"memories":[{"turn":0,"sentence":0,"place":"meadow","parent":null,"context":null}],"effects":[],"target":0,"secondPick":0,"extractPick":0,"events":[],"fresh":{"person":"Danny","food":"ceviche","place":"boardwalk"}}]
```

```
after step 7: "gumbo" came back through earlierSafeTurns
turn 0: Danny loves gumbo.
memory 0 (target): "Danny likes gumbo at the meadow"
events: none
--- output ---
[{"turnId":"tnr-turn-0_________________________________","role":"user","text":"Danny loves gumbo.",...},{"turnId":"tnr-request-nr-1___________________________","role":"user","text":"Forget what I said about gumbo.",...}]
```

In plain words: the owner said "Danny loves gumbo." and asked to forget it; once the barrier was released, the turns a fresh call carries over (`earlierSafeTurns`) still held both the original sentence and the forget request itself, because install sanitizes the Evidence but leaves each Turn's own `text` and its link to the blocked Evidence in place.

A smoke copy of the same property (not committed) that counted hits instead of failing, 300 runs against the scaffold, found resurrection through two readers only: `earlierSafeTurns` (turn text) and `peopleRoster` (entity IDs of Memories that were never withdrawn). Every reader that goes through `eligible` showed nothing, because the epoch fence hides every row stored before the forget; the same runs fail the survivors clause, since nothing is restamped.

## Built, by piece

In progress.

## Rulings needed

In progress.
