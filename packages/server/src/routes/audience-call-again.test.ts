// Brief 045 part S, finding 4 through a live call (part V's call steps): a company hit ends a call; the next call
// on the clone, whose first open says the S1 wish, opens company and nothing unprompted but the swap line is heard on it.
import { COMPANY_LINE, IDLE_SILENCE_MS, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { runScheduled, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { meetAlreadyHappened } from "../testing/meet";
import { ScriptCall } from "../testing/voice-call";

const UID = "owner-1";
const ZONE = "America/Chicago";
const WISH = "Good luck at 2 PM: Tessellate Labs final interview.";

async function call(rig: ReturnType<typeof testRig>) {
  const c = new ScriptCall(rig, ZONE);
  await c.ev({ type: "visitSet", visitId: testId("visit-v1") });
  await c.press();
  return c;
}

describe("brief 045 part S: a company call, then call again", () => {
  it("the company hit ends the call; on the next call nothing unprompted but the swap line is heard", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", ok(completed("All right.")));
    rig.openai.always("realtime.calls.hangup", ok(null));
    await resetAs(rig, UID, "v1", "r1", ZONE);
    // Brief 052 (M-1): a sample visit now meets Franki first; this test is about the line after, so the meeting is over.
    await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
    const first = await call(rig);
    expect(first.take().heard).toContain(WISH);
    const a = first.st.session!.sessionId;
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await first.type("My cousin is reading over my shoulder.");
    await runScheduled(rig);
    expect((await rig.store.get<Session>(UID, paths.session(UID, a)))!.data.audience).not.toBe("private");
    first.take();

    rig.clock.advance(60_000);
    const second = await call(rig);
    await second.quiet(IDLE_SILENCE_MS);
    await second.quiet(IDLE_SILENCE_MS);
    const log = second.take();
    const open = log.answers.find((x) => x.route === "open");
    expect(open?.status).toBe(200);
    expect(open?.body.audience).not.toBe("private");
    // The swap line is the one line an inherited audience may open with (finding 4, V-186); nothing else plays.
    expect(log.heard.every((h) => h === COMPANY_LINE), JSON.stringify(log.heard)).toBe(true);
    expect(log.heard).not.toContain(WISH);
  });

  it("the Owner's own hang-up widens (V-172): the next call is private and may say the wish", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", ok(completed("All right.")));
    rig.openai.always("realtime.calls.hangup", ok(null));
    await resetAs(rig, UID, "v1", "r1", ZONE);
    // Brief 052 (M-1): a sample visit now meets Franki first; this test is about the line after, so the meeting is over.
    await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
    const first = await call(rig);
    const a = first.st.session!.sessionId;
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await first.type("My cousin is reading over my shoulder.");
    await first.hangUp();
    await runScheduled(rig);
    expect((await rig.store.get<Session>(UID, paths.session(UID, a)))!.data.audience).toBe("private");
    rig.clock.advance(60_000);
    const second = await call(rig);
    expect(second.take().answers.find((x) => x.route === "open")?.body.audience).toBe("private");
  });
});
