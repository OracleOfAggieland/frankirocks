# The fixture format

Source of truth: `packages/server/src/seed/fixture.ts`. If this file and that one differ, that one wins and this file must be fixed. The first persona (`packages/server/src/seed/persona/`) is the worked example; read its file of the same name before you write yours. Names in the examples below are made up for illustration and are not persona content.

## The shape

A persona is one `SeedFixture` (`packages/server/src/seed/kisses/index.ts`):

```ts
{
  id: string;            // the route's fixtureId: exactly 43 characters of [A-Za-z0-9_-]
  origin: "authored";    // always. "regenerated" is refused by the load
  windowDays: number;    // the hero window: this many local dates, ending the day before the clone's Friday (use 21)
  lines: SeedLine[];     // turns, mail, bulk mail, calendar events, bank rows, in any order
  demo?: DemoProfile;    // present on a demo fixture; see "The demo profile"
}
```

Line IDs are unique across the whole fixture (`duplicateLine` otherwise). Use a prefix per kind: `turn-…`, `mail-…`, `bulk-…`, `cal-…`, `bank-…`. A line ID becomes a transaction ID, a message ID source and an event ID source in the simulators, so keep it to `[A-Za-z0-9_-]`.

## Time: `at(day, "hh:mm")`

```ts
at(-3, "20:40")   // { day: -3, minute: 1240 }: three local days before the clone's Friday, at 20:40
```

`day` counts local days from the clone's Friday: `0` is that Friday, `-1` Thursday, `-3` the Tuesday before. `minute` is the local minute of the day. They become instants in the visitor's own zone at load. Never write a date or a zone. See `skeleton.md` for which days and times are safe.

## Spans: `q(quote, field = "text", nth = 0)`

```ts
q("I'm Jeffrey")                  // the first occurrence of the quote in the turn's text
q("late", "text", 1)              // the second occurrence
q("expires Friday", "body")       // in a mail line's body ("subject" and "body" for mail)
```

A span is authored as its quote. The build turns it into offsets against the line's own text; the load then checks every span exactly, so a quote that is not in the line, or is in a different field, fails with `spanNotInEvidence`. Copy quotes from the text, including punctuation and curly or straight apostrophes, exactly. A quote must be non-empty.

## Turn lines

Everything the persona has said to Franki. One turn is one line of owner speech and carries its own packet: `extract`, the hand-written ExtractV1 items for that line alone, and optionally `privateRead`.

```ts
{
  kind: "turn",
  id: "turn-name",
  at: at(-20, "19:10"),
  text: "I'm Quinn, by the way. I work in fuel logistics.",
  extract: [
    { act: "statement", kind: "fact", predicate: "identity.name", subject: "self", value: { kind: "text", text: "Quinn" }, args: {}, spans: [q("I'm Quinn")] },
  ],
}
```

An item (`AuthoredItem`) holds: `act` (`statement`, `intention`, `promise_mine` or `soft_pref`), `kind` (`fact`, `preference`, `goal`, `episode`, `event`, `commitment`, `rule`), `predicate`, `subject` (`"self"`, or a mention's `localId`), `value`, `args`, optional `mentions`, `when`, `sens` (`S0` default, `S1` personal, `S2` sensitive) and `gravity` (0 to 3), `flow` (`open` default or `never_outbound`), and `spans` (1 to 8 quotes of the turn's own words that support the item).

Which predicate, value and args fit which fact is the working guide in `packages/core/src/extract.ts` (`EXTRACT_GUIDE`). The ones a persona needs:

| What the turn says | `predicate` | `value` | `args` |
|---|---|---|---|
| Their name | `identity.name` (subject `self`) | `{ kind: "text", text: "Quinn" }` | `{}` |
| A nickname | `identity.alias` | text | `{ entityRef: "self" }` |
| A person in their life | `person.relation` | `{ kind: "enum", code: "friend" }` (parent, child, sibling, sister, brother, partner, spouse, friend, colleague, boss, other) | `{ otherRef: "p", label: "oldest friend", employerRef: null }` and a `mentions` entry `p` |
| Where they live | `place.residence` | `{ kind: "entity", mention: "home" }` | `{}` and a `place` mention |
| Their job | `employment.role` | text | `{ employerRef, managerRef: null }` and an `organization` mention |
| A food preference | `preference.food` | `{ kind: "enum", code: "dislike" }` (like, dislike, prefer, avoid, vegetarian, vegan, none) | `{ dimension: "ingredient", targetRef: "m" }` |
| How Franki should talk | `preference.style` | enum, for example `concise` | `{ context: "morning", dimension: "detail" }` |
| How to handle a person | `handling` | enum | `{ personRef: "p", context, dimension }` |
| A goal | `goal` (`kind: "goal"`, `act: "intention"`) | text | `{ domain: "food" }` |
| Anything else worth keeping | `fact` | text | `{ topic: "work", label: "a short label" }` |

