// Brief 035, new property 2: the audience survives the swap. After a narrowing, for any sequence of opens, closes
// with any reason, drops with no close, and clock steps, an open that names a Session in that chain never gets a
// private Head (or a private Session) unless the Owner closed that Session themselves (reason "user") or said they
// are alone (no step here says alone).
import { type Session } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { UID, closeWith, runAll, runDoor, sessionOf } from "../testing/audience-doors";
import { callRoute, patchRecord } from "../testing/fakes";
import { PERSONAL_FACT } from "../testing/two-memories";
import { testId } from "@franki/core/testing";
import { openRoute } from "./open";

type Step =
  | { kind: "open"; pick: number }
  | { kind: "close"; pick: number; reason: "user" | "error" | "expired" }
  | { kind: "drop" }
  | { kind: "clock"; ms: number }
  | { kind: "jobs" };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("open" as const), pick: fc.nat(8) }),
  fc.record({ kind: fc.constant("close" as const), pick: fc.nat(8), reason: fc.constantFrom<"user" | "error" | "expired">("user", "error", "expired") }),
  fc.constant({ kind: "drop" as const }),
  fc.record({ kind: fc.constant("clock" as const), ms: fc.constantFrom(1_000, 5_000, 9_000, 11_000, 13_000, 30_000, 61_000, 600_000) }),
  fc.constant({ kind: "jobs" as const }),
);

const doorKindArb = fc.constantFrom<"onTurn" | "crisisLive" | "typedNoCall" | "replaced">("onTurn", "crisisLive", "typedNoCall", "replaced");

describe("brief 035 property 2: the audience survives the swap", () => {
  it("an open naming a Session in the chain is never private unless the Owner closed that Session", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(doorKindArb, fc.array(stepArb, { minLength: 1, maxLength: 8 }), async (kind, steps) => {
        const n = await runDoor({ kind, cls: "company", p: 0.9, judge: "H" });
        const { rig } = n;
        const chain: string[] = [n.id];
        const userClosed = new Set<string>();
        for (const [i, st] of steps.entries()) {
          const what = `${kind} step ${i} ${JSON.stringify(st)} of ${JSON.stringify(steps)}`;
          if (st.kind === "clock") rig.clock.advance(st.ms);
          else if (st.kind === "jobs") await runAll(rig);
          else if (st.kind === "drop") continue;
          else if (st.kind === "close") {
            const id = chain[st.pick % chain.length]!;
            const res = await closeWith(rig, id, st.reason, `close-${i}`);
            if (res.status === 200 && st.reason === "user") userClosed.add(id);
          } else {
            const named = chain[st.pick % chain.length]!;
            const res = await callRoute(rig, openRoute, { requestId: testId(`open-${i}`), initiator: "user", previousSessionId: named, clientZone: "UTC", visitId: null });
            expect(res.status, what).toBe(200);
            if (res.body.state !== "connecting") continue;
            const id: string = res.body.sessionId;
            if (!userClosed.has(named)) {
              expect(res.body.deck.head.text.includes(PERSONAL_FACT), `${what}: a private Head`).toBe(false);
              expect((await sessionOf(rig, id)).audience, `${what}: a private Session`).not.toBe("private");
            }
            // The fresh call connects, as the browser's would.
            await patchRecord<Session>(rig.store, UID, paths.session(UID, id), { status: "active", registeredCallIds: [`rtc_${i}`], callId: `rtc_${i}` });
            // An open naming a Session the Owner closed may start private: it leaves the chain.
            if (!userClosed.has(named)) chain.push(id);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
