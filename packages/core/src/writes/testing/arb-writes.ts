/**
 * Generators and fixtures for the wave A properties of brief 012 (design section 7). Plain module, not guarded:
 * fixing a generator is an ordinary edit. Each property file holds only its statement.
 *
 * A generated turn is a list of clauses (an allergy, someone else's allergy, a hedge, a denial, a fix to the
 * owner's name, a fix to the sister's name, a death, an illness, or filler with accents and emoji) joined into one
 * Evidence text. Each clause brings the FastSlots item a careful model would return for it; the generator then
 * moves its span, edits its quote, changes its act or swaps its allergen, so the items range from exact to wrong.
 * Slices over the text get generated classes. The prior Evidence and the rows a correction or a change can target
 * are fixed, with real lineage, so a planner's output can be resolved.
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { type PlanContext, anchorSpan, verifySpan } from "../../extract";
import { type Hasher, canonicalJSON, idParts, rootKey } from "../../ids";
import { type Class, type Slice, type Span, msFromTs, tsFromMs } from "../../schema/primitives";
import type { CoreRules, Evidence, Memory } from "../../schema/records";
import { buildSlice } from "../../slices";
import { splitsSurrogate } from "../../text";
import { commonFields, sampleEvidence, sampleMemory, testId } from "../../testing/samples";
import type { Act, FastItem, FastSlotsOut, HardRuleTurn, PlanEnv, Polarity, Route, TurnEvidence, ValidateContext } from "../types";
import { aliasesIn, hasWholeWords } from "./gazetteer-oracle";

// ---------------------------------------------------------------------------------------------
// Fixed identities

/** A deterministic Hasher: SHA-256 stands in for the HMAC, as in `slices.property.test.ts`. */
export const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

export const UID = "owner-1";
export const TURN_EID = testId("evturn");
export const PRIOR_EID = testId("evprior");
export const OTHER_EID = testId("evother");

/** The owner's earlier turn, where the names were first said. */
export const PRIOR_AT = "2026-11-09T18:00:00.000Z";
export const TURN_AT = "2026-11-10T18:00:00.000Z";
export const NOW = "2026-11-10T18:00:05.000Z";
export const NEXT_REVIEW = "2027-11-10T18:00:05.000Z";

/** As extraction's `resolveMention` derives a mention's EID today. */
export const personEid = (name: string) => hasher.id(["mention", "person", name.normalize("NFKC").trim().toLowerCase()]);
export const SISTER = personEid("maya");
export const DAD = personEid("dad");

export const memoryKey = (subject: string, predicate: string, scope: string) => hasher.id(idParts.memoryKey(subject, predicate, scope));

/**
 * Builds Evidence over `text` with slices at `cuts`, classed by `classes` (the last class repeats). A cut between
 * the two halves of a surrogate pair moves forward one code unit, and is dropped when that lands it on a
 * neighbouring cut or on the end of the text.
 */
export function buildEvidence(eid: string, text: string, cuts: readonly number[], classes: readonly Class[], assertedAt: string): Evidence {
  const kept = cuts.filter((c) => c > 0 && c < text.length);
  const moved = kept.map((c) => (splitsSurrogate(text, c) ? c + 1 : c));
  const inner = moved.filter((c, i) => c === kept[i] || (c < text.length && c !== moved[i - 1] && c !== moved[i + 1]));
  const bounds = [0, ...inner, text.length];
  const slices: Slice[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (bounds[i] === bounds[i + 1]) continue;
    const cls = classes[Math.min(i, classes.length - 1)] ?? "U";
    slices.push(buildSlice({ eid, fieldPath: "text", fieldText: text, start: bounds[i]!, end: bounds[i + 1]!, class: cls, sens: "S0" }, hasher));
  }
  return sampleEvidence({
    ...commonFields({ rootSlices: slices, rootKeys: slices.map((s) => rootKey(s, hasher)) }),
    logicalId: eid,
    text: { kind: "inline", text },
    fieldSlices: slices,
    occurredAt: assertedAt,
    assertedAt,
    receivedAt: assertedAt,
  });
}

export function turnEvidenceOf(e: Evidence, eid: string): TurnEvidence {
  const text = e.text !== null && e.text.kind === "inline" ? e.text.text : "";
  return { eid, rev: e.rev, text, slices: e.fieldSlices, rootKeys: e.fieldSlices.map((s) => rootKey(s, hasher)), assertedAt: e.assertedAt };
}

