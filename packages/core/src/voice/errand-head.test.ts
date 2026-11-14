/** Brief 049 part C, review fix E11: the Head tells the call a look-up exists only while an errand agent is ready. */
import { describe, expect, it } from "vitest";
import { ERRAND_HEAD_LINE } from "../errands/lines";
import { callHead, specCreate } from "./machine";

describe("callHead", () => {
  it("is the Deck's Head exactly while no errand agent is ready", () => {
    expect(callHead("HEAD", { errandsReady: false })).toBe("HEAD");
  });
  it("adds the one code-worded sentence while one is ready", () => {
    expect(callHead("HEAD", { errandsReady: true })).toBe(`HEAD\n\n${ERRAND_HEAD_LINE}`);
  });
  it("the speculative reply reads the same Head", () => {
    const st = { errandsReady: true, turn: { turnId: "t1", source: "typed", text: "hi" }, session: { sessionId: "s1", generation: 1 }, deck: { head: { text: "HEAD" }, turns: [] } } as never;
    const ev = specCreate(st, "e1") as unknown as { response: { instructions: string } };
    expect(ev.response.instructions).toContain(ERRAND_HEAD_LINE);
  });
});
