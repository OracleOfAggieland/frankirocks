// G17 for the correct and transition routes (brief 025 follow-up): a typed line with no call open whose route is known
// at arrival (RX6 or RX7, as RX4 for the hardRule route) starts no ordinary reply. The route's own typed reply is the
// one model call.
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

describe("a typed line whose memory route is known at arrival (G17)", () => {
  for (const text of ["My mom passed away last night.", "I was diagnosed with cancer last week.", "No, that's wrong, her name is Mara."]) {
    it(`makes one reply call: "${text}"`, async () => {
      const rig = testRig();
      const s = await openTestSession(rig);
      rig.openai.always("decisions.create", ok(decisionAnswer({})));
      rig.openai.always("responses.create", ok(completed("Okay.")));
      rig.fastSlots.always({ kind: "valid", out: { items: [], need: "none" }, ms: 10 });
      const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, text));
      expect(res.status).toBe(200);
      expect(rig.openai.requestsTo("responses.create")).toHaveLength(1);
    });
  }
});
