import { describe, expect, it } from "vitest";
import type { Slice } from "../schema/primitives";
import { ownerSentence } from "./owner-sentence";

const slice = (start: number, end: number, cls: "U" | "T"): Slice => ({ eid: "e", fieldPath: "text", start, end, contentHash: "h", class: cls, sens: "S0" }) as Slice;
const ev = (text: string, slices?: Slice[]) => ({ text, slices: slices ?? [slice(0, text.length, "U")] });
const at = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length });

describe("ownerSentence", () => {
  it("widens a resliced span to its whole sentence", () => {
    const t = "I'm allergic to peanuts.";
    expect(ownerSentence(at(t, "'m allergic to peanuts"), ev(t))).toBe("I'm allergic to peanuts");
  });
  it("keeps to the sentences the span touches", () => {
    const t = "My brother is fine. I'm allergic to peanuts. Thanks!";
    expect(ownerSentence(at(t, "allergic"), ev(t))).toBe("I'm allergic to peanuts");
    expect(ownerSentence(at(t, "fine. I'm"), ev(t))).toBe("My brother is fine. I'm allergic to peanuts");
  });
  it("reads only the U parts", () => {
    const t = "I said: Sam is allergic to peanuts.";
    const s = [slice(0, 8, "U"), slice(8, t.length, "T")];
    expect(ownerSentence(at(t, "allergic"), ev(t, s))).toBe("I said: ");
    expect(ownerSentence(at(t, "allergic"), ev(t, [slice(8, t.length, "T")]))).toBe("");
  });
});