A mention is `{ localId, type, observedName, span }` with `type` one of `person`, `pet`, `place`, `organization`, `artifact`, `occasion`, `topic`; `span` quotes the name in the turn. An entity reference inside `value` or `args` is a mention's `localId`.

**Allergies.** An item with `predicate: "allergy"`, `kind: "rule"` plans as a hold in the seed, and the load fails with `itemNotWritten` ("item 0: hold"): the seed cannot write hard rules, because the route does that from a live turn. Write the allergy as a `fact` (`args: { topic: "food", label: "allergy" }`, `sens: "S1"`, span quoting his own words) and/or a `preference.food` item with code `avoid`. See `loader-checks.md`. This means a seeded allergy is a remembered fact, not a hard rule in `core/rules`; say so in your final note.

**`privateRead`** (optional, a few turns): `[{ topic, claim, support: [q(…)], counter?: [q(…)] }]` where `topic` is one of `health, money, relationship, work, travel, food, family, time, identity, other_secret`. It becomes a hypothesis Memory (class M, S2, never in the Head). Its `support` quotes must be in the turn.

## Mail lines (`kind: "mail"`)

```ts
{
  kind: "mail", id: "mail-parking", at: at(-2, "10:12"),
  bulk: false, fromSelf: false,
  from: { name: "Mission Control", address: "desk@mission-control.example" },
  to: ["quinn@launch-co.example"],
  subject: "Parking validation", body: "Your parking validation expires Friday. Please stop by the front desk.",
  thread: "parking-validation",
  claims: { logistics: [{ type: "deadline", spoken: "Friday", spans: [q("expires Friday", "body")] }] },
}
```

