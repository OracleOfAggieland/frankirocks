// Brief 046 part C property "Every cent has a row": for any set of stored bank rows and any question, the total
// equals the sum of the cited rows' cents, and no cited row is removed, pending, superseded, of a disconnected bank, a
// transfer, a card payment or income. The oracle below reads the store itself and shares no code with the read but
// the period's dates. Seed and counterexample recorded in brief 046's Outcome.
import { type Evidence, MONEY_PERIODS, dollars, moneyPeriod } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { arbPull } from "../testing/bank-arb";
import { OWNER, bankRig, connectVia, connectorIdOf } from "../testing/bank-rig";
import { callRoute } from "../testing/fakes";
import { readFor } from "../testing/money-rig";
import { testId } from "@franki/core/testing";
import { pullBank } from "./pull";
import { bankDisconnectRoute, bankRuntime } from "./routes";

const NOT_SPENDING = /^(TRANSFER_IN_|TRANSFER_OUT_|INCOME_|LOAN_DISBURSEMENTS_)|^LOAN_PAYMENTS_CREDIT_CARD_PAYMENT$/;

describe("property: every cent has a row (brief 046 part C)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(arbPull("a"), arbPull("b"), arbPull("c"), fc.constantFrom(...MONEY_PERIODS), fc.boolean(), async (first, second, other, period, otherBank) => {
        const { rig, bank } = bankRig();
        bank.pages = first;
        expect((await connectVia(rig, 1)).status).toBe(200);
        const ctx = { uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule };
        const id = connectorIdOf(rig, 1);
        bank.pages = second;
        await pullBank(ctx, id, bankRuntime(ctx));
        if (otherBank) {
          // A second bank, read and then disconnected: its rows stay stored and must never count.
          bank.item = { ...bank.item, itemId: "item-2", institutionId: "ins_2" };
          bank.pages = other;
          expect((await connectVia(rig, 2)).status).toBe(200);
          expect((await callRoute(rig, bankDisconnectRoute, { requestId: testId("dc-2"), connectorId: connectorIdOf(rig, 2) })).status).toBe(200);
        }

        const out = await readFor(rig, "What did I spend?", { period, group: null, merchant: null });
        const all = (await listTenantRows(rig.store, OWNER)).filter((r) => r.path.includes("/evidence/")).map((r) => ({ id: r.path.split("/").pop()!, e: r.data as Evidence }));
        const superseded = new Set(all.map((r) => r.e.revisionOf).filter((x) => x !== null));
        const range = moneyPeriod(period, rig.clock.read().opsClock.now, "UTC");
        const counts = (r: { id: string; e: Evidence }) => {
          const o = r.e.observation;
          if (o.kind !== "bank" || r.e.connectorId !== id || superseded.has(r.id) || o.removed || o.pending || o.currency !== "USD" || o.amountCents <= 0) return false;
          const code = r.e.description?.kind === "inline" ? r.e.description.text : null;
          if (code !== null && NOT_SPENDING.test(code)) return false;
          const day = o.purchaseAt.civilDate ?? (o.purchaseAt.instant === null ? null : o.purchaseAt.instant.slice(0, 10));
          return day !== null && day >= range.from && day <= range.to;
        };
        const expected = all.filter(counts);
        const byId = new Map(all.map((r) => [r.id, r]));

        // A bank with nothing stored yet, still importing, answers that it is being read: no total, and nothing to cite.
        if (out.result.state === "importing") {
          expect(expected).toEqual([]);
          expect(JSON.stringify(out.result.notes)).not.toContain("$");
          return;
        }
        expect(out.facts?.kind).toBe("answered");
        if (out.facts?.kind !== "answered") return;
        const cited = out.facts.parts.flatMap((p) => p.spent.eids);
        const total = out.facts.parts.reduce((a, p) => a + p.spent.cents, 0);
        expect(cited.sort()).toEqual(expected.map((r) => r.id).sort());
        expect(total).toBe(expected.reduce((a, r) => a + (r.e.observation as { amountCents: number }).amountCents, 0));
        for (const p of out.facts.parts) {
          expect(p.spent.cents).toBe(p.spent.eids.reduce((a, eid) => a + (byId.get(eid)!.e.observation as { amountCents: number }).amountCents, 0));
        }
        // Every cited row is in its note's lineage, and the note says that part's total.
        out.result.notes.forEach((n, i) => {
          const part = out.facts!.kind === "answered" ? out.facts!.parts[i]! : null;
          for (const eid of part!.spent.eids) expect(n.dependsOn).toContain(`e:${eid}`);
          if (part!.spent.count > 0) expect(n.text).toContain(dollars(part!.spent.cents));
        });
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
