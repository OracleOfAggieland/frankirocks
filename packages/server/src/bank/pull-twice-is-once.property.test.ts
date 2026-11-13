// Brief 046 property "Twice is once": for any pull, applying it again writes no new document, changes no stored row,
// and leaves the cursor and the coverage the same; a stored category code always passes its pattern (part C). Seed recorded in brief 046's Outcome.
import { BANK_CATEGORY_CODE } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbPull, evidenceState, published } from "../testing/bank-arb";
import { OWNER, bankRig, connectVia, connectorIdOf, storedConnector } from "../testing/bank-rig";
import { pullBank } from "./pull";
import { bankRuntime } from "./routes";

describe("property: twice is once (brief 046)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(arbPull("a"), arbPull("b"), async (first, second) => {
        const { rig, bank } = bankRig();
        bank.pages = first;
        expect((await connectVia(rig)).status).toBe(200);
        const id = connectorIdOf(rig);
        const ctx = { uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule };
        bank.pages = second;
        await pullBank(ctx, id, bankRuntime(ctx));
        const rows = await evidenceState(rig.store);
        const conn = published(await storedConnector(rig, id));
        // The same pull again: Plaid answering the same pages from the same cursor, as after a crash.
        await pullBank(ctx, id, bankRuntime(ctx));
        expect(await evidenceState(rig.store)).toEqual(rows);
        // Part C follow-up 1: a stored category is the provider's code when it passes the pattern, and nothing else.
        for (const json of rows.values()) {
          const d = (JSON.parse(json) as { description: { kind: string; text: string } | null }).description;
          expect(d === null || (d.kind === "inline" && BANK_CATEGORY_CODE.test(d.text))).toBe(true);
        }
        expect(published(await storedConnector(rig, id))).toBe(conn);
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
