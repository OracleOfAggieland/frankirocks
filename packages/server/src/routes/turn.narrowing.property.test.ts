// Feature: voice-control, Property 10, server half (task 48; R14.1, R14.5, R14.7; contracts §6 "narrowing needs a
// closed call"). Once a company or quiet hit has narrowed a Session that has a live call (row 8), or a crisis line
// with company or quiet has deferred the swap (row 6), every later `/api/turn` on that Session answers `blocked`
// with no Permit and no notes, whatever it carries: any source, transcript state, verdict, parse, Stamp or clientSeq.
import { type Session } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

const UID = "owner-1";

const narrowingArb = fc.record({
  kind: fc.constantFrom("company", "quiet", "crisisCompany"),
  p: fc.double({ min: 0.3, max: 0.99, noNaN: true }),
  judge: fc.constantFrom("H", "U", "timeout", "error"),
});

const laterArb = fc.record({
  kind: fc.constantFrom("asrFinal", "asrMissing", "asrFailed", "typed"),
  text: fc.constantFrom("What's on for tonight?", "Okay, it's just us now.", "Forget what I said about Sam.", "I'm really not okay.", "Tell me about my week."),
  answer: fc.constantFrom({}, { alone: 0.95 }, { company: 0.9 }, { crisis: 0.6 }, { forget: 0.9 }, { quiet: 0.9 }),
  judge: fc.constantFrom("O", "H", "U", "timeout"),
  stamp: fc.constantFrom("before", "after"),
  seq: fc.constantFrom("next", "ahead", "behind"),
});

describe("Property 10 (server): narrowing needs a closed call", () => {
  it("every turn after a narrowing on the same Session answers blocked with no Permit", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(narrowingArb, fc.array(laterArb, { minLength: 1, maxLength: 4 }), async (n, later) => {
        const rig = testRig();
        rig.openai.always("responses.create", ok(completed("All right.")));
        const s = await openTestSession(rig);
        await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
        const post = (body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);

        const probs = n.kind === "company" ? { company: n.p } : n.kind === "quiet" ? { quiet: n.p } : { crisis: 0.6, company: n.p };
        rig.openai.script("decisions.create", ok(decisionAnswer(probs)));
        const first = await post({ ...asrTurn(s.stamp, 1, "My cousin just sat down.", [{ itemId: "item_1", commitSeq: 1 }]), judge: n.judge });
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        expect(first.body.status).toBe("blocked");
        const after = { ...s.stamp, policyRev: first.body.stamp.policyRev, bundleRev: first.body.stamp.bundleRev, rulesRev: first.body.stamp.rulesRev, epoch: first.body.stamp.epoch };

        let seq = 2;
        for (const [i, t] of later.entries()) {
          const stamp = t.stamp === "before" ? s.stamp : after;
          const clientSeq = t.seq === "next" ? seq : t.seq === "ahead" ? seq + 2 : 1;
          const label = `later-${i}`;
          const items = [{ itemId: `item_l${i}`, commitSeq: 10 + i }];
          let body: Record<string, unknown>;
          if (t.kind === "typed") body = typedTurn(stamp, clientSeq, t.text, label);
          else if (t.kind === "asrFinal") body = { ...asrTurn(stamp, clientSeq, t.text, items, "final", label), judge: t.judge };
          else body = { ...asrTurn(stamp, clientSeq, "", items, t.kind === "asrMissing" ? "missing" : "failed", label), judge: t.judge };
          if (t.kind === "typed" || t.kind === "asrFinal") rig.openai.script("decisions.create", ok(decisionAnswer(t.answer)));
          const res = await post(body);
          const what = `later turn ${i} ${JSON.stringify(t)}: ${JSON.stringify(res.body)}`;
          expect(res.status, what).toBe(200);
          expect(res.body.status, what).toBe("blocked");
          expect(res.body.permit, what).toBeNull();
          expect(res.body.notes, what).toEqual([]);
          seq++;
        }
      }),
      { numRuns: 100 },
    );
  });
});
