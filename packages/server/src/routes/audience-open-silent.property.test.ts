// Brief 045 part S, property 2: an inherited audience opens silent. On a seeded clone, whose open would otherwise
// say an S1 wish, for any earlier Session in any non-private state (company or unknown; active, closing or closed;
// no wait, a wait still running or one expired; with or without a crisis) and any open naming it or none, after any
// clock step: when the new Session is not private, its `proactive` is the swap line or null.
import { COMPANY_LINE, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openRoute } from "./open";

const UID = "owner-1";
const ZONE = "America/Chicago";
const VISIT = testId("visit-v1");

const priorArb = fc.record({
  audience: fc.constantFrom<"company" | "unknown">("company", "unknown"),
  status: fc.constantFrom<"active" | "closing" | "closed">("active", "closing", "closed"),
  wait: fc.constantFrom<"none" | "running" | "expired">("none", "running", "expired"),
  crisis: fc.boolean(),
  named: fc.boolean(),
  clockMs: fc.constantFrom(0, 1_000, 30_000, 600_000),
});

describe("brief 045 part S, property 2: an inherited audience opens silent", () => {
  it("an open whose Session is not private says the swap line or nothing", { timeout: 900_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(priorArb, async (p) => {
        const rig = testRig();
        await resetAs(rig, UID, "v1", "r1", ZONE);
        const open = (previousSessionId: string | null, label: string) =>
          callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: ZONE, visitId: VISIT });
        const a = await open(null, "open-a");
        expect(a.status).toBe(200);
        const ops = rig.clock.read().opsClock.now;
        const waitDeadline = p.wait === "none" ? null : tsFromMs(p.wait === "running" ? ops + 60_000 : ops - 1_000);
        const crisis = p.crisis ? tsFromMs(ops) : null;
        await patchRecord<Session>(rig.store, UID, paths.session(UID, a.body.sessionId), { audience: p.audience, status: p.status, waitDeadline, modifiers: { rushed: null, crisis } });
        rig.clock.advance(1_000 + p.clockMs);
        const b = await open(p.named ? a.body.sessionId : null, "open-b");
        expect(b.status).toBe(200);
        const session = (await rig.store.get<Session>(UID, paths.session(UID, b.body.sessionId)))!.data;
        if (session.audience === "private") return;
        const said = b.body.proactive?.whisper?.text ?? null;
        expect(said === null || said === COMPANY_LINE, `${JSON.stringify(p)}: ${session.audience} said ${said}`).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });
});
