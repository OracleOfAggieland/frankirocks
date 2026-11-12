// Brief 039: diets and dislikes in suggest(food), the pure half.
import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import { sampleMemory, testId } from "../testing/samples";
import { CATALOG } from "./catalog";
import { DIETS, dietEndedLine, filterPrefs, foodPrefsOf, keepsDiet, namedIngredientIds, readDietAnswer } from "./prefs";
import { ingredient } from "./ingredients";
import { suggestFood } from "./suggest";

const ZONE = "America/Chicago";
const NOV_5 = Date.UTC(2026, 10, 5, 18);
const DEC_2 = Date.UTC(2026, 11, 2, 18);
const DEC_1_CHICAGO = Date.UTC(2026, 11, 1, 6);

const diet = (code: string, validTo: number | null, subjectId = "self", spoken = "this month") => ({
  id: testId(`d-${code}-${subjectId}`),
  memory: sampleMemory({
    logicalId: testId(`d-${code}-${subjectId}`),
    kind: "preference",
    subjectId,
    predicate: "preference.food",
    value: { kind: "enum", code },
    args: { dimension: "diet", targetRef: null },
    validFrom: tsFromMs(NOV_5),
    assertedAt: tsFromMs(NOV_5),
    validTo: validTo === null ? null : tsFromMs(validTo),
    when: { kind: "spoken", spoken },
  }),
});
const dislike = (words: string, extra: Partial<Parameters<typeof sampleMemory>[0]> = {}) => ({
  id: testId(`x-${words}`),
  memory: sampleMemory({ logicalId: testId(`x-${words}`), kind: "preference", predicate: "preference.food", value: { kind: "enum", code: "dislike" }, args: { dimension: "ingredient", targetRef: null }, ...extra }),
  words,
});

function prefsAt(at: number, ms: ({ id: string; memory: ReturnType<typeof sampleMemory>; words?: string })[], applies: (s: string) => boolean = (s) => s === "self") {
  const words = new Map(ms.map((m) => [m.memory.logicalId, m.words ?? ""]));
  return foodPrefsOf({ memories: ms, at, zone: ZONE, applies, wordsOf: (m) => words.get(m.logicalId) ?? "" });
}

describe("a vegetarian is offered no meat, poultry or fish (Friend Test 2)", () => {
  it("vegetarian this month: no chicken quesadillas, and what is offered keeps the diet", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(NOV_5, [diet("vegetarian", DEC_1_CHICAGO)]) });
    expect(out.candidates.map((c) => c.id)).not.toContain("chicken_quesadillas");
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates) for (const id of c.ingredientIds) expect(keepsDiet("vegetarian", ingredient(id))).toBe(true);
    expect(out.question).toBeNull();
  });

  it("a removed dinner is simply absent; its reason is a code", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(NOV_5, [diet("vegetarian", null)]) });
    expect(out.prefs.find((r) => r.id === "chicken_quesadillas")).toEqual({ id: "chicken_quesadillas", reason: "diet" });
    expect(out.reason?.text ?? "").not.toMatch(/vegetarian|diet/i);
  });

  it("each known diet leaves out its kinds; a varies food or unknown kinds keep no diet", () => {
    expect(keepsDiet("pescatarian", ingredient("salmon_fillet"))).toBe(true);
    expect(keepsDiet("vegetarian", ingredient("salmon_fillet"))).toBe(false);
    expect(keepsDiet("vegan", ingredient("egg"))).toBe(false);
    expect(keepsDiet("vegetarian", ingredient("egg"))).toBe(true);
    expect(keepsDiet("vegetarian", ingredient("cheddar"))).toBe(false);
    expect(keepsDiet("vegetarian", ingredient("curry_paste"))).toBe(false);
    expect(keepsDiet("vegan", null)).toBe(false);
    expect(Object.keys(DIETS)).toEqual(["vegetarian", "vegan", "pescatarian"]);
  });

  it("a diet code isn't known: it removes nothing and asks", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(NOV_5, [diet("avoid", null)]) });
    expect(out.prefs).toEqual([]);
    expect(out.question).toBe("What does your diet leave out?");
  });
});

