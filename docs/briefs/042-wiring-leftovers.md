# Brief 042: what part A left unwired (lane `wire`)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here. This follows part A of `docs/briefs/030-wire-the-seams.md` in the same lane and worktree; its report section "Phase two, part A" in `docs/briefs/030-report.md` lists what was left and three findings. This brief is that list, in the order to build it.

Another lane (brief 041, part 3) is adding filters inside `chooseNow`, `admitMoments` and `proactiveOf` for a person recorded deceased. `packages/core/src/moments/**` and `packages/server/src/time/**` are open to you for this brief, but keep each change there small and additive, and change no existing parameter: add an optional field to a result, or a new function beside the old one.

## Build

**1. An offer shown again can be answered (finding 3).** `pendingRendered` is keyed by the pending ID alone, so when the same offer is shown in a later session the row still carries the first showing, brief 037's binding (shown in this session, and the yes is the owner's next turn after it) fails, and a plain yes answers `clarify`. A visitor who sees the hero offer, closes the tab and comes back can then never say yes. Record every showing: the binding must read the latest showing of that offer in this session. Keep the first showing's row as it is for the ledger. Test first: the offer shown in session one, a new session, the offer shown again, "Yes." applies.

**2. An offer that was answered is closed (finding 2).** An offer answered yes or no but never recorded as said stays open and is offered again (`packages/server/src/time/verdict.ts`). An answer closes it, whichever way it went, with the answer as the reason. Test first, both ways.

**3. A reminder held under crisis is never lost without a trace (finding 1).** It is offered again at each opening after crisis clears, and today expires silently 30 days past its due time. Ruling of the lead, for the owner to confirm: when a confirmed reminder passes its due time while held, the next opening not under crisis says it late, by code template, as a missed reminder ("You asked me to remind you about X at 10. I held it."), once, as `mustSay`; if no such opening comes before its close time, it closes with a `held` ledger row that names the reason, so "why didn't you remind me?" has a row to read. Test first.

**4. Delivery's own Gate verdicts get rows.** `chooseNow` gates every candidate and returns only the choice, so a line the Gate held, steered or blocked inside delivery leaves no ledger row, and the Lab's counts miss it. Return the verdicts beside the choice (an optional field on the result), and have the route write one row per verdict that is not `say`, as IDs and reason codes only, at most once per candidate per session. A `card` verdict is recorded with the Gate's own outcome for it (`steered`); this amends the lead's earlier ruling, which said `held`.

**5. `said` rows from what was heard.** `writeSaid` computes its own match now, and no route calls it. The receipt route calls it for a transcript receipt of an admitted response that carried a whisper or a note: a `said` row only when the transcript matches, by the matcher's own rules; no match, no row. This is spec §6, "no ledger row, no claim". Test first: a matching transcript writes one row, a second receipt writes none, a transcript that does not carry the note's tokens writes none.

**6. The hard-rule route's decisions get rows (question W-166).** The "Outcome" section of `docs/briefs/032-review-hard-rules.md` lists the nine decisions that need a ledger row. Write them from `packages/server/src/onturn/**` where each decision is made, as IDs and reason codes, never the owner's words. Another lane (brief 041, parts 1 and 2) is working in that folder: keep to the one place each decision is made, and merge `build/plan-stages` before you start this item.

**7. The beats still waiting on delivery.** Beat 2's check-in: at Thursday 18:00 delivery chooses the hero offer over the check-in, and `checkInLine` does not match the script runner's `checkIn` template. Decide from spec §6 "Delivery" (the priority order is `mustSay`, wish, check-in, ask, insight, celebrate, others) which is wrong, the choice or the script, and fix that one; a script's expected line changes only if the spec's wording says so, and you say why. Beat 1's texture, if it is a matter of the wish's template and not of new behaviour. Each step that turns green loses its wait in that commit.

## Do not build

