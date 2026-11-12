/**
 * Generators for the forget properties (brief 021). Pure, test-only. A store is one turn's Evidence built from
 * whole sentences, hard rules proved by its allergy sentences, Memories rooted on its sentences, and effects
 * premised on those Memories. A forget names some Memories and some extra ranges.
 */
import fc from "fast-check";
import { type Hasher, canonicalJSON, rootKey } from "../../ids";
import { buildSlice } from "../../slices";
import type { EID, ID, Ref, Span } from "../../schema/primitives";
import type { CoreRules, Effect, Evidence, Memory } from "../../schema/records";
import { T0, UID, sampleCoreDocs, sampleEffect, sampleEvidence, sampleMemory, testId } from "../../testing/samples";
import { lookupAllergen } from "../../writes/gazetteer";
import type { InstallInput } from "../install";
import type { AllergyRule, RosterEntry } from "../reanchor";

function fnv(bytes: Uint8Array, seed: number): string {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** A deterministic Hasher for tests (the same construction as the voice tests' `testHasher`). */
export const forgetHasher: Hasher = {
  sha256: (bytes) => [1, 2, 3, 4, 5, 6, 7, 8].map((s) => fnv(bytes, s)).join(""),
  id: (parts) => {
    const bytes = new TextEncoder().encode(canonicalJSON(parts));
    return `t${[1, 2, 3, 4, 5, 6].map((s) => fnv(bytes, s)).join("").slice(0, 42)}`;
  },
};

export const BROTHER: EID = testId("brother");
export const ANA: EID = testId("ana");
export const ROSTER: RosterEntry[] = [
  { id: BROTHER, names: ["brother"] },
  { id: ANA, names: ["Ana"] },
];

/** Allergy sentences: text, the subject, and the proof's offsets inside the sentence (null: the whole sentence). */
export const ALLERGY_SENTENCES: { text: string; subject: EID | null; proof: [number, number] | null }[] = [
  { text: "I'm allergic to shellfish.", subject: "self", proof: null },
  { text: "I am allergic to peanuts.", subject: "self", proof: [0, 24] },
  { text: "My brother is allergic to eggs.", subject: BROTHER, proof: null },
  { text: "Ana is allergic to milk.", subject: ANA, proof: null },
  { text: "Someone here is allergic to sesame.", subject: null, proof: null },
  // The subject is not literal in the proof span: the rule must go pending if this sentence is re-anchored.
  { text: "She is allergic to soy, my sister.", subject: BROTHER, proof: [0, 22] },
];

export const OTHER_SENTENCES = [
  "Danny relapsed.",
  "I'm moving to Austin unless my brother relapses.",
  "We went to Thai Basil again!",
  "Work was long today.",
  "Is the dentist on Friday?",
  "My sister is not coming.",
];

export const EID_A: ID = testId("evA");
export const EID_B: ID = testId("evB");
export const FISH = "I'm allergic to fish.";

export interface SentenceAt {
  start: number;
  end: number;
  allergy: number | null;
}

export interface ForgetStore {
  text: string;
  sentences: SentenceAt[];
  input: InstallInput;
  /** Memories not named by the forget. */
  others: { id: ID; memory: Memory }[];
}

const sentencePick = fc.oneof(
  fc.integer({ min: 0, max: ALLERGY_SENTENCES.length - 1 }).map((i) => ({ allergy: i as number | null, text: ALLERGY_SENTENCES[i]!.text })),
  fc.integer({ min: 0, max: OTHER_SENTENCES.length - 1 }).map((i) => ({ allergy: null as number | null, text: OTHER_SENTENCES[i]! })),
);

export function evidenceOf(eid: ID, text: string, hasher: Hasher): Evidence {
  return sampleEvidence({
    epoch: 2,
    policyRev: 2,
    text: { kind: "inline", text },
    fieldSlices: [buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "U", sens: "S0" }, hasher)],
  });
}

export function memoryOn(eid: ID, text: string, start: number, end: number, label: string, hasher: Hasher, status: Memory["status"] = "active"): Memory {
  const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start, end, class: "U", sens: "S0" }, hasher);
  return sampleMemory({
    epoch: 2,
    policyRev: 2,
    logicalId: testId(`log-${label}`),
    key: testId(`key-${label}`),
    rootSlices: [slice],
    rootKeys: [rootKey(slice, hasher)],
    packetEids: [eid],
    dependsOn: [`e:${eid}`],
    status,
  });
}

function ruleOn(eid: ID, text: string, s: SentenceAt, index: number, hasher: Hasher): AllergyRule {
  const a = ALLERGY_SENTENCES[s.allergy!]!;
  const [ps, pe] = a.proof === null ? [0, a.text.length] : a.proof;
  const start = s.start + ps;
  const end = s.start + pe;
  const quote = text.slice(start, end);
  const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start, end, class: "U", sens: "S0" }, hasher);
  return {
    id: testId(`rule${index}`),
    subjectId: a.subject,
    code: lookupAllergen(quote)[0]!,
    state: "active",
    anonymous: a.subject === null,
    proof: { eid, fieldPath: "text", start, end, quote },
    proofRev: 1,
    rootKeys: [rootKey(slice, hasher)],
    dependsOn: [`e:${eid}`],
  };
}