/** The exact Span over `text[start, end)`. */
export const spanAt = (eid: string, text: string, start: number, end: number): Span => ({ eid, fieldPath: "text", start, end, quote: text.slice(start, end) });

// ---------------------------------------------------------------------------------------------
// The prior turn and the rows that can be targeted

export const PRIOR_TEXT = "My sister Maya is coming Friday. My name is Alec. My dad lives in Leeds.";
export const PRIOR = buildEvidence(PRIOR_EID, PRIOR_TEXT, [], ["U"], PRIOR_AT);

function rootedIn(e: Evidence, eid: string, phrase: string): Pick<Memory, "rootSlices" | "rootKeys" | "dependsOn" | "packetEids" | "supportingIds"> {
  const text = turnEvidenceOf(e, eid).text;
  const at = text.indexOf(phrase);
  if (at < 0) throw new Error(`fixture: "${phrase}" is not in the Evidence`);
  const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start: at, end: at + phrase.length, class: "U", sens: "S0" }, hasher);
  return { rootSlices: [slice], rootKeys: [rootKey(slice, hasher)], dependsOn: [`e:${eid}`], packetEids: [eid], supportingIds: [{ type: "evidence", id: eid, rev: e.rev }] };
}

/** A U Memory with lineage into `e`. */
export function row(id: string, fields: Partial<Memory> & Pick<Memory, "subjectId" | "predicate" | "value" | "args">, e: Evidence, eid: string, phrase: string, scope = "global"): Memory {
  const at = e.assertedAt;
  return sampleMemory({
    ...rootedIn(e, eid, phrase),
    logicalId: id,
    kind: "fact",
    scopeId: scope,
    key: memoryKey(fields.subjectId, fields.predicate, scope),
    assertedAt: at,
    validFrom: at,
    validFromKey: at,
    entityIds: fields.subjectId === "self" ? [] : [fields.subjectId],
    ...fields,
  });
}

export const SELF_NAME = row(testId("mselfname"), { subjectId: "self", predicate: "identity.name", value: { kind: "text", text: "Alec" }, args: {}, sayAs: { text: "The owner's name is Alec.", entityRefs: [], timeFields: [] } }, PRIOR, PRIOR_EID, "My name is Alec");
export const SISTER_REL = row(
  testId("msisterrel"),
  {
    subjectId: "self",
    predicate: "person.relation",
    value: { kind: "enum", code: "sister" },
    args: { otherRef: SISTER, label: "sister", employerRef: null },
    entityIds: [SISTER],
    sayAs: { text: "Maya is the owner's sister.", entityRefs: [SISTER], timeFields: [] },
  },
  PRIOR,
  PRIOR_EID,
  "My sister Maya",
  hasher.id(["scope", SISTER]),
);
export const DAD_LIFE = row(testId("mdadlife"), { subjectId: DAD, predicate: "person.life", value: { kind: "enum", code: "alive" }, args: { detail: null } }, PRIOR, PRIOR_EID, "My dad lives in Leeds");

export const TARGET_ROWS: readonly Memory[] = [SELF_NAME, SISTER_REL, DAD_LIFE];

export function targetsMap(rows: readonly Memory[] = TARGET_ROWS): ValidateContext["targets"] {
  return new Map(rows.map((m) => [m.logicalId, { rev: m.rev, memory: m, line: m.sayAs?.text ?? "" }]));
}

export const ENTITIES: ValidateContext["entities"] = [
  { id: SISTER, label: "Maya", aliases: ["sister"] },
  { id: DAD, label: "Dad", aliases: ["dad"] },
];
export const KNOWN: ValidateContext["known"] = {
  entries: [
    { id: SISTER, kind: "person", label: "Maya", aliases: ["sister"], relation: "sister" },
    { id: DAD, kind: "person", label: "Dad", aliases: ["dad"], relation: "parent" },
  ],
};

export function emptyRules(): CoreRules {
  return { ...commonFields(), rulesRev: 1, allergies: [], standing: [], rulePages: 0, gazetteerVersion: "none", noneConfirmed: [], subjectLabels: [], proposals: [], handled: [], ask: { sessionId: null, q: { kind: "none" } } };
}

