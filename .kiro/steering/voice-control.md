---
inclusion: fileMatch
fileMatchPattern: "{packages/core/src/voice/machine.ts,packages/core/src/voice/fast-o.ts,packages/core/src/admission.ts,packages/server/src/admission/**,packages/server/src/routes/turn.ts,apps/web/src/client/voice-client.ts}"
---

# Voice-control rules

Sources: `docs/design/memory-contracts-v2.md` (cited as contracts §N; rows from §10), `docs/design/memory-spec-v3.md` §3 (cited as spec §3) and the spec `.kiro/specs/voice-control/`. If this file and a source differ, the source wins and this file must be fixed.

These files decide what Franki may say out loud. Every rule below holds in every state, for every event order.

## Permits

- There are five Permit kinds: `fastO`, `slowOrdinary`, `proactive`, `postCommitControl` and `recoveryOnly`. Each Permit is bound to one Turn and one generation, and is checked against the current Stamp, its expiry and its payload hash before any audio plays (KV03; contracts §6 Admission, Permit, Hash).
- Every server Permit comes from the Admission_Seam (`packages/server/src/admission/seam.ts`). `fastO` comes only from the FastO_Rule (`packages/core/src/voice/fast-o.ts`), the browser half of admission, and the seam records it in the ledger (contracts §6 "fastOlocal/othersserver").
- `fastO` needs a valid judge `O` and a StateAck under 2.5 s old whose four revisions match the Deck (KV13).

## Nothing before admission

- Nothing dispatches before admission: no audible audio, no tool call, no action and no receipt (KV02; contracts §6 "Preadmission: nodispatch").
- The speculative reply stays muted at the audio element until it is admitted.

## Held replies

- A reply held by `H` or `U` never resumes. A later `O` for the same Turn changes nothing (contracts §5 judge_v1 "H/U: no mutation/resume").
- An `O` that arrives after muted audio began cancels, clears and regenerates. No suffix of the earlier response is ever heard (spec §3; contracts §6 Realtime).

## Notes

- S2 is never in the Head (spec §3).
- An S1+ note stays off the Deck. It arrives beside its Permit, and only once every earlier Turn's parse has committed (KV11; contracts §6 "S0decknotes/S1+bypermit").
- A note that misses its deadline drops. The reply still plays (KV11; spec §3).

## Waits and interruptions

- Every wait has an opsClock deadline (KV06).
- Speech start cancels and clears older output and Permits (KV04).
- A higher revision cancels older Decks and speech (KV05).

## Never

- No reply path skips the Admission_Seam or the FastO_Rule.
- No probe line is relabeled, and no property is weakened to pass.
- No wall-clock read: time comes from the `now` argument or the Clock_Port.
