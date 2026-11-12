// Review 028, finding 9: the words for a `why` root come from copy.ts, keyed by the Evidence kind code.
import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { sourceLabel } from "./memory-screen";

describe("sourceLabel", () => {
  it("words each Evidence kind code from copy", () => {
    expect(sourceLabel("turn")).toBe(COPY.memory.sources.turn);
    expect(sourceLabel("message")).toBe(COPY.memory.sources.message);
  });

  it("words an unknown code neutrally, never echoing it", () => {
    expect(sourceLabel("somethingNew")).toBe(COPY.memory.sources.other);
  });
});
