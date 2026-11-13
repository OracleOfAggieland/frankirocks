/**
 * Generators for the No Resurrection property (brief 047; spec line 361). Pure, test-only. A world is a few turns
 * of plain sentences from a small pool of people, foods and places, Memories rooted on those sentences (some
 * derived from earlier Memories), effects premised on the Memories, an optional mail message, an optional hard
 * rule, and a list of events to interleave with the forget job's steps.
 *
 * Markers: every sentence names a food that appears in no other sentence, so the food is that root's marker. Every
 * Memory names a place that appears nowhere else (not in any turn and not in any other Memory), so the place is that
 * Memory's own marker. A Memory derived from another also names its parent's food and place, so a derivative's text
 * carries its root's marker. The property computes what must be gone from this lineage by itself and searches every
 * output string for the forgotten markers.
 */
import fc from "fast-check";

export const NR_PEOPLE = ["Danny", "Priya", "Marco", "Leah"] as const;
/** Root markers. None is a word any template, rule or Head section uses. */
export const NR_FOODS = ["paella", "ramen", "pierogi", "gumbo", "falafel", "risotto", "bibimbap", "tamales", "goulash", "ceviche", "moussaka", "jambalaya"] as const;
/** Memory markers. */
export const NR_PLACES = ["lakeside", "rooftop", "harbor", "orchard", "meadow", "canyon", "glacier", "lagoon", "prairie", "boardwalk", "vineyard", "quarry"] as const;
export const NR_ALLERGY = "I'm allergic to shellfish.";

export interface NrSentence {
  person: string;
  food: string;
  text: string;
}

export interface NrTurn {
  /** Index into `sentences`, in the order they are said. */
  sentences: number[];
  /** A mail message rather than a spoken turn: it has a provider key and no Turn record. */
  mail: boolean;
  /** The turn opens with the shellfish sentence, which proves a hard rule. */
  allergy: boolean;
}

export interface NrMemory {
  /** The turn whose sentence roots it. */
  turn: number;
  /** The sentence (index into `sentences`) it is rooted on; always one of its turn's sentences. */
  sentence: number;
  place: string;
  /** An earlier Memory it depends on (`dependsOn: m:<id>`), or null. */
  parent: number | null;
  /** An earlier Memory its packet read as context (`contextIds`), or null. */
  context: number | null;
}

export interface NrEffect {
  premise: number;
  target: number;
  kind: "exclude" | "quiet" | "careHold" | "celebrationHold" | "attentionBoost";
}

export const NR_EVENTS = ["extract", "resync", "lostLease", "forget2", "clock", "newStatement"] as const;
export type NrEvent = (typeof NR_EVENTS)[number];

export interface NrWorld {
  sentences: NrSentence[];
  turns: NrTurn[];
  memories: NrMemory[];
  effects: NrEffect[];
  /** The Memory the first forget names. */
  target: number;
  /** A pick for the second forget's target among Memories the first forget leaves alone (taken modulo). */
  secondPick: number;
  /** The extract job a pre-fence extraction runs (taken modulo the spoken turns). */
  extractPick: number;
  /** Events, each fired before the job step with that index (steps past the end fire after the job is done). */
  events: { at: number; event: NrEvent }[];
  /** The new statement's food and place: never used elsewhere. */
  fresh: { person: string; food: string; place: string };
}

export function memoryText(w: NrWorld, i: number): string {
  const m = w.memories[i]!;
  const s = w.sentences[m.sentence]!;
  const own = `${s.person} likes ${s.food} at the ${m.place}`;
  if (m.parent === null) return own;
  const p = w.memories[m.parent]!;
  return `${own}, like ${w.sentences[p.sentence]!.food} at the ${p.place}`;
}

export function turnText(w: NrWorld, t: number): string {
  const turn = w.turns[t]!;
  return [...(turn.allergy ? [NR_ALLERGY] : []), ...turn.sentences.map((s) => w.sentences[s]!.text)].join(" ");
}

const sentenceShape = fc.record({ person: fc.constantFrom(...NR_PEOPLE), sentences: fc.integer({ min: 1, max: 2 }) });

