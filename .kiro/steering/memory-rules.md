---
inclusion: always
---

# Memory rules

Sources: `docs/design/memory-spec-v3.md`, `docs/design/memory-contracts-v2.md` (cited as contracts §N; row IDs from §10) and `docs/briefs/001-first-spoken-call.md`.

## Never stubbed

These cannot be retrofitted, so they are always real:

1. **The Clock_Port.** All time comes from an injected `ClockPair` (`worldClock`, `opsClock`). No `Date.now()` or `new Date()` outside the allow-listed clock files.
2. **A source on every field.** Every Evidence field range carries a Slice with its Source_Class and Sensitivity.
3. **Lineage.** Every Memory resolves through its spans back to Evidence text that matches (KC03, W-LINEAGE).
4. **Transcript order.** The server serializes turns by `clientSeq` and `commitSeq` (KV12).

## Models never decide

Models read, extract and word. They never set a date, a trust level or a permission. Code decides when something matters, and a pure gate decides what may be said (memory-spec "The system in one paragraph"). Promotion follows Authority and Policy (KC04).

## Admission seam

Every server Permit comes from one module, the Admission_Seam (`packages/server/src/admission/seam.ts`), which runs the real admission rule and writes one ledger decision per admission (KV02, KV03). `fastO` comes only from the FastO_Rule (`packages/core/src/voice/fast-o.ts`), the browser half of admission, and the seam records it from the `admitted` receipt. No reply path skips either one. The voice-control rules are in `.kiro/steering/voice-control.md`.

## Records

- Schemas are closed and bounded (KC01).
- Content changes append an immutable revision; Evidence is never edited in place (KC02).
- Every route enforces auth and idempotency (KV10).
- Wire data needs `spokenGrade` or a logged carve-out (KC09).

## Model IDs

Model IDs come from Model_Config (`FRANKI_*_MODEL` in `apps/web/apphosting.yaml`), never from code. The only module that may hold model ID literals is `packages/server/src/config/models.ts`, for the `/api/health` fallbacks.

## Design docs are read-only

`docs/design/` is read-only for build work. Any conflict between contracts, or anything that cannot be built as written, goes under the "Contract questions" heading in the `design.md` of the spec being built (for example `.kiro/specs/voice-control/design.md`), numbered on from the last question in any spec, with a proposed resolution.

## Secrets

Refer to secrets by name only (`OPENAI_API_KEY`, `FRANKI_ID_HMAC_KEY`). Never open, print or commit any `.env` file. No paid OpenAI call runs except the final live check, after telling the owner.
