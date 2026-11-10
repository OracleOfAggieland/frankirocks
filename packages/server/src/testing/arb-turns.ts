/**
 * Turn-sequence generators and the two-run driver for property 11 (voice-control R20.1.11, R20.5). Plain module.
 *
 * A plan is up to 8 turns, typed or ASR. One turn, `k`, goes wrong in the first run: its parse fails (by deadline
 * or transport) and is repaired, or its transcript is missing and arrives late as a superseding post. The second
 * run is the same plan with nothing going wrong. `observe` reads what the property compares.
 */
import { type CoreEpoch, type Evidence, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { fail, never } from "../openai/fake";
import { stateRoute } from "../routes/state";
import { extractJobId } from "../worker/extract-jobs";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, settle, testRig } from "./fakes";
import { asrTurn, openTestSession, typedTurn } from "./session-fixtures";

export interface Plan {
  kinds: ("typed" | "asr")[];
  k: number;
  how: "deadline" | "transport" | "supersede";
}

export const arbPlan: fc.Arbitrary<Plan> = fc
  .record({ kinds: fc.array(fc.constantFrom<"typed" | "asr">("typed", "asr"), { minLength: 1, maxLength: 8 }), k: fc.nat({ max: 7 }), how: fc.constantFrom<Plan["how"]>("deadline", "transport", "supersede") })
  .map((p) => {
    const k = p.k % p.kinds.length;
    const kinds = [...p.kinds];
    // A missing transcript is an ASR thing.
    if (p.how === "supersede") kinds[k] = "asr";
    return { kinds, k, how: p.how };
  });

const UID = "owner-1";
const text = (i: number) => `turn number ${i} about the garden`;

export interface Observed {
  session: Pick<Session, "audience" | "committedParseSeq" | "nextClientSeq" | "lastClientSeq"> & { lease: boolean };
  policyRev: number;
  turns: { parseState: Turn["parseState"]; uncertainSpeaker: number; state: Turn["state"]; text: string | null; evidence: string | null; job: boolean }[];
  later: { status: string; permit: string | null }[];
  ack: boolean;
}

/** Runs a plan; `wrong` makes turn k go wrong as the plan says. */
export async function runPlan(plan: Plan, wrong: boolean): Promise<Observed> {
  const rig = testRig();
  const s = await openTestSession(rig);
  const go = (body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
  const later: Observed["later"] = [];
  for (let i = 1; i <= plan.kinds.length; i++) {
    const k = i - 1 === plan.k;
    const asr = plan.kinds[i - 1] === "asr";
    const items = [{ itemId: `item_${i}`, commitSeq: i }];
    let res;
    if (k && wrong && plan.how === "supersede") {
      await go(asrTurn(s.stamp, i, "", items, "missing"));
      res = await go({ ...asrTurn(s.stamp, i, text(i), items), requestId: testId(`req-${i}-late`), supersedesRequestId: testId(`req-${i}`) });
    } else {
      if (k && wrong) rig.openai.script("decisions.create", plan.how === "deadline" ? never() : fail(new Error("transport")));
      res = await go(asr ? asrTurn(s.stamp, i, text(i), items) : typedTurn(s.stamp, i, text(i)));
    }
    // Work scheduled after the response (extraction, the repair) runs before the next turn.
    await settle(rig.sched.runAll(), rig.clock, rig.timers);
    if (i - 1 > plan.k) later.push({ status: res.body.status, permit: res.body.permit?.kind ?? null });
  }
  const session = (await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data;
  const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const turns: Observed["turns"] = [];
  for (let i = 1; i <= plan.kinds.length; i++) {
    const t = (await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId(`turn-${i}`))))!.data;
    const ev = t.evidenceId === null ? null : await rig.store.get<Evidence>(UID, paths.evidence(UID, t.evidenceId));
    const evText = ev === null ? null : ev.data.text?.kind === "inline" ? ev.data.text.text : null;
    const job = t.evidenceId === null ? null : await rig.store.get(UID, paths.job(UID, extractJobId(t.evidenceId, rig.deps.hasher)));
    turns.push({ parseState: t.parseState, uncertainSpeaker: t.uncertainSpeaker, state: t.state, text: t.text, evidence: evText, job: job !== null });
  }
  const state = await settle(callRoute(rig, stateRoute, { sessionId: s.sessionId, generation: 1, seen: { epoch: 1, policyRev: epoch.policyRev, bundleRev: s.deck.bundleRev, rulesRev: s.deck.rulesRev }, ackStamp: null, speechStartedOpsAt: null }), rig.clock, rig.timers);
  return {
    session: { audience: session.audience, committedParseSeq: session.committedParseSeq, nextClientSeq: session.nextClientSeq, lastClientSeq: session.lastClientSeq, lease: session.parseLease !== null },
    policyRev: epoch.policyRev,
    turns,
    later,
    ack: state.value.body?.ack != null,
  };
}
