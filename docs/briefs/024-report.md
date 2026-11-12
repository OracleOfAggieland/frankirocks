# Brief 024 report: the Gate, whispers and the ledger (lane `gate`, F11)

Built by Claude Code from brief 024, not from a Kiro spec. No commit ends `Built-with: Kiro`. The design note is `docs/briefs/024-design.md`.

## Built, by task

1. **Design note** (`5e55fac`). It covers the ceiling as data, the modifiers, forms, floors, whispers, ledger rows, and each gap with the answer chosen.
2. **The Gate** (`e554ede`, with review fixes in `441e565`). `packages/core/src/gate/`:
   - `gate()`: a pure decision returning say, card, hold or silent, plus the form, the render, any carve-out and closed reason codes.
   - `CEILING`: the spec's table cell by cell.
   - Asked and doors, decided from the owner's own certain U/C words (`doors.ts`).
   - Quiet hours in the world zone.
   - `memoryCandidate`: builds a candidate from a stored Memory and calls `eligible`.
3. **`safeName`** (`cc9d853`). `packages/core/src/safe-name.ts`, with the spec's injection case as a unit test.
4. **Whispers** (`41580c2`). `packages/core/src/whisper/`:
   - `buildWhisper`: builds a whisper from one Gate `say` and the one template its form and render name.
   - `fixedWhisper`: acknowledgments and clarifications.
   - Nine templates.
   - `addedFacts`: the token check for transcripts.
5. **Ledger** (`adbaf40`):
   - A new ledger kind `gate` records said, held, steered, declined and blocked, as IDs and codes only.
   - Pure: `gateOutcome`, `gateRowPayload`, `saidRowPayload`, `whyBroughtUp`, `answerFrom`.
   - Server writers in `packages/server/src/ledger/said.ts`: `writeGateDecision`, `writeSaid`, `readWhySaid`. Each row is written once, under a deterministic ID.
   - `decision` gains `issuer`, `permitKind`, `judge` and `falseHold` (questions 16, 17, 57). They are nullable and in their own block. The schema is a union of the old and new shapes, and `decisionFields` is the defaults read, tested on an old record.
   - Seams: `withWhispers` in `deck.ts` (S0 on the deck; S1+ only sets `noteWaiting`) and `gateAudience` in `audience.ts`.

**Review.** An independent reviewer read the Gate against the spec. Five places were more open than the spec, and `441e565` fixes them:
- Unprompted T logistics and asks went to senders the owner had never mailed.
- A guess was raised by a topic opened earlier in the session.
- A floor skipped the crisis, transition and check-in holds.
- Floors were trusted without checking the class.
- Function words counted as "asked".

The rest of the review is under "Rulings needed".

## Not built

- Persona tuning, whisper quality on a live voice, the warmth floor and the screen ask. None is in this brief.
- The routes calling any of this. See the seam list.
- The Lab still shows `steered` and `declined` as uncounted. It could count `gate` rows; that is the screen lane's file.

## Red-first seeds

Each property was run against a stub before the code. The say-everything Gate stub, the identity `safeName`, the whisper stub that added "at 5 PM", and the always-answering "why" reader each failed at once:

| Property | Seed | Shrunk counterexample |
|---|---|---|
| ceiling holds | 1038952604 | an ineligible told S0 memory on a jar tap, said |
| hard rules fail closed | -1590739923 | a food candidate with rules `missing`, said |
| quiet wins | -1035214519 | an unprompted candidate on an `unsolicited` quiet topic, said |
| S2 off the wire | -1087867979 | an unprompted floor S2 told memory, said with no carve-out |
| T/M not as fact | 240572458 | a class T candidate said `free` |
| subtract only | 453229630 | Against the stub it passed, because a stub that says everything never narrows. Against a mutant ("unknown: S1 → say template"), an S1 jar tap was held in private and said in unknown |
| safeName closed | -69349262 | `""` returned as a name |
| whisper adds nothing | -2119447520 | a whisper built for a result with no form |
| no row, no claim | 912251231 | `([], "")` answered |

## Contract questions

