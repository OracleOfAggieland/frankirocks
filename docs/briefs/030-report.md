# Brief 030 report, phase one: wire the seams (lane `wire`)

Built by Claude Code from briefs 016 and 030, on `lane/wire`. No commit ends `Built-with: Kiro`. The design note is `030-design.md`. Forget stays unwired: no route calls the forget code. The one exception is a read: `tool-food.ts` now reads blocks and overlays through `forget/snapshot-rows.ts`, as `head-build.ts` already does.

Phase one ends here. `build/plan-stages` is merged in, at `b1085d6`. Briefs 031 and 033 have their "Outcome" sections. Brief 036, which the lead added as a gate for phase two, does not have one yet. So this lane stops, with the tree green.

## Seams wired, one per commit

| # | Seam | Commit | Witness |
|---|---|---|---|
| P1-1 | The hero window stays on its insight's dates across a jump (029 finding 3, X-165) | `a947422` | Beat 3: "the offer after the bolt still says $186" |
| P1-2 | The loop's root Slices are the rows' text Slices, so the yes can be written (029 finding 4, X-166) | `5fdc6f0` | Beat 3: the yes, the strip after it, the comparison three weeks on; `tool-food.test.ts` |
| P1-3 | The loop's check at `checkAt` is stored on the loop (`loopStateAfter`) | `429c8f9` | `tool-food.test.ts` (tick at checkAt) |
| (runner) | The scripts' `advance` step goes through `POST /api/seed/advance`, which forces the tick (replaces 029's `setWorldClock` ruling) | `a0f8e61` | All scripts |
| P1-4 | The strip's money figure: "$115 less on takeout." from the loop's celebrate moment | `117d605` | Beat 3: "the strip fills: $115 less" (3 variants); `memory-screen.test.ts` |
| P1-6 | The receipt route admits, says and renders moments (023's three calls) | `5108a23` | `routes/receipt-moments.test.ts`, red without the call |
| P1-7 | The false "gone" check on spoken transcripts: server half | `90fd897` | `receipt-moments.test.ts` |
| P1-7 | The same check: client half (the voice client tells the screen) | `2cf81c9` | `voice-client.test.ts` |
| 036 f7 | The seed's pending decoy is out of every hero window (brief 036 finding 7) | `75b4ccc` | `seed/hero-jump.test.ts`: a 16 h and a 40 h jump give the same hero result, with or without a tick first |
| P1-8 | The visit on open: a named visit opens only on its clone; the typed path names it | `d932add` | `routes/open-visit.test.ts`, `client/typed-visit.test.ts` |
| P1-9 | `tool-food.ts` reads the owner's blocks and overlays (028 finding 3) | `914e2be` | `tool-food.test.ts`: a blocked order is not counted |
| P1-10 | One wire type each for the reset and advance requests | `b6fe712` | typecheck |
| P1-11 | Rule motes in the jar from `core/rules` (`MemoryResponse.hardRules`) | `f7d3290` | `memory.test.ts`, `memory-screen.test.ts` |

Already wired before this lane, so no commit was needed: the tick on open, from the state route (at most once an ops minute) and on a jump; the hero's `insight` moment; and the loop's `celebrate` moment. Details are in the design note.

## Not wired, and why

- **P1-5, the Lab's count of guesses (029 finding 5).** Counting `alleged` guesses turns the committed property `core/src/memory-views.lab-counts.property.test.ts` red. It pins `privateGuesses` to active guesses only (counterexample: one alleged S2 guess). That file can't be edited, so I reverted the change, and beat 4's "the Lab counts the 3 private guesses" stays expected-fail. It needs a ruling, X-167: either the property is amended, or the seed stores its three guesses as `active`.
- **P1-12, showing a `proactive` that `open` returns.** The typed path always opens with `previousSessionId: null`, so today no open it makes can return one. The voice open is in `core/voice/**`. It belongs with phase two's delivery on open.
- **P1-13, the seed lane's five properties at 1,000 runs.** Not attempted. Each case loads the persona one to three times (about 0.2 to 0.5 s), so making them cheap enough needs a cached build. That changes what each case checks, and I didn't want to do it in a hurry.
- **W-166 ledger rows of the hard-rule route.** Brief 032 has no "Outcome" yet, and `onturn/**` belongs to another lane.
- **The pasted line in a call**, and everything else in phase two. See the design note.

## Demo beats (scripts)

| Script step | Before | After |
|---|---|---|
| Beat 3: the offer after the bolt still says $186 (2 variants) | W: window | **G** |
| Beat 3: the yes writes the list and the loop (3 variants) | W: window or lineage | **G** |
| Beat 3: the strip after the yes (3 variants) | W: window or lineage | **G** |
| Beat 3: the comparison three weeks on, $71, $186, $115 (3 variants) | W: window or lineage | **G** |
| Beat 3: the strip fills, $115 less (3 variants) | W: strip figure | **G** |
| Beat 3: the offer plays after the bolt, and its card (2 variants × 2) | W | W: delivery and the Gate (phase two) |
| Beat 3: "Franki speaks first: $71, down from $186" (3 variants) | W | W: delivery (phase two) |
| Beat 1: the wish, its texture, the card, no second wish | W | W: delivery on open (phase two) |
| Beat 2: the Biscuit check-in, about their own words | W | W: delivery and the Gate (phase two) |
| Beat 4: care first; the Jordan line; the walked-in tap | W | W: persona tuning; addition 1; addition 4 |
| Beat 4: the Lab counts the 3 private guesses | W | W: ruling X-167 (see above) |
| Beat 5: "Gone", the receipt, no brother in the next Head | W | W: forget (reserved) |
| Every step that was G | G | G |

Expected-fail count: 34 before, 20 after (14 fewer, all in beat 3).

One setup step was added to beat 3's three variants: "the rows' coverage, through three weeks on". The three weeks of bank rows after the yes are a limb event in the script. Nothing in the build writes them or their coverage (the seed's only event is the interview move), so the comparison was `incomplete: uncovered`. The setup stands in for that missing writer, like the limb event itself. No assertion was changed.

## Rulings needed

Each one is a named constant or function, and each fails closed.
- **X-165:** while a hero insight moment is live (pending to delivered, before `closeAt`), the hero window ends on its `occurrenceKey`. Otherwise it ends yesterday (`time/hero-anchor.ts`, `HERO_ANCHOR_SCAN_MAX` 2,000).
- **X-166:** a loop's root Slice is the cited row's first Slice with a range. A row with none makes the yes `stale`, and nothing is written (`loopRootSlice`). The lineage check is unchanged.
- **Decoy (036 finding 7):** the seed's pending takeout decoy moved from day 0, 00:20 to day -22, 00:20. I chose the seed over `offer.ts`, because a window only slides forward.
- **Comparison rows:** no writer exists for the bank rows of the weeks after the yes, or for their coverage. In the demo, a jump of three weeks therefore shows the comparison as incomplete and silent, never as $0.
- **Moments in receipts (`MOMENT_PERMIT_KIND`):** only a `proactive` Permit's `admitted` receipt admits a moment. Day counters are written once per receipt.
- **`SPOKEN_FORGET_RECEIPT` = null:** forget is unwired, so every spoken gone claim asks.
- **The visit (`checkOpenVisit`):** a named visit on another clone, or on a non-clone, gets STALE 409. A null visit is accepted.
- **`hardRules`:** counts every allergy rule, active or pending. The field sits on `MemoryResponse`, not on the snapshot, because the committed `ui/known-items.property.test.ts` builds snapshots by hand.
- **The strip figure:** shown only for a leased, admitted or delivered celebrate moment with a positive delta, and only while the loop is compared (`STRIP_MOMENT_SCAN_MAX` 2,000).
- **X-167:** see P1-5 above.

## Contract questions

- **R-030-1:** no writer exists for the comparison window's bank rows and coverage in a clone. Should `seed/event` gain one, or should `advance` bring them?
- **R-030-2:** the lab-counts property and finding 5 disagree about alleged guesses (X-167).

## Files the lead must merge by hand (`packages/server/src/time/**`, now brief 036's)

These were edited before the lead's message. They are as they stood then, and were not extended:
- `time/hero-anchor.ts`: new (P1-1).
- `time/loop-check.ts`: new (P1-3).
- `time/tick.ts`: one import and one call in `moveMoment`, before the moment's `tx.update` (P1-3).
- `time/said.ts`: a new `admitMoments` function, added beside `admitMoment`, which is unchanged (P1-6).

Nothing in `packages/core/src/moments/**` was edited.

`packages/core/src/patterns/**` now belongs to brief 037. This lane edited one file there, `patterns/words.ts`. It adds `lessOnTakeoutLine`, and `comparisonLines` now calls it with the same output (P1-4, `117d605`). It also edited `routes/tool-food.ts` (P1-1, P1-2, P1-9), which brief 037 leaves to this lane. `patterns/offer.ts` was not edited.

Phase two now also waits for the server half of brief 037. Brief 032's "Outcome" (the W-166 rows) is merged, but those rows are ledger rows, which are phase two.

## Hot files touched

All additive:
- `routes/open.ts`: one import and one line (`checkOpenVisit`).
- `routes/receipt.ts`: one import, one call, and `controlCheck: goneCheck(req)`.
- `routes/memory.ts`: the strip's falls, `hardRules`.
- `routes/tool-food.ts`: the anchor, the blocks, the loop roots.
- `core/schema/wire.ts`: `hardRules`, and two duplicate request types removed.
- `core/memory-views.ts`: `stripView`'s `falls`.
- `core/patterns/words.ts`: `lessOnTakeoutLine`, now also used by `comparisonLines` with the same output.
- `apps/web`: `memory-screen.ts`, `voice-client.ts` (`onControlCheck`), `memory-model.ts` (`askGone`), `typed-turns.ts` (`visitId`), `app-controllers.ts`, and the specimen fixture.
- Test infrastructure: `testing/script-runner.ts` (the `advance` step).
- Not touched: `state.ts`, `turn.ts`, `head.ts`, `admission.ts`, `audience-swap.ts`, `intents/repair.ts`, and the voice, gate, whisper, writes, onturn and moments folders. No committed `*.property.test.ts` was edited.

## Checks

These ran after merging `build/plan-stages` (`b1085d6`):
- `npx vitest run --maxWorkers=3`: exit 0. 425 files, 3,835 passed, 20 expected-fail (34 at the start).
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, with the one earlier warning (`avatar/three/brass.ts`).
- `npm run build`: exit 0.
- `copy-check`, `token-check`, `ui-boundaries` and `import-boundaries`: exit 0.

## Not tested

- Anything live: no model, no emulator, no browser, no dev server.
- On a real call: the receipt route's moment calls and the spoken false-gone ask. No route puts a moment on the wire yet, so `momentIds` stay empty in practice.
- Signed in: the strip's "$115 less" label on screen, the rule motes, and a stale visit tab.
- The added moment and block scans on Firestore, and their latency.

## Phase two, part A

Built by Claude Code on `lane/wire`. No commit ends `Built-with: Kiro`. `build/plan-stages` was merged three times: `9f615b4` (brief 037), `8208c80` (brief 035) and `9e5d68f` (the last).

### Seams, one per commit

| Seam | Commit | Test first |
|---|---|---|
| Delivery's choice is the open's `Proactive` (`routes/delivery-wire.ts`, plus a few lines in `open.ts`). The Gate runs inside `chooseNow` with the stored session's audience and modifiers; nothing gates a second time. It runs only for a `connecting` open with no swap line. A replayed open carries no `Proactive`. A failed choice says nothing and never fails the open. | `a01dc44` | beat 1's wish step; `delivery-wire.test.ts` |
| An offer is recorded as shown when its line starts playing (`receipt-moments.ts`). A `playbackStarted` receipt for a moment admitted on that response writes `pendingRendered`. The pending ID is the moment's own for an `offer` or `ask` moment. For the hero it is recomputed from the rows, and written only when the offer's line is still the one rendered. The pending ID never goes on the wire. The runner gains a `play` step (admitted, playback, transcript). | `6eeea88` | beat 3's yes, with the `showOffer` setup removed |
| Food F24's wait is dropped, since brief 037 turned it green. The summary reads 39 green and 1 waiting. | `c521ff6` | the summary test |
| The state route offers an idle whisper, after its ack checks. Nothing is read until `IDLE_SILENCE_MS` of quiet. A line still under an earlier poll's Permit is not sent again. The runner gains an `idle` step. | `c4c2bbf` | beat 3's Friday variant and food F34 and F35, which now play the wish, then the offer as an idle whisper, with no setup |
| V-181: the tool route narrows as the turn route does. It reads `narrowedHere` from the Session and issues no Deck on a Session narrowed here. | `2d7a9eb` | new `routes/audience-tool-door.property.test.ts`, 1,000 runs. Red first on `{"kind":"crisisLive","cls":"company","p":0.3,"judge":"H"}`, "answer": a Head with the S1 line. It calls with the browser's stamp and with the current stamp, so a stale answer can't pass it by saying nothing. |
| The Gate stands in front of a recall's notes above S0 on the tool route (`routes/gate-tool.ts`, one call in `tool.ts`). Each note it doesn't say writes a Gate row. | `be1a4e0` | `gate-tool.test.ts` |
| A typed open's `Proactive` is shown on the screen: `TypedTurns.onProactive` puts it in the `ProactiveShelf`. The browser then sends an `admitted` and a `pendingRendered` receipt naming the moment (`client/proactive-shown.ts`). The server records each offer moment admitted on that response as shown. | `fb84ce1` | `typed-proactive.test.ts`, against the real routes |
| `writeSaid` computes its match from what was heard (033 finding 12). | `cd257d9` | the finding 12 case in `said.test.ts` |
| The Lab counts the Gate's held, steered, declined and blocked rows. `steered` and `declined` leave `LAB_UNCOUNTED`. | `b0aa01f` | `memory-views.lab-gates.test.ts` |
| A said `celebrate` moment marks its loop `celebrated` (`markCelebrated`), in the receipt's transaction. | `43d7e63` | a new beat 3 step, red first with the state still `eligible` |

### Script steps turned green

- Beat 1: "the wish for the interview at 2 is said first" (`a01dc44`), and "the next open does not wish again" once the wish is played (`6eeea88`).
- Beat 3, both main variants: "the offer plays after the bolt, with $186" (`a01dc44`) and "Franki speaks first: $71, down from $186" (`6eeea88`). The yes, the list and the strip now pass with no setup standing in.
- Beat 3, Friday variant: the yes after an idle whisper, and "Franki speaks first: $71" (`c4c2bbf`).
- Food F24 (`c521ff6`). F34 and F35 went red at the brief 037 merge, because a yes with no shown offer answers `clarify`. They are green again through the idle whisper (`c4c2bbf`). The coordinator asked that a conflict here take the `build/plan-stages` side (`eef2b14`, which records the offer by setup). The last merge didn't conflict, so these scripts still play the offer.
- The runner binds `occasion.wish` to the code's wording, `wishLine` in `moments/words.ts`.

### Still waiting, and on what

- Beat 1, the wish's texture: the line names only the occasion, and nothing joins the gap-year answer to it (brief 036's folder).
- Beat 1's card on open, and beat 3's offer card: no route returns a card. `S2_SCREEN_ASK_BUILT` is false, and the lead ruled out a card route.
- Beat 2's check-in has two problems, both in brief 036's folder. At Thursday 18:00 delivery chooses the hero offer over the check-in. And the check-in's line is `checkInLine` ("How did it go: ...?"), not the `checkIn` whisper template the runner binds. The step's reason now says both.
- Beat 4's three steps and beat 5's forget steps are unchanged: persona, the recruiter line, the walked-in tap, and forget unwired.

