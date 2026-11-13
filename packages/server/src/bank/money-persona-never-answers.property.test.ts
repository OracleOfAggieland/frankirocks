// Brief 046 part C property "The persona never answers": with no connected bank (none ever, or one read and then
// disconnected), for any question and any persona rows (the sample visit's `source: "fixture"` bank rows, which carry
// no connector), the money read returns no amount and says no bank is connected. Seed and counterexample recorded in
// brief 046's Outcome.
import type { Evidence, Hasher } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { arbPull, arbTxn } from "../testing/bank-arb";
import { OWNER, bankRig, connectVia, connectorIdOf } from "../testing/bank-rig";
import { callRoute } from "../testing/fakes";
import { MONEY_WORDS, arbMoneyArgs, readFor } from "../testing/money-rig";
import { bankDisconnectRoute } from "./routes";
import { bankEvidence, bankRowContent } from "./rows";

/** A persona row: a bank row as the seed stores it, with `source: "fixture"` and no connector. */
function personaRow(hasher: Hasher, t: Parameters<typeof bankRowContent>[0], i: number): { id: string; e: Evidence } | null {
  const ctx = { uid: OWNER, connectorId: "persona", generation: 0, epoch: 1, policyRev: 1, opsNow: Date.UTC(2026, 10, 3, 12), hasher };
  const c = bankRowContent(t, ctx, null, false);
  if (typeof c === "string") return null;
  const id = testId(`persona-${i}`);
  return { id, e: { ...bankEvidence(id, testId(`persona-logical-${i}`), null, c, ctx), source: "fixture", connectorId: null } };
}

describe("property: the persona never answers (brief 046 part C)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbTxn, { maxLength: 8 }), fc.option(arbPull("x"), { nil: null }), arbMoneyArgs, fc.constantFrom(...MONEY_WORDS), async (persona, wasConnected, args, words) => {
        const { rig, bank } = bankRig();
        await rig.store.transaction(OWNER, async (tx) => {
          persona.forEach((t, i) => {
            const row = personaRow(rig.deps.hasher, { ...t, transaction_id: `p${i}` }, i);
            if (row !== null) tx.create(paths.evidence(OWNER, row.id), row.e);
          });
        });
        if (wasConnected !== null) {
          bank.pages = wasConnected;
          expect((await connectVia(rig)).status).toBe(200);
          expect((await callRoute(rig, bankDisconnectRoute, { requestId: testId("dc"), connectorId: connectorIdOf(rig) })).status).toBe(200);
        }
        const out = await readFor(rig, words, args);
        expect(out.facts).toBeNull();
        expect(out.result.state).toBe("noBank");
        const said = [...out.result.notes.map((n) => n.text), ...out.result.cards.flatMap((c) => [c.title, ...c.lines])].join("\n");
        expect(said).not.toMatch(/\d/);
        expect(out.result.notes.every((n) => n.sens === "S0" && n.dependsOn.length === 0)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
