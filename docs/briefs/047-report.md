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

### The other five properties

Each is a new file under `packages/server/src/forget/`, driven through the executor on the same generated worlds (`forget/testing/world.ts`), and first run against the same scaffold (`36b0d11`), 150 runs each.

| Property | File | First run | Seed and path | Shrunk counterexample, and what failed |
|---|---|---|---|---|
| The barrier clears only when it may | `barrier-clears.property.test.ts` | red | `1162036081`, `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0` | One turn "Danny loves jambalaya.", one Memory on it, the target; no close answers scripted (all `closed`), no second forget. Once the barrier was down, the turn's Evidence was still at epoch 1 under epoch 2: the barrier cleared with a survivor not restamped. |
| Purge only removes | `purge-removes.property.test.ts` | red | `1381910281`, `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0` | One turn "Danny loves jambalaya.", one Memory, the target. At `done`, `cleanupCompleteAt` was still null. |
| Restraint survives closure | `restraint-closure.property.test.ts` | red | `-797424518`, `2:0:0:0:0:0:0:0:0:0:1:1:1:1:1:1:3:2:2:2:2:2:5:2:2:2:2:2:2:6:5:6:2:3:2:3:3:3:3` | One turn "Danny loves ceviche."; two Memories on it ("Danny likes ceviche at the orchard", "... at the vineyard"); an exclude premised on the first; the second is the target. The first withdrew by packet membership, and its exclude was still `active`, with no `withdrawnHold`. |
| Closure can be re-run | `closure-rerun.property.test.ts` | green | none | Green on its first run: against a closure that writes nothing, a lost step has nothing to change. It pins the re-run once closure writes. |
| A hard rule outlives closure and purge | `rule-outlives-closure.property.test.ts` | green | none | Green on its first run: install already re-anchors the rule (FP1), and the scaffold's closure and purge touch nothing. It pins that through `done` once they do. |

## Built, by piece

In progress.

## Rulings needed

In progress.
