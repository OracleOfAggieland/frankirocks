/**
 * A demo tenant that stops being anonymous (brief 054 review, finding 1). A visitor can link a Google account to the
 * anonymous user by hand: the uid stays, and every later token is a signed-in one. Pairing then gives that tenant the
 * sample fixture on its next Start over. That reset must leave none of the demo's simulated connectors behind, so a
 * sample visit never answers from Jeffrey's bank, Gmail or Calendar. A real connection is not touched: the tests of
 * brief 046 ruling 9 and brief 049 keep a connected bank and Google account across a reset, unchanged.
 */
import type { Connector } from "@franki/core";
import { describe, expect, it } from "vitest";
import { googleConnectorId } from "../google/connector";
import { seedResetRoute } from "../routes/seed-reset";
import { paths } from "../store/paths";
import { DEMO_FIXTURES, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";
import { callRoute } from "../testing/fakes";
import { SMALL_FIXTURE_ID, resetBody } from "../testing/seed";
import { connectorSimulated, demoBankConnectorId } from "./visit";

const ZONE = "America/Chicago";
const SIGNED_IN = `token:${VISITOR}`;

describe.each(DEMO_FIXTURES.map((f) => [f.id, f] as const))("a demo tenant that links a real sign-in (%s)", (_id, f) => {
  it("keeps no simulated connector once it is reset as a signed-in tenant", async () => {
    const { rig, live } = demoRig();
    const ids = [demoBankConnectorId(rig.deps.hasher, VISITOR), googleConnectorId(rig.deps.hasher, VISITOR, "gmail"), googleConnectorId(rig.deps.hasher, VISITOR, "calendar")];
    const read = () => Promise.all(ids.map((id) => rig.store.get<Connector>(VISITOR, paths.connector(VISITOR, id))));

    expect((await resetDemo(rig, f.id, 1, ZONE)).status).toBe(200);
    const before = await read();
    expect(before.every((d, i) => d !== null && connectorSimulated(rig.deps.env, VISITOR, { id: ids[i]!, data: d.data }))).toBe(true);

    // The same uid, now with a signed-in token: the demo fixture is refused, and the sample fixture is cloned.
    expect((await callRoute(rig, seedResetRoute, resetBody("linked-0", "linked-0", ZONE, f.id), { token: SIGNED_IN })).status).toBe(404);
    expect((await read()).every((d) => d !== null)).toBe(true);
    expect((await callRoute(rig, seedResetRoute, resetBody("linked-1", "linked-1", ZONE, SMALL_FIXTURE_ID), { token: SIGNED_IN })).status).toBe(200);
    expect(await read()).toEqual([null, null, null]);

    // A second sample reset finds nothing to drop and still succeeds.
    expect((await callRoute(rig, seedResetRoute, resetBody("linked-2", "linked-2", ZONE, SMALL_FIXTURE_ID), { token: SIGNED_IN })).status).toBe(200);
    expect(await read()).toEqual([null, null, null]);
    expect(live.calls).toEqual([]);
  });
});
