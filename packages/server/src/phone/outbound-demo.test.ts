// Kiroween Demo (R14.1, R14.2): a demo visitor never dials. `placePhoneCall` answers the demo line before the settings,
// the claim and any ledger row, and a demo visit's typed turn offers `read_money` but no phone tool. The context is
// built here with `anonymous` set, as `runRoute` sets it from the verified token.
import type { Ledger, Stamp } from "@franki/core";
import { describe, expect, it, vi } from "vitest";
import { DEMO_PHONE_LINE } from "../demo/guards";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import type { RouteContext } from "../routes/runtime";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { TEST_ENV, settle, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { phoneId, placePhoneCall, queued } from "./outbound";
import type { dialTwilio } from "./twilio";

const UID = "owner-1";
const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test-secret" };
const text = "Call +1 (415) 555-0123 and ask when the shop opens.";
const intent = normalizeResponse({ status: "completed", output: [{ type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" }] });

async function setup() {
  const rig = testRig({ ...env, FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" });
  const dial = vi.fn<typeof dialTwilio>().mockResolvedValue("CA" + "a".repeat(32));
  rig.deps.dial = dial;
  const session = await openTestSession(rig);
  const ctx = (anonymous?: boolean): RouteContext => ({ uid: UID, deps: rig.deps, schedule: rig.sched.schedule, startedOpsAt: rig.clock.read().opsClock.now, origin: "https://frankirocks.com", ...(anonymous === undefined ? {} : { anonymous }) });
  return { rig, dial, session, ctx };
}

const phoneRows = async (rig: Awaited<ReturnType<typeof setup>>["rig"]) =>
  (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "phoneCall");

describe("no phone on a demo visit (Kiroween Demo)", () => {
  it("placePhoneCall answers the demo line and writes nothing, for any stamp", async () => {
    const { rig, dial, session, ctx } = await setup();
    const stamp: Stamp = { ...session.stamp, turnId: "t-demo" } as Stamp;
    const c = ctx(true);
    expect(await placePhoneCall(c, stamp)).toBe(DEMO_PHONE_LINE);
    expect(dial).not.toHaveBeenCalled();
    expect(await rig.store.get(UID, paths.ledger(UID, phoneId(c, stamp)))).toBeNull();
    expect(await phoneRows(rig)).toEqual([]);
  });

  it("a demo visit's typed turn offers read_money and no phone tool, and dials nothing when the model asks", async () => {
    const { rig, dial, session, ctx } = await setup();
    rig.openai.script("responses.create", ok(intent));
    const req = turnRoute.parse({ body: typedTurn(session.stamp, 1, text), query: new URLSearchParams() });
    const { value } = await settle(turnRoute.run(ctx(true), req), rig.clock, rig.timers);
    expect((value as { notes: { text: string }[] }).notes.map((n) => n.text)).not.toContain(queued);
    const reply = rig.openai.requestsTo("responses.create").map((r) => (r.body as { tools?: { name: string }[] }).tools ?? []).find((t) => t.length > 0) ?? [];
    expect(reply.map((t) => t.name)).toEqual(["read_money"]);
    expect(dial).not.toHaveBeenCalled();
    expect(await phoneRows(rig)).toEqual([]);
  });

  it("anyone else's typed turn still offers the phone and dials, as before", async () => {
    const { rig, dial, session, ctx } = await setup();
    rig.openai.script("responses.create", ok(intent));
    const req = turnRoute.parse({ body: typedTurn(session.stamp, 1, text), query: new URLSearchParams() });
    const { value } = await settle(turnRoute.run(ctx(false), req), rig.clock, rig.timers);
    expect((value as { notes: { text: string }[] }).notes[0]?.text).toBe(queued);
    const reply = rig.openai.requestsTo("responses.create").map((r) => (r.body as { tools?: { name: string }[] }).tools ?? []).find((t) => t.length > 0) ?? [];
    expect(reply.map((t) => t.name)).toEqual(["make_phone_call", "read_money", "read_phone_result"]);
    expect(dial).toHaveBeenCalledTimes(1);
  });
});
