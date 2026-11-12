/**
 * Generators for brief 039's food properties: stored diets, dislikes and allergy rules on any subject, at any world
 * time. The truth each case carries (which diet is live, which ingredient a dislike names) comes from the
 * generator, never from the product's reader.
 */
import fc from "fast-check";
import { tsFromMs } from "../../schema/primitives";
import type { Memory } from "../../schema/records";
import { sampleMemory, testId } from "../../testing/samples";
import type { FoodRule } from "../filter";
import { INGREDIENTS } from "../ingredients";
import { ORACLE_FOOD_CODES } from "./allergen-oracle";

export const ZONE = "America/Chicago";
export const OTHER = testId("sam");
export const AT_MIN = Date.UTC(2026, 0, 1);
export const AT_MAX = Date.UTC(2027, 0, 1);
const DAY = 86_400_000;

export interface DietCase {
  memory: { id: string; memory: Memory };
  code: string;
  subjectId: string;
  active: boolean;
  validFrom: number;
  validTo: number | null;
}

export interface DislikeCase {
  memory: { id: string; memory: Memory };
  /** The ingredient the words name, or null for words that name nothing in the table. */
  ingredientId: string | null;
  words: string;
  subjectId: string;
  counts: boolean;
}

export interface PrefCase {
  at: number;
  diets: DietCase[];
  dislikes: DislikeCase[];
  rules: FoodRule[];
}

const subject = fc.constantFrom("self", "self", OTHER);

const dietArb = (at: number) =>
  fc
    .record({
      n: fc.nat(1_000_000),
      code: fc.oneof({ weight: 6, arbitrary: fc.constantFrom("vegetarian", "vegan", "pescatarian") }, { weight: 1, arbitrary: fc.constantFrom("avoid", "prefer", "like") }),
      subjectId: subject,
      active: fc.constantFrom(true, true, false),
      fromAgo: fc.integer({ min: -3, max: 60 }),
      to: fc.oneof(fc.constant(null), fc.integer({ min: -40, max: 40 })),
      spoken: fc.constantFrom("this month", "this week", "for two weeks", "this year", "in march"),
    })
    .map(({ n, code, subjectId, active, fromAgo, to, spoken }): DietCase => {
      const validFrom = at - fromAgo * DAY;
      const validTo = to === null ? null : Math.max(validFrom + 1, at + to * DAY);
      const id = testId(`diet${n}`);
      const memory = sampleMemory({
        logicalId: id,
        kind: "preference",
        subjectId,
        predicate: "preference.food",
        value: { kind: "enum", code },
        args: { dimension: "diet", targetRef: null },
        status: active ? "active" : "history",
        assertedAt: tsFromMs(validFrom),
        validFrom: tsFromMs(validFrom),
        validTo: validTo === null ? null : tsFromMs(validTo),
        when: { kind: "spoken", spoken },
      });
      return { memory: { id, memory }, code, subjectId, active, validFrom, validTo };
    });

const PLAIN = ["I can't stand", "I hate", "please no", "I really dislike"];

const dislikeArb = fc
  .record({
    n: fc.nat(1_000_000),
    ing: fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...INGREDIENTS.map((i) => i.id)) }, { weight: 1, arbitrary: fc.constant(null) }),
    lead: fc.constantFrom(...PLAIN),
    subjectId: subject,
    sens: fc.constantFrom<"S0" | "S1">("S0", "S0", "S0", "S1"),
    cls: fc.constantFrom<"U" | "C" | "O">("U", "U", "C", "O"),
    code: fc.constantFrom("dislike", "avoid"),
  })
  .map(({ n, ing, lead, subjectId, sens, cls, code }): DislikeCase => {
    const label = ing === null ? "jazz music" : INGREDIENTS.find((i) => i.id === ing)!.label;
    const words = `${lead} ${label}`;
    const id = testId(`dislike${n}`);
    const memory = sampleMemory({
      logicalId: id,
      kind: "preference",
      subjectId,
      predicate: "preference.food",
      value: { kind: "enum", code },
      args: { dimension: "ingredient", targetRef: null },
      sens,
      sourceClass: cls,
      validFrom: tsFromMs(AT_MIN - 10 * DAY),
    });
    return { memory: { id, memory }, ingredientId: ing, words, subjectId, counts: sens === "S0" && cls !== "O" };
  });

const ruleArb: fc.Arbitrary<FoodRule> = fc
  .record({ n: fc.nat(1_000_000), subjectId: fc.constantFrom<string | null>("self", OTHER, null), code: fc.constantFrom(...ORACLE_FOOD_CODES), state: fc.constantFrom<"active" | "pending">("active", "pending") })
  .map(({ n, subjectId, code, state }) => ({ id: testId(`r${n}`), subjectId, code, state, anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] }));

export const prefCaseArb: fc.Arbitrary<PrefCase> = fc.integer({ min: AT_MIN, max: AT_MAX }).chain((at) =>
  fc.record({
    at: fc.constant(at),
    diets: fc.uniqueArray(dietArb(at), { maxLength: 3, selector: (d) => d.memory.id }),
    dislikes: fc.uniqueArray(dislikeArb, { maxLength: 4, selector: (d) => d.memory.id }),
    rules: fc.array(ruleArb, { maxLength: 3 }),
  }),
);

/** The words each case's Memory rests on, as the server reads them from its root Slices. */
export const wordsOfCase = (c: PrefCase) => {
  const words = new Map(c.dislikes.map((d) => [d.memory.id, d.words]));
  return (m: Memory) => words.get(m.logicalId) ?? "";
};

export const memoriesOf = (c: PrefCase) => [...c.diets.map((d) => d.memory), ...c.dislikes.map((d) => d.memory)];
