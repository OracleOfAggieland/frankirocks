/**
 * Shared pieces of the release-gate scripts (brief 034; spec §13 "Gates"): what each waiting step waits for, the
 * FastSlots answers a script declares, and the checks every food moment, poison and exposure uses. Plain module, so
 * no test file imports another, and `gates.summary.test.ts` can count the scripts without running them.
 */
import { CATALOG, type CoreRules, REGEX_TABLE, normalizeForRegex, readRulesSection } from "@franki/core";
import type { FakeSlotsScript } from "../testing/fake-fast-slots";
import { type Expectation, type Script, type SlotsAnswer, type Step, type World, allLedger, rulesOf } from "../testing/script-runner";
import { paths } from "../store/paths";

// ---------------------------------------------------------------------------------------------
// The gates, and what a waiting step waits for. One constant per reason, so the summary groups them.

export type Gate = "food" | "poison" | "exposure" | "friend";

export interface GateScript extends Script {
  gate: Gate;
  /** F01, P06, E01, FT01 ... */
  id: string;
  /** For the report's table: how the rule was stated, the food path, the state (food); or what the script covers. */
  meta: Record<string, string>;
  /** Set when the script can only be green because nothing is said at all: a green here is not a tested defence. */
  silentGreen?: string;
}

export const W = {
  H1: "brief 032 H1: one wrong polarity from FastSlots loses a stated allergy (validate.ts A5 passes any negation word; a denial on an absent slot carries the code; extraction's handled skip matches any subject)",
  H2: "brief 032 H2: coverage stops at the cue sentence (not-allergy.ts cueSentenceRanges), so an allergen in the next sentence gets no slot",
  H3: "brief 032 H3: a named person's rule supersedes the anonymous rule for the same code (hard-rule.ts affirm branch)",
  M1: "brief 032 M1: an allergen outside the gazetteer passes as not-an-allergy (hard-rule.ts G3 code half), so no unresolved filter is filed",
  M2: "brief 032 M2: unlabeled non-self subjects are grouped as one 'Someone else' line (rules-section.ts subjectName)",
  ATTENDEE:
    "finding A1 of brief 034 (a ruling): suggest(food) applies a named person's rule only when the model passes that person's entity ID in attendeeIds, and no Head, note or tool result ever shows an entity ID, so a named attendee's rule can never reach the filter",
  PASTE:
    "finding A2 of brief 034 (a ruling): an allergy the owner pastes is T, so it writes no rule and opens no route by design (G34), and nothing else filters it or asks; the Head only tells the model to ask the owner to say it",
  DECK_AFTER_NARROW:
    "finding A3 of brief 034: on a company or quiet line with a live call (brief 026 row 8), the blocked answer carries a Deck stamped at the raised policyRev whose Head is still the private one, S1 lines included (routes/turn.ts issues the Deck from the old bundle); the voice machine adopts it before the swap",
  LINEAGE:
    "finding 4 of brief 029: the hero yes's loop Memory cites typed Slices with null ranges, W-LINEAGE refuses them, and the yes answers 400 PARSE, so the three dinners and the list are never written",
  GATE_WIRE: "brief 030: no route calls the Gate or delivers a proactive line yet",
  NARROW_TOOL: "brief 026 'Not built' and brief 030: /api/tool still runs the Server_Rule in wave A with narrowedHere false",
  FORGET: "brief 021's reserved closure and resume, and the brief that wires forget into /api/turn: no route calls fenceForget or advanceForget",
  MAIL_READ: "no path reads mail into a turn, a Head or a whisper yet (ClaimsV1 consumers, the inbox read, whispers: briefs 024 and 030)",
} as const;

export type WaitKey = keyof typeof W;
/** The key of a wait text, for the summary's grouping. */
export const waitKey = (text: string): string => (Object.entries(W).find(([, v]) => text === v || text.startsWith(`${v};`))?.[0] ?? "other");

// ---------------------------------------------------------------------------------------------
// FastSlots answers. Spans are built over the step's own text, which the script knows.

/** `anon`: someone else, unnamed (no entity, no mention), as the reviewer of brief 032 wrote "one of the guests". */
type Who = "self" | "anon" | { mention: string } | { entity: string };

export interface AllergySlot {
  /** The words of the turn the item rests on; must be in the text. */
  quote: string;
  /** The allergen as the model copies it. */
  item: string;
  who?: Who;
  polarity?: "affirmed" | "denied" | "uncertain";
  act?: "direct" | "quoted" | "hypothetical" | "uncertain";
  severity?: "allergy" | "anaphylaxis" | "celiac" | "intolerance" | "unknown";
}

