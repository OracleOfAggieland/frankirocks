/**
 * The open allergy question (brief 012 design 6.4, G11, CQ 106). Pure: the one function that decides every
 * transition of `AllergyAsk`. A question counts as asked only when the transcript receipt shows it was spoken.
 */
import type { AllergyAsk, AskEvent } from "./types";

/** An asked question stays open for this many user turns whose FastSlots answer wasn't valid. */
export const PENDING_ASK_TURNS = 2;

export function pendingNext(q: AllergyAsk, e: AskEvent): AllergyAsk {
  if (e.kind === "sessionClosed") return { kind: "none" };
  if (e.kind === "ruleGone") return q.kind !== "none" && q.ruleId === e.ruleId ? { kind: "none" } : q;
  switch (q.kind) {
    case "none":
      if (e.kind === "ask") return { kind: "planned", ruleId: e.ruleId, seq: e.seq };
      if (e.kind === "frankiAsked") return { kind: "asked", ruleId: null, askedSeq: e.seq, attempts: 0 };
      return q;
    case "planned":
      if (e.kind === "ask") return { kind: "planned", ruleId: e.ruleId, seq: e.seq };
      if (e.kind === "spoken") return e.question ? { kind: "asked", ruleId: q.ruleId, askedSeq: e.seq, attempts: 0 } : { kind: "none" };
      if (e.kind === "userTurn") return { kind: "none" };
      return q;
    case "asked":
      if (e.kind === "userTurn") {
        if (!e.final) return q;
        if (e.slotsValid) return { kind: "none" };
        const attempts = q.attempts + 1;
        return attempts >= PENDING_ASK_TURNS ? { kind: "none" } : { ...q, attempts };
      }
      return q;
  }
}