// ---------------------------------------------------------------------------------------------
// Clauses

/** Allergens a person would name: gazetteer aliases, nested ones, and one off the table. */
export const ALLERGENS = ["shellfish", "peanuts", "sesame", "cashew nuts", "milk", "shrimp", "gluten", "kiwi", "latex", "penicillin", "tree nuts", "soy sauce", "durian"] as const;
const RELATIONS = ["brother", "mum", "friend", "boss"] as const;
const NEW_NAMES = ["Mara", "May", "Mia"] as const;

/** Filler with accents, emoji and an astral character, and no alias of any gazetteer entry. */
export const FILLER = ["Café au lait, s'il vous plaît.", "We watched a film about trains 🚆.", "The weather was grey today.", "Ünïcödé — fine 😀."] as const;
for (const f of FILLER) if (aliasesIn(f).length > 0) throw new Error(`fixture: filler "${f}" names an allergen`);

export type ClauseKind = "selfAllergy" | "otherAllergy" | "hedge" | "denial" | "selfName" | "rename" | "death" | "illness" | "filler";

export interface ClauseSpec {
  kind: ClauseKind;
  allergen: string;
  relation: string;
  newName: string;
  filler: string;
}

export const clauseArb: fc.Arbitrary<ClauseSpec> = fc.record({
  kind: fc.constantFrom<ClauseKind>("selfAllergy", "otherAllergy", "hedge", "denial", "selfName", "rename", "death", "illness", "filler"),
  allergen: fc.constantFrom(...ALLERGENS),
  relation: fc.constantFrom(...RELATIONS),
  newName: fc.constantFrom(...NEW_NAMES),
  filler: fc.constantFrom(...FILLER),
});

interface Built {
  text: string;
  /** The item a careful model returns, with spans relative to the clause; null for filler. */
  item: ((at: number, text: string) => FastItem) | null;
}

const selfSubject = { entityId: null, mention: null, isSelf: true };

function buildClause(c: ClauseSpec): Built {
  const whole = (t: string, extra: (at: number, all: string) => Partial<FastItem>) => (at: number, all: string) => ({ ...extra(at, all), span: spanAt(TURN_EID, all, at, at + t.length) }) as FastItem;
  switch (c.kind) {
    case "selfAllergy": {
      const t = `I'm allergic to ${c.allergen}`;
      return { text: `${t}.`, item: whole(t, () => ({ kind: "allergy", subject: selfSubject, item: c.allergen, severity: "allergy", polarity: "affirmed", act: "direct" })) };
    }
    case "otherAllergy": {
      const m = `My ${c.relation}`;
      const t = `${m} can't have ${c.allergen}`;
      return {
        text: `${t}.`,
        item: whole(t, (at, all) => ({
          kind: "allergy",
          subject: { entityId: null, mention: spanAt(TURN_EID, all, at, at + m.length), isSelf: false },
          item: c.allergen,
          severity: "unknown",
          polarity: "affirmed",
          act: "direct",
        })),
      };
    }
    case "hedge": {
      const t = `I think I might be allergic to ${c.allergen}`;
      return { text: `${t}.`, item: whole(t, () => ({ kind: "allergy", subject: selfSubject, item: c.allergen, severity: "unknown", polarity: "uncertain", act: "direct" })) };
    }
    case "denial": {
      const t = `I'm not allergic to ${c.allergen}`;
      return { text: `${t}.`, item: whole(t, () => ({ kind: "allergy", subject: selfSubject, item: c.allergen, severity: "unknown", polarity: "denied", act: "direct" })) };
    }
    case "selfName": {
      const t = `No, my name is Alex, not Alec`;
      return {
        text: `${t}.`,
        item: whole(t, () => ({ kind: "correction", targetIds: [SELF_NAME.logicalId], predicate: "identity.name", replacementValue: { kind: "text", text: "Alex" }, args: null, act: "direct" })),
      };
    }
    case "rename": {
      const t = `No, her name is ${c.newName}, not Maya`;
      return {
        text: `${t}.`,
        item: whole(t, () => ({ kind: "correction", targetIds: [SISTER_REL.logicalId], predicate: "identity.name", replacementValue: { kind: "text", text: c.newName }, args: null, act: "direct" })),
      };
    }
    case "death": {
      const t = "My dad passed away last night";
      return {
        text: `${t}.`,
        item: whole(t, () => ({ kind: "transition", transition: "death", subject: { entityId: DAD, mention: null, isSelf: false }, counterpart: null, whenSpoken: null, polarity: "affirmed", act: "direct" })),
      };
    }
    case "illness": {
      const t = "My dad has been really sick";
      return {
        text: `${t}.`,
        item: whole(t, () => ({ kind: "transition", transition: "illness", subject: { entityId: DAD, mention: null, isSelf: false }, counterpart: null, whenSpoken: null, polarity: "affirmed", act: "direct" })),
      };
    }
    case "filler":
      return { text: c.filler, item: null };
  }
}