### Not wired, and why

- **No Gate `held` row for delivery.** `chooseNow` runs the Gate but returns only the choice, so a moment the Gate cards or holds writes no row. The smallest fix is in `time/proactive.ts` (brief 036's folder): call `writeGateDecision` with the moment's ID for each verdict other than `say`, in the render transaction.
- **A `card` verdict isn't recorded as `held`.** `gateOutcome` in `core/gate/ledger.ts` maps `card` to `steered`, and the lead's ruling says `held`. The gate folder is off limits, so the tool route's rows say `steered` for a card.
- **The nine W-166 decision rows** (brief 032's Outcome) aren't built. They need the plan's outcome and the difference in the rules from the onturn write, in one transaction with `core/rules`.
- **The Gate doesn't see whispers outside delivery other than recall.** The typed reply's note and the turn's notes are the model's words over the Head, not one Memory's line, so no candidate fits. The Head is compiled for the audience.
- **`inspect` recall lines aren't gated.** The owner asked for everything, and the Server_Rule limits them.
- **`writeSaid` still uses the caller's Gate result.** No stored result is read back, and no route calls `writeSaid` yet.

### Findings

1. **Crisis and a confirmed reminder.** A hold doesn't drop a held reminder. It goes back to pending each time its lease runs out, and opens again at the next opening. It is dropped once its `closeAt` (due + 30 days) passes, as `expired`, with no row saying a hold caused it. Smallest fix (brief 036's folder): in `planTick`, keep a never-admitted `commitmentDue` past `closeAt` as `pending` while crisis holds, or write a held row.
2. **An answered offer whose moment was never said is offered again.** The Friday variant showed this while its setup stood in for the shown offer. After the yes, the pattern moment stayed open, and three weeks on it was offered ahead of the comparison. Nothing in the moment's verdict ends an offer moment whose pending ID was answered (`time/verdict.ts`).
3. **`pendingRendered` is written once per pending ID, ever** (`renderedEntryId(pendingId)`). If an offer is shown in one session and again in a later one, the first row stays. H-168's "recorded during this session" then fails, and the yes answers `clarify`. Smallest fix: key the row by session too (`time/reminder.ts`).
4. **The stash is shared between worktrees.** A `git stash push` of `tool.ts` here crossed with another lane's stash. This worktree received `routes/tool-food.ts` and `food/prefs-read.ts` from `lane/fix6`. They are back in the stash, under a name that says they belong to that lane (`stash@{0}`, "lane/fix6 (hero worktree) work-in-progress ..."). Nothing was dropped. The hero worktree still shows its own copies. No more stash use here.

### Rulings needed (each one constant or rule)

- `OPEN_DELIVERY_RESERVE_MS` = 600: what the open holds back from its tick for the choice and the render.
- `CHECKIN_TURNS_READ_MAX` = 50: past it, turns since a check-in answer read as 0, which holds the insight.
- The open's `Proactive` is not in the request ledger's replay, so a lost answer's line is not sent twice from one render.
- Idle: a line rendered for one poll is not sent again while its Permit lives (`PERMIT_TTL_MS`). An open always renders afresh.
- `GATE_S0_RECALL` = false: S0 recall notes pass as the Server_Rule lets them. The Gate silences every recall nobody asked for, S0 included, and an ask needs a certain speaker, so gating S0 would end recall on voice turns where the judge timed out.
- `RECALL_ALIASES` = "ownValueWords": nothing builds entity names (033 ruling 1), so a Memory's aliases are its own words when its class is U, C or O.
- A Gate `say` whose render isn't `free` drops the recall note, since the note's words are the recall model's, not the template's.
- Evidence has no class: calendar and bank rows read as O, and anything else as T.
- A typed line shown on the screen is admitted on `shown_<turnId>` and stays `admitted`. It is never `said`.


### Rulings from brief 042 and brief 045 part D, as questions for the owner

1. A showing is recorded when the offer's playback ended uncut or its transcript matched, once per response; is a `pendingRendered` receipt from the screen (a typed line) still a showing? (Today yes; finding 7 is meant to narrow it.)
2. A cancel revokes the latest showing of that offer in the Session, even one recorded from a matched transcript of the same response. Right?
3. A yes writes only when the turn is certainly the owner's: judge `O`, or typed by the owner (no audio items, no judge). A timed-out judge's spoken "yes" is `clarify`. Right, given the judge often times out on short words?
4. `SHOWINGS_PER_SESSION_MAX` = 16: past it a showing is not recorded, and a yes after other turns is `clarify`. Enough?
5. An answered offer closes with `closed` for a yes and `declined` for a no (no `answered` cancel reason exists in the schema). Right?
6. A no to the hero offer now writes a declined row, whoever said it, which closes the offer. Should a no also need the owner's certain voice?
7. A reminder held under crisis is said late at the next line not under crisis, opening or idle whisper, whichever comes first (`HELD_LATE_ON_IDLE`), not only at an opening. Right?
8. The late line reads "at 10 PM" (`clockLabel`), not "at 10". Right?
9. At close, a held reminder writes a Gate `held` row naming `crisis`, scoped to the moment, beside the per-Session held rows; the Lab then counts it once more. Right?
10. Delivery's Gate rows are one per candidate per outcome per Session (the Session's delivery turn), at most `DELIVERY_ROWS_MAX` = 8 a call. Right?
11. `STATE_BUDGET_MS` = 1,200: the state route's own budget (the browser's 1,500 ms less 300 ms of network); the idle read gets what is left of it.
12. `OPEN_ANSWER_MARGIN_MS` = 150 kept back from delivery's deadline, with `OPEN_CALLS_AFTER_DELIVERY` = 0.
13. A `said` row records the Gate result as the `say` delivery acted on (render `free`, reasons `ok`); no stored result is read back. Right?
14. Brief 042 item 6: every change the hard-rule route makes to `core/rules` writes a ledger row of kind `rule` (`RULE_DECISIONS`), keyed on the rules document's rev, the source and an index, at most `RULE_ROW_ITEMS_MAX` = 32 items a row (more go in further parts). The rows carry IDs, codes and states only, no quote. Right?
15. A pending rule's `origin` (verdict, coverage, fallback, bound, pasted) is read from the plan after the fact, not passed by the planner, and a rule's `answeredBy` is its own slot, then an anonymous rule of the same code, then an unresolved one with a food code. Right, or should the planner name both?
16. The open's own install of open proposals (`routes/open.ts`, `applyProposals`) writes no rule row yet: it waited for part S and is left. Should it write one (source `open`, already in `RULE_ROW_SOURCES`)?
17. Brief 045 finding 10: `suggest` under any audience but private, or on a Session narrowed here, asks no question drawn from a Memory, returns no pending ID, and keeps only S0 cards (no ask card). Right?
18. Finding 12: every receipt counts only for a moment rendered for the receipt's own Session (the render now records `sessionId` and `pendingId`). A moment rendered before this field existed has no Session on record, so no receipt counts for it. Right?
19. Finding 12: a client's `pendingRendered` is never a showing (it names a pending ID the client chose). The showing is recorded only from a played line (playback ended uncut, or a matched transcript). This reverses question 1's "today yes". Right?
20. Finding 12: a call's `answer` result carries no pending ID (`pendingId: null` on applied, declined and clarify). The code keeps the pending ID server-side (`declinedPendingId`). Right?
21. Finding 7: a moment asks for an answer when its payload kind is `pattern`, `offer` or `ask` (`ASKS_FOR_ANSWER`). The screen shows only a `Proactive` with `asks: false`, and a `Proactive` without the field counts as asking (fails closed). The receipt route admits no asking moment on a screen response ID (`SCREEN_RESPONSE_PREFIX` = `shown_`). Is the prefix acceptable as the screen's mark, or should the receipt carry an explicit channel field?
22. Contract question: since 20, two `answer` requests on one turn can return the same output, so they ask for the same Permit (its ID is the stamp, kind and payload hash, contracts §6). The second one's decision create conflicts, and it answers 409 STALE. Should the Permit ID also bind the request (or the call's function call ID), or should a repeat return the first Permit?
23. Brief 042 item 7, beat 2: delivery's order is right (check-in above insight, spec §6). The Gate holds the check-in: "surgery" makes Biscuit's surgery S2 (`core/lexicon.ts`), and at the floor build the told S2 check-in is a +200 path (`PLUS200_PATHS`). Which is it: a pet's surgery is not S2, the demo runs the +200 check-in path, or beat 2 changes? And should the line be the carve-out's exact `How's {e} doing?` (it is `checkInLine`'s "How did it go: ...?" today) or §15's "How'd Biscuit do?"?
24. Step 4: `OPEN_TAIL_RESERVE_MS` = (2 × `OPEN_TX_ROUND_TRIPS` 8 + `PRIOR_CLOSE_ROUND_TRIPS` 8) × `OPEN_ROUND_TRIP_MS` 75 + `DRAIN_OVERSHOOT_MS` 25 = 1,825 ms, up from 1,400. The drain gets 425 ms less. Right?

### Existing assertions and inputs changed

- `routes/receipt-moments.test.ts`: the wish said on the receipt now matches `idTagged`, not `exactTemplate`. The open renders it now, and `idTagged` comes first in contracts §6's order.
- `routes/memory.test.ts` pinned `uncounted:steered`. It now pins `steered: 0` and `declined: 0` as counted, and `uncounted:falseHolds`. The specimen fixture's `limits` follow.
- `ledger/said.test.ts` and `said.review-033.test.ts` pass what was heard instead of a match, with the same expectations.
- Beat 3: `showOffer` is removed. The main variants play the offer; the Friday variant plays the wish, then the idle offer. Food F34 and F35 gain the same play and idle steps. Waits whose reason changed now say what they wait on. No assertion was softened, and no committed `*.property.test.ts` was edited.

### Hot files touched in part A

- `routes/open.ts`: an import and three lines. `routes/state.ts`: an import and two lines. `routes/receipt.ts`: one call's arguments. `routes/tool.ts`: two imports, three lines for the narrowing and one Gate call. `routes/memory.ts`: one line.
- New: `routes/delivery-wire.ts`, `routes/gate-tool.ts`, `client/proactive-shown.ts` and their tests, and `routes/audience-tool-door.property.test.ts`.
- Changed: `routes/receipt-moments.ts`, `ledger/said.ts`, `core/memory-views.ts`, `testing/script-runner.ts`, `scripts/gate-kit.ts` (the stale `NARROW_TOOL` reason removed), `client/typed-turns.ts`, `components/app-controllers.ts`.
- Not touched: `core/voice/**`, the golden corpus, `core/gate/**`, `whisper/**`, `moments/**`, `server/time/**`, `server/food/**`, `answerTool`, `admission.ts`, `audience-swap.ts` and `intents/repair.ts`.

### Checks for part A

These ran after the last merge of `build/plan-stages` (`9e5d68f`):
- `npx vitest run --maxWorkers=3`: 480 files; 4,117 passed, 31 expected-fail, 4 failed, all in `scripts/gate-friend.test.ts` (Friend Tests 3, 8 and 10). Each typed transition line ("My mom passed away last night.", "Sam and I broke up...", "I was diagnosed with cancer last week.") now makes 2 `responses.create` calls where the script declares 1. The calls came in with the brief 025 merge (`1aeafb9`: the transition and memory routes on the turn, `onturn/memory-route.ts`). This lane didn't touch `onturn/**` or `turn.ts`, and the scripts were green at `8208c80`. Not checked on `build/plan-stages` alone, and not fixed here.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, with the one earlier warning (`avatar/three/brass.ts`).
- `npm run build`: exit 0.
- `copy-check`, `token-check`, `ui-boundaries`, `import-boundaries`, `clock-check` and `model-literals`: exit 0.

### Not verified in part A

- A live call: the `Proactive` on open and as an idle whisper through the voice machine, and its receipts. The runner's `play` stands in for the voice client.
- A signed-in browser: the typed `Proactive` on the screen and its two receipts.
- The hero's `pendingRendered` from a typed line shown on the screen. The server path is written, but the typed test only shows the wish.
- Firestore: the idle path's reads on each poll after 8 s of quiet, and the recall Gate's read of every Memory.