function spanIn(eid: string, text: string, quote: string) {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`span: "${quote}" is not in "${text}"`);
  return { eid, fieldPath: "text" as const, start, end: start + quote.length, quote };
}

function slotItem(eid: string, text: string, entities: readonly { id: string; label: string }[], s: AllergySlot) {
  const who = s.who ?? "self";
  const subject =
    who === "self"
      ? { entityId: null, mention: null, isSelf: true }
      : who === "anon"
        ? { entityId: null, mention: null, isSelf: false }
        : "mention" in who
        ? { entityId: null, mention: spanIn(eid, text, who.mention), isSelf: false }
        : { entityId: entities.find((e) => e.label === who.entity)?.id ?? null, mention: null, isSelf: false };
  return { kind: "allergy", subject, item: s.item, severity: s.severity ?? "allergy", polarity: s.polarity ?? "affirmed", act: s.act ?? "direct", span: spanIn(eid, text, s.quote) };
}

const answer = (why: string, slots: FakeSlotsScript): SlotsAnswer => ({ endpoint: "fastSlots", why: `fastSlots: ${why}`, slots });

/** A valid FastSlots answer with these allergy items over `text`. */
export const fs = (why: string, text: string, items: AllergySlot[], need: "none" | "subject" | "target" | "meaning" | "speaker" | "time" = "none"): SlotsAnswer =>
  answer(why, (input) => {
    if (input.turn.text !== text) throw new Error(`fs: the turn is "${input.turn.text}", not "${text}"`);
    return { kind: "valid", out: { items: items.map((s) => slotItem(input.turn.eid, text, input.entities, s)) as never, need }, ms: 50 };
  });
/** A valid answer with no items: what the model says when it finds nothing. */
export const fsEmpty = (why: string, need: "none" | "meaning" = "none"): SlotsAnswer => answer(why, { kind: "valid", out: { items: [], need }, ms: 50 });
export const fsInvalid = (why: string): SlotsAnswer => answer(why, { kind: "invalid", reason: "shape", path: "$.items[0].span", ms: 60 });
export const fsTimeout = (why: string): SlotsAnswer => answer(why, { kind: "timeout", ms: 900 });
export const fsTransport = (why: string): SlotsAnswer => answer(why, { kind: "transport", ms: 10 });
/** The answer never comes: the port's deadline passes on the fake timers. */
export const fsLate = (why: string): SlotsAnswer => answer(why, { kind: "never" });

// ---------------------------------------------------------------------------------------------
// Forbidden ingredients, written out by hand (not read from the product's allergen tree).

export const NO = {
  egg: ["egg"],
  milk: ["parmesan", "cheddar", "butter", "yogurt", "pesto"],
  wheat: ["pasta", "flour_tortillas", "bread", "soy_sauce"],
  peanut: ["peanut_butter"],
  treeNut: ["cashews", "pesto"],
  shellfish: ["shrimp", "mixed_seafood"],
  fish: ["salmon_fillet", "cod_fillet", "fish_sauce", "mixed_seafood"],
  soy: ["tofu", "soy_sauce"],
  sesame: ["sesame_oil"],
  corn: ["tortillas"],
  coriander: ["cilantro"],
  spinach: ["spinach"],
  mushroom: ["mushroom"],
  chicken: ["chicken_thigh", "chicken_breast"],
} as const;

/** The grocery labels of the forbidden ingredients, for a list write (ingredient labels, by hand). */
export const NO_LABELS: Record<keyof typeof NO, string[]> = {
  egg: ["eggs"],
  milk: ["parmesan cheese", "cheddar cheese", "butter", "plain yogurt", "basil pesto"],
  wheat: ["wheat pasta", "flour tortillas", "bread", "soy sauce"],
  peanut: ["peanut butter"],
  treeNut: ["cashews", "basil pesto"],
  shellfish: ["shrimp", "mixed seafood"],
  fish: ["salmon fillets", "cod fillets", "fish sauce", "mixed seafood"],
  soy: ["firm tofu", "soy sauce"],
  sesame: ["sesame oil"],
  corn: ["corn tortillas"],
  coriander: ["cilantro"],
  spinach: ["spinach"],
  mushroom: ["mushrooms"],
  chicken: ["chicken thighs", "chicken breast"],
};

/** The recipes a food card offers, read back from its lines ("Name, N minutes: ..."). */
export function offeredRecipes(lines: readonly string[]) {
  return lines.map((line) => {
    const r = CATALOG.find((c) => line.startsWith(`${c.name}, `));
    if (r === undefined) throw new Error(`a food card line names no catalog recipe: ${line}`);
    return r;
  });
}

type FoodExpect = "offered" | "nothing" | "either";

