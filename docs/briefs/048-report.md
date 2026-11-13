# Report 048: forget on the wire (lane `forget-b`, F4)

Built by Claude Code from briefs 016 and 048, on branch `lane/forget-b`. No commit ends `Built-with: Kiro`. This report is kept current as each stage lands, so the lane can be merged at the end of any stage.

## Stages

| Stage | State |
|---|---|
| 1. Design note (`048-design.md`) | done |
| 2. Rulings 1, 2, 16, 17 and the new No Resurrection property | not started |
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
