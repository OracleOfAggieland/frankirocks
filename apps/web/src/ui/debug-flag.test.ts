import { describe, expect, it } from "vitest";
import { debugVisible } from "./debug-flag";

describe("debugVisible", () => {
  it("is true only outside production with debug=1", () => {
    expect(debugVisible("development", "?debug=1")).toBe(true);
    expect(debugVisible("test", "?a=2&debug=1")).toBe(true);
    expect(debugVisible(undefined, "debug=1")).toBe(true);
  });

  it("is false without debug=1", () => {
    expect(debugVisible("development", "")).toBe(false);
    expect(debugVisible("development", "?debug=0")).toBe(false);
    expect(debugVisible("development", "?debug=true")).toBe(false);
  });

  it("is false in production whatever the query", () => {
    expect(debugVisible("production", "?debug=1")).toBe(false);
  });
});
