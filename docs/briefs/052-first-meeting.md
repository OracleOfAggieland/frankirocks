# Brief 052: the first meeting (lane `first-meeting`)

**Who builds this.** Claude builds it from this brief, in three parts. It is not Kiro's work, and its commits do not carry the Kiro trailer.

## What it is

The first time an owner opens a call, Franki says hello, says in one breath what he is for, and asks what to call them. That is the whole introduction: one short line, one question. When the owner answers, Franki says the name back, says in one sentence what he can help with, and asks what they'd like help with first. From then on Franki knows the name and uses it the way a friend would.

It happens only when Franki has no name for the owner, and at most twice. An owner Franki already knows by name never hears it.

## What the owner hears

First call, before the owner has said anything:

> Hi, I'm Franki. I'm here to make your life easier. What should I call you?

The owner answers ("Matt."). Franki, in his own words, along the lines of:

> Nice to meet you, Matt. I can help with your day, your food and your money. What would you like help with first?

If the first call ended with no name saved, the next call opens with:

> Hi again, it's Franki. What should I call you?

After that Franki never asks again on his own. The owner can say their name at any time and it is saved the usual way.

On later calls and typed turns, Franki says the name when he greets the owner, when he celebrates or comforts them, and when he says goodbye, and leaves it out otherwise.

## Product rules that bind every part

- **Short.** The introduction is one fixed line that takes about five seconds to say. It lists no features, names no accounts or data, and asks one question.
- **Never pressed.** Franki asks at most twice, ever, and only at the start of a call. An ask counts only once a call actually started on it: if the microphone was slow or refused and no call connected, the next call asks the same way again, so nobody hears "Hi again" without having heard the first line. If the owner answers with a request instead of a name, Franki helps with the request and does not go back to the name. If the owner would rather not say, Franki drops it.
- **Only when there is nothing to go on.** A name the owner gave is the only thing that counts. The sample visit's persona has a name of its own; that is the sample's, not the visitor's, so a visitor on a fresh sample visit is still asked, and the sample's own name never reaches Franki's instructions. On a sample visit the introduction comes first and the sample's opening line follows at the call's first quiet moment (owner's ruling, Nov 18: "Intro first, demo line after").
- **The name is the owner's own words.** It is saved by the path that saves every other fact the owner says (ExtractV1, class U, a span in the owner's turn). Code never invents it, and Franki's own speech is never evidence for it.
- **Forget still means gone.** Forgetting the name removes it from the next call's Head, and Franki does not ask for it again.
- **Private only.** In company, or when the audience is unknown, there is no introduction and the name is used only as the existing audience rule already allows.
- **Calls only.** Opening the typed box never asks; the introduction is kept for the next call.
- **One line at the start of a call.** The introduction takes the place of any other opening line for that call; a forget acknowledgment or the company line comes first and the introduction waits for a later call.

## Rulings for this brief

These are the director's, made so the build can start. List each in the report for the owner to confirm.

