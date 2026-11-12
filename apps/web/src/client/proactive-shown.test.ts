// Brief 045 finding 7: a typed screen shows and admits only lines that need no answer.
import type { Proactive } from "@franki/core";
import { describe, expect, it } from "vitest";
import { showsOnScreen } from "./proactive-shown";

const base = { turnId: "t", permit: {} as Proactive["permit"], whisper: {} as Proactive["whisper"], cards: [] };

describe("showsOnScreen (brief 045 finding 7)", () => {
  it("a line that needs no answer is shown", () => {
    expect(showsOnScreen({ ...base, asks: false } as Proactive)).toBe(true);
  });
  it("a line that asks for an answer stays for a call", () => {
    expect(showsOnScreen({ ...base, asks: true } as Proactive)).toBe(false);
  });
  it("a line that does not say is treated as asking (fails closed)", () => {
    expect(showsOnScreen(base as Proactive)).toBe(false);
  });
});
