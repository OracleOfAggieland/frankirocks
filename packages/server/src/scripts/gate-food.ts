/**
 * Forty food moments (brief 034 part 1; spec §13 gate "Hard-rule miss: 0 of 40 scripted food moments"; spec §10;
 * the owner's rule: allergies are hard rules, in every food path, for every attendee, failing closed).
 *
 * Each moment states rules in some way, then walks a food path, then asserts that every stated allergen is filtered
 * for every attendee: in core/rules (an active rule, a pending rule or the unresolved filter), in the Head at the
 * food moment, and in what the food path offers (every recipe on the card, read back to its closed manifest, holds
 * none of the forbidden ingredients, which are written out by hand in gate-kit.ts). Where the right answer is
 * "Franki asks" or "nothing is offered", that is asserted instead.
 *
 * Every model answer is declared beside its step: the typed reply, the slow parse, FastSlots and the extraction.
 * The extraction answers as a careful extractor would (the allergy as a hard_rule item), so the backstop is tested
 * too. No script calls a model.
 */
import type { Evidence } from "@franki/core";
import { type HeroOffer, heroOffer } from "../routes/tool-food";
import { type SlotsAnswer, type Step, type World, extract, item, parse, reply, rewriteEvidence, spanOf } from "../testing/script-runner";
import {
  type AllergySlot,
  CODES,
  type GateScript,
  NO,
  NO_LABELS,
  type RuleWho,
  W,
  attendeesFor,
  failNextRulesRead,
  foodSafe,
  franksAsks,
  fs,
  fsEmpty,
  fsInvalid,
  fsLate,
  fsTimeout,
  headFilters,
  headOneSubjectPerLine,
  listSafe,
  rulesHold,
  rx4,
  subjectOf,
  suggestCall,
} from "./gate-kit";

// ---------------------------------------------------------------------------------------------
// How a rule is told.

interface Extracted {
  quote: string;
  code: string;
  /** For someone else: the words that name them. */
  mention?: string;
}

/** The careful extractor's items for the turn just posted: one hard_rule item per stated allergen. */
const extracted = (xs: readonly Extracted[]) => (w: World) =>
  xs.map((x) =>
    item({
      act: "hard_rule",
      kind: "rule",
      predicate: "allergy",
      value: { kind: "boolean", bool: true },
      args: { allergenCode: x.code },
      spans: [spanOf(w, x.quote)],
      sens: "S1",
      ...(x.mention === undefined
        ? {}
        : { subject: "m1", mentions: [{ localId: "m1", type: "person", observedName: x.mention, span: spanOf(w, x.mention), existingId: null }] }),
    }),
  );

const workAfter = (label: string, xs: readonly Extracted[]): Step => ({
  label: `extraction of "${label}"`,
  do: "work",
  answers: [extract(xs.length === 0 ? "nothing to file" : `files ${xs.map((x) => x.code).join(", ")} as hard_rule items`, extracted(xs))],
});

/**
 * A typed line through /api/turn: the reply, the slow parse (a hardRule candidate) and FastSlots, then extraction.
 * When RX4 misses and only the parse opens the route, the route writes its own reply after the ordinary one: two
 * Responses calls (the runner checks the count; which reply is shown is the route's business).
 */
function typed(text: string, slots: SlotsAnswer | null, xs: readonly Extracted[], p: Parameters<typeof parse>[0] = { hardRule: 0.9 }): Step[] {
  const replies = slots !== null && !rx4(text) ? [reply("Okay."), reply("Okay, noted.")] : [reply("Okay.")];
  return [
    { label: `type: ${text}`, do: "type", text, answers: [...replies, parse(p, `parse: ${JSON.stringify(p)}`), ...(slots === null ? [] : [slots])] },
    workAfter(text, xs),
  ];
}

/** A spoken line (a final ASR transcript): the slow parse and FastSlots, then extraction. */
function spoken(text: string, slots: SlotsAnswer | null, xs: readonly Extracted[], p: Parameters<typeof parse>[0] = { hardRule: 0.9 }): Step[] {
  return [{ label: `say: ${text}`, do: "say", text, answers: [parse(p, `parse: ${JSON.stringify(p)}`), ...(slots === null ? [] : [slots])] }, workAfter(text, xs)];
}

const self = (quote: string, item: string, more: Partial<AllergySlot> = {}): AllergySlot => ({ quote, item, ...more });

// ---------------------------------------------------------------------------------------------
// A moment.

type FoodExpect = "offered" | "nothing" | "either";

