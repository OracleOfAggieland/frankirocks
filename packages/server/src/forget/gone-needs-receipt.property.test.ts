// Feature: forget on the wire (brief 048, ruling 7): gone needs a receipt. For any interleaving of forget job steps
// and session opens, an open carries the acknowledgment exactly when the forget's receipt has `blockedAt` set and the
// open is a fresh call (it answered `connecting`), and at most once. The oracle reads only the stored receipt's
// `blockedAt` and the open's own answer; it never asks the code under test whether an acknowledgment is due.
import { FORGET_ACK_TEXTS, type Ledger, type OpenResponse, type Infer, forgetAckText } from "@franki/core";
import { nrWorldArb, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { openRoute } from "../routes/open";
import { paths } from "../store/paths";
import { callRoute, settle } from "../testing/fakes";
import { fakeCallClose } from "./close-port";
import { forgetReceiptId } from "./fence";
import { WORLD_SESSION, WORLD_UID, type StoredWorld, allDone, forgetJobsOf, forgetMemory, stepAll, storeWorld, worldResolver } from "./testing/world";

type Act = { k: "step" } | { k: "open"; named: boolean };
const actArb: fc.Arbitrary<Act> = fc.oneof(fc.constant<Act>({ k: "step" }), fc.boolean().map<Act>((named) => ({ k: "open", named })));

type OpenRes = Infer<typeof OpenResponse>;

async function open(s: StoredWorld, n: number, named: boolean): Promise<OpenRes> {
  const r = s.rig;
  const body = { requestId: testId(`gone-open-${n}`), initiator: "user", previousSessionId: named ? WORLD_SESSION : null, clientZone: "America/Chicago", visitId: null };
  const res = (await settle(callRoute(r, openRoute, body), r.clock, r.timers)).value;
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as OpenRes;
}

const ackOf = (o: OpenRes): string | null => (o.proactive !== null && (FORGET_ACK_TEXTS as readonly string[]).includes(o.proactive.whisper.text) ? o.proactive.whisper.text : null);

describe("gone needs a receipt (brief 048, ruling 7)", () => {
  it("an open carries the acknowledgment exactly when blockedAt is set, and at most once", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, fc.array(actArb, { maxLength: 24 }), async (w, acts) => {
        const s = await storeWorld(w);
        s.rig.deps.forgetResolve = worldResolver(s);
        const { store, hasher } = s.rig.deps;
        const fenced = await forgetMemory(s, w.target, "gone-1");
        if (fenced.kind === "refused") throw new Error("refused");
        const receiptPath = paths.ledger(WORLD_UID, forgetReceiptId(fenced.opId, hasher));
        const blockedAt = async () => {
          const r = (await store.get<Ledger>(WORLD_UID, receiptPath))?.data;
          return r !== undefined && r.kind === "forgetReceipt" ? r.payload.blockedAt : null;
        };
        const closer = fakeCallClose(() => "closed");
        let delivered = 0;
        let opens = 0;
        // The generated interleaving, then the job run out and two more opens: once blockedAt is set, the next fresh
        // open must carry it.
        const tail: Act[] = [...Array.from({ length: 40 }, () => ({ k: "step" }) as Act), { k: "open", named: true }, { k: "open", named: false }];
        for (const a of [...acts, ...tail]) {
          if (a.k === "step") {
            if (!(await allDone(store))) await stepAll(s, closer);
            continue;
          }
          const o = await open(s, opens++, a.named);
          const set = (await blockedAt()) !== null;
          const expected = o.state === "connecting" && set && delivered === 0;
          const said = ackOf(o);
          expect(said !== null, `open ${opens - 1}: state ${o.state}, blockedAt ${set ? "set" : "null"}, delivered ${delivered}, proactive ${JSON.stringify(o.proactive?.whisper.text ?? null)}`).toBe(expected);
          if (said !== null) {
            delivered += 1;
            const job = (await forgetJobsOf(store)).find((j) => j.job.payload.kind === "forget" && j.job.payload.opId === fenced.opId)!.job.payload;
            if (job.kind !== "forget" || job.ack === null) throw new Error("an acknowledgment with no ack on the job");
            const ack = job.ack;
            expect(said).toBe(forgetAckText(ack.kind, "askAllergies" in ack ? ack.askAllergies : false));
          }
        }
        expect(delivered, "the acknowledgment was never delivered").toBe(1);
      }),
      { numRuns: 60 },
    );
  }, 600_000);
});
