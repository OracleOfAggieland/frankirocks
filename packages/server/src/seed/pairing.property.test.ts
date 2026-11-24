/**
 * Pairing (brief 054 design, correctness property 5; R5.1, R5.2, R5.3, R5.4, R5.5). 1,000 runs each.
 *   FOR ALL fixture IDs (every ID in FIXTURES, and unknown ones) and ALL `anonymous` (true, false, absent):
 *   `pairedFixture` returns a demo fixture exactly when `anonymous` is true and the fixture has `demo`, returns a
 *   non-demo fixture exactly when `anonymous` is not true and the fixture has none, and otherwise throws SCOPE.
 *   FOR ALL sequences of reset requests through `seedResetRoute`, as one anonymous or one signed-in tenant:
 *   a request that pairs clones its fixture; one that doesn't answers 404 SCOPE and writes nothing (no core
 *   document, no barrier, no row, no ledger entry: the tenant is exactly as before); so an anonymous tenant only
 *   ever holds a demo fixture's rows and its three connectors, and a signed-in one never does.
 * The signed-in half resets the small test fixture, since the Riley persona is too large to clone per case.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { RouteError } from "../routes/errors";
import { seedResetRoute } from "../routes/seed-reset";
import { DEMO_ENV, DEMO_TEST_FIXTURE_ID } from "../testing/demo-fixture";
import { FAKE_HMAC_KEY, T0_MS, callRoute, testRig } from "../testing/fakes";
import { SMALL_FIXTURE_ID, resetBody, snapshotOf } from "../testing/seed";
import { buildSeed } from "./build";
import { cloneWorldStart } from "./clock";
import type { SeedFixture } from "./fixture";
import { KISSES_FIXTURE_ID } from "./kisses";
import { pairedFixture } from "./pairing";
import { FIXTURES, PERSONA_FIXTURE_ID } from "./persona";

const RUNS = { numRuns: 1000 };
const UNKNOWN = ["seed-persona-nobody-v1-00000000000000000000", "", "x", PERSONA_FIXTURE_ID.toUpperCase()];
const anonymity = fc.constantFrom(true, false, undefined);

describe("pairedFixture", () => {
  it("pairs a demo fixture with an anonymous tenant only, and every other fixture with a signed-in one only", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FIXTURES.keys(), ...UNKNOWN), anonymity, (id, anonymous) => {
        const f = FIXTURES.get(id);
        const pairs = f !== undefined && (f.demo !== undefined) === (anonymous === true);
        let got: SeedFixture | null = null;
        let thrown: unknown = null;
        try {
          got = pairedFixture(anonymous, id);
        } catch (e) {
          thrown = e;
        }
        if (pairs) {
          expect(got).toBe(f);
        } else {
          expect(thrown).toBeInstanceOf(RouteError);
          expect(thrown).toMatchObject({ code: "SCOPE", status: 404 });
        }
      }),
      RUNS,
    );
  });

  it("reads fixtures from the map it is given", () => {
    const demo = FIXTURES.get(KISSES_FIXTURE_ID)!;
    const only = new Map([[demo.id, demo]]);
    expect(pairedFixture(true, demo.id, only)).toBe(demo);
    expect(() => pairedFixture(false, PERSONA_FIXTURE_ID, only)).toThrow(RouteError);
  });
});

const hasher = createHasher(FAKE_HMAC_KEY);
/** How many Evidence rows a clone of `f` holds, from the builder itself. */
async function evidenceCount(f: SeedFixture): Promise<number> {
  const zone = "America/Chicago";
  const rows = await buildSeed(f, { uid: "u", namespace: hasher.id(["ns"]), zone, worldStart: cloneWorldStart(T0_MS, zone), opsNow: T0_MS, core: { epoch: 1, policyRev: 1 }, hasher });
  return rows.groups.reduce((n, g) => n + g.writes.filter((w) => w.path.includes("/evidence/")).length, 0);
}

const ROUTE_IDS = [DEMO_TEST_FIXTURE_ID, KISSES_FIXTURE_ID, SMALL_FIXTURE_ID, "seed-persona-nobody-v1-00000000000000000000"];

describe("the reset route pairs before it writes anything", () => {
  it("an anonymous tenant ends with a demo fixture or nothing written, and a signed-in one never with a demo fixture", async () => {
    const counts = new Map<string, number>();
    for (const id of ROUTE_IDS) if (FIXTURES.has(id)) counts.set(id, await evidenceCount(FIXTURES.get(id)!));
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(fc.constantFrom(...ROUTE_IDS, PERSONA_FIXTURE_ID), { minLength: 1, maxLength: 3 }), async (anonymous, ids) => {
        // The Riley persona is cloned only for a signed-in tenant, which is too slow per case: it is refused here.
        fc.pre(anonymous || !ids.includes(PERSONA_FIXTURE_ID));
        const rig = testRig(DEMO_ENV);
        const uid = anonymous ? "visitor-1" : "owner-1";
        const token = anonymous ? `anon:${uid}` : `token:${uid}`;
        let holds: string | null = null;
        for (const [i, id] of ids.entries()) {
          const before = await snapshotOf(rig.store, uid);
          const f = FIXTURES.get(id);
          const pairs = f !== undefined && (f.demo !== undefined) === anonymous;
          const res = await callRoute(rig, seedResetRoute, resetBody(`v${i}`, `r${i}`, "America/Chicago", id), { token });
          if (!pairs) {
            expect(res.status).toBe(404);
            expect(res.body).toStrictEqual({ error: "SCOPE", retryAfterMs: 0 });
            expect(await snapshotOf(rig.store, uid)).toEqual(before);
            continue;
          }
          expect(res.status).toBe(200);
          holds = id;
        }
        const rows = await snapshotOf(rig.store, uid);
        const evidence = rows.filter(([p]) => p.includes("/evidence/")).length;
        const connectors = rows.filter(([p]) => p.includes("/connectors/")).length;
        if (holds === null) {
          expect(rows).toEqual([]);
          return;
        }
        expect(evidence).toBe(counts.get(holds));
        const demo = FIXTURES.get(holds)!.demo !== undefined;
        expect(demo).toBe(anonymous);
        expect(connectors).toBe(demo ? 3 : 0);
      }),
      RUNS,
    );
  }, 600_000);
});
