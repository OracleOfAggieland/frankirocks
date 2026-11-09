/**
 * Authority property (R23.1, R23.2, R23.11, R23.12; KC04). 500 runs. FOR ALL Evidence split into U, T and M
 * Slices and generated Items with spans anywhere in it:
 *   - a planned Memory is `sourceClass:"U"` and `active` only if every span sits inside one U Slice;
 *   - a Memory rooted in T or M is never `active` or `scheduled`;
 *   - T or M never promotes allergy, identity.*, person.life, care or preference.*.
 * Planning is pure (`planItem`), so this runs on the exact code the extractor commits from.
 */
import { type Evidence, type Slice, buildSlice, planItem } from "@franki/core";
import { sampleEvidence, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { factItem } from "../testing/extract-fixtures";
import { FAKE_HMAC_KEY } from "../testing/fakes";

const hasher = createHasher(FAKE_HMAC_KEY);
const EID = testId("ev");
const TEXT = "I like tea. From: boss she says you owe money. maybe you like jazz";

const PREDICATES = [
  { predicate: "fact", kind: "fact", value: { kind: "text", text: "x" }, args: { topic: "other", label: null } },
  { predicate: "goal", kind: "goal", value: { kind: "text", text: "x" }, args: { domain: "work" } },
  { predicate: "identity.name", kind: "fact", value: { kind: "text", text: "x" }, args: {} },
  { predicate: "person.life", kind: "fact", value: { kind: "enum", code: "ill" }, args: { detail: null } },
  { predicate: "preference.food", kind: "preference", value: { kind: "enum", code: "like" }, args: { dimension: "dish", targetRef: null } },
  { predicate: "care", kind: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: "self", topic: "x" } },
] as const;

/** Three cut points split TEXT into slices with generated classes; any gap is unclassified (M by default). */
const layoutArb = fc.record({
  cuts: fc.uniqueArray(fc.integer({ min: 1, max: TEXT.length - 1 }), { minLength: 0, maxLength: 3 }).map((c) => [...c].sort((a, b) => a - b)),
  classes: fc.array(fc.constantFrom("U", "T", "M"), { minLength: 4, maxLength: 4 }),
});

const itemArb = fc.record({
  shape: fc.constantFrom(...PREDICATES),
  act: fc.constantFrom("statement", "intention", "soft_pref", "promise_mine"),
  spans: fc.array(
    fc.tuple(fc.integer({ min: 0, max: TEXT.length }), fc.integer({ min: 0, max: TEXT.length })).map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const),
    { minLength: 1, maxLength: 4 },
  ),
});

function evidenceFor(layout: { cuts: number[]; classes: string[] }): Evidence {
  const bounds = [0, ...layout.cuts, TEXT.length];
  const fieldSlices: Slice[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    fieldSlices.push(
      buildSlice({ eid: EID, fieldPath: "text", fieldText: TEXT, start: bounds[i]!, end: bounds[i + 1]!, class: layout.classes[i] as Slice["class"], sens: "S0" }, hasher),
    );
  }
  return sampleEvidence({ text: { kind: "inline", text: TEXT }, fieldSlices });
}

describe("extract authority property", () => {
  it("T and M never write active or scheduled", () => {
    const seen = { u: 0, tm: 0 };
    fc.assert(
      fc.property(layoutArb, itemArb, (layout, gen) => {
        const evidence = evidenceFor(layout);
        const spans = gen.spans.map(([s, e]) => ({ eid: EID, fieldPath: "text" as const, start: s, end: e, quote: TEXT.slice(s, e) }));
        const item = { ...factItem(gen.act, "new", "x", spans), predicate: gen.shape.predicate, kind: gen.shape.kind, value: gen.shape.value, args: gen.shape.args };
        const plan = planItem(item, 0, {
          uid: "owner-1",
          jobId: testId("job"),
          packet: new Map([[EID, { evidence, fields: ["text"] }]]),
          hasher,
          worldNow: "2026-11-03T12:00:00.000Z",
          opsNow: "2026-11-03T12:00:00.000Z",
          nextReviewAt: "2027-11-03T12:00:00.000Z",
          epoch: 1,
          policyRev: 1,
        });
        const inU = (s: number, e: number) => evidence.fieldSlices.some((sl) => sl.class === "U" && sl.start! <= s && e <= sl.end!);
        const allU = spans.every((sp) => inU(sp.start, sp.end));
        if (plan.kind !== "memory") return;
        const m = plan.memory;
        seen[m.sourceClass === "U" ? "u" : "tm"]++;
        if (m.sourceClass === "U") expect(allU).toBe(true);
        if (!allU) expect(m.sourceClass).not.toBe("U");
        if (m.sourceClass === "T" || m.sourceClass === "M") {
          expect(m.status).not.toBe("active");
          expect(m.status).not.toBe("scheduled");
          const p = m.predicate;
          expect(p === "allergy" || p.startsWith("identity.") || p === "person.life" || p === "care" || p.startsWith("preference.")).toBe(false);
        }
        if (m.status === "active") expect(m.sourceClass).toBe("U");
      }),
      { numRuns: 500 },
    );
    // Not vacuous: both U-rooted and T/M-rooted Memories were planned and checked.
    expect(seen.u).toBeGreaterThan(10);
    expect(seen.tm).toBeGreaterThan(10);
  });
});
