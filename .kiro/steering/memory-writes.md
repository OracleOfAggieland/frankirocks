---
inclusion: fileMatch
fileMatchPattern: "{packages/core/src/writes/**,packages/core/src/extract.ts,packages/core/src/intents/**,packages/core/src/head.ts,packages/server/src/onturn/**,packages/server/src/worker/extract.ts,packages/server/src/routes/turn.ts,packages/server/src/routes/receipt.ts}"
---

# Memory-write rules

Sources: `docs/design/memory-spec-v3.md` (cited as spec §N), `docs/design/memory-contracts-v2.md` (cited as contracts §N) and the design note `docs/briefs/012-design.md` (cited as design G*n* or CQ *n*). If this file and a source differ, the source wins and this file must be fixed.

These files decide what the owner's words write: allergies and hard rules, corrections and life changes, on the turn and in extraction. Every rule below holds for every order of turns, jobs and retries.

## Corrections

- A correction marks the old value `wrong`. It never becomes `history`, and no later write makes it current or history again (spec §4; contracts §7 `applyCorrection`; design 6.5).
- A Memory's status changes only through `statusTransition` in `packages/core/src/writes/status.ts`, and placement only through `place` and `closesCurrent` in `writes/bitemporal.ts` (design 6.5, 6.6).
- A fact whose interval is entirely in the past inserts as `history` and leaves the current value alone (spec §4; design 6.6).

## Authority

- Third-party and inferred text (classes T and M) never writes a rule, a preference, an identity or `life`. Authority is the class of the slice that covers the item's span, not one class for the whole Evidence (contracts §2; KC04; design 2.4).
- A typed line whose text came from a paste is T whatever its length (design G34, CQ 127).

## Hard rules

- A hard rule is added only from the owner's own direct words, for an item in the allergen gazetteer, with its verified span as proof (spec §3; contracts §1 `core/rules`; design 2.1, 2.4).
- A hard rule is removed only by a trusted tap. No model output, correction, change, denial or forget removes one (spec §8; contracts §1; design 6.3).
- An unresolved allergy fails closed: the turn writes a pending rule or the anonymous `unresolved` filter, never nothing (contracts §1 "unresolved safety"; design 2.5, G4).
- A denial needs a certain speaker. Without one, nothing is relaxed and `noneConfirmed` is unchanged (contracts §2; design G19, row A6, CQ 112).

## Models and code

- Models read, extract and word. Code validates spans, authority, subject, value and gazetteer before anything is written (spec §3; contracts §5 `FastSlotsV1`; design 2.4).
- A FastSlots span quotes the current turn only; any other eid fails the span check (design CQ 118).
- Every deadline is a named constant, and a slow or failed answer takes the safe path of its route (contracts §5 Execution table; design G6, G22).
- Model IDs come from Model_Config; core never names one (contracts §5; `scripts/model-literals.mjs`).

## Saying it

- Nothing is called saved, corrected or changed before its write has committed (spec §3 step 6; design P9).
- A route note is an S0 pointer: a closed template with no owner words, no allergen, no name and no roots (contracts §6; design 2.7, CQ 97).
- A committed write that raises the Deck answers `ready`, and the reply is created from the new Head (KV05; design G1, CQ 96).

## Extraction and the route

- Extraction skips only what the turn's `handled` record names, and does everything else as before (design 5, CQ 108).
- An earlier turn never closes a later one: an item never closes a same-key row asserted after its own root Evidence (design G35, CQ 120).

## State

- New state is a closed union with one pure function that decides every transition: `nextSlots`, `ruleTransition`, `pendingNext`, `statusTransition`, `place`, `bundleAfter` (design section 6).
