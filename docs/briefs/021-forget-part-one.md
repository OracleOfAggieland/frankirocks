# Brief 021: forget, part one (lane `forget`, F4)

Read `docs/briefs/016-plan-stages.md` first. Its rules apply here.

Spec §8 gives forgetting as eight steps: quarantine, fence, close, resolve, install, closure, resume, purge. The schema for it exists (`ForgetJob` phases, the barrier and its queue, `sanitizedFrom` and `sanitizeMap`, the ledger's `forgetReceipt`), and `eligible` denies its maintenance tasks "until F4". No step is built. This brief builds the pure pieces and the store work of steps 2, 4 and 5, with what they keep and the receipt. It builds no route, and it does not build the closure walk.

## What is held back, on purpose

**Step 6 (closure, the walk over `dependsOn`), step 7 (resume and "Gone") and the No Resurrection property are not built in this brief.** The plan (spec §14) has that property written first and run red before the closure it tests, from a spec. That work is reserved for a later, separate run. So in this brief:

- Do not write a property named No Resurrection, or any property that states "nothing derived from a forgotten input stays eligible".
- Do not write the `dependsOn` walk.
- The executor stops after install in a phase that is not complete. Nothing built here may report a forget as done, and nothing may say or show "Gone". Admission rule 11 ("forget before forget exists") stays as it is, and no route calls this code.

## Read first

- Spec §8 (lines 259 to 285) in full, §3 lines 77 to 93 (the control turn; rows 87 and 90), §4 lines 122 to 166, §6 lines 196 to 241 as far as eligibility goes.
- Contracts §8 (lines 878 to 891), `eligible` (380 to 397), the registry (400 to 431), effects and `withdrawnHold` (119 to 125), blocks (196 to 202), overlays (204 to 209), `QueuedControl` (192), `ForgetJob` (194), the barrier (247), `sanitizeMap` (45), `forgetReceipt` (162), `ForgetResolveV1` (640 to 657), `QUARANTINED` and `CLEAN_READY` (782 to 783), `reanchorRule` (825, 840), Q19 (920), and the IDs KC06, KC08, KV07, KV08, KV09, KS07, KS09 (972 to 1007).
- `docs/briefs/012-design.md` question 162 (line 1103): what the fence does to rows written before it. It leaves a question for F4; answer it in your design note.
- `.kiro/specs/lab-ui-foundation/design.md` questions 1 and 7; `.kiro/specs/voice-control/design.md` question 79.
- `packages/core/src/eligible.ts` and its tests, `lineage/`, `schema/records.ts` (the forget shapes), `writes/` (rule state, the hard-rule planner, `bundle.ts`), `packages/server/src/store/`, `worker/jobs.ts` and `tick.ts`, `apps/web/src/ui/receipt-from.ts`.

## How the work runs

1. **Design note,** `docs/briefs/021-design.md`: each step's write set as the contracts give it; every gap, ambiguity or conflict with the answer chosen; a Correctness Properties section; the file plan; contract questions. It also lists what the reserved work (closure, resume, the No Resurrection property) will need from this code: the function to call, the state it finds, the phase it must advance.
2. **Then the pieces below.** For each, the property first and red, then the code.

## What to build

- **Fence** (step 2): one small transaction that raises the epoch and the policy revision, sets the barrier, burns the bundle and records the dead item IDs. A second forget while a barrier is up joins its queue; the barrier clears only when the queue is empty. Retries keep their original input epochs. The request turn dies at the fence: no safe turn, no extraction, no chunk.
- **Eligibility under a barrier:** recall returns nothing and writers wait while it is up. Blocks (root, provider and semantic) and overlays make a row ineligible through the one `eligible` function. No second function decides what is usable.
- **Resolve** (step 4), the floor's version: current-session segments first, then exact bindings, aliases and roles. An exact match goes. An ambiguous one is held and asked, with neutral labels. A vague cue matching more than one memory confirms first. `ForgetResolveV1` goes through a port with a fake.
- **Install** (step 5), in bounded pages: blocks and overlays first, then sanitized evidence revisions. A sentence holding a removed range drops whole, except a verified rule span.
- **`reanchorRule`**, pure, as contracts lines 825 and 840 give it: it maps a hard rule's span onto the sanitized revision, verifies the quote and the gazetteer entry, and swaps its roots. With no disjoint span, or a subject that is not literal in the span, the rule goes `pending`. A forget never withdraws a hard rule.
- **What withdrawal keeps** (spec lines 275 to 279): excludes, quiet and care holds as a content-free `withdrawnHold`, `wrong` marks, negative assertions and cancelled moments. A forgotten memory's calendar event survives as busy time with no moments. Render sensitivity never falls.
- **The receipt and the scope card's data:** what was blocked, what was cleaned, what was touched, and what withdrew, as counts and neutral labels, in the `forgetReceipt` shape. Data only; no screen work.
- **The job:** `forget` as a job kind the worker can lease and advance phase by phase, resumable, ending in the not-complete phase described above.

The floor has no re-extraction and no `ruleSalvage` (spec line 273). Build what that paragraph says instead: code survivors stay, everything else in a dirty packet withdraws, and the receipt counts what withdrew.

## Properties, red first

- **A hard rule outlives any forget:** for any store and any forget target, every committed hard rule is still active or `pending` afterwards, never gone, and a re-anchored rule's span is a verbatim quote of the sanitized text.
- **A sentence never loses half its meaning:** for any text and removed range, the sanitized revision holds no sentence that overlapped the range, except a verified rule span.
- **Restraint survives:** for any forget, every exclude, hold, `wrong` mark, negative assertion and cancelled moment that was not the target still restrains what it restrained.
- **The fence is one-way and the queue drains:** for any order of forgets and retries, the epoch and policy revision never fall, a retry keeps its input epoch, and the barrier clears exactly when the queue is empty.
- **Under a barrier nothing is read:** for any read during a barrier, the result is empty.
- **A direct target is ineligible after install:** for any forget, every row the resolve named is denied by `eligible` in every context. (This is about named targets only. It says nothing about rows derived from them.)

## Hot files this lane may edit

`packages/core/src/eligible.ts` (this lane is its one writer), `packages/server/src/worker/jobs.ts` (the job kind), additions to `schema/records.ts`, `testing/samples.ts`, `store/paths.ts`, `core-docs.ts` and the barrels. New: `packages/core/src/forget/**`, `packages/server/src/forget/**`. Not `routes/**`, `admission.ts`, `head.ts`, `worker/tick.ts`, `packages/core/src/voice/**` or anything under `apps/web`.

## Done

The design note, the pieces above with their properties green, the checks of brief 016, and `docs/briefs/021-report.md`. The report has a section "Reserved" that states plainly that closure, resume, "Gone" and the No Resurrection property are not built and no forget can complete.
