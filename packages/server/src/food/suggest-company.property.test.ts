// Brief 045 part D, property 4: food asks nothing private in company. For any audience that is not private, and any
// diet the owner has on record (none, holding, ended, or a sister's), `suggest` on the tool route returns no question
// drawn from a Memory, no pending ID, no ask card and no card above S0.
import { RULES_UNAVAILABLE_LINE } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SEP_30_END, remember, suggestSetup, vegetarian } from "../testing/suggest-audience";

const SEED = 45104;
const DIETS = ["none", "holding", "ended", "sisterEnded"] as const;
const LINES = ["What's for dinner tonight?", "Any quick dinner ideas?", "What should I make for dinner?"] as const;

describe("brief 045 part D: food asks nothing private in company", () => {
  it("no question from a Memory and no card above S0 under any audience but private", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("company", "unknown"), fc.constantFrom(...DIETS), fc.constantFrom(...LINES), async (audience, diet, line) => {
        const t = await suggestSetup(async (rig) => {
          if (diet === "holding") await remember(rig, "veg", "I'm vegetarian this month", vegetarian(null));
          if (diet === "ended") await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END));
          if (diet === "sisterEnded") await remember(rig, "veg", "My sister is vegetarian this month", vegetarian(SEP_30_END, testId("sister")));
        });
        const body = (await t.suggest(line, audience)) as { result: { question: string | null; pendingId: string | null; cards: { kind: string; sens: string }[] } };
        expect([null, RULES_UNAVAILABLE_LINE]).toContain(body.result.question);
        expect(body.result.pendingId).toBeNull();
        expect(body.result.cards.filter((c) => c.kind === "ask")).toEqual([]);
        expect(body.result.cards.every((c) => c.sens === "S0")).toBe(true);
      }),
      { numRuns: 1000, seed: SEED },
    );
  });
});
