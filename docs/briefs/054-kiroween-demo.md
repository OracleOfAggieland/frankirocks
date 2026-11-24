# Brief 054: the Kiroween Demo (lane `kiroween-demo`)

**Who builds this.** Kiro writes the spec (`.kiro/specs/kiroween-demo/`), the persona-author skill, and the persona itself (every file under `packages/server/src/seed/kisses/`). Claude writes the rest of the code from the spec's tasks, plus the Kiro files Kiro can't write headless (`.kiro/agents/`, `.kiro/hooks/`, `.kiro/workflows/`). Only Kiro's commits carry the Kiro trailer.

## What it is

A button that says **Kiroween Demo**. Press it and you are in the lab as **Jeffrey Kisses**, an invented and absurdly rich man Franki already knows well. Nothing asks you to sign in, and nothing asks for an email account or a bank. Franki greets Jeffrey by name, knows his habits, can read his mail and calendar, and can answer questions about his money, all from made-up data.

Everything a visitor can do on a sample visit works here too: the call, typed turns, the visit bar, the bolts, Start over, the Lab and the jar.

## What the visitor sees

1. On the landing page and on the lab's signed-out panel, a button: **Kiroween Demo**.
2. One press opens the lab. No popup, no form. The visit is Jeffrey's.
3. The account menu says **Jeffrey Kisses** and marks the visit as a demo. It never shows "(no email)".
4. The Bank sheet shows one connected bank, named for the persona, with its accounts, and says plainly that it is simulated. The Gmail and Calendar sheet shows the same for Jeffrey's mail and calendar. Neither sheet offers Connect or Disconnect on a demo visit.
5. Franki does not ask "What should I call you?" on this visit. He already knows.

## Things to try, which must work

- "How much did I spend on rocket fuel this month?" answers from the simulated bank through `read_money`.
- "Check my mail for anything from mission control." and "What's on my calendar today?" answer through the mail and calendar errands.
- The hero offer arrives the usual way: takeout on nights with late meetings, computed by `TAKEOUT_LATE_V1` from Jeffrey's own rows. The joke is the contrast: a small takeout habit beside very large everything else.
- "What do you know about me?" recalls what Jeffrey has told Franki.
- A stranger's mail that tells Franki to do something is treated as mail, never as an order.

## Product rules that bind every part

These hold on a demo visit exactly as they do anywhere else.

- Allergies are hard rules in every food path, failing closed.
- No tool can move money. No investment, tax or legal advice. Every number traces to a source row.
- Patterns are never called causes.
- Crisis: care plus 988.
- Forget means gone from the next thought.
- Mail can inform but can't give orders, change a belief, or grant a permission.
- The clock port, a source on every field, lineage, closed schemas and the admission seam are untouched.

## The persona: taste rules

Jeffrey Kisses is funny because of scale and contrast. He is never the butt of a mean joke.

- **Invented only.** No real person, company, product, place of business or trademark, anywhere: merchants, senders, events, and Jeffrey himself. Nothing describes a real person's life, family, looks, health or politics.
- **Kind.** Franki treats Jeffrey like anyone else: warm, a little amused, never fawning and never mocking. Jeffrey is likeable: he calls his mother, tips well, forgets to cancel subscriptions.
- **The joke is the size of ordinary things.** Rocket fuel next to a late library fee. A very large deposit next to a $9 sandwich. A launch window that keeps landing on dinner.
- **Clean.** Nothing crude, nothing about bodies, nothing political.
- **True to the product.** One real allergy, stated in Jeffrey's own words. No fact without a line that carries it.
- **Amounts** stay under `BANK_CENTS_MAX` ($100 billion a row).

## Rulings for this brief

