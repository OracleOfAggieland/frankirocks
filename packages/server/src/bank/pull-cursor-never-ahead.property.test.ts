// Brief 046 property "The cursor never runs ahead": for any pull that fails at any write, the stored cursor is the
// old one, and the next pull ends in the same state as a pull that never failed. Seed recorded in brief 046's Outcome.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StorePort } from "../store/port";
import { arbPull, evidenceState, published } from "../testing/bank-arb";
import { OWNER, bankRig, connectVia, connectorIdOf, storedConnector } from "../testing/bank-rig";
import { pullBank } from "./pull";
import { bankRuntime } from "./routes";

/** Fails the commit of the `failAt`-th transaction (1-based) after `arm`, once. */
function failOnce(inner: StorePort) {
  const state = { count: 0, failAt: 0, armed: false, failed: false };
  const store: StorePort = {
    get: (uid, path) => inner.get(uid, path),
    query: (uid, spec) => inner.query(uid, spec),
    transaction: (uid, fn) =>
      inner.transaction(uid, async (tx) => {
        const result = await fn(tx);
        if (state.armed && ++state.count === state.failAt) {
          state.failed = true;
          throw new Error("injected commit failure");
        }
        return result;
      }),
  };
  return { store, state };
}

async function setUp(first: ReturnType<typeof arbPull> extends fc.Arbitrary<infer P> ? P : never) {
  const { rig, bank } = bankRig();
  const wrapped = failOnce(rig.store);
  rig.deps.store = wrapped.store;
  bank.pages = first;
  expect((await connectVia(rig)).status).toBe(200);
  const id = connectorIdOf(rig);
  const ctx = { uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule };
  return { rig, bank, wrapped, id, ctx };
}

describe("property: the cursor never runs ahead (brief 046)", () => {
  it("1,000 runs", async () => {
    let injected = 0;
    await fc.assert(
      fc.asyncProperty(arbPull("a"), arbPull("b"), fc.integer({ min: 1, max: 8 }), async (first, second, failAt) => {
        // A pull that never failed.
        const ref = await setUp(first);
        ref.bank.pages = second;
        await pullBank(ref.ctx, ref.id, bankRuntime(ref.ctx));

        const t = await setUp(first);
        const before = (await storedConnector(t.rig, t.id))!.cursor;
        t.bank.pages = second;
        t.wrapped.state.armed = true;
        t.wrapped.state.failAt = failAt;
        const outcome = await pullBank(t.ctx, t.id, bankRuntime(t.ctx)).then(() => "ok", () => "failed");
        if (t.wrapped.state.failed) {
          injected++;
          expect(outcome).toBe("failed");
          expect((await storedConnector(t.rig, t.id))!.cursor).toEqual(before);
          t.wrapped.state.armed = false;
          await pullBank(t.ctx, t.id, bankRuntime(t.ctx));
        }
        expect(await evidenceState(t.rig.store)).toEqual(await evidenceState(ref.rig.store));
        expect(published(await storedConnector(t.rig, t.id))).toBe(published(await storedConnector(ref.rig, ref.id)));
      }),
      { numRuns: 1000 },
    );
    // Most runs fail one of the pull's transactions (lease, a page of rows, or the publish).
    expect(injected).toBeGreaterThan(200);
  }, 600_000);
});
