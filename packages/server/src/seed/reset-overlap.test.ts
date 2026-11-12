// Brief 038 finding 8: a reset that ran past its deadline and was taken over must stop writing.
import { describe, expect, it } from "vitest";
import { type TestRig, testRig } from "../testing/fakes";
import { SMALL_FIXTURE_ID, hookedStore, resetFresh } from "../testing/seed";
import { listTenantRows } from "./clear";
import { RESET_BARRIER_MS } from "./reset";

const UID = "owner-1";
const ZONE = "America/Chicago";

/** Rows per collection, ledger aside (each reset keeps its own request entry). */
async function shape(rig: TestRig): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await listTenantRows(rig.store, UID)) {
    const collection = r.path.split("/")[2]!;
    if (collection === "ledger") continue;
    out[collection] = (out[collection] ?? 0) + 1;
  }
  return out;
}

describe("two resets that overlap (brief 038 finding 8)", () => {
  it("the first reset, taken over after its deadline, writes nothing more, and the tenant is one clone", async () => {
    const control = testRig();
    await resetFresh(control, UID, "v0", "r0", ZONE, SMALL_FIXTURE_ID);
    expect((await resetFresh(control, UID, "v2", "r2", ZONE, SMALL_FIXTURE_ID)).status).toBe(200);

    const rig = testRig();
    await resetFresh(rig, UID, "v0", "r0", ZONE, SMALL_FIXTURE_ID);
    const inner = rig.deps.store;
    let second: Awaited<ReturnType<typeof resetFresh>> | null = null;
    rig.deps.store = hookedStore(
      inner,
      (op) => op.kind === "query" && op.collection.endsWith("/memories"),
      async () => {
        // The first reset stalls in its clear past the barrier's deadline; a second reset takes over and finishes.
        rig.clock.advance(RESET_BARRIER_MS + 1);
        second = await resetFresh(rig, UID, "v2", "r2", ZONE, SMALL_FIXTURE_ID);
      },
    );
    const first = await resetFresh(rig, UID, "v1", "r1", ZONE, SMALL_FIXTURE_ID);
    rig.deps.store = inner;
    expect(second!.status).toBe(200);
    expect([first.status, first.body.error]).toEqual([409, "STALE"]);
    expect(await shape(rig)).toEqual(await shape(control));
  });
});