1. **No sign-in means Firebase anonymous sign-in.** Each visitor gets their own tenant, so one visitor's forget or Start over never touches another's. No shared account.
2. **A demo tenant is an anonymous one.** The token verifier reports whether the token's sign-in provider is `anonymous`, and the route context carries that. It is read from the verified token on every request, never from the body and never from a stored flag.
3. **Anonymous and Jeffrey go together.** The reset route gives an anonymous tenant the Kisses fixture and nothing else, and refuses the Kisses fixture to any other tenant. A signed-in sample visit is unchanged.
4. **The persona is a second `SeedFixture`** in `packages/server/src/seed/kisses/`, registered in `FIXTURES` beside the first. Same line types, same loader, same checks.
5. **The visitor plays Jeffrey.** On this visit the persona's own name may reach the Head's name line, and the first-meeting line is never offered. The existing rule (a name resting only on fixture Evidence is not the visitor's) stays for every other visit. The design says how a visit is known to be this kind without trusting the browser.
6. **The bank and Google are simulated at the port.** A `BankPort` and a `GooglePort` built from the fixture's own bank, mail and calendar lines stand in for Plaid and Google. Everything above the port is the real product: the pull, the import, `read_money`, the Gate, the errand runner, the planner, the reader, the trust rule.
7. **Routing is by token, not by user.** The seed installs the connectors as connected, each with a sealed simulator token. A routing port sends a call to the simulator when the unsealed token is a simulator token, and to the live provider otherwise. A simulator token carries what the simulator needs (which fixture, the visit's world start, the zone). A real token can never be taken for one, and the reverse.
8. **One authored list, two readers.** The fixture's bank lines are seeded as fixture Evidence (the hero reads those) and served by the simulated bank (`read_money` reads the imported rows). They must agree to the cent. The same goes for mail and calendar.
9. **Mail trust comes from the fixture.** A mail line can say whether its sender passes DMARC. A sender counts as mailed only if Jeffrey's own sent mail to that address is in the fixture. The persona has at least one mailed sender and at least one stranger.
10. **Demo visitors can't reach outside.** No phone call can be placed (not offered, and refused on the server). Plaid Link and Google sign-in can't be started. Web search stays available.
11. **A switch.** One environment value turns the demo off: the button is hidden and anonymous tokens are refused.
12. **Leaving cleans up.** Sign out on a demo visit removes the tenant and the anonymous user, as Delete my data does.
13. **No new record kinds** unless the design shows it can't be done without one. A new optional field on a fixture line type is fine.

## Seams (read these before the design)

| Area | Where |
|---|---|
| Sign-in in the browser | `apps/web/src/client/auth.ts`, `components/AuthPanel.tsx`, `components/App.tsx`, `components/AccountMenu.tsx` |
| Landing calls to action | `apps/web/src/components/landing/Hero.tsx`, `TopBar.tsx` |
| Token guard | `packages/server/src/auth/guard.ts`, `auth/admin-verifier.ts`, `routes/runtime.ts` (`runRoute`) |
| Visit and reset | `apps/web/src/client/visit-model.ts`, `client/seed-guesses.ts`, `packages/server/src/seed/reset.ts`, `seed/load.ts`, `seed/live.ts` |
| Fixture format | `packages/server/src/seed/fixture.ts`, `seed/build.ts`, `seed/persona/` |
| Name and first meeting | `packages/core/src/owner-name.ts`, `packages/server/src/meet.ts`, `routes/open.ts` |
| Bank | `packages/server/src/bank/plaid.ts` (`BankPort`), `bank/routes.ts` (`bankRuntime`), `bank/pull.ts`, `bank/rows.ts`, `bank/money-read.ts`, `testing/fake-bank.ts` |
| Google and errands | `packages/server/src/google/port.ts` (`GooglePort`), `google/routes.ts` (`googleRuntime`), `google/read.ts`, `google/mail.ts`, `errands/google-agents.ts`, `errands/run-endpoint.ts`, `testing/fake-google.ts` |
| Tool offering | `packages/core/src/voice/machine.ts` (`callTools`), `packages/core/src/specialists.ts`, `packages/server/src/errands/agent.ts`, `phone/outbound.ts` |
| Account delete | `packages/server/src/account/delete.ts` |

## Correctness properties the design should carry

Write these as fast-check properties, red first where that is possible.

- **Agreement.** For any period, group and merchant, `read_money`'s total over the simulated bank equals the sum of the fixture's bank lines that match.
- **No crossing.** For any sequence of calls, a simulator token never reaches a live provider, and a non-simulator token never reaches a simulator.
- **Pairing.** For any reset request, an anonymous tenant ends with the Kisses fixture or a refusal, and a non-anonymous tenant never ends with it.
- **No way out.** For any tool call on a demo visit, no phone dial is placed and no live Plaid or Google call is made.
- **Trust.** For any fixture mail line, the spoken-or-card decision equals what the trust rule gives for that line's sender.
- **Taste.** No line of the persona holds a word from the denied list (real names and brands).

## Parts

| Part | What | Who |
|---|---|---|
| A | Spec: requirements, design with the properties above, tasks | Kiro |
| B | The persona-author skill and the taste steering file | Kiro |
| C | Server: anonymous flag, pairing, plays-owner, simulators, routing ports, connectors at seed, the guards, the switch | Claude |
| D | Web: the button, anonymous sign-in, the visit's fixture, the account menu, the two sheets | Claude |
| E | The persona: turns, mail, bulk mail, calendar, bank | Kiro, through the `stitch-persona` workflow |
| F | Review, the whole suite, a look in the browser | Claude |

Part C lands the fixture type changes first, so part E has types to write against.

## Tests

- The persona loads through the real loader with no `SeedLoadError`, and `TAKEOUT_LATE_V1` yields an offer on the clone's Friday.
- Every property above.
- The signed-in sample visit's existing tests pass unchanged.
- A demo visit walked on the specimens page or in the lab, in the browser.

## What it doesn't do

- No account balance read. Large deposits are rows; a balance is not.
- No upgrade from a demo visit to a real account.
- No cleanup job for demo tenants a visitor walks away from.
- No per-visitor spending cap beyond what every account has.
- The Kisses persona is not offered to signed-in accounts.

## Report

When the lane is done, write `docs/briefs/054-report.md`: what was built, by whom, what was checked and how, contract questions, and what was not tried.
