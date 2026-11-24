/**
 * Delete leaves nothing and calls nothing live (brief 054 design, correctness property 19; R16.2, R16.3). 1,000 runs.
 *   FOR ALL demo fixtures, ALL demo tenant states (one to three resets, with or without a pull's imported rows), and
 *   a deployment with or without Plaid and Google settings:
 *   POST /api/account/delete as the anonymous visitor answers `{deleted: true}`, removes the bank and revokes Google
 *   through the simulators (each at most once, and only with a simulator token), makes no call to a live port, leaves
 *   no document under the tenant and deletes the user; a second delete is harmless (it calls nothing outside and
 *   leaves the tenant empty).
 * `account/delete.ts` is unchanged: routing follows the token, so its disconnects reach the simulators.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accountDeleteRoute } from "../account/delete";
import type { BankPort } from "../bank/plaid";
import { bankSyncRoute } from "../bank/routes";
import type { GooglePort } from "../google/port";
import { listTenantRows } from "../seed/clear";
import { ANON, DEMO_ENV, DEMO_FIXTURES, VISITOR, recordingLive, resetDemo } from "../testing/demo-fixture";
import { FakeAccount } from "../testing/fake-account";
import { BANK_ENV } from "../testing/fake-bank";
import { GOOGLE_TEST_ENV } from "../testing/fake-google";
import { callRoute, testRig } from "../testing/fakes";
import { routingBank, routingGoogle } from "./routing";
import { simulatedBank } from "./sim-bank";
import { simulatedGoogle } from "./sim-google";
import { readSimToken } from "./token";
import { demoBankConnectorId } from "./visit";

const RUNS = { numRuns: 1000 };
const CONFIRM = { confirm: "delete everything" };

/** The simulators, with every token they are handed recorded. */
function watchedSims() {
  const seen: { method: string; token: string }[] = [];
  const b = simulatedBank();
  const g = simulatedGoogle();
  const bank: BankPort = {
    ...b,
    accounts: (c, t) => (seen.push({ method: "bank.accounts", token: t }), b.accounts(c, t)),
    sync: (c, t, k) => (seen.push({ method: "bank.sync", token: t }), b.sync(c, t, k)),
    remove: (c, t) => (seen.push({ method: "bank.remove", token: t }), b.remove(c, t)),
  };
  const google: GooglePort = { ...g, revoke: (t) => (seen.push({ method: "google.revoke", token: t }), g.revoke(t)) };
  return { bank, google, seen };
}

describe("a demo visit's delete", () => {
  it("removes everything through the simulators and calls nothing live", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...DEMO_FIXTURES), fc.integer({ min: 1, max: 3 }), fc.boolean(), fc.boolean(), async (fixture, resets, pulled, configured) => {
        const rig = testRig(configured ? { ...DEMO_ENV, ...BANK_ENV, ...GOOGLE_TEST_ENV } : DEMO_ENV);
        const live = recordingLive();
        const sims = watchedSims();
        // As `bankRuntime` and `googleRuntime` compose them, with the live half recorded.
        rig.deps.bank = routingBank(live.bank, sims.bank);
        rig.deps.google = routingGoogle(live.google, sims.google);
        const account = new FakeAccount(rig.store);
        rig.deps.account = account;

        for (let i = 0; i < resets; i++) expect((await resetDemo(rig, fixture.id, i)).status).toBe(200);
        if (pulled) expect((await callRoute(rig, bankSyncRoute, { connectorId: demoBankConnectorId(rig.deps.hasher, VISITOR) }, { token: ANON })).status).toBe(200);
        expect((await listTenantRows(rig.store, VISITOR)).length).toBeGreaterThan(0);
        sims.seen.length = 0;

        const res = await callRoute(rig, accountDeleteRoute, CONFIRM, { token: ANON });
        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ deleted: true });
        expect(sims.seen.map((s) => s.method).sort()).toEqual(["bank.remove", "google.revoke"]);
        for (const s of sims.seen) expect(readSimToken(s.token)).toMatchObject({ fixtureId: fixture.id });
        expect(live.calls).toEqual([]);
        expect(await listTenantRows(rig.store, VISITOR)).toEqual([]);
        expect(account.deletedUsers).toEqual([VISITOR]);

        sims.seen.length = 0;
        const again = await callRoute(rig, accountDeleteRoute, CONFIRM, { token: ANON });
        expect(again.status).toBe(200);
        expect(sims.seen).toEqual([]);
        expect(live.calls).toEqual([]);
        expect(await listTenantRows(rig.store, VISITOR)).toEqual([]);
      }),
      RUNS,
    );
  }, 600_000);

  it("works on a demo-only deployment through the ports the routes compose themselves", async () => {
    const rig = testRig(DEMO_ENV);
    // No override: `bankRuntime` and `googleRuntime` compose the routing ports over refusing live halves.
    rig.deps.bank = undefined;
    rig.deps.google = undefined;
    const account = new FakeAccount(rig.store);
    rig.deps.account = account;
    expect((await resetDemo(rig)).status).toBe(200);
    const res = await callRoute(rig, accountDeleteRoute, CONFIRM, { token: ANON });
    expect(res.status).toBe(200);
    expect(await listTenantRows(rig.store, VISITOR)).toEqual([]);
  });
});