export const nrWorldArb: fc.Arbitrary<NrWorld> = fc
  .record({
    turns: fc.array(sentenceShape, { minLength: 1, maxLength: 3 }),
    mail: fc.boolean(),
    allergyTurn: fc.option(fc.nat(), { nil: null }),
    foods: fc.shuffledSubarray([...NR_FOODS], { minLength: NR_FOODS.length, maxLength: NR_FOODS.length }),
    places: fc.shuffledSubarray([...NR_PLACES], { minLength: NR_PLACES.length, maxLength: NR_PLACES.length }),
    people: fc.array(fc.constantFrom(...NR_PEOPLE), { minLength: 8, maxLength: 8 }),
    memoryPicks: fc.array(fc.record({ sentence: fc.nat(), parent: fc.option(fc.nat(), { nil: null }), context: fc.option(fc.nat(), { nil: null }) }), { minLength: 1, maxLength: 6 }),
    effects: fc.array(fc.record({ premise: fc.nat(), target: fc.nat(), kind: fc.constantFrom("exclude" as const, "quiet" as const, "careHold" as const, "celebrationHold" as const, "attentionBoost" as const) }), { maxLength: 4 }),
    target: fc.nat(),
    secondPick: fc.nat(),
    extractPick: fc.nat(),
    events: fc.array(fc.record({ at: fc.integer({ min: 0, max: 14 }), event: fc.constantFrom(...NR_EVENTS) }), { maxLength: 6 }),
  })
  .map((g): NrWorld => {
    const turnShapes = [...g.turns, ...(g.mail ? [{ person: g.people[7]!, sentences: 1 }] : [])];
    const sentences: NrSentence[] = [];
    const turns: NrTurn[] = turnShapes.map((t, ti) => {
      const ids: number[] = [];
      for (let k = 0; k < t.sentences; k++) {
        const person = k === 0 ? t.person : g.people[(ti * 2 + k) % g.people.length]!;
        const food = g.foods[sentences.length]!;
        ids.push(sentences.length);
        sentences.push({ person, food, text: `${person} loves ${food}.` });
      }
      const mail = g.mail && ti === turnShapes.length - 1;
      return { sentences: ids, mail, allergy: !mail && g.allergyTurn !== null && g.allergyTurn % g.turns.length === ti };
    });
    const turnOf = (s: number) => turns.findIndex((t) => t.sentences.includes(s));
    const memories: NrMemory[] = g.memoryPicks.map((p, i) => {
      const sentence = p.sentence % sentences.length;
      return {
        turn: turnOf(sentence),
        sentence,
        place: g.places[i]!,
        parent: p.parent === null || i === 0 ? null : p.parent % i,
        context: p.context === null || i === 0 ? null : p.context % i,
      };
    });
    const n = memories.length;
    return {
      sentences,
      turns,
      memories,
      effects: g.effects.map((e) => ({ premise: e.premise % n, target: e.target % n, kind: e.kind })),
      target: g.target % n,
      secondPick: g.secondPick,
      extractPick: g.extractPick,
      events: [...g.events].sort((a, b) => a.at - b.at),
      fresh: { person: sentences[memories[g.target % n]!.sentence]!.person, food: g.foods[NR_FOODS.length - 1]!, place: g.places[NR_PLACES.length - 1]! },
    };
  });

/** A world as plain sentences, for a counterexample a person can read. */
export function describeWorld(w: NrWorld): string {
  const lines = w.turns.map((t, i) => `${t.mail ? "mail" : "turn"} ${i}: ${turnText(w, i)}`);
  w.memories.forEach((m, i) => lines.push(`memory ${i}${i === w.target ? " (target)" : ""}: "${memoryText(w, i)}"${m.context !== null ? ` (packet read memory ${m.context})` : ""}`));
  w.effects.forEach((e) => lines.push(`effect ${e.kind} on memory ${e.target}, premised on memory ${e.premise}`));
  lines.push(`events: ${w.events.map((e) => `${e.event}@${e.at}`).join(", ") || "none"}`);
  return lines.join("\n");
}