- **G-163.** Spec line 218 says floor S2 stays off the wire. Line 120 lists "an opened-topic owner recall" as a logged carve-out. Brief 024 says the carve-outs apply, so the floor lets an asked recall on an opened topic through (`openedTopicRecall`). The reviewer flagged this as high. Proposal: v3 states which one holds at the floor.
- **G-164.** Contracts list "S2/company: Exact Auth". That would let narrowing open something. Built: authorization only works private into private. Proposal: drop that cell or define it.
- **G-165.** Authorization has no `wording` or world-window start in the input. The Gate checks subject, topic, moment, audience, `expiresAt` and `used`. Proposal: v3 puts the wording check on the code template.

## Rulings needed (each one constant or one function)

1. The Gate takes a precomputed eligibility; `memoryCandidate` computes it.
2. S2 needs a carve-out in both builds.
3. Authorization only for told or own S2, from U/C, private into private, and only in plus200.
4. A recall that is not asked is `silent`.
5. Caps and quiet hours apply only to the `unprompted` trigger.
6. `all_output` quiet also silences a jar tap.
7. `safeName` tokens are space-separated words (`SAFE_NAME_MAX_TOKENS`).
8. `opensLabel` needs every label token.
9. A set modifier timestamp counts as on.
10. `WHISPER_TTL_MS` is 60 s.
11. Crisis holds every unprompted line, floors included.
12. The Gate writes a new `gate` ledger kind, not `decision` rows.
13. `FUNCTION_WORDS` (in `added-facts.ts`) also filters the asked and door terms.
14. Under an unknown audience, S1 attributed, offer and hedged renders are left as they are. Every whisper is a code template, so only `free` becomes `template`.
15. "R may bypass unsolicited once" is not counted. It needs Session state.
16. A jar tap on S2 in an unknown audience is held; the "Generic" card is not built.
17. A `commitmentDue` in company is held.
18. `T_ASKS_PER_SENDER_PER_DAY` is 1.

## Hot files touched

- `packages/core/src/schema/records.ts`:
  - a Gate import block;
  - `"gate"` appended to `LEDGER_KINDS`;
  - the `GatePayload` and decision-field blocks before `LEDGER_PAYLOADS`;
  - `decision:` now points to `DecisionPayload`;
  - `gate:` added at the end of the payload map.
- `packages/core/src/testing/samples.ts`: two builders at the end.
- `packages/core/src/index.ts` and `packages/server/src/index.ts`: export blocks at the end.
- `packages/server/src/deck.ts` and `audience.ts`: one block each at the end.

## Seams: the calls a later brief makes

- **`compileHead` (`head.ts`):** pass every organizer, sender, bank descriptor and roster label through `safeName(label)` before it goes into a line.
- **The Deck, where it is issued (`open.ts`, `state.ts`, `turn.ts`):**
  - For each candidate: `gate(candidate, ctx)`, with `ctx.audience` and `ctx.modifiers` from `gateAudience(session, opsNow)`.
  - Then `buildWhisper(note, result, templateFor(result)!, {opsNow, trigger})`.
  - Then `withWhispers(deck, whispers, opsNow)`. S1+ whispers go in `TurnResponse.notes` beside their permit, never on the deck.
- **`/api/turn`:** in the Turn's transaction, `writeGateDecision(tx, hasher, at, result, row)` for every result that is not `say`.
- **`/api/receipt`:**
  - For each note matched in the assistant transcript, `writeSaid(tx, hasher, at, result, {…, turnId: assistantTurnId, noteIds:[noteId]}, match)`.
  - `addedFacts(text, notes)` flags lines that added a fact.
- **"Why did you bring that up?":** `readWhySaid(reader, hasher, uid, assistantTurnId, noteId)`, using the noteIds of the assistant Turn. With null, Franki claims nothing.
- **Admission seam:** write `issuer`, `permitKind`, `judge` and `falseHold` on new decisions, and read old ones with `decisionFields`.

## Checks

- `npx vitest run --maxWorkers=3`: exit 1. 3,277 passed, 20 expected fail (unchanged), 1 failed.
  - The failure is the known flaky voice property "an admitted turn is posted", seed -1850267948, after 925 runs.
  - It failed in both full runs. Alone it passed 3 of 3.
  - It imports nothing from this lane.
- `npm run lint`: 0.
- `npm run typecheck`: 0.
- `npm run build`: 0. Nothing under `apps/web` changed; it was run because core changed.

## Not checked

Nothing here runs on a live call. Not tested:
- any route calling the Gate;
- whisper wording on the voice model;
- `addedFacts` on real transcripts;
- the Firestore emulator.
