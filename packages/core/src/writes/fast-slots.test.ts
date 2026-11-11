// FastSlotsV1: the request, the strict schema and the parser (design 2.2, 2.3; task A4 witnesses).
import { describe, expect, it } from "vitest";
import { PREFIX } from "../extract";
import { testId } from "../testing/samples";
import {
  FAST_SLOTS_INPUT_CAP_UNITS,
  FAST_SLOTS_INSTRUCTIONS,
  FAST_SLOTS_JSON_SCHEMA,
  FAST_SLOTS_PROMPT,
  type FastSlotsInput,
  buildFastSlots,
  fitFastSlotsInput,
  parseFastSlots,
} from "./fast-slots";

const EID = testId("evturn");
const text = "I'm allergic to shellfish.";
const input = (over: Partial<FastSlotsInput> = {}): FastSlotsInput => ({
  turn: { eid: EID, text, ownerConfirmed: false },
  lastTurns: [],
  entities: [],
  targets: [],
  pendingId: null,
  ...over,
});

const allergy = {
  kind: "allergy",
  subject: { entityId: null, mention: null, isSelf: true },
  item: "shellfish",
  severity: "allergy",
  polarity: "affirmed",
  act: "direct",
  span: { eid: EID, fieldPath: "text", start: 0, end: 25, quote: "I'm allergic to shellfish" },
};
const answer = (out: unknown) => ({ status: "completed" as const, outputText: JSON.stringify(out), refusal: null });

describe("FastSlotsV1 request", () => {
  it("starts the instructions with PREFIX and holds the contract literal verbatim", () => {
    expect(FAST_SLOTS_INSTRUCTIONS.startsWith(`${PREFIX}\n${FAST_SLOTS_PROMPT}\n\n`)).toBe(true);
    expect(FAST_SLOTS_PROMPT).toBe(
      "Current turn; context=refs. Preserve subject/act. Mondays is no allergy; denial never deletes. Correction=wrong; null=retract only. No diagnosis. Copy time words; uncertain change is not actual. Ambiguity=need. Care outside rule span.",
    );
  });

  it("builds a tool-less strict body with the model it is given", () => {
    const b = buildFastSlots("some-model", input());
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.body.model).toBe("some-model");
    expect(b.body.tools).toEqual([]);
    expect(b.body.store).toBe(false);
    expect(b.body.reasoning).toEqual({ effort: "low" });
    expect(b.body.max_output_tokens).toBe(1536);
    expect(b.body.input[0]).toEqual({ role: "developer", content: FAST_SLOTS_INSTRUCTIONS });
    expect(JSON.parse(b.body.input[1].content)).toEqual(input());
    expect(b.body.text.format).toMatchObject({ type: "json_schema", name: "fast_slots_v1", strict: true });
  });

  it("refuses an empty model or turn, and a turn over 6,000 units, without cutting it", () => {
    expect(buildFastSlots("", input())).toEqual({ ok: false, why: "invalidInput" });
    expect(buildFastSlots("m", input({ turn: { eid: EID, text: " ", ownerConfirmed: true } }))).toEqual({ ok: false, why: "invalidInput" });
    expect(buildFastSlots("m", input({ turn: { eid: EID, text: "a".repeat(6_001), ownerConfirmed: true } }))).toEqual({ ok: false, why: "oversize" });
  });

  it("trims targets, then entities, then the oldest turns to the input cap, and never the turn", () => {
    const long = "x".repeat(590);
    const big = input({
      turn: { eid: EID, text: "y".repeat(6_000), ownerConfirmed: true },
      lastTurns: [0, 1, 2, 3, 4].map((i) => ({ eid: testId(`ev${i}`), role: "user" as const, text: long })),
      entities: Array.from({ length: 20 }, (_, i) => ({ id: testId(`ent${i}`), label: `Person ${i}`, aliases: ["a", "b", "c", "d", "e"] })),
      targets: Array.from({ length: 20 }, (_, i) => ({ id: testId(`m${i}`), predicate: "fact", value: { kind: "text", text: long }, args: {}, line: long })),
    });
    const fit = fitFastSlotsInput(big);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(JSON.stringify(fit.input).length).toBeLessThanOrEqual(FAST_SLOTS_INPUT_CAP_UNITS);
    expect(fit.input.turn.text.length).toBe(6_000);
    expect(fit.input.lastTurns.length).toBeLessThanOrEqual(4);
    expect(fit.input.entities.length).toBeLessThanOrEqual(16);
    expect(fit.input.entities.every((e) => e.aliases.length <= 4)).toBe(true);
    // Targets go first.
    expect(fit.input.targets.length).toBeLessThan(16);
  });

  it("gives a strict schema: closed objects, every key required", () => {
    const walk = (s: unknown): void => {
      if (Array.isArray(s)) return s.forEach(walk);
      if (typeof s !== "object" || s === null) return;
      const o = s as Record<string, unknown>;
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(FAST_SLOTS_JSON_SCHEMA);
    expect((FAST_SLOTS_JSON_SCHEMA.properties as { items: { maxItems: number } }).items.maxItems).toBe(8);
  });
});

describe("FastSlotsV1 parser", () => {
  it("accepts a valid answer and an empty one", () => {
    expect(parseFastSlots(answer({ items: [allergy], need: "none" }), 40)).toEqual({ kind: "valid", out: { items: [allergy], need: "none" }, ms: 40 });
    expect(parseFastSlots(answer({ items: [], need: "meaning" }), 1)).toMatchObject({ kind: "valid" });
  });

  it("rejects a refusal, an incomplete answer, no text and text that isn't JSON", () => {
    expect(parseFastSlots({ status: "completed", outputText: "{}", refusal: "no" }, 3)).toEqual({ kind: "invalid", reason: "refusal", path: null, ms: 3 });
    expect(parseFastSlots({ status: "incomplete", outputText: "{}", refusal: null }, 3)).toMatchObject({ reason: "incomplete" });
    expect(parseFastSlots({ status: "completed", outputText: null, refusal: null }, 3)).toMatchObject({ reason: "empty" });
    expect(parseFastSlots({ status: "completed", outputText: "{items:", refusal: null }, 3)).toMatchObject({ reason: "notJson" });
  });

  it("rejects an extra field and a missing one with its path", () => {
    expect(parseFastSlots(answer({ items: [{ ...allergy, extra: 1 }], need: "none" }), 0)).toEqual({ kind: "invalid", reason: "shape", path: "$.items[0].extra", ms: 0 });
    const { severity: _, ...missing } = allergy;
    expect(parseFastSlots(answer({ items: [missing], need: "none" }), 0)).toEqual({ kind: "invalid", reason: "shape", path: "$.items[0].severity", ms: 0 });
    expect(parseFastSlots(answer({ items: [] }), 0)).toMatchObject({ reason: "shape", path: "$.need" });
  });

  it("never cuts a string past its bound", () => {
    expect(parseFastSlots(answer({ items: [{ ...allergy, item: "x".repeat(81) }], need: "none" }), 0)).toMatchObject({ reason: "shape", path: "$.items[0].item" });
  });

  it("rejects more than 8 items", () => {
    expect(parseFastSlots(answer({ items: Array.from({ length: 9 }, () => allergy), need: "none" }), 0)).toEqual({ kind: "invalid", reason: "tooMany", path: "$.items", ms: 0 });
  });
});