interface Moment {
  id: string;
  stated: string;
  path: "suggest" | "recipe pick" | "dinner with attendees" | "hero dinners" | "list write" | "asked recall";
  state: string;
  tell: Step[];
  /** Steps between the rules and the food question (company in the room, a failing read). */
  before?: Step[];
  rules: { codes: readonly string[]; who: RuleWho }[];
  head: { subjects: string[]; allergen: string }[];
  forbid: readonly string[];
  expect?: FoodExpect;
  /** The attendee IDs the model passes. */
  attendees?: (w: World) => Promise<string[]>;
  asks?: boolean;
  /** The Head must give each subject its own line, at least this many. */
  linesAtLeast?: number;
  waits?: { rules?: string; head?: string; food?: string; asks?: string };
  note?: string;
  /** The rule and the food question are one spoken line: suggest runs on that turn, before any extraction. */
  sameTurn?: boolean;
}

const FOOD_Q = "What should I make for dinner tonight?";

function momentScript(m: Moment): GateScript {
  const toolLabel = "suggest(food)";
  const waits = m.waits ?? {};
  const w = (k: keyof NonNullable<Moment["waits"]>) => (waits[k] === undefined ? {} : { waits: waits[k] });
  const dinnerLabel = m.sameTurn === true ? m.tell[m.tell.length - 1]!.label : "the owner asks about dinner";
  const steps: Step[] = [
    { label: "open a session", do: "open" },
    ...m.tell,
    { label: "the stated allergens are filtered in core/rules", do: "check", of: "open a session", ...w("rules"), expect: [{ ...rulesHoldOf(m) }] },
    ...(m.asks === true ? [{ label: "Franki asks", do: "check" as const, of: "open a session", ...w("asks"), expect: [franksAsks] }] : []),
    ...(m.before ?? []),
    ...(m.sameTurn === true ? [] : [{ label: dinnerLabel, do: "say" as const, text: m.path === "recipe pick" ? "Pick me a recipe for tonight." : FOOD_Q, answers: [parse()] }]),
    { label: "the Head at the food moment lists every rule", do: "check", of: dinnerLabel, ...w("head"), expect: [headFilters(dinnerLabel, m.head), ...(m.linesAtLeast === undefined ? [] : [headOneSubjectPerLine(dinnerLabel, m.linesAtLeast)])] },
    ...(m.attendees === undefined ? [] : [attendeesFor(toolLabel, m.attendees)]),
    { ...suggestCall(toolLabel, [foodSafe(toolLabel, m.forbid, m.expect ?? "offered")], m.path === "recipe pick" ? "a recipe for tonight" : "quick dinner tonight"), ...w("food") },
  ];
  return {
    gate: "food",
    id: m.id,
    name: `food ${m.id}: ${m.stated}; ${m.path}; ${m.state}`,
    scores: "spec §13 gate 'Hard-rule miss: 0 of 40'",
    meta: { stated: m.stated, path: m.path, state: m.state, ...(m.note === undefined ? {} : { note: m.note }) },
    steps,
  };
}

const rulesHoldOf = (m: Moment) => rulesHold(m.rules);

const YOU = ["You"];
const forbidOf = (...keys: (keyof typeof NO)[]) => keys.flatMap((k) => [...NO[k]]);

// ---------------------------------------------------------------------------------------------
// The forty.

const I_EGGS = "I'm allergic to eggs.";

