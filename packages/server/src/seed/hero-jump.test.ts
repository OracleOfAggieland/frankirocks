/**
 * A jump equals waiting, for the hero (brief 036 finding 7, given to brief 030). On a fresh clone, a jump past
 * midnight with no earlier tick and a tick then the same jump give the same hero result: no seeded row may enter a
 * window that slides with the world clock and change the pattern.
 */
import { msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { heroOffer } from "../routes/tool-food";
import { seedAdvanceRoute } from "../routes/seed-advance";
import { callRoute, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { memoryTick } from "../time/tick";

const UID = "owner-1";
const HOUR = 3_600_000;

async function heroAfterJump(tickFirst: boolean, hours: number) {
  const rig = testRig();
  const reset = await resetAs(rig, UID, "v1", "r1");
  const ctx = { uid: UID, deps: rig.deps, schedule: () => undefined };
  if (tickFirst) await memoryTick(ctx);
  const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
  const res = await callRoute(rig, seedAdvanceRoute, { requestId: testId("adv"), fixtureNamespace: reset.body.fixtureNamespace, to: tsFromMs(world + hours * HOUR) }, { token: `token:${UID}` });
  expect(res.status).toBe(200);
  const offer = await heroOffer(ctx, 0);
  const p = offer?.pattern;
  return p === undefined ? null : { status: p.status, mostly: p.mostly, total: p.totalCents, late: p.lateCents, orders: p.orderCount, line: offer!.line };
}

describe("the hero across a jump", () => {
  for (const hours of [16, 40]) {
    it(`a ${hours} h jump with no tick first gives the hero a tick-then-jump gives`, async () => {
      const jumped = await heroAfterJump(false, hours);
      const waited = await heroAfterJump(true, hours);
      expect(waited).toMatchObject({ status: "eligible", total: 18600, late: 12600, orders: 6 });
      expect(jumped).toEqual(waited);
    });
  }
});
