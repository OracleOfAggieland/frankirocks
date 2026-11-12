// Feature: what a call puts on the screen (brief 044), Property: only two taps exist.
// `/api/turn` takes a trusted tap only for `company` and `alone`, with no text and no target IDs. For any control
// verb other than those two, on any source, and for any trustedTap that carries text, targets, items or a control
// other than those two, the turn is refused (400) and nothing is written: the store is byte-for-byte the same.
import { ControlVerb } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { doorRig } from "../testing/audience-doors";
import { callRoute } from "../testing/fakes";
import { typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

/** Every ControlVerb on the wire (`schema/wire.ts`); each is checked against the schema below. */
const VERBS = ["forget", "quiet", "correct", "company", "alone", "wrong", "deleteRule", "restore"] as const;
for (const v of VERBS) if (ControlVerb.check(v, "verb") !== null) throw new Error(`not a ControlVerb: ${v}`);

const arbBad = fc.oneof(
  // Any other verb, on any source, with or without targets and text.
  fc.record({
    verb: fc.constantFrom(...VERBS.filter((v) => v !== "company" && v !== "alone")),
    source: fc.constantFrom("asr", "typed", "chip", "pasted", "trustedTap"),
    text: fc.constantFrom("", "my boss just walked in"),
    targets: fc.nat({ max: 2 }),
    items: fc.constant(0),
  }),
  // One of the two taps, carrying text, targets or items.
  fc
    .record({
      verb: fc.constantFrom("company", "alone"),
      source: fc.constant("trustedTap"),
      text: fc.constantFrom("", "x", "someone walked in"),
      targets: fc.nat({ max: 2 }),
      items: fc.nat({ max: 1 }),
    })
    .filter((b) => b.text !== "" || b.targets > 0 || b.items > 0),
  // A trusted tap with no control at all, and a company or alone control on any other source.
  fc.record({ verb: fc.constant(null), source: fc.constant("trustedTap"), text: fc.constantFrom("", "hi"), targets: fc.constant(0), items: fc.constant(0) }),
  fc.record({ verb: fc.constantFrom("company", "alone"), source: fc.constantFrom("asr", "typed", "chip", "pasted"), text: fc.constantFrom("", "hi"), targets: fc.constant(0), items: fc.constant(0) }),
);

describe("Property: only two taps exist", () => {
  it("every other control, and a tap with text, targets or items, is refused and writes nothing", async () => {
    const { rig, s } = await doorRig(false);
    const docs = (rig.store as unknown as { docs: Map<string, unknown> }).docs;
    const stored = () => JSON.stringify([...docs.entries()]);
    let n = 0;
    await fc.assert(
      fc.asyncProperty(arbBad, async (b) => {
        n += 1;
        const before = stored();
        const body = {
          ...typedTurn(s.stamp, 1, b.text, `bad${n}`),
          source: b.source,
          items: Array.from({ length: b.items }, (_, i) => ({ itemId: `item_bad${n}_${i}`, commitSeq: 1, final: true, audioEndOpsAt: "2026-11-03T12:00:00.000Z", audioDurationMs: 800 })),
          uiControl: b.verb === null ? null : { verb: b.verb, targetIds: Array.from({ length: b.targets }, (_, i) => testId(`target${i}`)) },
        };
        const res = await callRoute(rig, turnRoute, body);
        expect(res.status, JSON.stringify(b)).toBe(400);
        expect(stored()).toBe(before);
      }),
      { numRuns: 1_000 },
    );
  }, 300_000);
});
