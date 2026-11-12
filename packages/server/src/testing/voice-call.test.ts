// Two calls in one script are two calls: the second's open is a new request, not a replay of the first's (brief 042
// item 7, after part S's call-again test had to renumber its second call by hand).
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { testRig } from "./fakes";
import { resetAs } from "./seed";
import { ScriptCall } from "./voice-call";

const ZONE = "America/Chicago";

async function call(rig: ReturnType<typeof testRig>) {
  const c = new ScriptCall(rig, ZONE);
  await c.ev({ type: "visitSet", visitId: testId("visit-v1") });
  await c.press();
  return c;
}

describe("ScriptCall: each call on a rig has its own IDs", () => {
  it("a second call opens a new Session", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", ok(completed("All right.")));
    rig.openai.always("realtime.calls.hangup", ok(null));
    await resetAs(rig, "owner-1", "v1", "r1", ZONE);
    const first = await call(rig);
    await first.hangUp();
    rig.clock.advance(60_000);
    const second = await call(rig);
    const opens = [first, second].map((c) => c.log.answers.find((a) => a.route === "open"));
    expect(opens.map((o) => o?.status)).toEqual([200, 200]);
    expect(opens[1]!.body.sessionId).not.toBe(opens[0]!.body.sessionId);
  });
});