const MOMENTS: Moment[] = [
  // How the rule was stated (the owner; a dinner for the owner).
  {
    id: "F01",
    stated: "plainly, typed",
    path: "suggest",
    state: "rules ready",
    tell: typed(I_EGGS, fs("an affirmed egg allergy for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F02",
    stated: "with \"can't eat\", typed",
    path: "suggest",
    state: "rules ready",
    tell: typed("I can't eat dairy, it makes me really sick.", fs("an affirmed milk allergy for the owner", "I can't eat dairy, it makes me really sick.", [self("I can't eat dairy", "dairy", { severity: "unknown" })]), [{ quote: "I can't eat dairy", code: "milk" }]),
    rules: [{ codes: CODES.milk, who: "self" }],
    head: [{ subjects: YOU, allergen: "milk" }],
    forbid: forbidOf("milk"),
  },
  {
    id: "F03",
    stated: "a list in one sentence, typed",
    path: "suggest",
    state: "rules ready, two rules",
    tell: typed(
      "I'm allergic to dairy and peanuts.",
      fs("milk and peanut for the owner", "I'm allergic to dairy and peanuts.", [self("I'm allergic to dairy", "dairy"), self("peanuts", "peanuts")]),
      [{ quote: "allergic to dairy", code: "milk" }, { quote: "peanuts", code: "peanut" }],
    ),
    rules: [{ codes: CODES.milk, who: "self" }, { codes: CODES.peanut, who: "self" }],
    head: [{ subjects: YOU, allergen: "milk" }, { subjects: YOU, allergen: "peanuts" }],
    forbid: forbidOf("milk", "peanut"),
    note: "with milk out, the quickest picks include peanut noodles, so the peanut rule is exercised on the card",
  },
  {
    id: "F04",
    stated: "a list over two sentences, typed; the model returns both",
    path: "suggest",
    state: "rules ready, two rules",
    tell: typed(
      "I'm allergic to dairy. Peanuts too.",
      fs("milk and peanut for the owner", "I'm allergic to dairy. Peanuts too.", [self("I'm allergic to dairy", "dairy"), self("Peanuts too", "Peanuts")]),
      [{ quote: "I'm allergic to dairy", code: "milk" }, { quote: "Peanuts too", code: "peanut" }],
    ),
    rules: [{ codes: CODES.milk, who: "self" }, { codes: CODES.peanut, who: "self" }],
    head: [{ subjects: YOU, allergen: "milk" }, { subjects: YOU, allergen: "peanuts" }],
    forbid: forbidOf("milk", "peanut"),
  },
  {
    id: "F05",
    note: "after the turn nothing filters shellfish; the extraction backstop proposes it, and the next turn applies it, so the Head and the card at the dinner question are right (F06 asks on the same turn)",
    stated: "a list over two sentences, typed; the model returns only the first (brief 032 H2, the reviewer's input)",
    path: "suggest",
    state: "rules ready",
    tell: typed("I'm allergic to peanuts. Shellfish too.", fs("peanut only: the second sentence is missed", "I'm allergic to peanuts. Shellfish too.", [self("I'm allergic to peanuts", "peanuts")]), [{ quote: "I'm allergic to peanuts", code: "peanut" }, { quote: "Shellfish too", code: "shellfish" }]),
    rules: [{ codes: CODES.peanut, who: "self" }, { codes: CODES.shellfish, who: "self" }],
    head: [{ subjects: YOU, allergen: "peanuts" }, { subjects: YOU, allergen: "shellfish" }],
    forbid: forbidOf("peanut", "shellfish"),
  },
  {
    id: "F06",
    stated: "a list over two sentences, spoken with the food question in one breath; the model returns only the first (H2, an allergen on the default card)",
    path: "suggest",
    state: "rules ready; suggest runs on the same turn, before extraction",
    sameTurn: true,
    tell: [
      {
        label: "say: I'm allergic to shellfish. Dairy too. What should I make tonight?",
        do: "say",
        text: "I'm allergic to shellfish. Dairy too. What should I make tonight?",
        answers: [
          parse({ hardRule: 0.9 }, "parse: a hardRule candidate"),
          fs("shellfish only: the second sentence is missed", "I'm allergic to shellfish. Dairy too. What should I make tonight?", [self("I'm allergic to shellfish", "shellfish")]),
        ],
      },
    ],
    rules: [{ codes: CODES.shellfish, who: "self" }, { codes: CODES.milk, who: "self" }],
    head: [{ subjects: YOU, allergen: "shellfish" }, { subjects: YOU, allergen: "milk" }],
    forbid: forbidOf("shellfish", "milk"),
    note: "in a voice turn the tool call comes on the same turn, before the extraction backstop can propose the missed rule",
  },
  {
    id: "F07",
    stated: "\"can't eat\", typed; the model marks it denied (brief 032 H1, the reviewer's input)",
    path: "suggest",
    state: "rules ready",
    tell: typed("I can't eat peanuts, I'm allergic.", fs("peanut for the owner, polarity denied (wrong)", "I can't eat peanuts, I'm allergic.", [self("I can't eat peanuts", "peanuts", { polarity: "denied" })]), [{ quote: "I can't eat peanuts", code: "peanut" }]),
    rules: [{ codes: CODES.peanut, who: "self" }],
    head: [{ subjects: YOU, allergen: "peanuts" }],
    forbid: forbidOf("peanut"),
  },
  {
    id: "F08",
    stated: "\"can't eat\", typed; the model marks it denied (H1, an allergen on the default card)",
    path: "suggest",
    state: "rules ready",
    tell: typed("I can't eat eggs, I'm allergic.", fs("egg for the owner, polarity denied (wrong)", "I can't eat eggs, I'm allergic.", [self("I can't eat eggs", "eggs", { polarity: "denied" })]), [{ quote: "I can't eat eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F09",
    stated: "one allergen affirmed, one denied, typed; the model marks both denied (H1's second input)",
    path: "suggest",
    state: "rules ready",
    tell: typed(
      "I'm allergic to peanuts, not shellfish.",
      fs("peanut and shellfish for the owner, peanut denied over the whole sentence (wrong)", "I'm allergic to peanuts, not shellfish.", [self("I'm allergic to peanuts, not shellfish", "peanuts", { polarity: "denied" })]),
      [{ quote: "I'm allergic to peanuts", code: "peanut" }],
    ),
    rules: [{ codes: CODES.peanut, who: "self" }],
    head: [{ subjects: YOU, allergen: "peanuts" }],
    forbid: forbidOf("peanut"),
  },
  {
    id: "F10",
    stated: "plainly, spoken (a final transcript)",
    path: "suggest",
    state: "rules ready",
    tell: spoken("I'm allergic to eggs", fs("an affirmed egg allergy for the owner", "I'm allergic to eggs", [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F11",
    stated: "plainly, pasted into the typed box",
    path: "suggest",
    state: "rules ready",
    tell: [{ label: "paste: I'm allergic to eggs.", do: "paste", text: I_EGGS, answers: [reply("Could you say that yourself, so I can save it?")] }],
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    note: "pasted text is T and writes no rule (brief 018 B10, G34). Brief 041 part 1: the paste writes an anonymous pending filter for eggs and one question, so eggs stay off the card until the owner answers",
  },
  {
    id: "F12",
    stated: "an allergen outside the gazetteer (spinach), typed; the model finds no items",
    path: "suggest",
    state: "unresolved",
    tell: typed("I'm allergic to spinach.", fsEmpty("no items, need none (spinach is no gazetteer entry)"), []),
    rules: [{ codes: CODES.spinach, who: "self" }],
    head: [{ subjects: YOU, allergen: "any food" }],
    forbid: forbidOf("spinach"),
    expect: "nothing",
    asks: true,
  },
  {
    id: "F13",
    stated: "cilantro, typed; the model finds no items (brief 032 M1, the reviewer's input)",
    path: "suggest",
    state: "rules ready or unresolved",
    tell: typed("I'm allergic to cilantro.", fsEmpty("no items, need none"), [{ quote: "I'm allergic to cilantro", code: "coriander" }]),
    rules: [{ codes: CODES.coriander, who: "self" }],
    head: [{ subjects: YOU, allergen: "coriander" }],
    forbid: forbidOf("coriander"),
    expect: "either",
  },
  {
    id: "F14",
    stated: "plainly, typed; the model's item is wrong (milk for eggs)",
    path: "suggest",
    state: "rules ready",
    tell: typed(I_EGGS, fs("milk for the owner, quoting the egg words (wrong item)", I_EGGS, [self("I'm allergic to eggs", "milk")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F15",
    stated: "plainly, typed; the model's answer is empty",
    path: "suggest",
    state: "rules ready or pending",
    tell: typed(I_EGGS, fsEmpty("no items, need none"), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F16",
    stated: "plainly, typed; the model's answer is invalid",
    path: "suggest",
    state: "pending",
    tell: typed(I_EGGS, fsInvalid("a shape error"), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F17",
    stated: "plainly, typed; the model's answer is late (past the deadline)",
    path: "suggest",
    state: "pending",
    tell: typed(I_EGGS, fsLate("no answer before the deadline"), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F18",
    stated: "spoken; the model call times out",
    path: "suggest",
    state: "pending",
    tell: spoken("I'm allergic to eggs", fsTimeout("a timeout"), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F19",
    stated: "corrected (\"not peanuts, tree nuts\"), typed",
    path: "suggest",
    state: "rules ready",
    tell: [
      ...typed("I'm allergic to peanuts.", fs("peanut for the owner", "I'm allergic to peanuts.", [self("I'm allergic to peanuts", "peanuts")]), [{ quote: "I'm allergic to peanuts", code: "peanut" }]),
      ...typed("Sorry, not peanuts, tree nuts.", fs("tree nuts for the owner", "Sorry, not peanuts, tree nuts.", [self("tree nuts", "tree nuts")]), [{ quote: "tree nuts", code: "tree_nut" }]),
    ],
    rules: [{ codes: CODES.treeNut, who: "self" }],
    head: [{ subjects: YOU, allergen: "tree nuts" }],
    forbid: forbidOf("treeNut"),
  },
  {
    id: "F20",
    stated: "corrected (\"not eggs, dairy\"), typed; the corrected allergen is on the default card",
    path: "suggest",
    state: "rules ready",
    tell: [
      ...typed(I_EGGS, fs("egg for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
      ...typed("Wait, not eggs. Dairy.", fs("milk for the owner", "Wait, not eggs. Dairy.", [self("Dairy", "Dairy")]), [{ quote: "Dairy", code: "milk" }]),
    ],
    rules: [{ codes: CODES.milk, who: "self" }],
    head: [{ subjects: YOU, allergen: "milk" }],
    forbid: forbidOf("milk"),
  },
  {
    id: "F21",
    stated: "denied (\"I'm not allergic to eggs\") after the rule, typed",
    path: "suggest",
    state: "rules ready; a spoken request can't remove a rule",
    tell: [
      ...typed(I_EGGS, fs("egg for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
      ...typed("Actually I'm not allergic to eggs.", fs("egg denied for the owner", "Actually I'm not allergic to eggs.", [self("I'm not allergic to eggs", "eggs", { polarity: "denied" })]), []),
    ],
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F22",
    stated: "denied (\"I'm not allergic to shellfish\") by an uncertain speaker after the rule, spoken",
    path: "suggest",
    state: "rules ready",
    tell: [
      ...typed("I'm allergic to shellfish.", fs("shellfish for the owner", "I'm allergic to shellfish.", [self("I'm allergic to shellfish", "shellfish")]), [{ quote: "I'm allergic to shellfish", code: "shellfish" }]),
      ...spoken("I'm not allergic to shellfish", fs("shellfish denied", "I'm not allergic to shellfish", [self("I'm not allergic to shellfish", "shellfish", { polarity: "denied" })]), [], { hardRule: 0.9, uncertainSpeaker: 0.9 }),
    ],
    rules: [{ codes: CODES.shellfish, who: "self" }],
    head: [{ subjects: YOU, allergen: "shellfish" }],
    forbid: forbidOf("shellfish"),
  },

  // People.
  {
    id: "F23",
    stated: "for a named person (\"my sister\"), typed",
    path: "dinner with attendees",
    state: "rules ready; the model passes her ID",
    tell: typed("My sister is allergic to eggs.", fs("egg for the sister", "My sister is allergic to eggs.", [{ quote: "My sister is allergic to eggs", item: "eggs", who: { mention: "My sister" } }]), []),
    rules: [{ codes: CODES.egg, who: { label: "sister" } }],
    head: [{ subjects: ["Your sister", "My sister"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    attendees: async (w) => [(await subjectOf(w, "sister")) ?? "self"],
    note: "the model is assumed to pass the sister's entity ID, which no Head shows (see F24); extraction files nothing, so only the named rule can filter",
  },
  {
    id: "F24",
    stated: "for a named person (\"my sister\"), typed",
    path: "dinner with attendees",
    state: "rules ready; the model passes no ID (none is visible to it)",
    note: "extraction files nothing (an extractor that misses it), so only the named rule can filter; the model can pass no entity ID because none is shown to it",
    tell: [
      ...typed("My sister is allergic to eggs.", fs("egg for the sister", "My sister is allergic to eggs.", [{ quote: "My sister is allergic to eggs", item: "eggs", who: { mention: "My sister" } }]), []),
    ],
    before: [{ label: "the owner says the sister is coming", do: "type", text: "My sister's coming over for dinner tonight.", answers: [reply("Nice."), parse()] }],
    rules: [{ codes: CODES.egg, who: { label: "sister" } }],
    head: [{ subjects: ["Your sister", "My sister"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    attendees: async () => [],
  },
  {
    id: "F25",
    stated: "for an unnamed guest, typed",
    path: "suggest",
    state: "pending (anonymous)",
    tell: typed("One of the guests is allergic to eggs.", fs("egg for an unnamed guest", "One of the guests is allergic to eggs.", [{ quote: "One of the guests is allergic to eggs", item: "eggs", who: "anon" }]), []),
    rules: [{ codes: CODES.egg, who: "anon" }],
    head: [{ subjects: ["Someone", "Someone else", "One of the guests"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F26",
    stated: "an unnamed guest, then a named brother, same allergen (brief 032 H3, the reviewer's input)",
    path: "suggest",
    state: "a rule for someone who is not at this dinner (the brother)",
    tell: [
      ...typed("One of the guests is allergic to peanuts.", fs("peanut for an unnamed guest", "One of the guests is allergic to peanuts.", [{ quote: "One of the guests is allergic to peanuts", item: "peanuts", who: "anon" }]), []),
      ...typed("My brother's allergic to peanuts.", fs("peanut for the brother", "My brother's allergic to peanuts.", [{ quote: "My brother's allergic to peanuts", item: "peanuts", who: { mention: "My brother" } }]), [{ quote: "My brother's allergic to peanuts", code: "peanut", mention: "brother" }]),
    ],
    rules: [{ codes: CODES.peanut, who: "anon" }, { codes: CODES.peanut, who: { label: "brother" } }],
    head: [{ subjects: ["Someone"], allergen: "peanuts" }],
    forbid: forbidOf("peanut"),
    expect: "either",
  },
  {
    id: "F27",
    stated: "an unnamed guest, then a named brother, same allergen (H3, an allergen on the default card)",
    path: "suggest",
    state: "a rule for someone who is not at this dinner (the brother)",
    tell: [
      ...typed("One of the guests is allergic to eggs.", fs("egg for an unnamed guest", "One of the guests is allergic to eggs.", [{ quote: "One of the guests is allergic to eggs", item: "eggs", who: "anon" }]), []),
      ...typed("My brother's allergic to eggs.", fs("egg for the brother", "My brother's allergic to eggs.", [{ quote: "My brother's allergic to eggs", item: "eggs", who: { mention: "My brother" } }]), [{ quote: "My brother's allergic to eggs", code: "egg", mention: "brother" }]),
    ],
    rules: [{ codes: CODES.egg, who: "anon" }],
    head: [{ subjects: ["Someone"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F28",
    stated: "the owner's rule and the brother's, typed in one line",
    path: "suggest",
    state: "a rule for someone who is not at this dinner",
    tell: typed(
      "I'm allergic to eggs and my brother can't have shellfish.",
      fs("egg for the owner, shellfish for the brother", "I'm allergic to eggs and my brother can't have shellfish.", [self("I'm allergic to eggs", "eggs"), { quote: "my brother can't have shellfish", item: "shellfish", who: { mention: "my brother" } }]),
      [{ quote: "I'm allergic to eggs", code: "egg" }, { quote: "my brother can't have shellfish", code: "shellfish", mention: "brother" }],
    ),
    rules: [{ codes: CODES.egg, who: "self" }, { codes: CODES.shellfish, who: { label: "brother" } }],
    head: [{ subjects: YOU, allergen: "eggs" }, { subjects: ["Your brother", "My brother"], allergen: "shellfish" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F29",
    stated: "two people with different rules, typed over two lines",
    path: "dinner with attendees",
    state: "two people with different rules, both at dinner",
    tell: [
      ...typed("I can't have dairy.", fs("milk for the owner", "I can't have dairy.", [self("I can't have dairy", "dairy")]), [{ quote: "I can't have dairy", code: "milk" }]),
      ...typed("My sister is allergic to eggs.", fs("egg for the sister", "My sister is allergic to eggs.", [{ quote: "My sister is allergic to eggs", item: "eggs", who: { mention: "My sister" } }]), [{ quote: "My sister is allergic to eggs", code: "egg", mention: "sister" }]),
    ],
    rules: [{ codes: CODES.milk, who: "self" }, { codes: CODES.egg, who: { label: "sister" } }],
    head: [{ subjects: YOU, allergen: "milk" }, { subjects: ["Your sister", "My sister"], allergen: "eggs" }],
    forbid: forbidOf("milk", "egg"),
    attendees: async (w) => [(await subjectOf(w, "sister")) ?? "self"],
    linesAtLeast: 2,
  },
  {
    id: "F30",
    stated: "two named people by first name (Sam, Priya), typed (brief 032 M2's shape)",
    path: "dinner with attendees",
    state: "two people with different rules, both at dinner",
    tell: typed(
      "Sam is allergic to eggs and Priya is allergic to dairy.",
      fs("egg for Sam, milk for Priya", "Sam is allergic to eggs and Priya is allergic to dairy.", [
        { quote: "Sam is allergic to eggs", item: "eggs", who: { mention: "Sam" } },
        { quote: "Priya is allergic to dairy", item: "dairy", who: { mention: "Priya" } },
      ]),
      [],
    ),
    rules: [{ codes: CODES.egg, who: { label: "Sam" } }, { codes: CODES.milk, who: { label: "Priya" } }],
    head: [{ subjects: ["Sam", "Someone else"], allergen: "eggs" }, { subjects: ["Priya", "Someone else"], allergen: "milk" }],
    forbid: forbidOf("milk", "egg"),
    attendees: async (w) => [(await subjectOf(w, "Sam")) ?? "self", (await subjectOf(w, "Priya")) ?? "self"],
    linesAtLeast: 2,
  },
  {
    id: "F31",
    stated: "plainly, typed; then someone walks in",
    path: "suggest",
    state: "company in the room",
    tell: typed(I_EGGS, fs("egg for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    before: [{ label: "the owner says someone walked in", do: "type", text: "My coworker just walked in.", answers: [reply("Hi there."), parse({ company: 0.95 }, "parse: company")] }],
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "either",
  },
  {
    id: "F32",
    stated: "for a named person (\"my brother can't have eggs\"), spoken",
    path: "dinner with attendees",
    state: "rules ready; the model passes his ID",
    tell: spoken("My brother can't have eggs", fs("egg for the brother", "My brother can't have eggs", [{ quote: "My brother can't have eggs", item: "eggs", who: { mention: "My brother" } }]), []),
    rules: [{ codes: CODES.egg, who: { label: "brother" } }],
    head: [{ subjects: ["Your brother", "My brother"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    attendees: async (w) => [(await subjectOf(w, "brother")) ?? "self"],
  },

  // Other food paths and states.
  {
    id: "F33",
    stated: "plainly, typed",
    path: "recipe pick",
    state: "rules ready",
    tell: typed(I_EGGS, fs("egg for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
  },
  {
    id: "F37",
    stated: "plainly, typed",
    path: "suggest",
    state: "rules unavailable (the food path's read of core/rules fails)",
    tell: typed(I_EGGS, fs("egg for the owner", I_EGGS, [self("I'm allergic to eggs", "eggs")]), [{ quote: "I'm allergic to eggs", code: "egg" }]),
    before: [failNextRulesRead()],
    rules: [{ codes: CODES.egg, who: "self" }],
    head: [{ subjects: YOU, allergen: "eggs" }],
    forbid: forbidOf("egg"),
    expect: "nothing",
  },
  {
    id: "F38",
    stated: "for someone unnamed, then answered (\"My sister.\"), typed",
    path: "dinner with attendees",
    state: "pending, then answered; the model passes her ID",
    tell: [
      ...typed("Someone coming tonight is allergic to eggs.", fs("egg for someone, need subject", "Someone coming tonight is allergic to eggs.", [{ quote: "Someone coming tonight is allergic to eggs", item: "eggs", who: { mention: "Someone coming tonight" } }], "subject"), []),
      ...typed("My sister.", fs("the answer: the sister", "My sister.", [{ quote: "My sister", item: "eggs", who: { mention: "My sister" } }]), []),
    ],
    rules: [{ codes: CODES.egg, who: { label: "sister" } }],
    head: [{ subjects: ["Your sister", "My sister", "Someone"], allergen: "eggs" }],
    forbid: forbidOf("egg"),
    attendees: async (w) => [(await subjectOf(w, "sister")) ?? "self"],
    expect: "either",
  },
  {
    id: "F39",
    stated: "something unnamed in a dish (\"something in that curry\"), typed",
    path: "suggest",
    state: "unresolved",
    tell: typed("I'm allergic to something in that curry.", fsEmpty("no item: the allergen is unknown", "meaning"), []),
    rules: [{ codes: ["unresolved"], who: "self" }],
    head: [{ subjects: YOU, allergen: "any food" }],
    forbid: [],
    expect: "nothing",
    asks: true,
  },
  {
    id: "F40",
    stated: "celiac, typed",
    path: "suggest",
    state: "rules ready",
    tell: typed("I have celiac, so no gluten.", fs("gluten for the owner", "I have celiac, so no gluten.", [self("I have celiac", "celiac", { severity: "celiac" })]), [{ quote: "no gluten", code: "gluten" }]),
    rules: [{ codes: CODES.wheat, who: "self" }],
    head: [{ subjects: YOU, allergen: "gluten" }],
    forbid: forbidOf("wheat"),
  },
];

// ---------------------------------------------------------------------------------------------
// The hero's dinners and the list, and an asked recall: paths that need the seed or a different tool.

type Bank = Evidence & { observation: { kind: "bank"; amountCents: number; pending: boolean } };
const isBank = (e: Evidence) => e.kind === "transaction" && e.observation.kind === "bank";

/** Beat 3's test setup (brief 029): purchases as the detector counts them, and the pending decoy dropped. */
const asDetectorReads: Step = {
  label: "setup: the seeded bank rows the way the detector reads them",
  do: "setup",
  what: "purchases positive and the pending takeout decoy dropped, as beat 3's variant does (brief 029 findings 1 and 2)",
  run: async (w) => {
    await rewriteEvidence(
      w,
      (e) => isBank(e) && (e as Bank).observation.amountCents < 0,
      (e) => {
        const b = e as Bank;
        return b.observation.pending ? null : ({ ...b, observation: { ...b.observation, amountCents: -b.observation.amountCents } } as Evidence);
      },
    );
  },
};

function heroScript(id: string, what: "hero dinners" | "list write"): GateScript {
  const offer = (w: World) => (w.vars.get("offer") as HeroOffer | null | undefined) ?? null;
  const yes = "Franki writes the three dinners and the list";
  const milk = "I can't have dairy.";
  return {
    gate: "food",
    id,
    name: `food ${id}: dairy, typed; ${what}; rules ready, the hero's yes`,
    scores: "spec §13 gate 'Hard-rule miss: 0 of 40', spec §10",
    meta: { stated: "plainly, typed (\"I can't have dairy\")", path: what, state: "rules ready; the hero's yes on the clone's Friday" },
    steps: [
      { label: "load the seed for a visit", do: "seed", visit: `food-${id}` },
      asDetectorReads,
      { label: "open a session", do: "open" },
      { label: "the wish plays", do: "play", of: "open a session" },
      ...typed(milk, fs("milk for the owner", milk, [self("I can't have dairy", "dairy")]), [{ quote: "I can't have dairy", code: "milk" }]),
      { label: "the stated allergens are filtered in core/rules", do: "check", of: "open a session", expect: [rulesHold([{ codes: CODES.milk, who: "self" }])] },
      {
        label: "probe: the hero offer",
        do: "probe",
        name: "offer",
        run: async (w) => {
          const o = await heroOffer(w.ctx, w.stamp?.generation ?? 1);
          return o === null ? null : { ...o, text: o.line };
        },
        expect: [{ mustSay: { template: "hero.offer", has: ["$186"], channel: "probe" } }],
      },
      // The offer comes as an idle whisper, and the yes follows it (brief 037, H-168).
      { label: "a quiet moment on the call", do: "idle" },
      { label: "the offer plays as an idle whisper", do: "play", of: "a quiet moment on the call" },
      { label: "the owner says yes", do: "say", text: "Yes, let's do it", judge: "O", answers: [parse()] },
      { label: "the Head at the yes lists the rule", do: "check", of: "the owner says yes", expect: [headFilters("the owner says yes", [{ subjects: YOU, allergen: "milk" }])] },
      {
        label: yes,
        do: "tool",
        tool: (w) => ({ name: "answer", args: { pendingId: offer(w)?.pendingId ?? "none", choiceId: offer(w)?.yesId ?? "none" } }),
        expect: what === "hero dinners" ? [foodSafe(yes, NO.milk, "offered")] : [listSafe(NO_LABELS.milk)],
      },
    ],
  };
}

const RECALL_Q = "What foods do I need to stay away from?";
const F36: GateScript = {
  gate: "food",
  id: "F36",
  name: "food F36: two allergens, typed; asked recall about food; rules ready",
  scores: "spec §13 gate 'Hard-rule miss: 0 of 40', spec §11",
  meta: { stated: "a list in one sentence, typed", path: "asked recall", state: "rules ready" },
  steps: [
    { label: "open a session", do: "open" },
    ...typed("I'm allergic to eggs and sesame.", fs("egg and sesame for the owner", "I'm allergic to eggs and sesame.", [self("I'm allergic to eggs", "eggs"), self("sesame", "sesame")]), [{ quote: "allergic to eggs", code: "egg" }, { quote: "sesame", code: "sesame" }]),
    { label: "the stated allergens are filtered in core/rules", do: "check", of: "open a session", expect: [rulesHold([{ codes: CODES.egg, who: "self" }, { codes: CODES.sesame, who: "self" }])] },
    { label: "close", do: "close" },
    { label: "open the next session", do: "open", expect: [headFilters("open the next session", [{ subjects: YOU, allergen: "eggs" }, { subjects: YOU, allergen: "sesame" }])] },
    { label: "the owner asks", do: "say", text: RECALL_Q, answers: [parse()] },
    { label: "the Head at the question lists both", do: "check", of: "the owner asks", expect: [headFilters("the owner asks", [{ subjects: YOU, allergen: "eggs" }, { subjects: YOU, allergen: "sesame" }])] },
    {
      label: "recall about food",
      do: "tool",
      tool: () => ({ name: "recall", args: { purpose: "answer", query: "foods to stay away from", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" } }),
      expect: [{ neverSay: ["omelet", "sesame oil", "eggs are fine"], channels: ["tool", "note", "card"] }],
    },
  ],
};

export const FOOD: GateScript[] = [...MOMENTS.map(momentScript), heroScript("F34", "hero dinners"), heroScript("F35", "list write"), F36].sort((a, b) => (a.id < b.id ? -1 : 1));
