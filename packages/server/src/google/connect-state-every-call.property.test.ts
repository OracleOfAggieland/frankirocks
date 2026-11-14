// Brief 049 review S10: the "State" property pinned only the exchange. Here every port call counts (exchange,
// refresh, revoke and every data method): a state that is not the owner's fresh one reaches Google zero times in any
// way, writes no ledger row and leaves the owner's pending authorization as it was (review S5). The owner's fresh
// state reaches Google exactly once, by the exchange.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Ledger } from "@franki/core";
import { testId } from "@franki/core/testing";
import { listTenantRows } from "../seed/clear";
import { callRoute } from "../testing/fakes";
import { OWNER, OTHER, googleRig, stateOf } from "../testing/google-rig";
import { PENDING_TTL_MS } from "./oauth";
import { googleConnectRoute, googleStartRoute } from "./routes";

const KINDS = ["valid", "other", "reused", "expired", "superseded", "forged"] as const;

describe("property: a state that is not the owner's fresh one makes no Google call of any kind (review S10)", () => {
  it("500 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...KINDS), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 5 * 60_000 }), fc.stringMatching(/^[A-Za-z0-9_-]{43}$/), async (kind, extraStarts, lateBy, forged) => {
        const { rig, google } = googleRig();
        const start = async (uid: string) => stateOf((await callRoute(rig, googleStartRoute, {}, { token: `token:${uid}` })).body.url);
        let mine = await start(OWNER);
        for (let i = 0; i < extraStarts; i++) mine = await start(OWNER);
        const theirs = await start(OTHER);
        const connect = (state: string, n: number) => callRoute(rig, googleConnectRoute, { requestId: testId(`gc-${n}`), code: "4/0AQSTgQ-test-code", state }, { token: `token:${OWNER}` });
        const googleRows = async () => (await listTenantRows(rig.store, OWNER)).filter((r) => r.path.includes("/ledger/") && (r.data as Ledger).kind === "google").length;
        const pendingOf = async () => JSON.stringify((await listTenantRows(rig.store, OWNER)).filter((r) => r.path.includes("/connectors/")).map((r) => (r.data as { google?: { pending: unknown } }).google?.pending ?? null));

        if (kind === "reused") {
          expect((await connect(mine, 1)).status).toBe(200);
        } else if (kind === "expired") {
          rig.clock.advance(PENDING_TTL_MS + lateBy);
        } else if (kind === "superseded") {
          // A later start replaces the pending authorization; `mine` is now the superseded state.
          await start(OWNER);
        }
        const before = google.calls.length;
        const rowsBefore = await googleRows();
        const pendingBefore = await pendingOf();
        const state = kind === "other" ? theirs : kind === "forged" ? (forged === mine ? `${forged.slice(0, 42)}${forged.endsWith("A") ? "B" : "A"}` : forged) : mine;
        const res = await connect(state, 2);
        const made = google.calls.slice(before).map((c) => c.method);
        if (kind === "valid") {
          expect(res.status).toBe(200);
          expect(made).toEqual(["exchangeCode"]);
        } else {
          expect(res.status).toBe(409);
          expect(made).toEqual([]);
          expect(await googleRows()).toBe(rowsBefore);
          expect(await pendingOf()).toBe(pendingBefore);
        }
      }),
      { numRuns: 500 },
    );
  });
});