describe("a month ends: the question, and neutral until answered", () => {
  it("after November, suggest asks first and still offers only vegetarian dinners", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(DEC_2, [diet("vegetarian", DEC_1_CHICAGO)]) });
    expect(out.question).toBe("Still vegetarian, or was November it?");
    for (const c of out.candidates) for (const id of c.ingredientIds) expect(keepsDiet("vegetarian", ingredient(id))).toBe(true);
  });

  it("the line names the period: a month, a year, or 'that'", () => {
    expect(dietEndedLine("vegan", { kind: "year", month: 12, year: 2026 })).toBe("Still vegan, or was 2026 it?");
    expect(dietEndedLine("vegetarian", { kind: "week", month: 11, year: 2026 })).toBe("Still vegetarian, or was that it?");
  });

  it("someone else's ended diet still filters when they're named, and is never asked about", () => {
    const sam = testId("sam");
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(DEC_2, [diet("vegetarian", DEC_1_CHICAGO, sam)], () => true) });
    expect(out.question).toBeNull();
    expect(out.candidates.map((c) => c.id)).not.toContain("chicken_quesadillas");
  });

  it("the answer is read from a closed list; a bare yes or no is unclear", () => {
    const nov = { kind: "month" as const, month: 11, year: 2026 };
    for (const t of ["Yes, still", "still vegetarian", "Yeah, I'm still vegetarian.", "I still am"]) expect(readDietAnswer(t, "vegetarian", nov), t).toBe("still");
    for (const t of ["No, that was November", "That was November.", "nope, not anymore", "just November", "No, that was it"]) expect(readDietAnswer(t, "vegetarian", nov), t).toBe("ended");
    for (const t of ["yes", "no", "maybe", "still thinking about it", "No, that was October", "yes still vegan"]) expect(readDietAnswer(t, "vegetarian", nov), t).toBe("unclear");
  });
});

describe("dislikes (Friend Test 11)", () => {
  it("'I hate mushrooms' takes the mushroom omelet away", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(NOV_5, [dislike("I hate mushrooms")]) });
    expect(out.candidates.map((c) => c.id)).not.toContain("veggie_omelet");
    expect(out.prefs).toContainEqual({ id: "veggie_omelet", reason: "dislike" });
  });

  it("words that name nothing in the table remove nothing", () => {
    expect(namedIngredientIds("I hate jazz")).toEqual([]);
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: prefsAt(NOV_5, [dislike("I love Thai food")]) });
    expect(out.prefs).toEqual([]);
  });

  it("only an S0 dislike in the owner's own or confirmed words counts", () => {
    expect(prefsAt(NOV_5, [dislike("I hate mushrooms", { sens: "S1" })]).dislikes).toEqual([]);
    expect(prefsAt(NOV_5, [dislike("I hate mushrooms", { sourceClass: "O" })]).dislikes).toEqual([]);
    expect(prefsAt(NOV_5, [dislike("I hate mushrooms", { sourceClass: "C" })]).dislikes).toHaveLength(1);
  });

  it("fewer than three left means fewer offered, never a disliked one put back", () => {
    const all = filterPrefs(CATALOG, { diets: [], dislikes: [{ memoryId: "m", subjectId: "self", ingredientIds: ["rice", "egg", "olive_oil", "garlic"] }] });
    const out = suggestFood({ rules: [], attendeeIds: [], prefs: { diets: [], dislikes: [{ memoryId: "m", subjectId: "self", ingredientIds: ["rice", "egg", "olive_oil", "garlic"] }] } });
    expect(out.candidates.length).toBeLessThanOrEqual(Math.min(3, all.kept.length));
    for (const c of out.candidates) expect(c.ingredientIds.some((i) => ["rice", "egg", "olive_oil", "garlic"].includes(i))).toBe(false);
  });
});