/**
 * The food path's outputs at `label`: every recipe offered (on a card or the tool result) holds none of the
 * forbidden ingredients. "offered" also needs at least one dinner; "nothing" needs none and a fail-closed question
 * or an empty result.
 */
export function foodSafe(label: string, forbid: readonly string[], expect: FoodExpect = "offered"): Expectation {
  return {
    store: `the food path offers nothing with ${forbid.join(", ")}${expect === "offered" ? ", and offers something" : expect === "nothing" ? ", and offers nothing" : ""}`,
    check: async (w) => {
      const mine = w.outputs.filter((o) => o.step === label);
      const cards = mine.filter((o) => o.channel === "card").map((o) => JSON.parse(o.json) as { kind: string; lines: string[] });
      const food = cards.filter((c) => c.kind === "food");
      const recipes = food.flatMap((c) => offeredRecipes(c.lines));
      const bad = recipes.filter((r) => r.ingredientIds.some((i) => forbid.includes(i)));
      if (bad.length > 0) return `offered ${bad.map((r) => `${r.name} (${r.ingredientIds.filter((i) => forbid.includes(i)).join(", ")})`).join("; ")}`;
      const tool = mine.find((o) => o.channel === "tool");
      const ids = tool === undefined ? [] : ((JSON.parse(tool.json) as { candidateIds?: string[] } | null)?.candidateIds ?? []);
      if (ids.length !== recipes.length && food.length > 0) return `the tool names ${ids.length} candidates and the card ${recipes.length}`;
      if (expect === "offered" && recipes.length === 0) return `nothing offered; ${mine.map((o) => `[${o.channel}] ${o.text.slice(0, 200)}`).join(" ") || "no output"}`;
      if (expect === "nothing" && (recipes.length > 0 || ids.length > 0)) return `offered ${recipes.map((r) => r.name).join("; ")}`;
      return true;
    },
  };
}

