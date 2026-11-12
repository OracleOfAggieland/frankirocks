// Feature: what a call puts on the screen (brief 044), Property: a tap narrows like the words do.
// Spec line 211: company is set by the owner's words or a tap. For any Session state (a call open or not) reached by
// any sequence of earlier turns (ordinary lines, company and alone lines, company and alone taps), a `company` tap
// and the line "My boss just walked in." leave the same audience, the same policyRev step, the same next Head and
// the same hang-up. One exception, by ruling SB-224: on a Session that is already company with no call open, the
// words raise policyRev again (row 9 runs on every company line) and the tap changes nothing ("twice in a row is
// one change"); there the property asserts that the tap is a no-op with the same audience and Head.
// Runs the real turn route on the in-memory store with the fake Decisions port; the tap makes no model call.
import type { CoreBundle, CoreEpoch } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { UID, doorRig, postTurn, runAll, sessionOf, stampAfter } from "../testing/audience-doors";
import { decisionAnswer } from "../testing/decisions";
import type { TestRig } from "../testing/fakes";
import { asrTurn, typedTurn } from "../testing/session-fixtures";

type Stamp = Parameters<typeof stampAfter>[0];
type Move = "ordinary" | "companyLine" | "aloneLine" | "companyTap" | "aloneTap";

const arbCase = fc.record({
  live: fc.boolean(),
  before: fc.array(fc.constantFrom<Move>("ordinary", "companyLine", "aloneLine", "companyTap", "aloneTap"), { maxLength: 3 }),
});

const HIT: Record<Move, Record<string, number>> = {
  ordinary: {},
  companyLine: { company: 0.9 },
  aloneLine: { alone: 0.9 },
  companyTap: {},
  aloneTap: {},
};
const TEXT: Record<Move, string> = {
  ordinary: "What's on for tonight?",
  companyLine: "My boss just walked in.",
  aloneLine: "It's just us now.",
  companyTap: "",
  aloneTap: "",
};

function tap(stamp: Stamp, verb: "company" | "alone", label: string) {
  return {
    ...typedTurn(stamp, 1, "", label),
    turnId: testId(`tap-${label}`),
    requestId: testId(`tapreq-${label}`),
    source: "trustedTap",
    uiControl: { verb, targetIds: [] },
  };
}

interface World {
  rig: TestRig;
  sessionId: string;
  stamp: Stamp;
  seq: number;
  live: boolean;
}

async function move(w: World, m: Move, label: string): Promise<void> {
  let body: Record<string, unknown>;
  if (m === "companyTap" || m === "aloneTap") body = tap(w.stamp, m === "companyTap" ? "company" : "alone", label);
  else {
    w.rig.openai.script("decisions.create", ok(decisionAnswer(HIT[m])));
    body = w.live ? { ...asrTurn(w.stamp, w.seq, TEXT[m], [{ itemId: `item_${label}`, commitSeq: w.seq }], "final", label), judge: "H" } : typedTurn(w.stamp, w.seq, TEXT[m], label);
  }
  const res = await postTurn(w.rig, body);
  if (res.status === 200 && m !== "companyTap" && m !== "aloneTap" && res.body.status !== "stale" && res.body.status !== "hold") w.seq += 1;
  if (res.status === 200) w.stamp = stampAfter(w.stamp, res.body);
  await runAll(w.rig);
}

const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const headOf = async (rig: TestRig) => (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data.head?.text ?? null;

/** Plays the earlier moves, then the last one, and reads what the last one left. */
async function play(c: { live: boolean; before: readonly Move[] }, last: "companyLine" | "companyTap") {
  const { rig, s } = await doorRig(c.live);
  const w: World = { rig, sessionId: s.sessionId, stamp: s.stamp, seq: 1, live: c.live };
  for (const [i, m] of c.before.entries()) await move(w, m, `b${i}`);
  const pre = await sessionOf(rig, w.sessionId);
  const policyRev = (await epochOf(rig)).policyRev;
  await move(w, last, "last");
  const after = await sessionOf(rig, w.sessionId);
  return {
    preAudience: pre.audience,
    preLive: pre.registeredCallIds.length > 0 && (pre.status === "active" || pre.status === "minting"),
    audience: after.audience,
    status: after.status,
    narrowedWait: after.waitDeadline !== null,
    step: (await epochOf(rig)).policyRev - policyRev,
    head: await headOf(rig),
    hangups: rig.openai.requestsTo("realtime.calls.hangup").length,
  };
}

describe("Property: a tap narrows like the words do", () => {
  it("a company tap and the company line leave the same audience, policyRev step, next Head and hang-up", async () => {
    await fc.assert(
      fc.asyncProperty(arbCase, async (c) => {
        const words = await play(c, "companyLine");
        const tapped = await play(c, "companyTap");
        expect(tapped.preAudience).toBe(words.preAudience);
        expect(tapped.audience).toBe(words.audience);
        expect(tapped.head).toBe(words.head);
        expect(tapped.status).toBe(words.status);
        expect(tapped.narrowedWait).toBe(words.narrowedWait);
        expect(tapped.hangups).toBe(words.hangups);
        if (words.preAudience === "company" && !words.preLive) expect(tapped.step).toBe(0);
        else expect(tapped.step).toBe(words.step);
      }),
      { numRuns: 1_000 },
    );
  }, 600_000);
});