/** Sentences joined by a space or a line break, with their offsets. */
export const textArb = fc
  .tuple(fc.array(sentencePick, { minLength: 1, maxLength: 6 }), fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }))
  .map(([picks, breaks]) => {
    let text = "";
    const sentences: SentenceAt[] = [];
    picks.forEach((p, i) => {
      if (i > 0) text += breaks[i]! ? "\n" : " ";
      sentences.push({ start: text.length, end: text.length + p.text.length, allergy: p.allergy });
      text += p.text;
    });
    return { text, sentences };
  });

export const rangeIn = (len: number) =>
  fc.tuple(fc.integer({ min: 0, max: len }), fc.integer({ min: 0, max: 12 })).map(([s, w]) => ({ start: s, end: Math.min(len, s + w) }));

const ref = (m: { id: ID; memory: Memory }): Ref => ({ type: "memory", id: m.id, rev: m.memory.rev });

export const forgetStoreArb: fc.Arbitrary<ForgetStore> = fc
  .tuple(
    textArb,
    fc.array(fc.nat(), { minLength: 0, maxLength: 4 }),
    fc.array(fc.nat(), { minLength: 0, maxLength: 3 }),
    fc.array(fc.tuple(fc.nat(), fc.nat(), fc.constantFrom("exclude" as const, "quiet" as const, "careHold" as const, "celebrationHold" as const), fc.boolean()), { maxLength: 6 }),
    fc.boolean(),
    fc.array(fc.nat(), { maxLength: 2 }),
  )
  .chain(([t, memoryPicks, targetPicks, effectPicks, uncommitted, wrongPicks]) =>
    fc.array(rangeIn(t.text.length), { maxLength: 3 }).map((ranges): ForgetStore => {
      const hasher = forgetHasher;
      const { text, sentences } = t;
      const evidence = new Map<ID, Evidence>([
        [EID_A, evidenceOf(EID_A, text, hasher)],
        [EID_B, evidenceOf(EID_B, FISH, hasher)],
      ]);
      const memories: { id: ID; memory: Memory }[] = sentences.map((s, i) => ({ id: testId(`m${i}`), memory: memoryOn(EID_A, text, s.start, s.end, `m${i}`, hasher) }));
      memoryPicks.forEach((p, k) => {
        const s = sentences[p % sentences.length]!;
        memories.push({ id: testId(`x${k}`), memory: memoryOn(EID_A, text, s.start, s.end, `x${k}`, hasher) });
      });
      wrongPicks.forEach((p, k) => {
        const s = sentences[p % sentences.length]!;
        memories.push({ id: testId(`w${k}`), memory: memoryOn(EID_A, text, s.start, s.end, `w${k}`, hasher, "wrong") });
      });
      const targetIdx = new Set(targetPicks.map((p) => p % memories.length));
      const targets = memories.filter((_, i) => targetIdx.has(i));
      const others = memories.filter((_, i) => !targetIdx.has(i));
      const allergyRules = sentences.flatMap((s, i) => (s.allergy === null ? [] : [ruleOn(EID_A, text, s, i, hasher)]));
      const fishSlice = buildSlice({ eid: EID_B, fieldPath: "text", fieldText: FISH, start: 0, end: FISH.length, class: "U", sens: "S0" }, hasher);
      allergyRules.push({
        id: testId("ruleB"),
        subjectId: "self",
        code: lookupAllergen(FISH)[0]!,
        state: "active",
        anonymous: false,
        proof: { eid: EID_B, fieldPath: "text", start: 0, end: FISH.length, quote: FISH },
        proofRev: 1,
        rootKeys: [rootKey(fishSlice, hasher)],
        dependsOn: [`e:${EID_B}`],
      });
      const rules: CoreRules = { ...sampleCoreDocs().rules, epoch: 2, policyRev: 2, allergies: allergyRules, noneConfirmed: ["self"] };
      const effects = effectPicks.map(([a, b, kind, onTarget], k) => {
        const pool = onTarget && targets.length > 0 ? targets : others.length > 0 ? others : memories;
        const premise = pool[a % pool.length]!;
        const target = memories[b % memories.length]!;
        const effect: Effect = sampleEffect({ epoch: 2, policyRev: 2, kind, premiseIds: [ref(premise)], target: ref(target), minSens: k % 2 === 0 ? "S1" : "S0" });
        return { id: testId(`ef${k}`), effect };
      });
      const remove: Span[] = ranges.map((r) => ({ eid: EID_A, fieldPath: "text" as const, start: r.start, end: r.end, quote: text.slice(r.start, r.end) }));
      const input: InstallInput = {
        uid: UID,
        opId: testId("op"),
        stamps: { epoch: 3, policyRev: 3 },
        now: T0,
        targets,
        review: [],
        remove,
        evidence,
        effects,
        rules,
        roster: ROSTER,
        uncommittedAtFence: uncommitted,
        hasher,
      };
      return { text, sentences, input, others };
    }),
  );

export const memoryRef = ref;
