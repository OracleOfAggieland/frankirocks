// Brief 030 part A (question V-181 of brief 026's report): the tool door. Brief 035's property 1 probes the turn,
// state and open routes after a narrowing; this one probes `/api/tool`. For any way a company or quiet hit arrives,
// once it commits, a tool call on that Session for the narrowing turn (a recall that names the S1 line, or an
// inspect) carries no Head, note or result above S0, as the turn route's answer on that Session does not. Each case
// calls twice: with the stamp the browser holds after the narrowing answer (often stale), and with the Session's
// current stamp read from the store, so a stale answer can't make the property pass by saying nothing.
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentStamp } from "../deck";
import { readCoreDocs } from "../core-docs";
import { storeReader } from "../head-build";
import { callRoute } from "../testing/fakes";
import { UID, doorArb, leaks, narrowedState, runDoor, sessionOf } from "../testing/audience-doors";
import { toolRoute } from "./tool";

const RECALL = { purpose: "answer", query: "boss personal fact", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };

describe("brief 030 part A: a narrowing, then the tool door", () => {
  it("a tool call on the narrowed Session lets nothing above S0 through", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(doorArb, fc.constantFrom("answer", "inspect"), async (door, purpose) => {
        const n = await runDoor(door);
        const what = `${JSON.stringify(door)} ${purpose}`;
        expect((await narrowedState(n)).audience, `${what}: audience`).not.toBe("private");
        const core = await readCoreDocs(storeReader(n.rig.store, UID), UID);
        const s = await sessionOf(n.rig, n.id);
        const fresh = currentStamp(n.id as never, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
        for (const [k, stamp] of [["held", n.stamp], ["current", fresh]] as const) {
          const res = await callRoute(n.rig, toolRoute, {
            requestId: testId(`tool-door-${k}`),
            stamp: { ...stamp, turnId: testId("turn-1") },
            callId: "call_1",
            tool: { name: "recall", args: { ...RECALL, purpose } },
          });
          const answer = { route: "tool", sessionId: n.id, status: res.status, body: res.body };
          expect(leaks(answer), `${what} ${k}`).toEqual([]);
          // A result the tool route lets out is S0 only, whatever the door.
          const notes: { sens: string }[] = res.body?.result?.notes ?? [];
          expect(notes.filter((x) => x.sens !== "S0"), `${what} ${k}: result notes`).toEqual([]);
          const told: { sens: string }[] = res.body?.result?.snapshot?.overview?.recentTold ?? [];
          expect(told.filter((x) => x.sens !== "S0"), `${what} ${k}: recent told`).toEqual([]);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
