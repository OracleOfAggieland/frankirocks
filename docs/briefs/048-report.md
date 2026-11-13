# Report 048: forget on the wire (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 048, on branch `lane/forget-b`. No commit ends `Built-with: Kiro`. This report is kept current as each stage lands, so the lane can be merged at the end of any stage.

## Stages

| Stage | State |
|---|---|
| 1. Design note (`048-design.md`) | done |
| 2. Rulings 1, 2, 16, 17 and the new No Resurrection property | done |
| 3. Admission, the turn route, the fence, the hang-up, the driver, the tick | not started |
| 4. The acknowledgment, the voice machine, beat 5 | not started |
| 5. The release-gate scripts | not started |
| 6. The ask by words, "Forget last thing" | not started |

## Lane start

`7a9bacb`: 635 files, 5,094 passed, 23 expected fail (the lead's run on `881f68c`, the same tree).

## Red first

### No Resurrection with Franki's replies (`packages/server/src/forget/no-resurrection-speech.property.test.ts`)

Run against `e55c888`, the code exactly as brief 047 left it (no change to closure, purge, `safeTurn` or any route). Not a stub: the real executor, the real receipt route writing Franki's replies, the real readers. 50 runs requested; it failed on the first.

- Seed: `-377689814`
- Path: `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`
- Shrunk counterexample, verbatim:

```
[{"sentences":[{"person":"Danny","food":"bibimbap","text":"Danny loves bibimbap."}],"turns":[{"sentences":[0],"mail":false,"allergy":false}],"memories":[{"turn":0,"sentence":0,"place":"glacier","parent":null,"context":null}],"effects":[],"target":0,"secondPick":0,"extractPick":0,"events":[],"fresh":{"person":"Danny","food":"risotto","place":"orchard"}}]
```

```
after step 9: "bibimbap" came back through eligible(evidence cznu2Bezu0xuhaYP-Kn4qvB2QZrj0FUKm5V1wTw6G0A)
turn 0: Danny loves bibimbap.
memory 0 (target): "Danny likes bibimbap at the glacier"
events: none
replies: Oh, bibimbap! Tell me more about Danny.
--- output ---
{"v":1,"uid":"owner-1","rev":2,"createdAt":"2026-11-03T12:00:02.500Z","updatedAt":"2026-11-03T12:00:11.500Z","epoch":2,"policyRev":1,"rootKeys":[],"rootSlices":[],"contextIds":[],"packetEids":[],"dependsOn":[],"dirty":false,"dependenciesComplete":true,"logicalId":"M7pRrHaCfaaJ8DBtyBOEZgZHMWtuhY9IJrPbmafnT6Q","revisionOf":null,"sanitizedFrom":null,"source":"voice","providerKey":null,"providerRevision":null,"connectorId":null,"generation":1,"threadKey":null,"inReplyToProviderKey":null,"closureProofs":[],"kind":"turn","status":"retained","isCurrentProvider":true,"occurredAt":"2026-11-03T12:00:00.
```

In plain words: the owner said "Danny loves bibimbap.", Franki answered "Oh, bibimbap! Tell me more about Danny.", and the owner asked to forget it; closure restamped Franki's reply Evidence to the new epoch (`rev 2`, `epoch 2`) as an unrelated survivor, so once the barrier cleared `eligible` let Franki's own sentence, with the forgotten food in it, through to speech.

### A second counterexample, from the same property after the stage 2 fix

With rulings 1, 2, 16 and 17 in place, a 1,000-run pass of the same property found a forget that never finishes. Not a leak: a job that waits at `resume` forever.

- Seed: `1495687112`
- Path: `3:1:1:1:1:1:1:1:1:1:1:1:1:1:1:2:6:5:4:2:11:2:4:2:2:2:3:3:4:4:4:4:4:4:3:3:3:3:3:4:3:9:9`
- Counterexample: two turns ("Danny loves ceviche.", "Danny loves risotto."), a Memory on each, the first forget aimed at memory 0, and a second forget (`forget2`) at step 9.
- Seen: the first job sat in `retry` at `resume` with the wait reason `closure`.

In plain words: the second forget's request turn was written after the first forget's closure had finished, below the barrier's epoch, so the first forget's resume re-planned closure, found that row "not yet restamped", and waited for a restamp nothing would ever write. The fix (`queuedEids` in `ClosureInput`): closure leaves the request Evidence of every forget queued behind the barrier to that forget, neither blocking nor restamping it. It fails closed: that row is never lifted to the cleared epoch before its own forget runs. The world now passes, and the property passes at its default 300 runs.

## Stage 2: what changed

- Ruling 1 (`withheldSpeech` in `packages/core/src/forget/closure.ts`): Franki's own replies said after the forgotten Evidence and before the fence are withheld. Their Evidence goes `blocked` in closure order 1, and purge empties their text (`packages/core/src/forget/purge.ts`). A Fixed_Line is never withheld. A delivered moment of a forgotten Memory loses its rendered words.
- Ruling 2 (`turnEvidenceUsable` in `packages/server/src/turns.ts`): a dead turn, or a turn whose Evidence is not retained, is never a safe turn.
- Ruling 16: a restamp moves the epoch only; a survivor dirty for another reason stays dirty.
- Ruling 17 (`purgedArgs`): a purged Memory's string arguments and its hypothesis alternatives are emptied as far as the Memory schema allows. The store's immutability check accepts exactly that change (`packages/server/src/store/checks.ts`).
- Purge reads every Session's turns, not only the request's (`packages/server/src/forget/executor.ts`), so a withheld reply in another Session is emptied too.