/** A list write: the makeList action's grocery items hold none of the forbidden labels. */
export function listSafe(forbid: readonly string[]): Expectation {
  return {
    store: `the grocery list holds none of ${forbid.join(", ")}`,
    check: async (w) => {
      const actions = (await allLedger(w)).filter((l) => l.data.kind === "action");
      if (actions.length === 0) return "no list was written";
      const items = actions.flatMap((a) => ((a.data as { payload: { items?: { label: string }[] } }).payload.items ?? []).map((i) => i.label));
      const bad = items.filter((i) => forbid.includes(i));
      return bad.length === 0 ? true : `the list holds ${bad.join(", ")}`;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rules: in the store, and in the Head.

export type RuleWho = "self" | "anon" | { label: string };

/** The subject ID of a stored label ("your brother"), or null. */
export async function subjectOf(w: World, label: string): Promise<string | null> {
  const rules = await rulesOf(w);
  return (rules.subjectLabels ?? []).find((l) => l.label.toLowerCase().includes(label.toLowerCase()))?.subjectId ?? null;
}

function filters(rules: CoreRules, codes: readonly string[], who: RuleWho, subjectId: string | null): boolean {
  return rules.allergies.some((r) => {
    if (r.state !== "active" && r.state !== "pending") return false;
    if (!codes.includes(r.code) && r.code !== "unresolved") return false;
    // A rule with no subject covers everyone at the filter.
    if (r.subjectId === null) return true;
    if (who === "self") return r.subjectId === "self";
    if (who === "anon") return false;
    return subjectId !== null && r.subjectId === subjectId;
  });
}

/** Every stated allergen is filtered for its subject: an active rule, a pending rule, or the unresolved filter. */
export function rulesHold(want: readonly { codes: readonly string[]; who: RuleWho }[]): Expectation {
  return {
    store: `core/rules filters ${want.map((x) => `${x.codes[0]} for ${typeof x.who === "string" ? x.who : x.who.label}`).join(", ")}`,
    check: async (w) => {
      const rules = await rulesOf(w);
      for (const x of want) {
        const sid = typeof x.who === "string" ? null : await subjectOf(w, x.who.label);
        if (!filters(rules, x.codes, x.who, sid)) {
          return `nothing filters ${x.codes[0]} for ${typeof x.who === "string" ? x.who : x.who.label}: ${JSON.stringify(rules.allergies.map((r) => [r.code, r.subjectId, r.state]))}, labels ${JSON.stringify(rules.subjectLabels ?? [])}`;
        }
      }
      return true;
    },
  };
}

/** Franki asks: an allergy question is open on core/rules (code decides; the reply's wording is the model's). */
export const franksAsks: Expectation = {
  store: "an allergy question is open on core/rules",
  check: async (w) => {
    const ask = (await rulesOf(w)).ask;
    return ask !== undefined && ask.q.kind !== "none" ? true : `ask: ${JSON.stringify(ask)}`;
  },
};

/**
 * The last Head shown at `label` lists each allergen for its subject (or under a pending line for someone, or as
 * "any food", or the fail-closed tail). `subjects` are the rendered names a line may use ("You", "Your brother").
 */
export function headFilters(label: string, want: readonly { subjects: readonly string[]; allergen: string }[]): Expectation {
  return {
    store: `the Head at "${label}" lists ${want.map((x) => `${x.allergen} for ${x.subjects[0]}`).join(", ")}`,
    check: async (w) => {
      const heads = w.outputs.filter((o) => o.step === label && o.channel === "head");
      const head = heads[heads.length - 1];
      if (head === undefined) return "no Head at this step";
      if (head.text.includes("more rules: ask before suggesting any food")) return true;
      const triples = readRulesSection(head.text);
      for (const x of want) {
        const names = [...x.subjects, "someone"].map((s) => s.toLowerCase());
        if (!triples.some((t) => names.includes(t.subject.toLowerCase()) && (t.code === x.allergen || t.code === "any food"))) {
          const at = rulesAt(head.text);
          return `no line for ${x.allergen} (${x.subjects.join("/")}): ${head.text.slice(at, at + 400)}`;
        }
      }
      return true;
    },
  };
}

/** Where the Head's rules section starts (for failure messages). */
const rulesAt = (text: string) => Math.max(0, text.lastIndexOf("\nHard rules"));

/** Each subject on its own line: no rules-section line names two subjects' allergens together (M2). */
export function headOneSubjectPerLine(label: string, minLines: number): Expectation {
  return {
    store: `the Head at "${label}" gives each subject its own line (at least ${minLines})`,
    check: async (w) => {
      const heads = w.outputs.filter((o) => o.step === label && o.channel === "head");
      const head = heads[heads.length - 1];
      if (head === undefined) return "no Head at this step";
      const subjects = new Set(readRulesSection(head.text).map((t) => `${t.state}:${t.subject}`));
      const at = rulesAt(head.text);
      return subjects.size >= minLines ? true : `${subjects.size} subject line(s): ${head.text.slice(at, at + 300)}`;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Steps.

/** A suggest(food) call, with the attendees the model passes. */
export function suggestCall(label: string, expect: Expectation[], query = "quick dinner tonight"): Step {
  return {
    label,
    do: "tool",
    tool: (w) => ({ name: "suggest", args: { domain: "food", query, attendeeIds: (w.vars.get(`attendees:${label}`) as string[] | undefined) ?? [], when: null, contextId: null } }),
    expect,
  };
}

/**
 * The attendees the model passes, resolved before the tool step (the tool's args are built synchronously): a setup
 * step that stores them under the tool step's label.
 */
export function attendeesFor(toolLabel: string, attendees: (w: World) => Promise<string[]>): Step {
  return {
    label: `the model passes the attendees for "${toolLabel}"`,
    do: "setup",
    what: "the attendee IDs the speaking model passes to suggest, read from the store (no Head shows them)",
    run: async (w) => void w.vars.set(`attendees:${toolLabel}`, await attendees(w)),
  };
}

/**
 * Test setup for "rules unavailable": the food path's own read of core/rules fails once (a read made from inside
 * suggestTool or answerTool, told by the call stack); every other read goes through.
 */
export function failNextRulesRead(): Step {
  return {
    label: "setup: the food path's read of core/rules fails",
    do: "setup",
    what: "the next core/rules read made by the food handler throws (a failed rules read inside suggest)",
    run: async (w) => {
      const store = w.rig.store as unknown as { get: (uid: string, path: string) => Promise<unknown> };
      const orig = store.get.bind(store);
      store.get = async (uid, path) => {
        const stack = new Error().stack ?? "";
        if (path === paths.core(uid, "rules") && /readRules|suggestTool|answerTool/.test(stack)) {
          store.get = orig;
          throw new Error("rules read failed (test setup)");
        }
        return orig(uid, path);
      };
    },
  };
}

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
/** RX4 (the arrival regex) matches: the route opens at arrival and the typed reply is the route's only reply. */
export const rx4 = (text: string): boolean => RX4.test(normalizeForRegex(text));

/** Allergy codes, with the ones above them that also filter it. */
export const CODES = {
  egg: ["egg"],
  milk: ["milk"],
  wheat: ["wheat", "gluten"],
  gluten: ["gluten"],
  peanut: ["peanut", "nuts"],
  treeNut: ["tree_nut", "nuts"],
  shellfish: ["shellfish", "seafood"],
  sesame: ["sesame"],
  coriander: ["coriander"],
  spinach: ["spinach"],
} as const;
