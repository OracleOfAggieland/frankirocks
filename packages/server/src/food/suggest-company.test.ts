// Brief 045 finding 10: under any audience that is not private, suggest asks no question drawn from a stored Memory
// and its cards carry nothing above S0; the question waits for a private turn.
import { describe, expect, it } from "vitest";
import { SEP_30_END, remember, suggestSetup as setup, vegetarian } from "../testing/suggest-audience";

type Body = { status: string; result: { question: string | null; pendingId: string | null; cards: { kind: string; sens: string; lines: string[] }[] } };

describe("brief 045 finding 10: food asks nothing private in company", () => {
  it("private: the ended diet's question comes first (the control)", async () => {
    const t = await setup(async (rig) => void (await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const body = (await t.suggest("What's for dinner tonight?", "private")) as Body;
    expect(body.result.question).toBe("Still vegetarian, or was September it?");
  });

  for (const audience of ["company", "unknown"] as const) {
    it(`${audience}: no question, no pending ID, no ask card, every card S0, and the dinners still keep the diet`, async () => {
      const t = await setup(async (rig) => void (await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
      const body = (await t.suggest("What's for dinner tonight?", audience)) as Body;
      expect(body.status).toBe("ready");
      expect(body.result.question).toBeNull();
      expect(body.result.pendingId).toBeNull();
      expect(body.result.cards.filter((c) => c.kind === "ask")).toEqual([]);
      expect(body.result.cards.every((c) => c.sens === "S0")).toBe(true);
      expect(JSON.stringify(body)).not.toContain("vegetarian");
      const lines = body.result.cards.filter((c) => c.kind === "food").flatMap((c) => c.lines);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => /chicken|beef|pork|salmon|cod|shrimp|seafood/i.test(l))).toBe(false);
    });
  }
});