- The Gate on typed-reply notes and on `inspect`. Part A found no single Memory candidate fits them. Write, in the report, what input the Gate would need for each, as a design note of a few lines; the owner decides.
- A card route for a `card` verdict.
- Anything in `packages/core/src/voice/**`, the golden corpus, `answerTool`, or the `answer` wire shapes (brief 040's lane).
- Forget closure, resume, purge, No Resurrection.

## Properties, new files, red first where the code fails today, 1,000 runs

1. **A shown offer can always be answered once.** For any sequence of sessions, showings, other turns and answers, a plain yes that is the owner's next turn after the latest showing in that session applies exactly once, and any other yes is `clarify`.
2. **Every verdict that is not `say` has exactly one row.** For any candidates, audience and modifiers, the rows written for a delivery choice are one per held, steered or blocked candidate, and none for the chosen one until it is said.
3. **No row, no claim; no match, no row.** For any transcript and any note, a `said` row exists only if the transcript matches the note by the matcher's rules, and never twice for one response.

## Done

The seven items with their tests, the three properties with seeds recorded, the checks of brief 016 with `npm run build` and the repo's check scripts, and a section "Outcome" at the end of this file: each item with its commit, each step turned green, each ruling as a numbered question at the end of the list in `docs/briefs/030-report.md`, the design note on the typed-reply Gate, and what a live call or a signed-in browser must still show. Merge `build/plan-stages` before the final checks and run the full suite after it.

## Outcome

Built in lane `wire`. Items 1 to 5 are done. A second builder in the same lane did items 6 and 7 and the open's tail reserve (see "Second builder" below). Brief 045's ruling on finding 6 changed item 1's shape, and the open's budget came first by the coordinator's word; both are recorded here and in brief 045's "Outcome, part D".

### Items, with their commits

| Item | Commit(s) | Test, red first |
|---|---|---|
| Open budget (coordinator, first) and 045 finding 9 | `c8685c2`, then `e244a3a` (deterministic test) | `routes/open-budget.test.ts`: the seeded open took 5,509 ms at 75 ms a store call before the fix |
| 1. An offer shown again can be answered | `de106ba`, reshaped by `79571ab` with 045 finding 6 | `routes/offer-shown-again.test.ts`; property `routes/offer-answered-once.property.test.ts` |
| 2. An answered offer is closed | `553675e` | `time/answered-offer-closes.test.ts`, both ways |
| 4. Delivery's own Gate verdicts get rows | `159a2a6` (built before item 3, which reads these holds) | `routes/delivery-verdict-rows.test.ts`; property `routes/verdict-rows.property.test.ts` |
| 3. A reminder held under crisis is never lost | `6bd1fe2` | `time/held-reminder.test.ts`: held, said late once, or closed with a held row |
| 5. `said` rows from what was heard | `9b71bdd` | `routes/said-rows.test.ts`; property `routes/said-row-only-on-match.property.test.ts` |
| 6. The nine W-166 rows | `e9e2e8b` | `routes/rule-rows.test.ts`: 11 cases, all red before |
| 7. Beats waiting on delivery | `14eba84` (no step turned green; see below) | `testing/voice-call.test.ts`: a second call replayed the first open before |

### Properties

| Property | File | Seed | Red first |
|---|---|---|---|
| A shown offer can always be answered once | `routes/offer-answered-once.property.test.ts` | 42042 | counterexample before item 1: `["show","open","show","yes","open"]` |
| Every verdict that is not say has exactly one row | `routes/verdict-rows.property.test.ts` | 42044 | counterexample with no row writer: `[0,0,"unknown",false,false,["idle"]]` |
| No row, no claim; no match, no row | `routes/said-row-only-on-match.property.test.ts` | 42053 | counterexample with no `said` writer: `[["line"]]` |
| No rule change without its row (item 6) | `routes/rule-rows.property.test.ts` | 42066 | one typed "I'm allergic to shellfish." turn: "new rule self:shellfish:active has no row" |

All three at 1,000 runs. The second takes about 5 minutes (a persona reset per run).

### What changed in each item

- **1.** Every showing is a ledger row per Session (`showingEntryId`, up to `SHOWINGS_PER_SESSION_MAX` = 16, past it fails closed); the first showing's row is kept. The yes binding reads the latest showing in the yes turn's Session. With 045 finding 6: a showing is recorded when the playback ended uncut or the transcript matched, once per response (`showingResponseId`); `cancelled` revokes the latest showing (`showingRevokedId`); a yes writes only when the turn is certainly the owner's (`certainlyOwners`: judge `O`, or typed by the owner) and the Session's Gate audience is private, on the path with IDs and the path with nulls.
- **2.** Delivery skips an offer whose pending ID has an answer (`time/answered.ts`, `offerAnswer`), and the tick cancels it as `closed` (a yes) or `declined` (a no). A no to the hero offer is now recorded by the tool route (`recordHeroDeclined`), since `answerTool` writes nothing for a no.
- **3.** When delivery's Gate holds a `commitmentDue` for a crisis at or after its due time, the route records it once (`reminderHeldId`). The next line not under crisis says it by `heldReminderLine`: "You asked me to remind you about Call the vet at 10 PM. I held it." (the time is `clockLabel`'s, so "10 PM", not "10"). It is said once, as the mustSay it already is. If none comes before its close, the tick writes a `held` Gate row naming `crisis`, scoped to the moment.
- **4.** `chooseNow` returns `verdicts` (optional) beside the choice. The route writes one Gate row per verdict that is not `say`, IDs and reason codes only, with the Session's delivery turn (`deliveryTurnId`) as the row's turn, so a candidate has one row per outcome per Session. A `card` is `steered`. At most `DELIVERY_ROWS_MAX` = 8 a call.
- **5.** The receipt route writes the Gate `said` row for a moment's whisper heard on the response that admitted it (`writeSaid`; its matcher decides). One row per turn and note. Reply notes outside delivery are not covered: their text is not stored, only their tokens (see "Left").