/** The text and the careful items of a clause list. */
export function compose(clauses: readonly ClauseSpec[]): { text: string; items: FastItem[] } {
  let text = "";
  const items: FastItem[] = [];
  const pending: { at: number; f: (at: number, all: string) => FastItem }[] = [];
  for (const c of clauses) {
    const b = buildClause(c);
    if (text !== "") text += " ";
    if (b.item !== null) pending.push({ at: text.length, f: b.item });
    text += b.text;
  }
  for (const p of pending) items.push(p.f(p.at, text));
  return { text, items };
}

// ---------------------------------------------------------------------------------------------
// Item changes: span moves, quote edits, acts, swapped allergens

export type SpanChange = { kind: "exact" } | { kind: "shift"; d: number } | { kind: "editQuote"; at: number } | { kind: "reslice"; d: number } | { kind: "otherEid" };

export const spanChangeArb: fc.Arbitrary<SpanChange> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: "exact" as const }) },
  // The anchor slack is 3: shifts of 3 and 4 are weighted in.
  { weight: 3, arbitrary: fc.oneof(fc.constantFrom(-4, -3, 3, 4), fc.integer({ min: -20, max: 20 })).map((d) => ({ kind: "shift" as const, d })) },
  { weight: 1, arbitrary: fc.nat(600).map((at) => ({ kind: "editQuote" as const, at })) },
  { weight: 1, arbitrary: fc.integer({ min: -20, max: 20 }).map((d) => ({ kind: "reslice" as const, d })) },
  { weight: 1, arbitrary: fc.constant({ kind: "otherEid" as const }) },
);

export function changeSpan(s: Span, c: SpanChange, text: string): Span {
  const clamp = (n: number) => Math.max(0, n);
  switch (c.kind) {
    case "exact":
      return s;
    case "shift": {
      const start = clamp(s.start + c.d);
      return { ...s, start, end: Math.max(start, s.end + c.d) };
    }
    case "editQuote": {
      if (s.quote === "") return s;
      const i = c.at % s.quote.length;
      const ch = s.quote[i] === "x" ? "y" : "x";
      return { ...s, quote: s.quote.slice(0, i) + ch + s.quote.slice(i + 1) };
    }
    case "reslice": {
      const start = Math.min(text.length, clamp(s.start + c.d));
      const end = Math.min(text.length, Math.max(start, s.end + c.d));
      return { ...s, start, end, quote: text.slice(start, end) };
    }
    case "otherEid":
      return { ...s, eid: OTHER_EID };
  }
}

export interface ItemChange {
  span: SpanChange;
  act: Act;
  /** For an allergy item: replace `item` with an allergen the span doesn't hold. */
  swapItem: boolean;
  polarity: Polarity | null;
}

export const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 3, arbitrary: fc.constant("direct" as const) },
  { weight: 3, arbitrary: fc.constantFrom<Act>("quoted", "hypothetical", "uncertain") },
);

export const itemChangeArb: fc.Arbitrary<ItemChange> = fc.record({
  span: spanChangeArb,
  act: actArb,
  swapItem: fc.boolean(),
  polarity: fc.option(fc.constantFrom<Polarity>("affirmed", "denied", "uncertain"), { freq: 4 }),
});

/** An allergen alias that isn't in `quote` at all (so it can't be inside the span). */
export function allergenNotIn(quote: string): string {
  const q = quote.toLowerCase();
  return ALLERGENS.find((a) => !q.includes(a) && !q.includes(a.split(" ")[0]!)) ?? "lupin";
}

