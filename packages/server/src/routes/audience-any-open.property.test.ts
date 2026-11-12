// Brief 045 part S, property 1: company outlives any open. For a company Session on a seeded clone and any later
// sequence of opens (naming the last Session, the first, or none, as the typed bar and voice after a reload do), clock
// steps, closes other than the Owner's own hang-up, and jobs: every open's Session is not private, and neither its
// Head nor its Proactive carries anything above S0. No step hangs up as the Owner or says "alone".
import { type Memory, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { turnRoute } from "./turn";

const UID = "owner-1";
const ZONE = "America/Chicago";
const VISIT = testId("visit-v1");

type Step =
  | { kind: "open"; named: "none" | "last" | "first" }
  | { kind: "clock"; ms: number }
  | { kind: "close"; reason: "replace" | "expired" | "error" }
  | { kind: "jobs" };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("open" as const), named: fc.constantFrom<"none" | "last" | "first">("none", "last", "first") }),
  fc.record({ kind: fc.constant("clock" as const), ms: fc.constantFrom(1_000, 11_000, 61_000, 600_000, 86_400_000) }),
  fc.record({ kind: fc.constant("close" as const), reason: fc.constantFrom<"replace" | "expired" | "error">("replace", "expired", "error") }),
  fc.constant({ kind: "jobs" as const }),
);
const narrowArb = fc.constantFrom<"typed" | "live" | "patched">("typed", "live", "patched");

const open = (rig: TestRig, previousSessionId: string | null, label: string) =>
  callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: ZONE, visitId: VISIT });

/** What an open's answer carries above S0: a Head that selects an S1+ Memory, or a Proactive whisper above S0. */
async function aboveS0(rig: TestRig, body: any): Promise<string[]> {
  const out: string[] = [];
  for (const ref of body?.deck?.head?.selectedRefs ?? []) {
    if (ref.type !== "memory") continue;
    const m = await rig.store.get<Memory>(UID, paths.memory(UID, ref.id));
    if (m !== null && m.data.sens !== "S0") out.push(`Head selects ${m.data.sens} memory`);
  }
  const w = body?.proactive?.whisper;
  if (w !== undefined && w !== null && w.sens !== "S0") out.push(`Proactive ${w.sens}: ${w.text}`);
  return out;
}

describe("brief 045 part S, property 1: company outlives any open", () => {
  it("no open after a company Session is private, or carries anything above S0, before the Owner's own hang-up", { timeout: 900_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(narrowArb, fc.array(stepArb, { minLength: 1, maxLength: 6 }), async (narrow, steps) => {
        const rig = testRig();
        rig.openai.always("responses.create", ok(completed("All right.")));
        rig.openai.always("realtime.calls.hangup", ok(null));
        await resetAs(rig, UID, "v1", "r1", ZONE);
        const first = await open(rig, null, "open-a");
        expect(first.status).toBe(200);
        const a: string = first.body.sessionId;
        const stamp = first.body.deck;
        const s = { sessionId: a, epoch: stamp.epoch, policyRev: stamp.policyRev, bundleRev: stamp.bundleRev, rulesRev: stamp.rulesRev, generation: 1 } as never;
        if (narrow === "patched") await patchRecord<Session>(rig.store, UID, paths.session(UID, a), { status: "active", audience: "company" });
        else {
          rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
          if (narrow === "live") {
            await patchRecord<Session>(rig.store, UID, paths.session(UID, a), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
            await settle(callRoute(rig, turnRoute, { ...asrTurn(s, 1, "My boss just walked in.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" }), rig.clock, rig.timers);
          } else await settle(callRoute(rig, turnRoute, typedTurn(s, 1, "My cousin is reading over my shoulder.")), rig.clock, rig.timers);
        }
        expect((await rig.store.get<Session>(UID, paths.session(UID, a)))!.data.audience).not.toBe("private");
        const chain: string[] = [a];
        for (const [i, st] of steps.entries()) {
          const what = `${narrow} step ${i} ${JSON.stringify(st)} of ${JSON.stringify(steps)}`;
          if (st.kind === "clock") rig.clock.advance(st.ms);
          else if (st.kind === "jobs") await settle(rig.sched.runAll(), rig.clock, rig.timers);
          else if (st.kind === "close") await callRoute(rig, closeRoute, { requestId: testId(`close-${i}`), sessionId: chain.at(-1)!, generation: 1, reason: st.reason });
          else {
            const named = st.named === "none" ? null : st.named === "last" ? chain.at(-1)! : chain[0]!;
            const res = await open(rig, named, `open-${i}`);
            expect(res.status, what).toBe(200);
            const session = (await rig.store.get<Session>(UID, paths.session(UID, res.body.sessionId)))!.data;
            expect(session.audience, `${what}: audience`).not.toBe("private");
            expect(await aboveS0(rig, res.body), what).toEqual([]);
            chain.push(res.body.sessionId);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
