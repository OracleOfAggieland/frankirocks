/**
 * Start over reinstalls (brief 054 design, correctness property 15; R11.1, R11.5, R11.7, R11.8). 1,000 runs.
 *   FOR ALL demo fixtures (the test fixture and the Kisses persona) and ALL sequences of resets of one anonymous
 *   tenant, each in any zone and at any later ops time (so each has its own world start):
 *   after each reset the bank, Gmail and Calendar connectors are connected, each unseals to a simulator token naming
 *   that fixture with that reset's world start and zone, and their `createdAt` is the first reset's;
 *   AND the bank rows the next pull imports carry, row for row, the amounts and the purchase and posting instants of
 *   the bank Evidence that reset seeded;
 *   AND no call reaches the live bank or Google.
 */
import { type Connector, type Evidence, msFromTs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bankSyncRoute } from "../bank/routes";
import { openToken } from "../bank/seal";
import { googleConnectorId } from "../google/connector";
import { unseal } from "../sealed";
import { sealKeysFrom } from "../sealed";
import { paths } from "../store/paths";
import { ANON, DEMO_FIXTURES, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";
import { callRoute } from "../testing/fakes";
import { SEED_ZONES, evidenceOf } from "../testing/seed";
import { readSimToken } from "./token";
import { demoBankConnectorId } from "./visit";

const RUNS = { numRuns: 1000 };

type BankObs = Extract<Evidence["observation"], { kind: "bank" }>;
const bankKey = (e: Evidence) => {
  const o = e.observation as BankObs;
  return `${o.amountCents}|${o.purchaseAt.instant}|${o.purchaseAt.civilDate}|${o.postedAt}|${o.pending}`;
};

describe("Start over reinstalls the demo connectors", () => {
  it("writes fresh simulator tokens for each visit, and the next pull dates the rows from that visit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DEMO_FIXTURES),
        fc.array(fc.record({ zone: fc.constantFrom(...SEED_ZONES), laterMs: fc.integer({ min: 0, max: 40 * 86_400_000 }) }), { minLength: 1, maxLength: 3 }),
        async (fixture, resets) => {
          const { rig, live } = demoRig();
          const keys = sealKeysFrom(rig.deps.env, "FRANKI_BANK_TOKEN_KEY");
          const ids = {
            bank: demoBankConnectorId(rig.deps.hasher, VISITOR),
            gmail: googleConnectorId(rig.deps.hasher, VISITOR, "gmail"),
            calendar: googleConnectorId(rig.deps.hasher, VISITOR, "calendar"),
          };
          let firstCreated: Record<string, string> | null = null;
          for (const [i, r] of resets.entries()) {
            rig.clock.advance(r.laterMs);
            const res = await resetDemo(rig, fixture.id, i, r.zone);
            expect(res.status).toBe(200);
            const worldStart = msFromTs(res.body.worldClock);

            const docs: Record<string, Connector> = {};
            for (const [k, id] of Object.entries(ids)) {
              const d = await rig.store.get<Connector>(VISITOR, paths.connector(VISITOR, id));
              expect(d).not.toBeNull();
              docs[k] = d!.data;
              expect(d!.data.state).toBe("connected");
            }
            const bankToken = readSimToken(openToken(keys, VISITOR, ids.bank, docs.bank!.bank!.token!));
            expect(bankToken).toStrictEqual({ kind: "bank", fixtureId: fixture.id, worldStart, zone: r.zone });
            for (const p of ["gmail", "calendar"] as const) {
              const t = readSimToken(unseal("franki-google-token", keys, VISITOR, ids[p], docs[p]!.google!.token!));
              expect(t).toStrictEqual({ kind: "refresh", fixtureId: fixture.id, worldStart, zone: r.zone });
              expect(docs[p]!.google!.granted).toBe(true);
              expect(docs[p]!.google!.email).toBe(fixture.demo!.google.email);
            }
            const created = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.createdAt]));
            if (firstCreated === null) firstCreated = created;
            else expect(created).toStrictEqual(firstCreated);

            // The next pull, through the real route and the routing port, imports the rows this visit seeded.
            const sync = await callRoute(rig, bankSyncRoute, { connectorId: ids.bank }, { token: ANON });
            expect(sync.status).toBe(200);
            const all = (await evidenceOf(rig.store, VISITOR)).map((d) => d.data).filter((e) => e.observation.kind === "bank");
            const imported = all.filter((e) => e.source === "plaid").map(bankKey).sort();
            const seeded = all.filter((e) => e.source !== "plaid").map(bankKey).sort();
            expect(imported).toEqual(seeded);
            expect(seeded.length).toBe(fixture.lines.filter((l) => l.kind === "bank").length);
          }
          expect(live.calls).toEqual([]);
        },
      ),
      RUNS,
    );
  }, 600_000);
});
