import { FAST_SLOTS_DEADLINE_MS, type FastSlotsInput, isIdShape } from "@franki/core";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { FakeFastSlots } from "../testing/fake-fast-slots";
import { TEST_ENV, settle, testRig } from "../testing/fakes";
import { fastSlotsModel, fastSlotsPort } from "./fast-slots-port";

const EID = "e".repeat(43);
const input = (text = "I'm allergic to shellfish."): FastSlotsInput => ({ turn: { eid: EID, text, ownerConfirmed: true }, lastTurns: [], entities: [], targets: [], pendingId: null });
const portOf = (rig: ReturnType<typeof testRig>) => fastSlotsPort({ openai: rig.openai, timers: rig.timers, clock: rig.clock, env: rig.deps.env });

describe("FastSlots port", () => {
  it("sends the core body to responses.create with the bg model and parses the answer", async () => {
    const rig = testRig();
    rig.openai.script("responses.create", ok(completed(JSON.stringify({ items: [], need: "none" }))));
    const { value } = await settle(portOf(rig).slots(input(), FAST_SLOTS_DEADLINE_MS), rig.clock, rig.timers);
    expect(value).toEqual({ kind: "valid", out: { items: [], need: "none" }, ms: 0 });
    const body = rig.openai.requestsTo("responses.create")[0]!.body as { model: string; tools: unknown[]; text: { format: { name: string } } };
    expect(body.model).toBe("test-bg-model");
    expect(body.tools).toEqual([]);
    expect(body.text.format.name).toBe("fast_slots_v1");
    expect(isIdShape(EID)).toBe(true);
  });

  it("a missed deadline is timeout, on the opsClock", async () => {
    const rig = testRig();
    rig.openai.script("responses.create", never());
    const { value, elapsedMs } = await settle(portOf(rig).slots(input(), FAST_SLOTS_DEADLINE_MS), rig.clock, rig.timers);
    expect(value).toEqual({ kind: "timeout", ms: FAST_SLOTS_DEADLINE_MS });
    expect(elapsedMs).toBe(FAST_SLOTS_DEADLINE_MS);
  });

  it("a thrown error is transport; an invalid answer is invalid", async () => {
    const rig = testRig();
    rig.openai.script("responses.create", fail(new Error("boom")), ok(completed("not json")));
    const port = portOf(rig);
    expect((await settle(port.slots(input(), 900), rig.clock, rig.timers)).value).toMatchObject({ kind: "transport" });
    expect((await settle(port.slots(input(), 900), rig.clock, rig.timers)).value).toMatchObject({ kind: "invalid", reason: "notJson" });
  });

  it("a turn too long to send is oversize and makes no call", async () => {
    const rig = testRig();
    const { value } = await settle(portOf(rig).slots(input("a".repeat(6_001)), 900), rig.clock, rig.timers);
    expect(value).toEqual({ kind: "invalid", reason: "oversize", path: null, ms: 0 });
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(0);
  });

  it("the model comes from FRANKI_BG_MODEL", () => {
    expect(fastSlotsModel({ ...TEST_ENV, FRANKI_BG_MODEL: "x-model" })).toBe("x-model");
    expect(() => fastSlotsModel({})).toThrow(/FRANKI_BG_MODEL/);
  });
});

describe("Fake_FastSlots", () => {
  it("answers transport by default, then from its script, and records each input", async () => {
    const f = new FakeFastSlots();
    expect(await f.slots(input(), 900)).toEqual({ kind: "transport", ms: 0 });
    f.script({ kind: "valid", out: { items: [], need: "none" }, ms: 5 });
    expect(await f.slots(input(), 900)).toMatchObject({ kind: "valid" });
    expect(f.calls).toHaveLength(2);
  });

  it("never times out at the caller's deadline on the fake timers", async () => {
    const rig = testRig();
    rig.fastSlots.script({ kind: "never" });
    const { value, elapsedMs } = await settle(rig.deps.fastSlots.slots(input(), 900), rig.clock, rig.timers);
    expect(value).toEqual({ kind: "timeout", ms: 900 });
    expect(elapsedMs).toBe(900);
  });
});