export function changeItem(item: FastItem, c: ItemChange, text: string): FastItem {
  const span = changeSpan(item.span, c.span, text);
  const base = { ...item, span, act: c.act } as FastItem;
  if (base.kind === "allergy") {
    return { ...base, item: c.swapItem ? allergenNotIn(item.span.quote) : base.item, polarity: c.polarity ?? base.polarity };
  }
  if (base.kind === "transition") return { ...base, polarity: c.polarity ?? base.polarity };
  return base;
}

// ---------------------------------------------------------------------------------------------
// Span oracle: extraction's own check (design 2.4, "The span check is extraction's")

/** The packet `anchorSpan` and `verifySpan` read: the turn's Evidence alone. */
export const packetOf = (e: Evidence): PlanContext => ({ packet: new Map([[TURN_EID, { evidence: e, fields: ["text"] }]]) }) as unknown as PlanContext;

/** The verified span after the anchor slack, or null when it doesn't match the Evidence text. */
export function verified(span: Span, e: Evidence): Span | null {
  const ctx = packetOf(e);
  const anchored = anchorSpan(span, ctx);
  return verifySpan(anchored, ctx) === null ? null : anchored;
}

/** True when the span is exact on the turn: no anchoring needed. */
export const exactOn = (span: Span, text: string): boolean => span.eid === TURN_EID && span.fieldPath === "text" && span.start < span.end && span.end <= text.length && text.slice(span.start, span.end) === span.quote;

/** True when a U slice covers [start, end) whole. */
export const inU = (slices: readonly Slice[], start: number, end: number): boolean =>
  slices.some((s) => s.class === "U" && s.fieldPath === "text" && s.start !== null && s.end !== null && s.start <= start && end <= s.end);

/** The allergy item's `item` occurs as whole words inside the quote. */
export const itemInQuote = (item: string, quote: string): boolean => hasWholeWords(quote, item);

// ---------------------------------------------------------------------------------------------
// Turns

export const ALL_ROUTES: ReadonlySet<Route> = new Set(["hardRule", "correct", "transition"]);

export const routesArb: fc.Arbitrary<ReadonlySet<Route>> = fc
  .subarray<Route>(["hardRule", "correct", "transition"], { minLength: 0, maxLength: 3 })
  .map((r) => new Set(r));

export const layoutArb = fc.record({
  cuts: fc.uniqueArray(fc.nat(400), { minLength: 0, maxLength: 4 }).map((c) => [...c].sort((a, b) => a - b)),
  classes: fc.array(fc.constantFrom<Class>("U", "T", "M", "O", "C"), { minLength: 5, maxLength: 5 }),
});

export function validateContext(e: Evidence, over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    evidence: turnEvidenceOf(e, TURN_EID),
    source: "typed",
    speakerCertain: true,
    routes: ALL_ROUTES,
    answering: null,
    known: KNOWN,
    entities: ENTITIES,
    targets: targetsMap(),
    worldNow: msFromTs(NOW),
    hasher,
    ...over,
  };
}

export function hardRuleTurn(e: Evidence, out: FastSlotsOut | null, over: Partial<HardRuleTurn> = {}): HardRuleTurn {
  return {
    evidence: turnEvidenceOf(e, TURN_EID),
    trigger: { regex: true, candidate: true, asked: false },
    out,
    speakerCertain: true,
    answering: null,
    hasher,
    ...over,
  };
}

/** PlanEnv for a change made by the turn `e`, with the FastSlots packet's inputs as lineage (G37). */
export function planEnv(e: Evidence, eid: string, proof: Span, targets: readonly Memory[], worldNow = NOW): PlanEnv {
  return {
    uid: UID,
    evidence: turnEvidenceOf(e, eid),
    proof,
    lineage: {
      packetEids: [eid],
      contextIds: targets.map((m) => ({ type: "memory" as const, id: m.logicalId, rev: m.rev })),
      dependsOn: [`e:${eid}`, ...targets.map((m) => `m:${m.logicalId}@${m.rev}`)],
    },
    worldNow,
    opsNow: worldNow,
    nextReviewAt: NEXT_REVIEW,
    epoch: 1,
    policyRev: 1,
    hasher,
  };
}

/** `ms` as TS, for generated instants. */
export const ts = (ms: number) => tsFromMs(ms);