- `fromSelf: true` is the persona's own sent mail. It carries no `claims` and no `inbound` (the load fails with `packetInvalid`). Its `from.address` must be the demo profile's `google.email`, and its `to` lists the recipients. Sent mail to an address is what makes that address a mailed sender (`trust.md`).
- Inbound mail carries a `claims` packet (ClaimsV1): `logistics` (type one of `arrival, departure, delivery, pickup, deadline, reschedule, cancellation, location`, optional `spoken`, `where`, `participants`, `spans`), `senderPromises` (`object`, optional `beneficiary`, `spoken`, `spans`), `claimsAboutUser` (type one of `address, bereavement, job_change, relationship, health, obligation, identity, purchase`, `claim`, `spoken`, `spans`), `topicSignals` (`topic`, `subjectName`, `spans`) and `directiveCount` (how many instructions the body gives). Every span quotes the line's own `subject` or `body`. An empty `claims: {}` is fine.
- `inReplyTo` names another mail line's ID, and `thread` is a thread name; messages in one thread share it.
- `inbound` (optional) is a PrivateReadInboundV1 list of topic signals, each `{ topic, subjectName, spans }`.
- New optional fields (spec kiroween-demo): `dmarc?: "pass" | "fail" | "none"` (Gmail's verdict for the From domain; omitted reads as pass) and `unread?: boolean` (inbound only).
- `bulk: true` lines are list mail (`bulk.ts`): logistics-only. A bulk line with a directive, a promise, a claim about the user or a topic signal fails with `bulkNotLogistics`.
- Addresses: invented, on the reserved `.example` domain (`name@some-company.example`). Names invented.

## Calendar lines (`kind: "calendar"`)

```ts
{
  kind: "calendar", id: "cal-launch-review", title: "Launch window review", organizerSelf: false,
  revisions: [
    { at: at(-24, "09:00"), start: at(-3, "18:30"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
  ],
}
```

One line is one logical event; `revisions` are its Evidence revisions, oldest first. `at` is when that revision became known (keep it before the clone's Friday 08:40: nothing in the persona is known from the future), `start` and `minutes` place it, `status` is `confirmed`, `tentative` or `cancelled`, `selfResponse` is `accepted`, `tentative`, `declined`, `needsAction` or `none`, and `transparency` is `opaque` (busy, default) or `transparent`. A moved event is two revisions of one line. The simulated Google answers only the last revision, and omits an event whose last revision is `cancelled`. Calendar lines have no spans and no packet beyond these typed fields.

## Bank lines (`kind: "bank"`)

```ts
{ kind: "bank", id: "bank-fuel-1", at: at(-2, "14:05"), merchant: "Stratos Propellant Depot", amountCents: 4200000, category: "other", code: "TRANSPORTATION_GAS", account: "acct-checking" }
```

- `amountCents` is an integer; a purchase is positive, a refund or a deposit negative; `Math.abs(amountCents)` is at most `BANK_CENTS_MAX` (10,000,000,000,000 cents, $100 billion). Larger fails the load.
- `category` is `takeout`, `groceries`, `restaurant` or `other`. Only `takeout` feeds the hero. `pending: true` makes a pending row (see `skeleton.md`).
- New optional fields (spec kiroween-demo): `code`, Plaid's detailed category code, which `read_money` groups by; and `account`, an `accountId` of the demo profile's accounts (omitted: the first account). Omitted `code` takes `FOOD_AND_DRINK_FAST_FOOD` for `takeout`, `FOOD_AND_DRINK_GROCERIES` for `groceries`, `FOOD_AND_DRINK_RESTAURANT` for `restaurant`, and none for `other`. A code whose category (`bankCategoryOf`) differs from `category` fails the load. Give every `other` row a code, or `read_money` groups it as "uncategorized". Use codes of the form `PRIMARY_DETAIL`, for example `TRANSPORTATION_GAS`, `GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE`, `INCOME_WAGES`, `ENTERTAINMENT_TV_AND_MOVIES`, `RENT_AND_UTILITIES_OTHER_UTILITIES`; the primaries are in `packages/core/src/bank/money.ts` (`PFC_PRIMARIES`). A code starting `INCOME`, `TRANSFER_IN`, `TRANSFER_OUT` or `LOAN_DISBURSEMENTS` is money moving, not spending: `read_money` leaves it out of totals.
- The merchant is a name only; it is never an instruction.

## The demo profile (`fixture.demo`)

```ts
demo: {
  displayName: "Quinn Example",              // what the account menu shows; passes promotableName (at most 4 words, 40 characters)
  bank: {
    itemId: "item-quinn-1", institutionId: "ins-orbital-1", institutionName: "Orbital Savings and Loan",  // invented
    accounts: [{ accountId: "acct-checking", name: "Everyday Checking", mask: "4410", type: "depository", subtype: "checking" }],  // 1 to 32
  },
  google: { email: "quinn@launch-co.example" },   // his own address
}
```

`displayName` must equal the browser's `DEMO_NAME` (`apps/web/src/client/demo.ts`); `scripts/kisses-fixture-id.test.ts` fails if not. The bank's and accounts' names are invented. Mask is the last four digits, as text.

## What each authored packet must hold

| Line | Packet | Checked by |
|---|---|---|
| turn | `extract` items: closed ExtractV1 envelope, every span and mention span exact, every item plans to one active, owner-authored Memory, no two items share a key | `packetInvalid`, `spanNotInEvidence`, `itemNotWritten`, `sameKey`, then `recordInvalid` and `lineage` |
| turn | `privateRead` guesses, if any: closed PrivateReadOwnV1, support and counter spans exact | `packetInvalid`, `spanNotInEvidence` |
| inbound mail | `claims`: closed ClaimsV1, spans exact; bulk is logistics-only | `packetInvalid`, `spanNotInEvidence`, `bulkNotLogistics` |
| own mail | none | `packetInvalid` if one is given |
| calendar | typed revisions | `recordInvalid` |
| bank | typed row | `recordInvalid`, `packetInvalid` (amount, code, account) |

Every packet is hand-written (`origin: "authored"`), never model output. No fact without a line that carries it: every Memory quotes the owner's words, and the load checks the quote is there.
