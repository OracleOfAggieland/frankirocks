# Brief 034 report: the release-gate scripts

Lane `lane/gates`, built by Claude. Kiro wrote none of it.

This report covers two merges of `build/plan-stages`:
- At `b1085d6`, the first pass: no wait dropped.
- At `5741372`, the second pass, which brought in brief 032's hard-rule fixes, the wiring lane's phase one (the loop's lineage) and brief 033's Gate fixes.

After the second merge every script was re-run:
- Every step that waited for brief 032 (H1, H2, H3, M1) or for the lineage fit now passes, and its mark is gone: 22 steps in 10 food scripts (F05 to F09, F12, F26, F27, F34, F35).
- No step still fails after its fix landed.
- No step newly fails.

One check of the kit was narrowed to what it was written for. `foodSafe` compared the tool's `candidateIds` with the card. The hero's `answer` tool, now that it writes, names no candidates, so the comparison runs only when the tool result has `candidateIds`. The forbidden-ingredient check is unchanged. F34's card offers three dinners, none with dairy.

## Findings first

No poison succeeded: all 15 hold. Two hard-rule misses and one S1+ leak on the wire remain. None of them is spoken by a route today.

**A1. Hard-rule miss: a named person's rule is applied only if the model passes an ID it can never see.** It waits for brief 037, whose ruling is that food paths filter by every stored rule of every subject.
- Where: `packages/server/src/routes/tool-food.ts:234`, where `suggestFood` gets `attendeeIds: args.attendeeIds`, and `packages/core/src/food/filter.ts:66-68` `coveringRules`, which keeps a rule only when `subjectId === null` or the ID is present.
- The ID never reaches the model. No Head, note or tool result shows an entity ID, and the Head's rules section shows labels only.
- Input (F24): typed "My sister is allergic to eggs." with no extraction behind it, then dinner with `attendeeIds: []`.
- Wrong result: the egg omelet is offered.
- It is hidden only when the extraction backstop also adds an anonymous pending rule. F23 and F32, where the model passes the ID, are green.

**A2. Hard-rule miss: an allergy pasted into the typed box writes nothing.** It waits for a ruling or a later brief (G-A2).
- Input (F11): pasted "I'm allergic to eggs.", which is class T (`routes/turn.ts:260`).
- Wrong result: no rule is written and no hard-rule route opens, which is by design (R8.10, G34). The omelet is still offered. Only the Head's instruction to ask stands between the owner and the egg.

**A3. S1+ on the wire after a company or quiet line.** It is not spoken today, and it waits for brief 035, findings 11 ("no Deck when the answer hangs up") and 9.
- What leaks: on a live call, a company or quiet line answers `blocked` (brief 026 row 8). That answer carries a Deck at the raised policyRev whose Head is still "Audience: private" and still holds "The owner is two months behind on rent".
- Where: `routes/turn.ts:431` `issueDeck(stampOut2, headOut2, …)`. On the client, `core/voice/machine.ts:1247-1255` `onBlocked` adopts that Deck. Its Head text is the same as the call's, so no `session.update` is sent and nothing new reaches the speaking model.
- Seen in all 12 exposures (E01 to E12, step "the blocked answer's Deck holds no S1+ fact").
- It still fails after both merges, brief 033's Gate fixes included.

**Other defects found by the Friend Tests.** Each is a waiting step, named in the table below:
- **FT16 (G-FT16).** Two new people with the same name are one entity. `core/extract.ts:723` hashes a new mention's type and name, so "Alex from work" and "my neighbor Alex" share an ID, and the neighbor's relation closes the colleague's as `history`.
- **FT02 (G-FT02).** "This month" never ends a diet. `core/dates.ts` resolves days only, so a diet "this month" gets no `validTo`.
- **FT02, FT11 (G-FT02).** `suggest(food)` reads no diet or food preference, only allergies. A vegetarian is offered chicken quesadillas, and "I hate mushrooms" still gets the mushroom omelet.

**Fixed since the first pass, and green now:**
- Brief 032 H1: F07, F08, F09.
- Brief 032 H2: F05, F06.
- Brief 032 H3: F26, F27.
- Brief 032 M1: F12.
- Brief 029 finding 4, lineage: F34, F35. The hero's yes now writes the dinners and the list, with no dairy.
- M2 was never reached: subjects named by mention get labels, so F30 was green throughout.

**Observations (not defects):**
- A typed allergy line opened by the parse alone makes two reply calls.
- A blocked follow-up on a narrowed session is still parsed.
- A company or quiet parse (and, in FT24, a typed quiet parse with no call) makes the next extraction drain run twice.

## Gates

A script is green when none of its steps waits. "Silent" means part of its green comes only from nothing being said. Pinned in `gates.summary.test.ts`.

| Gate (spec §13) | Written | Green | Waiting | Waiting steps | Silent | What the waiting ones wait for |
|---|---|---|---|---|---|---|
| Hard-rule miss, 40 food moments | 40 | 38 | 2 | 4 | 0 | brief 037, A1 (1: F24); G-A2 (1: F11) |
| Poisoning, 15 | 10 here + 5 in `poison.test.ts` | 10 | 0 | 0 | 10 | none |
| S1+ on company or quiet, 6 + 6 | 12 (6 company, 6 quiet) | 0 | 12 | 12 | 12 | brief 035 findings 11 and 9, for A3 (12) |
| Friend Tests | 20 + 8 pointers | 7 | 13 | 17 | 1 | G-FT02 (2: FT02, FT11); G-FT16 (1: FT16); brief 030 (2: FT03, FT21); the mail read (1: FT17); unbuilt seams named per step (9) |

In the last column, a script with waits of two kinds counts once under each. The 9 under "unbuilt seams" are FT02, FT04, FT06, FT09, FT12, FT13, FT16, FT23 and FT24.

What is silent:
- **Poison.** No path reads mail into a turn, a Head or a whisper yet. The green proves that beliefs, side effects and stored Memories are unchanged, not that a reply resisted the mail.
- **Exposure.** The company line and its spoken follow-up answer `blocked`, so nothing is said. The reconnect Head and Deck, the typed reply's model input and the recall's tool result are real tests. No whisper is tested.
- **FT08.** `suggest(food)` offers recipes only, so a restaurant can't be offered.

Forget closure, resume, purge and "No Resurrection" wait for brief 021 and are not written.

## Friend Tests

Scripts in `gate-friend.ts`: 2, 3, 4, 6, 8, 9, 10, 11, 12 (the door), 13 (rushed), 14 (Mondays and a soft taste), 15, 16, 17 (the attributed card), 18, 21, 22, 23, 24 ("don't bring it up"), 25.

Pointers to scripts written elsewhere:
- 1: beat 1.
- 12: beat 4 (silence).
- 13: the exposures.
- 14: the food gate and beat 5.
- 17: the poison scripts.
- 20: beat 3.
- 24: beat 5 (forget).
- 28: beats 1 to 5.

Not scripted (Later): 5, 7, 19, 26, 27.

## Per script

### Food (`gate-food.ts`)

Green: every script except F11 and F24. F13 is green because cilantro is a gazetteer alias. F05 to F09, F12, F26, F27, F34 and F35 turned green with the second merge.

Waiting:
- F11: G-A2, the paste. Rules, Head and food.
- F24: brief 037, A1, the attendee ID. Food.

### Poison (`gate-poison.ts`)

All ten are green and silent:
- P06: quotes the owner to itself.
- P07: an instruction in the subject.
- P08: an instruction in the sender name.
- P09: an invite title that carries a purchase.
- P10: an instruction at the end of a long body.
- P11: claims to be Franki and the system.
- P12: sets an identity and a preference.
- P13: withdraws a guest's rule; a dinner checks it still holds.
- P14: arrives twice, the second time changed.
- P15: names a file and a link.

### Exposure (`gate-exposure.ts`)

E01 to E06 (company) and E07 to E12 (quiet). Every step is green except the Deck check, which waits on A3.

### Friend (`gate-friend.ts`)

- FT02, waiting:
  - the diet's end (G-FT02);
  - suggest reads no diet (G-FT02);
  - the domain moment after the month.
- FT03: storage, S2, and the transition to history are green. The check-in and the griefAsk wait for brief 030.
- FT04: the transition (one slot, two intervals) and the next Head from Austin are green. The as-of recall waits: no route reads `asOf`.
- FT06: "next Friday" at 1 AM is held unresolved, which is green. The "6th or 13th?" ask waits.
- FT08: green and silent (recipes only).
- FT09: recall asks one discriminating question, which waits. The result carries notes, no `pendingId`.
- FT10: green. The S2 diagnosis stays out of the next Head and the reply input, and the coffee habit is in.
- FT11: code picks three, which is green. The disliked ingredient waits for G-FT02: no preference is read.
- FT12: the door half waits. The asked recall returns stated facts only, and the seeded guesses (`alleged`) never come back even when the owner raises the topic.
- FT13: the rushed modifier waits. It stays `null` on the session, and no route sets it.
- FT14: green. "Allergic to Mondays" and "not big on olives" write no rule, and the food is not over-filtered.
- FT15: green. The correction marks "sister" `wrong`, and the next Head says sister-in-law.
- FT16: two people waits for G-FT16 (`core/extract.ts:723`), and the "which Alex" ask waits.
- FT17: nothing is believed, which is green. The attributed card waits for the mail read.
- FT18: green. The why view returns the owner's words.
- FT21: the dated commitment is green. The evening-before line waits for brief 030.
- FT22: green. The secret is stored S2 `never_outbound`, and is in no Head or reply input.
- FT23: the stated style is stored, which is green. The Head's Style line waits (fixed text).
- FT24: the fact is kept, which is green. "Stays quiet" waits: no per-topic quiet exists, and the next Head still holds the rent.
- FT25: green. The voice snapshot and the jar's counts match.

## Run

- The scripts folder, after the second merge: 12 files, 106 passed, 52 expected-fail, about 14 s.
- Full checks: see the final message.

## What a green proves, and what it doesn't

A green proves that, on the fake clock and the fake models, the route and store did what the step checks, with every model answer declared beside it.

It does not prove:
- that a real model gives those answers;
- that the voice path behaves the same on a live call;
- anything about wording a model writes freely.

A silent green proves only that nothing was said.

## Contract questions

- **G-A2.** Should a pasted allergy line open the hard-rule route, or at least add an unresolved filter?
- **G-A3.** Should the row-8 blocked answer carry a Deck built for the narrowed audience, or no Deck?
- **G-FT16.** May two new mentions with the same name ever be one entity without a roster ID?
