import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../client/api";
import type { BrowserClock } from "../client/clock";
import { TypedTurns } from "../client/typed-turns";
import type { CardProps, KnownItem, TurnCopies } from "./surface-props";
import { clearTurnCopies } from "./turn-copies";

const arbCard: fc.Arbitrary<CardProps> = fc.record({ id: fc.string(), title: fc.string(), lines: fc.array(fc.string()) }).map(
  ({ id, title, lines }) => ({ kind: "read", id, title, lines, sources: [], onOpenSource: () => {} }),
);
const arbItem: fc.Arbitrary<KnownItem> = fc.record({
  id: fc.string(),
  area: fc.constantFrom("Time and work", "Food and health", "Money", "People", "Goals" as const),
  text: fc.string(),
  from: fc.string(),
  guessed: fc.boolean(),
  hardRule: fc.boolean(),
});
const arbCopies: fc.Arbitrary<TurnCopies> = fc.record({
  reply: fc.option(fc.string()),
  caption: fc.option(fc.record({ id: fc.string(), text: fc.string() })),
  typedText: fc.string(),
  cards: fc.array(arbCard, { maxLength: 5 }),
  jarItems: fc.array(arbItem, { maxLength: 8 }),
});

// Feature: lab-ui-foundation, Property 20: Forget clears every turn copy
describe("Property 20: Forget clears every turn copy", () => {
  it("clearTurnCopies leaves no reply, caption, typed text, card or jar item", () => {
    fc.assert(
      fc.property(arbCopies, (copies) => {
        expect(clearTurnCopies(copies)).toEqual({ reply: null, caption: null, typedText: "", cards: [], jarItems: [] });
      }),
      { numRuns: 200 },
    );
  });

  it("dropTurnCopies leaves no typed entry and no text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ key: fc.string(), role: fc.constantFrom("user", "franki" as const), text: fc.string() }), { maxLength: 20 }),
        fc.string(),
        (entries, text) => {
          const turns = new TypedTurns({ api: {} as ApiClient, clock: {} as BrowserClock });
          (turns as unknown as { state: { entries: unknown[] } }).state.entries = entries;
          turns.setText(text);
          turns.dropTurnCopies();
          expect(turns.getSnapshot().entries).toEqual([]);
          expect(turns.getSnapshot().text).toBe("");
        },
      ),
      { numRuns: 200 },
    );
  });
});
