// Brief 045 part D, property 2: a receipt counts only for what was sent. The hero offer is rendered for Session A
// (and, in some runs, rendered again for Session B). For any receipts, on either Session, naming the moment or not,
// with a client-chosen pending ID or not, and with a call on that Session or not: when no Permit issued to the
// receipt's Session carried the moment, nothing is recorded: the moment's admission, playback and said fields are
// unchanged, and no showing, delivery or Gate row is written.
import { type Ledger, type Moment, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { callRoute, patchRecord } from "../testing/fakes";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";
import { momentsOf } from "../time/testing";
import { receiptRoute } from "./receipt";
import { heroOffer } from "./tool-food";

const SEED = 45102;
const KINDS = ["admitted", "playbackStarted", "playbackEnded", "transcript", "pendingRendered", "cancelled"] as const;

const rowsOf = async (rig: Awaited<ReturnType<typeof hero>>["rig"]) =>
  (await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/ledger/") && ["decision", "gate", "delivery"].includes((r.data as Ledger).kind)).map((r) => r.id).sort();
const fields = (m: Moment) => ({ status: m.status, admittedAt: m.admittedAt, responseId: m.responseId, playbackAt: m.playbackAt, saidAt: m.saidAt });

describe("brief 045 part D: a receipt counts only for what was sent", () => {
  it("receipts naming nothing sent to their Session record nothing", { timeout: 1_200_000 }, async () => {
    let checked = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.constantFrom<"A" | "B">("A", "B"),
        fc.array(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (rerender, on, kinds, nameMoment, withPending, call) => {
          const h = await hero();
          await memoryTick(h.ctx);
          const a = await h.openLine();
          if (a.proactive === null) return;
          const p = a.proactive;
          const b = rerender ? await h.openLine() : { s: await h.open(), proactive: null };
          const sentTo = rerender && b.proactive?.permit.momentIds[0] === p.permit.momentIds[0] ? b.s.sessionId : a.s.sessionId;
          const target = on === "A" ? a.s : b.s;
          if (nameMoment && target.sessionId === sentTo) return; // sent here: counting it is right
          checked++;
          if (call) await patchRecord<Session>(h.rig.store, UID, paths.session(UID, target.sessionId), { status: "active", callId: "rtc_x", registeredCallIds: ["rtc_x"] });
          const offer = await heroOffer(h.ctx, 1);
          const momentId = p.permit.momentIds[0]!;
          const before = fields((await momentsOf(h.rig, UID)).get(momentId)!);
          const rows0 = await rowsOf(h.rig);
          let r = 0;
          for (const kind of kinds) {
            h.rig.clock.advance(10);
            await callRoute(h.rig, receiptRoute, {
              requestId: testId(`rp${++r}`),
              stamp: { ...target.stamp, turnId: p.permit.stamp.turnId },
              responseId: kind === "pendingRendered" ? `shown_${p.turnId}` : "resp_p",
              kind,
              momentIds: nameMoment ? p.permit.momentIds : [],
              noteIds: nameMoment ? p.permit.noteIds : [],
              pendingId: withPending && kind === "pendingRendered" && offer !== null ? offer.pendingId : null,
              permitKind: kind === "admitted" ? "proactive" : null,
              text: kind === "transcript" ? p.whisper.text : null,
            });
          }
          expect(fields((await momentsOf(h.rig, UID)).get(momentId)!)).toEqual(before);
          expect(await rowsOf(h.rig)).toEqual(rows0);
        },
      ),
      { numRuns: 1000, seed: SEED },
    );
    expect(checked).toBeGreaterThan(0);
  });
});
