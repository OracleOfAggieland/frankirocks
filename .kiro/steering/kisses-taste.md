---
inclusion: manual
---

# Kisses taste rules

Source: `docs/briefs/054-kiroween-demo.md`, "The persona: taste rules" and "Product rules that bind every part". If this file and the brief differ, the brief wins and this file must be fixed. Spec: `.kiro/specs/kiroween-demo/` (Requirements 25 and 26). Pull this file in by name when you write, stitch or review anything under `packages/server/src/seed/kisses/`.

Jeffrey Kisses is funny because of scale and contrast. He is never the butt of a mean joke.

The Denied_List, as data: #[[file:packages/server/src/testing/denied-words.ts]]. No line of the persona may hold a word from it. `node .kiro/skills/persona-author/scripts/check.mjs` scans for it and prints file:line.

## The rules, as tests you can apply

1. **Invented only.** Every merchant, sender, event, place, address and person is made up, Jeffrey included. Test: could a reader find this name on a map, a stock exchange or a shelf? If yes, change it. Use made-up two-part names (`Quillan Thai Kitchen` is the first persona's style) and the reserved `.example` domain for every address. Nothing describes a real person's life, family, looks, health or politics, not even in passing.
2. **Kind.** Franki treats Jeffrey like anyone else: warm, a little amused, never fawning and never mocking. Jeffrey is likeable: he calls his mother, tips well, forgets to cancel subscriptions. Test: would Jeffrey read the line and laugh with it? If the laugh is at him, cut it.
3. **The joke is the size of ordinary things.** The humour sits in a number or a pairing, not in a punchline about the man. Rocket fuel next to a late library fee. A very large deposit next to a $9 sandwich. A launch window that keeps landing on dinner. Test: say the two rows or two lines side by side; if the contrast is the joke, keep it; if you needed an adjective to make it funny, rewrite it as numbers.
4. **Clean.** Nothing crude, nothing about bodies, nothing political. No swearing, no innuendo, no weight, looks or health jokes, no party, policy or election.
5. **True to the product.** One real allergy, in Jeffrey's own words, in one turn. No fact without a line that carries it: every Memory quotes the words that say it, and nothing is inferred beyond them. Every figure traces to a row.
6. **Amounts stay under `BANK_CENTS_MAX`** ($100 billion a row, 10,000,000,000,000 cents). Large is fine; absurd is the point; past the cap the load fails.

## A line that fits, and one that does not

| Fits | Does not fit | Why |
|---|---|---|
| Bank row: `Stratos Propellant Depot`, 4,200,000 cents, `other`, next to `Ashgrove Library`, 35 cents | A merchant called after a real fuel company | Rule 1: invented only |
| Turn: "I tip well, my mother says it is the only thing I do right." | Turn: "I'm hopeless with money, ha." said as a flaw Franki jokes about | Rule 2: Jeffrey is likeable; the joke is not on him |
| Calendar: "Launch window review" at 18:30, again at 18:30, again at 18:45 | Calendar: "Meeting with the senator" | Rules 1 and 4 |
| Mail from `Mission Control <desk@mission-control.example>`: "Your parking validation expires Friday." | Mail from a real airline's "rewards desk" | Rule 1 |
| Deposit row: 9,800,000,000 cents `Orbital Dividend`, then a $9.00 `Corner Sandwich Shop` | A row whose name mocks his looks or health | Rules 3 and 4 |
| Franki: "That's a big week for fuel, and one very good sandwich." | Franki: "Of course, sir, right away, sir." | Rule 2: warm, not fawning |
| Franki: "Cancelled meetings, again?" said warmly | Franki: "You forgot again, didn't you." said to shame | Rule 2: amused, never mocking |
| Turn: "I'm allergic to peanuts." (one turn, his own words) | Turn: "My cousin can't have shellfish either, and my doctor says I..." | Rule 5: one allergy, nothing about others' health |

## Before you finish

Run `node .kiro/skills/persona-author/scripts/check.mjs`. It must print PASS: no denied word, and the folder's tests green. Then read the persona once for rules 2 to 4, which no script can judge. A reviewer reads for the same four: kind, the joke is the size of ordinary things, clean, true to the product.

Words that are also plain English (apple, target, shell, delta and the like) are not on the list. Their brand sense is still denied: choose another word.
