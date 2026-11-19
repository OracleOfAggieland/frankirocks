// Brief 053 (owner, Nov 18): company mode is off unless FRANKI_COMPANY_MODE is "on". A walk-in or keep-it-between-us
// answer no longer ends the call, and an account an earlier company hit narrowed opens private again.
import { type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { TEST_ENV, runScheduled, testRig } from "../testing/fakes";
import { meetAlreadyHappened } from "../testing/meet";
import { resetAs } from "../testing/seed";
import { ScriptCall } from "../testing/voice-call";

const UID = "owner-1";
const ZONE = "America/Chicago";

async function setUp(companyMode: "on" | "off") {
  const env: Record<string, string> = { ...TEST_ENV };
  if (companyMode === "off") delete env.FRANKI_COMPANY_MODE;
  const rig = testRig(env);
  rig.openai.always("responses.create", ok(completed("All right.")));
  rig.openai.always("realtime.calls.hangup", ok(null));
  await resetAs(rig, UID, "v1", "r1", ZONE);
  await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
  return { rig, env };
}

async function call(rig: ReturnType<typeof testRig>) {
  const c = new ScriptCall(rig, ZONE);
  await c.ev({ type: "visitSet", visitId: testId("visit-v1") });
  await c.press();
  return c;
}

const audienceOf = async (rig: ReturnType<typeof testRig>, sessionId: string) => (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data;

describe("brief 053: company mode off", () => {
  it.each([
    ["a walk-in", { company: 0.9 }, "My cousin is reading over my shoulder."],
    ["keep it between us", { quiet: 0.9 }, "Keep that between us."],
  ])("%s keeps the call up and private", async (_name, answer, line) => {
    const { rig } = await setUp("off");
    const c = await call(rig);
    const a = c.st.session!.sessionId;
    rig.openai.script("decisions.create", ok(decisionAnswer(answer)));
    await c.type(line);
    await runScheduled(rig);
    const s = await audienceOf(rig, a);
    expect(s.audience).toBe("private");
    expect(s.status).toBe("active");
    expect(c.st.session?.sessionId).toBe(a);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
  });

  it("an account a company hit narrowed opens private once company mode is off", async () => {
    const { rig, env } = await setUp("on");
    const first = await call(rig);
    const a = first.st.session!.sessionId;
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await first.type("My cousin is reading over my shoulder.");
    await runScheduled(rig);
    expect((await audienceOf(rig, a)).audience).not.toBe("private");
    first.take();

    delete env.FRANKI_COMPANY_MODE;
    rig.clock.advance(60_000);
    const second = await call(rig);
    const open = second.take().answers.find((x) => x.route === "open");
    expect(open?.status).toBe(200);
    expect(open?.body.audience).toBe("private");
  });
});