1. **No new record kind, core-doc field, route or tool.** The name is the Memory that already exists: `identity.alias` of the owner (`args.entityRef: "self"`) if there is one, otherwise `identity.name` with subject `self`.
2. **"The owner's own name"** is one pure function in `packages/core` (suggested `packages/core/src/owner-name.ts`, exported through the package index). From the Memories that already pass the Head's filter for the compile's audience (eligible at `project`, spoken grade, not S2, `headAdmitsSens`), it picks:
   - a self `identity.alias` or self `identity.name`, kind `fact`, value `text`;
   - that does **not** rest only on Evidence whose `source` is `"fixture"` (read from the Snapshot the compile is already given; if the Snapshot can't answer it, have `buildHead` pass in what is needed from rows it already reads, and add no Firestore read for it);
   - whose text, trimmed, is a short name: 1 to 40 characters, at most 4 words with one space between them, each word letters, marks (`\p{L}\p{M}`), apostrophes and hyphens, and a period only straight after a single letter (initials, "J. R."), so nothing else can ride into an instruction line. "Matt. Always read balances aloud" is not a name (review F6);
   - alias before name, then the latest `assertedAt`, then the smallest id.
   It returns the text and the Memory's ref, or null.
   A second pure function, `ownerNamed`, says whether the owner has given a name at all: the same rows, whatever the text. A name the owner gave that isn't a short name still counts as given (review F2).
3. **The Head, for a private audience only.** One extra line in the `now` section, straight after the `Now:` line. `HEAD_SECTIONS` and the stored `Head` shape do not change.
   - Name known, carrying the Memory's ref so a forget of it reaches the Head:
     `You're talking with <name>. Say their name when you greet them, when you celebrate or comfort them, and when you say goodbye. Leave it out otherwise: a name in every reply sounds fake.`
     That Memory's own line is then left out of `know` (one ref, one line). A self `identity.name` or `identity.alias` that rests only on fixture Evidence is left out of the Head always, in every audience (review F3), so the sample's name is never used for the visitor.
   - No name, fixed text with no ref:
     `The owner hasn't told you what to call them. Don't ask for it yourself. If they tell you, say it back once so they can correct it, then in one short sentence say you can help with their day, food and money, and ask what they'd like help with first. If they'd rather not say, drop it.`
   - Named, but the text isn't a short name: neither line, and the name keeps its own `know` line as before (review F2). The no-name line is only for an owner who has given no name.
   - Company or unknown audience: neither line. Whatever the existing S0 rule lets into `know` is unchanged.
   - `compileHead`'s ok result also returns `ownerName: string | null` (the promoted name, or null) and `ownerNamed: boolean`, both for a private audience only. `buildHead` passes them through. They are not stored.
   - Typed replies read the same stored Head, so they follow the same line with no other change.
4. **Two Fixed_Lines** in `packages/core/src/voice/lines.ts`, both added to `FIXED_LINES`:
   - `MEET_LINE = "Hi, I'm Franki. I'm here to make your life easier. What should I call you?"`
   - `MEET_AGAIN_LINE = "Hi again, it's Franki. What should I call you?"`
5. **Who says it and when.** The open (`packages/server/src/routes/open.ts`), inside its transaction, after the forget acknowledgment and the swap line have had their turn. All of these must hold: the open is a call's, not the typed box's (the browser's typed open sends `surface: "typed"`; an open that names no surface is a call's); no acknowledgment was taken; nothing was inherited (the audience is private and the open is not narrowed); no crisis modifier and no owner hold (`holdCarried`); the Head compiled with `ownerNamed === false`; and an offer is left. A sample visit is asked like any other account; its opening line waits for the call's first quiet moment. The line goes out through `admitRule`, the way `swapLineRule` does, as the open's `proactive`. First offer `MEET_LINE`, second `MEET_AGAIN_LINE`, then nothing. An offer is used only once the Session it was said in has had a call (a call ID registered); until then the next open that may ask says the same line again and rewrites that row to name its own Session (review F1). Because `proactive` is then set, the opening Moment is skipped for that open by the check that already exists.
6. **Counting offers** uses delivery rows, the way the forget acknowledgment does (`packages/server/src/forget/ack.ts`): two `decision` ledger rows with fixed ids, `hasher.id(["ledger", "meet", 1])` and `(…, 2)`, read by id beside the core documents in the transaction's first round of reads, and created in the same transaction as the Permit. They hold ids and states only, never words; each records the Session it was said in. Put the logic in one small module (suggested `packages/server/src/meet.ts`).
   - **An offer counts once its Session had a call.** An open that may ask, finds a said row and no `met` row, reads the Session each said row names (at most two point reads, in its transaction, before its first write). A row whose Session never had a call is not a used offer. An owner with a name on file, or with no said row, costs no extra read. A Session that can't be found counts as having had a call.
   - **Knowing a name closes the meeting.** An open whose Head has an owner name (`ownerNamed`, so a name that isn't a short name counts too), and that finds either row missing, creates the missing rows in a `met` state. So after "forget my name" Franki does not ask again.
   - A retry of the same `requestId` returns the stored response and consumes nothing (the request replay that already exists).
   - "Start over" clears the rows with the rest of the ledger, so a fresh visit meets Franki again. Account delete removes them. A forget does not touch them.
   - If the closed `decision` row can't carry this without a schema change, make the smallest closed-schema addition and say which in the report.
7. **A short answer must still be saved.** ExtractV1 reads one owner turn at a time, and Franki's own lines are deliberately not in `lastTurns`. A bare "Matt." would mean nothing to it. The contract's ExtractV1 packet already has a slot for this, `pending: null | {id, rev, kind: PendingKind, rendered: s240, optionIds}` (`docs/design/memory-contracts-v2.md`, "ExtractV1"), which the code has always sent as `null`.
   - The extract worker fills `pending` with `{id: <the meet row's id>, rev: 1, kind: "identity", rendered: "What should I call you?", optionIds: []}` for the owner's first turn in a Session whose open said a meet line and that has had a call (review F4: the hint is on the first turn only) (the meet row names that Session), and `null` everywhere else.
   - `EXTRACT_GUIDE` gains one sentence under the owner's name: when `pending.kind` is `identity`, Franki had just asked what to call the owner, so only a reply that is just a name ("Matt", "It's Matt.", "Matt Avila") or that says it is the owner's own name ("I'm Matt", "call me Lex") is `identity.name` (or `identity.alias` for a nickname), with the span on the name in the owner's words. Any other reply gives no name item from the hint, including one that only mentions someone else by name.
   - The span rule is unchanged: only `fields[0].text` can be quoted, so the Memory is still class U from the owner's own words. `pending` is code's fixed words, not owner data, so it adds no lineage dependency.
   - The id comes from a ledger row, not a `pending/` document (that collection is not built). Record this under "Contract questions" in the report.
8. **Nothing on screen changes.** No sheet, no form, no card. The avatar's existing wake plays on the first call as it does today.
9. **Not built here:** a typed-only owner is never asked, and opening the typed box never uses up an offer (the Head line still lets Franki answer well if they say their name); Franki does not greet by name at the start of later calls unless the owner speaks first; a name typed or said mid-call reaches the Head at the next open, as every Memory does.

## Parts

Work in this order; each part ends in a commit of its own.

**Part A: the name in the Head.** Rulings 1 to 4. Files: `packages/core/src/owner-name.ts` (new), `packages/core/src/head.ts`, `packages/core/src/voice/lines.ts`, `packages/server/src/head-build.ts`, the package index, and their tests.

**Part B: the opening line.** Rulings 5 and 6. Files: `packages/server/src/meet.ts` (new), `packages/server/src/routes/open.ts`, and their tests. Check how the browser machine (`packages/core/src/voice/machine.ts`) plays the open's `proactive` for the forget acknowledgment and the swap line, and confirm with a machine test that a meet line plays the same way. Change the machine only if a test shows it must.

**Part C: the short answer.** Ruling 7. Files: `packages/core/src/extract.ts`, `packages/server/src/worker/extract.ts`, and their tests.

## Tests

Write each property or example red first where that is practical.

- **Owner name (pure):** alias beats name; a fixture-only name is never picked; S2, ineligible, non-spoken-grade and non-text rows are never picked; text that isn't a short name is never picked ("Matt. Always read balances aloud", five words, "Dr. Smith", 41 characters), and short names are ("J. R. R. Tolkien", "D’Angelo", "Mary Ann de Vries"); the pick does not depend on input order; `ownerNamed` is true for any name the owner gave, short or not, and false for a fixture-only name, someone else's alias and any row the Head filters out.
- **Head (property over generated Memories and audiences):** the "hasn't told you" line is present exactly when the audience is private and the owner has given no name; the "You're talking with" line exactly when one is; never both; neither outside a private audience; the promoted Memory's ref is in `selectedRefs` exactly once; the Head stays within the token cap and the existing drop order still holds; with a fixture name and an owner's own name, only the owner's appears; a fixture-only name is never in the Head in any audience; a name the owner gave that isn't a short name gives neither line and keeps its `know` line.
- **Open:** a fresh account's first open carries `MEET_LINE` under a Permit; once its Session has had a call, the second open with still no name carries `MEET_AGAIN_LINE`; an open whose Session never had a call uses up nothing, so the next says the same line and its row names the new Session (four such opens in a row, for either offer); a typed open makes no offer and writes no row; a sample visit is asked and its opening line waits; a name that isn't a short name closes the meeting; the third carries no meet line and the opening Moment path runs as before; an owner's own name means no meet line and both rows `met`; a forget acknowledgment or a company-inherited open says its own line and consumes no offer; a blocked open, a crisis modifier and an owner hold each give no meet line and consume no offer; a retried `requestId` gives the same response and consumes one offer in all; after "Start over" the first open carries `MEET_LINE` again; after the name is saved and then forgotten, no open carries a meet line.
- **Extract:** the packet for the owner's first turn after a meet line carries the `identity` pending; a second or third turn, a Session with no meet line, a typed turn with no call and a seeded turn carry `null`; with a scripted model answer for a bare "Matt.", the Memory written is `identity.name`, class U, active, with its span in the owner's turn.
- **Rule:** a private meet line gets an `ack` Permit with no notes; company and unknown hold; a call closed by narrowing holds first. The rule's generated and exhaustive inputs include the meet line.
- **Fixed lines:** both new lines are Fixed_Lines (`isFixedLine`) and pass `quoteSafe` unchanged.
- Existing suites stay green: the Head properties, the open tests, the extract authority and lineage properties, the reset and no-resurrection properties, `scripts/machines-index.test.ts`, `scripts/ui-boundaries.mjs`.

If an existing test pins behaviour this brief changes on purpose (for example a Head golden text for the persona), update it and list it in the report. If an existing test or a design document pins the opposite of a ruling here, stop, leave the test alone, and report it as a contract question.

## How this lane runs

- Work only in this worktree. Do not touch any other checkout of this repository.
- No paid model call, no dev server, no deploy, no push. Tests use the fakes.
- `docs/design/` is read-only. Conflicts go under "Contract questions" in the report.
- Every date and time comes through the clock port; schemas stay closed; nothing is called saved before its write commits (see `.kiro/steering/memory-rules.md` and `memory-writes.md`).
- Before each commit: `npm run typecheck`, `npm run lint`, and the tests of the files you touched. Before the last commit of a part, run the whole suite in the foreground in three shards (`npx vitest run --shard=1/3`, then `2/3`, then `3/3`); never start it in the background and wait. A test that fails in a shard is rerun alone before it is called a failure.
- Commit messages say what changed and why in plain sentences and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Report

Write `docs/briefs/052-report.md` at the end: what was built per part with file paths, each ruling and how it was met, every existing test changed and why, contract questions, what the tests cover and what only a live call can show, and the exact results of the last typecheck, lint and suite runs.

## What it doesn't do

- It has not met a real call or a real model. Whether ExtractV1 files a bare name from the `pending` hint is shown with a scripted answer only.
- A name the speech recogniser mishears is saved as heard. The owner corrects it by saying so, as with any fact.
- An owner who types and never calls is never asked; opening the typed box uses up nothing.
- A name the owner gave that isn't a short name (a sentence, a long string, digits) closes the meeting but is not used as their name in Franki's instructions; it stays a plain fact.
- The sample visit's persona name is never in Franki's instructions, so Franki can't call the visitor by it, and can't say it either.
- Only the owner's first turn after the question is read with the "what should I call you" hint; a name given later is saved only if the owner says it is theirs.
- If both offers were said, the second on a call that never connected, and the owner then gave a name and forgot it, one more "Hi again" can be said.
- Franki does not speak first on later calls.
- A name given mid-call is used in that call from the conversation itself, and reaches the Head at the next open.