### Steps turned green

None. Items 6 and 7 hold the beats' waits.

### Design note: the Gate on typed-reply notes and on `inspect`

- **A typed reply's note.** The note is the reply model's words over the Head, not one Memory's line, so no `GateCandidate` fits. The Gate would need, per note: the Memory IDs the note cites, read back with their class, sensitivity and `toldAt`; the turn's ask (`asked`/`notAsked` from the owner's own words); the Session's audience and modifiers; and a render rule for model words (`attributed` or `free`). The smallest input is one candidate per cited Memory, with the note dropped if any cited Memory's verdict is not `say`.
- **`inspect`.** The owner asked for everything, so every line is asked. The Gate would need the audience and modifiers (company and crisis still hold S1+), the sensitivity of each line's Memory, and a carve-out for the owner's own explicit "what do you know" request. Without a carve-out the Gate would silence lines the owner asked to see.

### Left, for a fresh builder

- Item 6 (W-166's nine rows in `onturn/execute.ts`, after merging `build/plan-stages`).
- Item 7 (beat 2's check-in against spec §6 "Delivery", beat 1's texture).
- `said` rows for reply notes: needs the note's text stored with the turn (today `noteTokens` only).

### What a live call or a signed-in browser must still show

- A barge-in after one word of the hero offer, then "Okay?", writes nothing; the offer heard to the end and a plain yes writes the list.
- The late reminder line on the first open after a crisis clears, spoken once.
- The open answering inside 3.5 s with a 75 ms round trip on the real store (the emulator's `collide` case is still red, from the open's own transaction, not delivery; see brief 045's "Outcome, part D").

### Second builder: items 6 and 7, and the open's tail reserve

Rulings are questions 14 to 24 in `030-report.md`, lane `wire`.

- **Item 6 (`e9e2e8b`).** Each decision of the hard-rule route writes a ledger row of kind `rule`: ruleWritten, pendingWritten, pendingResolved, ruleKept, noneConfirmed, proposalWritten, proposalInstalled, denialRecorded and notAllergy (`RULE_DECISIONS` in `core/schema/records.ts`).
  - The rows are written from the turn, the late path, pasted text, the turn route's install of open proposals, the backstop and the repair (`onturn/rule-rows.ts`).
  - The edits to `onturn/execute.ts` are additive. `validate.ts`, `subject.ts` and `typed-reply.ts` are untouched.
  - Not done: the open's own install of proposals (`routes/open.ts`); question 16.
- **Item 7 (`14eba84`).**
  - **Beat 2.** The check-in is not chosen because the Gate holds it, not because delivery ranks it wrong (question 23). Its wait text now says so.
  - **Beat 1.** The texture is new behaviour, not a template matter: no seeded Memory or moment carries `texture` (`seed/build.ts` writes `[]`), and nothing joins the gap-year episode to the wish. It still waits.
  - **Card steps.** Beat 1's and beat 3's still wait for a card route.
  - **No step turned green.** No step was turned green by the `play` or `idle` stand-ins.
  - **ScriptCall IDs.** ScriptCall now numbers each call on a rig past the last (`CALL_ID_STRIDE`). Part S's hand renumbering in `audience-call-again.test.ts` is removed.
- **The open's tail reserve (`83e2492`).**
  - **Round trips removed.**
    - The open's transaction reads its request entry with the core documents, so it is 8 round trips as the Firestore adapter makes them, down from 9.
    - `ensureExtractJobs` reads in two waves whatever the number of Turns. With 5 Turns at 75 ms that is 975 ms before and 300 ms after.
  - **The reserve.** `OPEN_TAIL_RESERVE_MS` = (2 × 8 + 8) × 75 + 25 = 1,825 ms (question 24).
  - **The injected-clock test.**
    - `open-budget.test.ts` gained an `asFirestore` charge mode and a count test, red first at 675 ms against 600.
    - The `collide` case now checks that the reserve held the transaction and the close.
    - The emulator test is unchanged.
- **Step 5, skipped.** The render's second `momentVerdict` read was left alone. Sharing the choice's Reader would drop the reread that stops a line after a death recorded in between, so it is not cheap.

#### Existing assertions changed

- `audience-call-again.test.ts`: the hand renumbering of the second call was removed, because the harness does it now. No assertion changed.
- `beat2-biscuit.test.ts`: the reason text of `CHECKIN_WAITS` was changed. No expected line changed.

#### What a live call or a signed-in browser must still show

- Rule rows on Firestore: they are written in the turn's own commit, which was not run against the emulator here.
- The open's 8 round trips and the 1,825 ms reserve on the emulator's `collide` case (`npm run test:emulator`, not run here).
