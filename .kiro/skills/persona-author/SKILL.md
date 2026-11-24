---
name: persona-author
description: Use when writing, stitching or reviewing a seeded persona fixture for Franki, such as the Kisses persona (Jeffrey Kisses) under packages/server/src/seed/kisses/, or any SeedFixture the seed loader must accept. Covers the fixture format, the time skeleton the hero offer needs, the loader's checks, mail trust, and the persona check script.
---

# Authoring a seeded persona

A persona is one `SeedFixture`: a list of lines (turns, mail, bulk mail, calendar events, bank rows), each with its own hand-written packet, plus, for a demo persona, a profile. The seed loader builds every row in memory, checks it, and only then writes. The first persona (`packages/server/src/seed/persona/`) is the worked example. Read its file of the same name before you write yours.

Pull in the taste rules first: `#kisses-taste` (`.kiro/steering/kisses-taste.md`, manual inclusion). The plan for the person is `docs/briefs/054-persona-bible.md`; if you have no bible, write one first (see step 1). Never change a date, a name, an amount or an address the bible fixes. If the bible is wrong, say so and fix it first.

## Steps, in order

1. **Plan on the skeleton.** Fill the day table in `references/skeleton.md` before any line exists: the clone's Friday, the 21-date window, the late-meeting nights, the takeout rows and decoys, the rocket-fuel and calendar rows the demo questions need. Write the hero arithmetic down. Decide who is mailed and who is a stranger (`references/trust.md`).
2. **Write the limbs**, each in its own file under the persona folder, in the shape of the first persona's file of the same name: `bank.ts`, `calendar.ts`, `mail.ts` and `bulk.ts`, `turns.ts`, then `profile.ts`. Field by field format and one example per line type: `references/fixture-format.md`. Quote spans straight from the line's own text.
3. **Stitch.** Put the limbs and the profile together in `index.ts`: the fixture ID (43 characters, never changed), `origin: "authored"`, `windowDays: 21`, `lines`, `demo`. Write `kisses.test.ts` so the real loader loads it, the hero offer holds on the clone's Friday, and the structural facts hold.
4. **Run the check** (below). Fix what it names. A loader failure names a check and a line: look it up in `references/loader-checks.md`.
5. **Read it once for taste.** No script judges kindness or humour. Re-read the persona against `kisses-taste.md`, rules 2 to 4.

## Run the check

```
node .kiro/skills/persona-author/scripts/check.mjs [dir]
```

Default `dir` is `packages/server/src/seed/kisses`. It (a) scans the contents of the string literals (single-quoted, double-quoted and template literals) in every `.ts` file in the folder, skipping comments and code such as field names, for words of the Denied_List (`packages/server/src/testing/denied-words.ts`: real companies, brands and well-known public figures), on word boundaries after NFKC and case folding, printing `file:line` for each hit; and (b) when the folder holds a `*.test.ts` file, runs `npx vitest run <dir>` and lists the names of failing tests. It prints a summary and exits 1 on any hit or failure, 0 when clean. A folder that does not exist yet is clean.

`--witness` is for hooks and loops: it prints nothing and never fails; it does nothing unless `git status --porcelain <dir>` shows a change, and then appends one line (`<ISO time> PASS|FAIL hits=<n> failing=<n>`) to `.kiro/specs/kiroween-demo/persona-check.log`.

## Rules that never bend

- **Invented only.** No real person, company, product, place of business or trademark. Addresses on the reserved `.example` domain.
- **No fact without a line that carries it.** Every Memory quotes the owner's own words.
- **Amounts under `BANK_CENTS_MAX`** ($100 billion a row).
- **One allergy, in his own words, as a `fact`.** The seed cannot write a hard rule; an `allergy` rule item fails the load (`itemNotWritten`).
- **Write only the persona's folder** (and the bible). Never touch the loader, the types or any test outside the folder to make a persona pass. If the types are wrong, say so.

## References

- `references/fixture-format.md`: every line type and field, `at(day, hhmm)` and `q()`, the new optional fields, the demo profile, what each packet must hold, one short example per line type.
- `references/skeleton.md`: the window, the clone's Friday at 08:40, the bolts, the `TAKEOUT_LATE_V1` thresholds, the decoy rules, the world-clock ruling for a demo visit.
- `references/loader-checks.md`: every check the seed build and load can fail with, what triggers it, how to fix the line.
- `references/trust.md`: mailed senders and strangers over the simulated Google, and how to write a stranger's mail that gives an order.
