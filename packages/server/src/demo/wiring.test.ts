// Brief 054 part C3: the guard rows the properties do not spell out. A demo-only deployment (no Plaid, Google or
// Twilio settings) serves a demo visit's mail and calendar and never the phone, while a signed-in user there reads
// exactly what they read before; and a demo reset with no token key answers CONFIG before anything is written.
import { describe, expect, it } from "vitest";
import { BANK_ENV_VARS } from "../bank/config";
import { specialistCatalog } from "../errands/agent";
import type { RouteContext } from "../routes/runtime";
import { snapshotOf } from "../testing/seed";
import { DEMO_ENV, DEMO_TEST_FIXTURE_ID, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";

const ctxOf = (rig: ReturnType<typeof demoRig>["rig"], uid: string, anonymous?: boolean): RouteContext => ({ uid, deps: rig.deps, schedule: rig.sched.schedule, ...(anonymous === undefined ? {} : { anonymous }) });

describe("the specialist catalog on a demo-only deployment", () => {
  it("offers a demo visit its simulated mail and calendar, by token or by connector, and never the phone", async () => {
    const { rig, live } = demoRig();
    expect((await resetDemo(rig)).status).toBe(200);
    for (const anonymous of [true, undefined]) {
      expect(await specialistCatalog(ctxOf(rig, VISITOR, anonymous))).toStrictEqual({ phone: "unavailable", mail: "ready", calendar: "ready" });
    }
    expect(live.calls).toEqual([]);
  });

  it("answers a signed-in user unavailable, as before, with Google not configured", async () => {
    const { rig } = demoRig();
    expect(await specialistCatalog(ctxOf(rig, "owner-1", false))).toStrictEqual({ phone: "unavailable", mail: "unavailable", calendar: "unavailable" });
  });

  it("never offers a demo visit the phone, even where Twilio is configured", async () => {
    const env = { ...DEMO_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "t", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "s", FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" };
    const { rig } = demoRig(env);
    const origin = "https://frankirocks.com";
    expect((await specialistCatalog({ ...ctxOf(rig, VISITOR, true), origin })).phone).toBe("unavailable");
    expect((await specialistCatalog({ ...ctxOf(rig, "owner-1", false), origin })).phone).toBe("ready");
  });
});

describe("a demo reset with no token key", () => {
  it("answers CONFIG and writes nothing", async () => {
    const env = { ...DEMO_ENV };
    delete env[BANK_ENV_VARS.tokenKey];
    const { rig } = demoRig(env);
    const res = await resetDemo(rig, DEMO_TEST_FIXTURE_ID);
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "CONFIG" });
    // The core documents exist (the visit's first reset creates them), but no barrier was raised and nothing cloned.
    const rows = await snapshotOf(rig.store, VISITOR);
    expect(rows.filter(([p]) => p.includes("/evidence/") || p.includes("/connectors/"))).toEqual([]);
    const epoch = rows.find(([p]) => p.endsWith("/core/epoch"));
    expect(epoch).toBeDefined();
    expect(JSON.parse(epoch![1]).barrier).toBeNull();
  });
});
