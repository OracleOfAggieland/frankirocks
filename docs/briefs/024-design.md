# Brief 024 design note: the Gate, whispers and the ledger

Lane `gate`, F11. Built by Claude Code from brief 024, not from a Kiro spec. Sources: spec §3 (permits, the Head, spoken-grade test), §5 (delivery), §6 (the Gate), §9 (words); contracts §2 (Policy, `spokenGrade`, the S×audience table), §6 (W, Deck), §7 (`gate`, `safeName`). Everything here is pure code in `packages/core`, except the ledger writers and two small seams in `packages/server`.

## 1. The Gate's input and output

`gate(candidate, context): GateResult`, in `packages/core/src/gate/gate.ts`. No clock read, no I/O: `worldNow` and `zone` arrive in the context.

**Candidate** (one memory or moment): `id`, `kind`, `subjectId`, `sourceClass` (U/C/O/T/M), `sens`, `allergy` (allergies are exempt from S2 gates), `eligibility` (the caller's `eligible`/`spokenGrade` answer; `gateMemory` computes it), `toldAt`, `topic` (`topicId`, `label`, `labelClass`, `terms`, `quiet`), `queryTerms` (the aliases and terms the asked test reads), `purpose` (item, wish, ask, insight, celebrate, suggest, logistics), `gravity`, `food`, `mustSay` (claimed kind) and `dueAt`, `sender` (`mailedByOwner`, T only), `attestedPremises`, `offerUsed`, `ownRooted`, `checkInUsed`, `act` (say or use).

**Context:** `worldNow`, `zone`, `build` (floor or plus200), `audience`, `modifiers` (rushed, crisis), `trigger` (unprompted, recall, jarTap), `ownerTurn` (this turn's owner words, their class and whether the speaker is certain), `openedTopics`, `recentTurns` (check-in answers and transition or crisis candidates), `counts` (proactive and heavy deliveries today, this sender's asks today, notes already on this reply), `rules` (ready, missing, unreadable), `authorization`.

**Output:** `verdict` (say, card, hold, silent), `form` (item, checkIn, door, use), `render` (free, attributed, offer, hedged, template), `carveOut` (openedTopicRecall, jarTap, checkIn, door, oLogistics, authorization), the proven `mustSay` kind, `fixedLine`, and `reasons` (closed codes, never words).

Verdict order: say > card > hold > silent. *Hold* means kept: it can come back when asked or in another room. *Silent* means this route may not carry it at all.

## 2. The ceiling table, as data

`CEILING` in `gate/ceiling.ts`, one cell per sensitivity and class group (told = U/C, own = O, third = T, inferred = M). A cell is an ordered list of unprompted paths (the first whose condition holds wins) and the render used once the topic is raised.

| | told (U/C) | own (O) | third (T) | inferred (M) |
|---|---|---|---|---|
| S0 | open | open | attributedMailed, card | offer, silentUntilRaised |
| S1 | open | open | attributedLogistics, cappedAsk, card | offer, silentUntilRaised |
| S2 | checkIn, door, replyOnly | oLogistics, ownRootedDoor, silentUntilRaised | replyOnly | ownRootedDoor, silentUntilRaised |
| reply render | free | free (S2: hedged, "any conclusion counts as M") | attributed | hedged |

Paths:
- `open`: say, item, free.
- `attributedMailed`: say, item, attributed, when the owner has mailed the sender.
- `attributedLogistics`: say, item, attributed, when the candidate is logistics.
- `cappedAsk`: say, item, attributed, when the purpose is ask and this sender has had fewer than `T_ASKS_PER_SENDER_PER_DAY` (1) asks today.
- `card`: card, item.
- `offer`: say, item, offer, with at least `OFFER_PREMISES` (2) attested premises and the offer unused.
- `checkIn` (plus200): say, checkIn, template `How's {e} doing?`, when told within 7 world days, the audience is private and the check-in is unused.
- `door` (plus200): say, door, template, when the candidate has a topic and the audience is private.
- `ownRootedDoor` (plus200): as `door`, only when own-rooted.
- `oLogistics` (plus200): say, item, template, when the candidate is logistics.
- `replyOnly`: hold.
- `silentUntilRaised`: silent.

No matching path is `silent` (the Gate fails quiet).

## 3. Raised, asked and doors

- **Asked** (spec line 216): only on the `recall` trigger, when the owner's own words this turn (class U or C, speaker certain) share a token (the tokenizer chunking uses, two characters or more) with the candidate's `queryTerms`. A recall result that is not asked is `silent`: the notes come back empty.
- **Door opens** (line 220): a topic opens this turn only on a term match or `opensLabel(label)` on the owner's words, and only when its label and terms came from a U, C or O span. `opensLabel` is true when every label token of two characters or more appears in the owner's words. A topic also counts as open when it is in the Session's `openedTopics`.
- **Raised** = asked, or the candidate's topic is open. Raised content is said with the cell's reply render.

## 4. S2 and the carve-outs

S2 (allergies excepted) is never `say` or `card` without a carve-out, in either build. Floor carve-outs: `openedTopicRecall` (recall trigger, asked, and the topic open) and `jarTap`. The plus200 build adds the check-in, the door, O logistics and exact authorization, each a code template. An S2 result without a carve-out becomes `hold` with reason `sensitivity`. The floor build has no screen ask, so "Here, or on screen?" is not built.

Authorization (`authorized{subject,wording,audience,expiresAt}`) applies only in plus200, only from a U or C authorization, for a told or own candidate, when subject, topic and moment match exactly, it is unused and unexpired, and both the authorization's audience and the context's are private. It gives say, template, carve-out `authorization`. It never beats quiet or ineligibility.

## 5. Modifiers only subtract

Every modifier returns a cap, and the result is the lower of the cell's answer and every cap, so narrowing can only lower the verdict.

- **company:** S1+ or class T is `hold`; a recall that was asked, or a jar tap, is `card` instead; a proven hard-rule conflict is `card`; the door form is `hold`.
- **unknown:** S2 is `hold`, a jar tap too; S1 says only through a template render.
- **rushed:** a second note on the reply, the door form and insights are `hold`.
- **crisis:** suggest and celebrate are `hold` on any trigger; anything unprompted that is not a proven `mustSay` is `hold`.
- **delivery** (unprompted only, skipped by a proven `mustSay`): quiet hours 21:30 to 08:00 in the world zone, `PROACTIVE_PER_DAY` (3), `HEAVY_PER_DAY` (1, gravity 2 or more), and no insight, celebrate or ask in a session with a transition or crisis candidate or within two turns of a check-in answer.

## 6. Floors and failing closed

- **mustSay** (line 224) is proven by code: a hard-rule conflict (flag set by the food filter), a commitment due within 24 hours of `worldNow`, or critical logistics (T arrival, departure or cancellation due within 24 hours). An unproven claim is ignored, with reason `mustSayUnproven`. mustSay skips caps and quiet hours, never the ceiling or the audience.
- **Hard rules fail closed:** a food candidate with rules `missing` or `unreadable` is `silent` with `fixedLine` = "Allergy data unavailable, recommend no food."
- **Quiet wins:** `quiet:"unsolicited"` makes every unprompted result `silent`; only an asked recall passes. `quiet:"all_output"` is `silent` on every trigger. Authorization never beats either.
- **Use:** `act:"use"` returns `silent` with form `use`: the reason may filter suggestions, never be said.
- **Invalid input** is `silent`.

## 7. safeName

`safeName(name)` (`packages/core/src/safe-name.ts`): NFC, trim and collapse U+0020 spaces only, 1 to 40 UTF-16 units, at most 4 space-separated tokens, Unicode letters, space, `'`, `-` and `.` only, at least one letter. Anything else, any non-string, is "a sender".

## 8. Whispers

`buildWhisper(note, gate, ctx)` (`packages/core/src/whisper/build.ts`) takes one note (`noteId`, `momentId`, `sens`, `rootKeys`, `dependsOn`, `tokens` up to 4 of up to 64 characters), its Gate result and a template ID, and returns a `W` or null. It returns null unless the verdict is `say` and the template matches the result's form and render. Text is the template with the note's tokens put in its slots; nothing else. `expiresAt` = issued + `WHISPER_TTL_MS` (60 s, the Deck's life). `unprompted` is true unless the trigger was recall.

Templates (`whisper/templates.ts`), each a fixed string with numbered slots:

| ID | W kind | Text | For |
|---|---|---|---|
| item | truth or moment | `{0}. One line, no recap.` | routine items |
| thirdParty | truth | `{0}'s {1} mentions {2}. Say it's on the card.` | T renders; `{0}` passes safeName |
| checkIn | moment | `How's {0} doing?` | S2 named check-in |
| door | moment | `How's this week been?` | S2 doors, no tokens |
| s2Appointment | moment | `Personal appointment at {0}.` | S2 logistics |
| ackNoted | ack | `Got it.` | controlled acknowledgments |
| ackQuiet | ack | `Okay, I won't bring it up.` | |
| clarifyWhich | clarification | `Did you mean {0} or {1}?` | clarifications |
| clarifyDelete | clarification | `Did you want that deleted?` | the false "gone" ask |

`addedFacts(spoken, notes)` (`whisper/added-facts.ts`): tokenizes a spoken line and returns every token that carries a fact (any digit, or not in the closed `FUNCTION_WORDS` list) and is in no note's tokens or text and no template. Empty means nothing was added.

## 9. Ledger rows

A new ledger kind `gate`, payload: `outcome` (said, held, steered, declined, blocked), `candidateId`, `refs` (up to 8), `noteIds` (up to 4), `momentId`, `sessionId`, `turnId`, `verdict`, `form`, `render`, `carveOut`, `reasonCodes` (Gate reasons, up to 16), `audience`, `permitKind`, `match` (the `said` match). IDs and codes only, never words.

Outcome of a Gate result (`gateOutcome`): `say` writes nothing yet (`said` is written from the transcript); `card` and `use` are `steered`; `hold` is `held`; `silent` is `blocked` when the reason is ineligible, invalid input or rules unavailable, else `declined`.

The "why" reader (`whyBroughtUp(id, rows)`, core) answers only from a `said` row whose note, moment, candidate or ref matches the ID, with that row's reason codes and form. No row, no answer: it returns null.

**Decision payload, questions 16, 17 and 57.** Four nullable fields in their own block: `issuer` (fastORule, admissionSeam, devAdmit), `permitKind`, `judge` (O, H, U, timeout, error, typed) and `falseHold`. Stored decisions written before them still validate (the schema is a union of the old and new shape), and `decisionFields(payload)` reads either, filling nulls.

## 10. Gaps and the answers chosen

Each is one named constant or function, listed in the report under "Rulings needed".

1. The Gate takes a precomputed eligibility answer (so it stays a pure decision over facts); `gateMemory` is the wrapper that computes it with `eligible` and `spokenGrade`.
2. S2 needs a carve-out in both builds, not only the floor, because the screen ask is not built anywhere.
3. Authorization only from a private U/C grant into a private room: the contracts' "S2/company: exact Auth" is not built, because it would let narrowing open something (brief property "subtract only").
4. A recall that is not asked is `silent`, not `hold`.
5. Caps and quiet hours apply to the `unprompted` trigger only.
6. `quiet:"all_output"` silences a jar tap too.
7. `safeName` counts space-separated words as tokens; no pinned tokenizer exists in core.
8. `opensLabel` needs every label token of two or more characters in the owner's words.
9. Session modifiers count as on whenever their timestamp is set.
10. Whisper TTL is the Deck's 60 s.
11. A crisis holds every unprompted non-mustSay candidate.
12. The Gate's rows are a new ledger kind (`gate`), not new `decision` rows, so the Lab's decision counts are unchanged until the screen lane reads them.
13. **G-166 (brief 033 finding 3; amends §3 "Asked").** "Asked" read the owner's words against `queryTerms`, which the voice model sends. A recall is now asked only when the owner's words hold one of the candidate's own `aliases` (a new required field: its entity's names, from U, C or O spans) or open its own topic. `queryTerms` narrow retrieval only. Proposal: v3 says "a query alias or term *of the candidate*".
14. **G-167 (brief 033 finding 1; amends §3 "Raised").** For class T, an opened topic raises nothing: only an asked recall does. A `senderCap` card is never overridden.
15. **G-168 (brief 033 finding 14; amends the §2 table, S0 third).** The S0 third-party cell tries `cappedAsk` first, so one ask per sender per day holds at every sensitivity (ruling 18).
16. **G-169 (brief 033 finding 15; amends §4 and G-163).** Until the on-screen ask exists (`S2_SCREEN_ASK_BUILT`, false), an asked S2 recall on an opened topic is a card with carve-out `openedTopicRecall`, in both builds, not said.
17. **G-170 (brief 033 finding 17, found by the committed subtract-only property; amends §2 "paths").** On the recall trigger an asked result is answered by the cell's reply render (or a card, per G-169), never by an unprompted path such as a door that comes first in the cell.
18. **G-171 (brief 033 finding 18, found by the committed ceiling property; amends ruling 8 and the part of ruling 13 about labels).** `opensLabel` needs every label token of two or more characters, function words included, and at least one label word that is not a function word. Function words still never count as an asked or door *term*.
19. **G-172 (brief 033 finding 7; amends §5 "unknown" and ruling 14).** The context gains `moment` (`opener` or `idle`), required on the unprompted trigger. An idle S1+ line is held unless the audience is private; an opener's S1 line renders `template` in any audience.
20. **G-173 (brief 033 findings 2, 8, 10; amends §8 and the part of G-165 about texture).** Code templates have typed slots: `thirdParty` is `On the card: {kind} from the sender "{name}". Say it's on the card, nothing more.` (the claim is dropped; kind is email, invite, text or bank); `s2Appointment` takes a strict time; the `template` render has its own template, `For "{name}": {result} at {time}. One line, nothing more.`, so the authorization carve-out adds no texture. The wording check of G-165 is still not built. `checkIn` keeps the spec's exact text. Open: a letters-only phrase still passes a name slot (`safeName` cannot tell a name from words); contracts' `{e:<id>}` slot, bound to the candidate's entity, would close it.
21. **G-174 (brief 033 finding 6; amends §8 and the `withWhispers` seam).** A Gate result carries `candidateId` and `sens`; a note names its candidate, and `buildWhisper` refuses a mismatch. `withWhispers(deck, gated, opsNow, audience)` takes whispers with their template and drops what the audience may not hear (`audienceMayHear`); a whisper the Deck already held stays only in private.
22. **G-175 (brief 033 finding 9; amends §8 `addedFacts`).** Negations and "won" count as facts (`FACT_WORDS`), and by default no template's words are known beyond the note's own text.
23. **G-176 (brief 033 finding 11; amends §9).** Every non-`said` Gate row needs a `turnId` or a `momentId`, and a row that fails validation throws instead of returning null.
