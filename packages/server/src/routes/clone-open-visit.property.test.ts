// Brief 045 part S, property 4: a clone's open names its visit. For an account on the fixture clock (a clone after
// any number of resets, each with its own visit), an open naming no visit, or any visit but the current one, from any
// earlier Session or none: it answers STALE, creates no Session, and leaves core/epoch and core/bundle as they were.
// An open naming the current visit still opens.
import { type CoreBundle, type CoreEpoch, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { type TestRig, callRoute, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openRoute } from "./open";

const UID = "owner-1";
const ZONE = "America/Chicago";

const sessionsOf = (rig: TestRig) => rig.store.query<Session>(UID, { collection: paths.collection(UID, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });

describe("brief 045 part S, property 4: a clone's open names its visit", () => {
  it("an open with no visit or an old one answers STALE and opens nothing", { timeout: 900_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), fc.option(fc.nat(4), { nil: null }), fc.boolean(), fc.boolean(), async (resets, pick, opensFirst, names) => {
        const rig = testRig();
        for (let r = 1; r <= resets; r++) expect((await resetAs(rig, UID, `v${r}`, `r${r}`, ZONE)).status).toBe(200);
        const current = testId(`visit-v${resets}`);
        let previous: string | null = null;
        if (opensFirst) {
          const ok = await callRoute(rig, openRoute, { requestId: testId("open-ok"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: current });
          expect(ok.status).toBe(200);
          previous = ok.body.sessionId;
        }
        // No visit, or one of the earlier visits, or one never made; never the current one.
        const visitId = pick === null ? null : pick + 1 === resets ? testId("visit-never") : testId(`visit-v${pick + 1}`);
        const before = { sessions: (await sessionsOf(rig)).length, epoch: (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data, bundle: (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data };
        const res = await callRoute(rig, openRoute, { requestId: testId("open-x"), initiator: "user", previousSessionId: names ? previous : null, clientZone: ZONE, visitId });
        const what = JSON.stringify({ resets, pick, opensFirst, names, visitId });
        expect(res.status, what).toBe(409);
        expect(res.body.error, what).toBe("STALE");
        expect((await sessionsOf(rig)).length, what).toBe(before.sessions);
        expect((await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data, what).toEqual(before.epoch);
        expect((await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data, what).toEqual(before.bundle);
      }),
      { numRuns: 1_000 },
    );
  });
});
