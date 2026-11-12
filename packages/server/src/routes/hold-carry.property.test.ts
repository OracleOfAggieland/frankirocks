// Brief 045 part S, property 3: a hold outlives a hang-up. On a fixture tenant whose open moment is an insight, a
// celebration or an ask (one occasion's moment, its kind set so; with no hold it is said as the opener), after a
// crisis or life-change turn (a regex line, or a crisis or transition candidate in the parse), and any steps inside
// `HOLD_CARRY_MS` of world time (closes with any reason, opens naming the last Session or none, idle polls, world
// and ops steps): no opening or idle line is an insight, a celebration or an ask.
import { type CoreState, type Moment, type Session, localMinuteAt } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOLD_CARRY_MS } from "../audience-swap";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { typedTurn } from "../testing/session-fixtures";
import { momentsOf, setWorld, timeTenant, worldOf, writeOccasion } from "../time/testing";
import { memoryTick } from "../time/tick";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { stateRoute } from "./state";
import { turnRoute } from "./turn";

const UID = "owner-1";
const ZONE = "America/Chicago";
const DAY = "2026-11-13";
const VISIT = testId("visit-v1");
const HELD: readonly Moment["kind"][] = ["insight", "celebrate", "ask", "expiryAsk", "griefAsk"];

const holdArb = fc.constantFrom(
  { text: "My mom passed away last night.", probs: {} },
  { text: "I was diagnosed with cancer last week.", probs: {} },
  { text: "I feel hopeless about all of it.", probs: {} },
  { text: "I can't do this anymore.", probs: { crisis: 0.6 } },
  { text: "Things are really different at home now.", probs: { transition: 0.7 } },
);
type Step =
  | { kind: "open"; named: boolean }
  | { kind: "close"; reason: "user" | "replace" | "expired" | "error" }
  | { kind: "idle" }
  | { kind: "time"; ms: number };
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("open" as const), named: fc.boolean() }),
  fc.record({ kind: fc.constant("close" as const), reason: fc.constantFrom<"user" | "replace" | "expired" | "error">("user", "replace", "expired", "error") }),
  fc.constant({ kind: "idle" as const }),
  fc.record({ kind: fc.constant("time" as const), ms: fc.constantFrom(60_000, 16 * 60_000, 3_600_000, 6 * 3_600_000) }),
);

interface Open {
  id: string;
  deck: any;
}

describe("brief 045 part S, property 3: a hold outlives a hang-up", () => {
  it("inside the carry window no opening or idle line is an insight, a celebration or an ask", { timeout: 900_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<Moment["kind"]>("insight", "celebrate", "ask"), holdArb, fc.array(stepArb, { minLength: 1, maxLength: 6 }), async (kind, hold, steps) => {
        const rig = testRig();
        rig.openai.always("responses.create", ok(completed("I'm so sorry.")));
        const ctx = await timeTenant(rig, UID, ZONE, localMinuteAt(DAY, 8 * 60 + 40, ZONE)!);
        await patchRecord<CoreState>(rig.store, UID, paths.core(UID, "state"), { visitId: VISIT });
        await writeOccasion(rig, UID, "0", localMinuteAt(DAY, 14 * 60, ZONE)!, ZONE);
        await memoryTick(ctx);
        for (const [id, m] of await momentsOf(rig, UID)) if (m.kind === "wish") await patchRecord<Moment>(rig.store, UID, paths.moment(UID, id), { kind });

        const said: { where: string; body: any }[] = [];
        const open = async (previousSessionId: string | null, label: string): Promise<Open> => {
          const res = await callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: ZONE, visitId: VISIT });
          expect(res.status, label).toBe(200);
          said.push({ where: label, body: res.body });
          return { id: res.body.sessionId, deck: res.body.deck };
        };
        const chain: Open[] = [await open(null, "open-a")];
        // The first open may say the line: the hold starts with the next turn.
        said.length = 0;
        const a = chain[0]!;
        const stamp = { sessionId: a.id, epoch: a.deck.epoch, policyRev: a.deck.policyRev, bundleRev: a.deck.bundleRev, rulesRev: a.deck.rulesRev, generation: 1 } as never;
        rig.openai.script("decisions.create", ok(decisionAnswer(hold.probs)));
        const t = await settle(callRoute(rig, turnRoute, typedTurn(stamp, 1, hold.text)), rig.clock, rig.timers).then((r) => r.value);
        expect(t.status).toBe(200);

        let elapsed = 0;
        for (const [i, st] of steps.entries()) {
          const last = chain.at(-1)!;
          if (st.kind === "time") {
            if (elapsed + st.ms >= HOLD_CARRY_MS - 60_000) continue;
            elapsed += st.ms;
            rig.clock.advance(st.ms);
            await setWorld(rig, UID, (await worldOf(rig, UID)) + st.ms);
          } else if (st.kind === "close") {
            await callRoute(rig, closeRoute, { requestId: testId(`close-${i}`), sessionId: last.id, generation: 1, reason: st.reason });
          } else if (st.kind === "open") {
            chain.push(await open(st.named ? last.id : null, `open-${i}`));
          } else {
            // An idle poll after the silence, on a live Session.
            await patchRecord<Session>(rig.store, UID, paths.session(UID, last.id), { status: "active" });
            rig.clock.advance(10_000);
            const d = last.deck;
            const res = await callRoute(rig, stateRoute, { sessionId: last.id, generation: 1, seen: { epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
            said.push({ where: `idle-${i}`, body: res.body });
          }
        }
        const moments = await momentsOf(rig, UID);
        for (const s of said) {
          for (const id of s.body?.proactive?.permit?.momentIds ?? []) {
            const m = moments.get(id);
            expect(m === undefined || !HELD.includes(m.kind), `${s.where}: said a ${m?.kind} (${JSON.stringify({ kind, hold, steps })})`).toBe(true);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
