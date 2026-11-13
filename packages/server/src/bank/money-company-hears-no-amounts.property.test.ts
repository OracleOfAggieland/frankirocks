// Brief 046 part C property "Company hears no amounts": for any audience other than private (company, or unknown),
// any stored bank rows, any question and any words, no tool output or card from POST /api/tool holds a digit, and an
// answer that held an amount back wrote its Gate row. Seed and counterexample recorded in brief 046's Outcome.
import { type Ledger, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { arbPull } from "../testing/bank-arb";
import { OWNER, bankRig, connectVia } from "../testing/bank-rig";
import { callRoute, patchRecord } from "../testing/fakes";
import { MONEY_WORDS, arbMoneyArgs } from "../testing/money-rig";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { ok } from "../openai/fake";

describe("property: company hears no amounts (brief 046 part C)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPull("a"),
        arbMoneyArgs,
        fc.constantFrom(...MONEY_WORDS, "Tell me a joke"),
        fc.constantFrom("company", "unknown"),
        fc.constantFrom("voice", "typed"),
        async (pages, args, words, audience, how) => {
          const { rig, bank } = bankRig();
          bank.pages = pages;
          expect((await connectVia(rig)).status).toBe(200);
          const s = await openTestSession(rig);
          if (how === "typed") rig.openai.script("responses.create", ok({ status: "completed", outputText: "All right.", refusal: null, usage: { inputTokens: 0, outputTokens: 0 } }));
          const body = how === "typed" ? typedTurn(s.stamp, 1, words) : { ...asrTurn(s.stamp, 1, words, [{ itemId: "item_1", commitSeq: 1 }]), judge: "O" };
          expect((await callRoute(rig, turnRoute, body)).status).toBe(200);
          await patchRecord<Session>(rig.store, OWNER, paths.session(OWNER, s.sessionId), { audience });
          const res = await callRoute(rig, toolRoute, { requestId: testId("money"), stamp: { ...s.stamp, turnId: testId("turn-1") }, callId: "call_1", tool: { name: "read_money", args } });
          expect(res.status).toBe(200);
          const result = res.body.result as { state: string; notes: { text: string; sens: string }[]; cards: { title: string; lines: string[] }[] } | null;
          if (result === null) return;
          const said = [...result.notes.map((n) => n.text), ...result.cards.flatMap((c) => [c.title, ...c.lines])].join("\n");
          expect(said, said).not.toMatch(/\d/);
          expect(result.notes.every((n) => n.sens === "S0")).toBe(true);
          expect(result.state).not.toBe("answered");
          if (result.state === "held") {
            const gate = await rig.store.query<Ledger>(OWNER, { collection: paths.collection(OWNER, "ledger"), where: [{ field: "kind", op: "==", value: "gate" }], orderBy: { field: "at", dir: "desc" }, limit: 10 });
            expect(gate.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 1000 },
    );
  }, 600_000);
});
