/**
 * Brief 049 part A, ruling 10: the Gate in front of an Errand's result, the way `read_money` built its candidate
 * (`bank/money-gate.ts`). Each checked line is one candidate for the pure `gate()`:
 *
 *   - its class and sensitivity are the line's own (the lowest-trust class and highest sensitivity among its refs);
 *   - on the `recall` trigger, with the owner's assignment words as the owner's turn: the Errand exists only because
 *     those words asked, so a candidate's aliases are those words' own tokens, and "asked" still needs a certain
 *     speaker (a typed turn, or judge `O`), as for a recall (contract question E-260);
 *   - a third-party line carries its senders: `mailedByOwner` only when every mail source behind it was mailed by
 *     the owner (fails closed).
 *
 * Then, only lowering (the Gate's modifiers only subtract, and so does this):
 *   - a result is said in full only in private: any other audience lowers a `say` to `card`;
 *   - a third-party line is said only for a sender the owner has mailed, else `card`;
 *   - an S2 line is never said by a late delivery, at most `card`;
 *   - a `say` whose render is not `free` or `attributed` is `card` (its words are the helper's, not a template's).
 *
 * The rows for every line not said are written by the caller, in the transaction that claims the delivery.
 */
import { type Au, type Errand, type ErrandLine, type GateCandidate, type GateContext, type GateResult, type ID, gate, tokenize, tsFromMs } from "@franki/core";

export type LineShown = "say" | "card" | "none";

export interface LineVerdict {
  index: number;
  line: ErrandLine;
  candidateId: ID;
  result: GateResult;
  shown: LineShown;
}

export interface ErrandGateInput {
  errand: Errand;
  /** The assignment's words, and whether its speaker is certain (typed, or judge O). */
  ownerWords: readonly string[];
  certain: boolean;
  audience: Au;
  modifiers: { rushed: boolean; crisis: boolean };
  worldNow: number;
  zone: string;
  candidateId: (index: number) => ID;
}

/** The senders behind a third-party line, as the Gate's `sender`. */
function senderOf(errand: Errand, line: ErrandLine): GateCandidate["sender"] {
  if (line.cls !== "T" && line.cls !== "M") return null;
  const mail = line.refs.map((r) => errand.reads.find((x) => x.ref === r)?.source).filter((s) => s !== undefined && s.kind === "mail");
  return { mailedByOwner: mail.length > 0 && mail.every((s) => s!.kind === "mail" && s!.mailedByOwner) };
}

export function errandCandidate(x: ErrandGateInput, line: ErrandLine, index: number): GateCandidate {
  return {
    id: x.candidateId(index),
    kind: "memory",
    subjectId: "self",
    sourceClass: line.cls,
    sens: line.sens,
    allergy: false,
    // Every ref behind the line was reread as retained Evidence when the result was checked.
    eligibility: { allow: true, reason: "ok" },
    toldAt: null,
    topic: null,
    queryTerms: [],
    aliases: [...new Set(x.ownerWords.flatMap((w) => tokenize(w)))],
    purpose: "item",
    gravity: 0,
    food: false,
    mustSay: null,
    dueAt: null,
    sender: senderOf(x.errand, line),
    attestedPremises: 0,
    offerUsed: false,
    ownRooted: false,
    checkInUsed: false,
    act: "say",
  };
}

export function errandGateContext(x: ErrandGateInput, notesThisReply: number): GateContext {
  return {
    worldNow: tsFromMs(x.worldNow),
    zone: x.zone,
    build: "floor",
    audience: x.audience,
    modifiers: x.modifiers,
    trigger: "recall",
    moment: null,
    ownerTurn: { text: x.ownerWords.join("\n"), sourceClass: "U", certain: x.certain },
    openedTopics: [],
    recentTurns: [],
    counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply },
    rules: "ready",
    authorization: null,
  };
}

const lowered = (r: GateResult, reason: GateResult["reasons"][number]): GateResult => ({ ...r, verdict: "card", form: r.form ?? "item", render: null, carveOut: null, reasons: [...r.reasons.filter((x) => x !== "ok"), reason] });

/** Each line's verdict, in order. Pure. */
export function gateErrandLines(x: ErrandGateInput): LineVerdict[] {
  const out: LineVerdict[] = [];
  let said = 0;
  x.errand.lines.forEach((line, index) => {
    const c = errandCandidate(x, line, index);
    let r = gate(c, errandGateContext(x, said));
    if (r.verdict === "say") {
      if (r.render !== "free" && r.render !== "attributed") r = lowered(r, "ceiling");
      else if (line.sens === "S2") r = lowered(r, "sensitivity");
      else if (x.audience !== "private") r = lowered(r, "audience");
      else if (c.sender !== null && !c.sender.mailedByOwner) r = lowered(r, "ceiling");
    }
    const shown: LineShown = r.verdict === "say" ? "say" : r.verdict === "card" ? "card" : "none";
    if (shown === "say") said++;
    out.push({ index, line, candidateId: c.id, result: r, shown });
  });
  return out;
}
