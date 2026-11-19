import { describe, expect, it } from "vitest";
import { type RuleInput, serverRule } from "./admission";
import type { ControlClass } from "./intents/classes";
import { ALONE_LINE, COMPANY_LINE, MEET_AGAIN_LINE, MEET_LINE } from "./voice/lines";

const base: RuleInput = {
  source: "asr",
  transcript: "final",
  judge: "O",
  parse: { kind: "ordinary" },
  regexMatch: false,
  audience: "private",
  narrowedHere: false,
  callLive: true,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: false,
  wave: "A",
};
/** A hit whose candidates are sure (0.9), so a route fires whatever the judge said, unless p says otherwise. */
const hit = (chosen: ControlClass | null, candidates: ControlClass[] = chosen === null ? [] : [chosen], uncertain = false, p = 0.9) =>
  ({ kind: "hit", chosen, candidates, uncertain, candidateP: Object.fromEntries(candidates.map((c) => [c, p])) }) as const;
const rule = (over: Partial<RuleInput>) => serverRule({ ...base, ...over });

describe("serverRule, one case per design row", () => {
  it("1: a narrowed call is blocked", () => {
    expect(rule({ narrowedHere: true })).toEqual({ kind: "hold", reasons: ["audience"], blocked: true, swap: "none" });
  });

  it("1b (brief 052 ruling 5): a meet line is a postCommitControl ack with no notes in private, held in any other audience; row 1 still wins", () => {
    for (const meetLine of [MEET_LINE, MEET_AGAIN_LINE] as const) {
      // Whatever else the input says: the meet row comes straight after row 1.
      for (const over of [{}, { source: "typed", judge: "typed", callLive: false, parse: { kind: "none" } }, { source: "pasted", noteSens: "S1+" }, { parse: hit("crisis") }, { transcript: "missing" }] as Partial<RuleInput>[]) {
        expect(rule({ ...over, meetLine })).toEqual({ kind: "permit", permit: "postCommitControl", scope: "ack", notes: "none", line: meetLine, swap: "none", cut: true, reasons: [] });
        for (const audience of ["company", "unknown"] as const) expect(rule({ ...over, meetLine, audience })).toEqual({ kind: "hold", reasons: ["audience"], blocked: false, swap: "none" });
      }
      expect(rule({ meetLine, narrowedHere: true })).toEqual({ kind: "hold", reasons: ["audience"], blocked: true, swap: "none" });
    }
  });

  it("2: pasted text gets postCommitControl with S0 notes, and holds an S1+ note", () => {
    expect(rule({ source: "pasted", parse: { kind: "none" } })).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "reply", notes: "S0", cut: false });
    expect(rule({ source: "pasted", noteSens: "S1+" })).toMatchObject({ kind: "hold", reasons: ["sensitivity"] });
  });

  it("3: a tool continuation needs the committed parse, S0 notes unless private", () => {
    expect(rule({ source: "tool", toolParseCommitted: false })).toMatchObject({ kind: "hold", reasons: ["missingDependency"] });
    expect(rule({ source: "tool", toolParseCommitted: true })).toMatchObject({ permit: "slowOrdinary", notes: "all" });
    expect(rule({ source: "tool", toolParseCommitted: true, audience: "unknown" })).toMatchObject({ permit: "slowOrdinary", notes: "S0" });
    expect(rule({ source: "tool", toolParseCommitted: true, judge: "H" })).toMatchObject({ permit: "slowOrdinary", notes: "S0" });
    expect(rule({ source: "tool", toolParseCommitted: true, parseGap: true })).toMatchObject({ permit: "slowOrdinary", notes: "S0" });
  });

  it("4: a missing or failed transcript gets recoveryOnly and cuts nothing", () => {
    for (const transcript of ["missing", "failed"] as const) {
      expect(rule({ transcript, regexMatch: true })).toMatchObject({ permit: "recoveryOnly", notes: "none", cut: false });
    }
  });

  it("5a and 5b: a failed parse gets recoveryOnly, and only a regex match cuts", () => {
    expect(rule({ parse: { kind: "failed", why: "deadline" }, regexMatch: true })).toMatchObject({ permit: "recoveryOnly", cut: true, reasons: ["DEPENDENCY"] });
    expect(rule({ parse: { kind: "failed", why: "transport" } })).toMatchObject({ permit: "recoveryOnly", cut: false, reasons: ["DEPENDENCY"] });
    expect(rule({ parse: { kind: "failed", why: "invalid" } })).toMatchObject({ reasons: ["invalidInput"] });
    expect(rule({ parse: { kind: "failed", why: "oversize" } })).toMatchObject({ reasons: ["oversize"] });
  });

  it("6: crisis with company in wave B plays the care reply, then swaps", () => {
    expect(rule({ wave: "B", parse: hit("company", ["crisis", "company"]) })).toMatchObject({ permit: "postCommitControl", scope: "ack", notes: "none", line: null, swap: "afterReply", cut: true });
  });

  it("7: crisis always takes the reply, whatever is chosen", () => {
    for (const chosen of ["forget", "company", "quiet", "food"] as const) {
      for (const wave of ["A", "B"] as const) {
        const o = rule({ wave, callLive: false, parse: hit(chosen, [chosen, "crisis"]) });
        expect(o).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "ack", notes: "none", line: null, cut: true });
      }
    }
  });

  it("8: company or quiet with a live call in wave B hangs up", () => {
    expect(rule({ wave: "B", parse: hit("company") })).toEqual({ kind: "hold", reasons: ["audience"], blocked: true, swap: "now" });
    expect(rule({ wave: "B", parse: hit("quiet") })).toEqual({ kind: "hold", reasons: ["audience", "quiet"], blocked: true, swap: "now" });
  });

  it("9: company with no call says the company line", () => {
    expect(rule({ wave: "B", callLive: false, source: "typed", judge: "typed", parse: hit("company") })).toMatchObject({ permit: "postCommitControl", scope: "ack", line: COMPANY_LINE });
  });

  it("10: alone in wave B says the alone line", () => {
    expect(rule({ wave: "B", parse: hit("alone") })).toMatchObject({ permit: "postCommitControl", scope: "ack", line: ALONE_LINE });
  });

  it("11: forget hangs up and swaps with a call live, and says nothing on it (brief 048 ruling 3)", () => {
    expect(rule({ parse: hit("forget") })).toEqual({ kind: "hold", reasons: ["blocked"], blocked: true, swap: "now", forget: true });
  });

  it("11: a typed forget with no call open is a line-less ack Permit; the route adds the acknowledgment once blockedAt is set (ruling 8)", () => {
    expect(rule({ source: "typed", judge: "typed", callLive: false, parse: hit("forget") })).toEqual({ kind: "permit", permit: "postCommitControl", scope: "ack", notes: "none", line: null, swap: "none", cut: true, reasons: [], forget: true });
  });

  it("12: every other hit, and wave A audience classes, keep their tools with S0 notes and cut nothing", () => {
    for (const chosen of ["correct", "transition", "hardRule", "food", "action", "why", "answer", "rushed", "company", "quiet", "alone"] as const) {
      expect(rule({ parse: hit(chosen) })).toMatchObject({ permit: "postCommitControl", scope: "reply", notes: "S0", line: null, cut: false });
    }
    expect(rule({ parse: hit(null, [], true) })).toMatchObject({ permit: "postCommitControl", scope: "reply", notes: "S0", cut: false });
  });

  it("only routes that change what is said cut a playing reply", () => {
    expect(rule({ parse: hit("crisis") })).toMatchObject({ cut: true });
    // Brief 048: a forget with a call live stops more than a cut: it hangs up, and nothing more is said on that call.
    expect(rule({ parse: hit("forget") })).toMatchObject({ kind: "hold", blocked: true, swap: "now" });
    expect(rule({ wave: "B", parse: hit("alone") })).toMatchObject({ cut: true });
    expect(rule({ parse: { kind: "failed", why: "deadline" }, regexMatch: true })).toMatchObject({ cut: true });
    for (const chosen of ["company", "quiet", "alone", "rushed", "why"] as const) expect(rule({ wave: "A", parse: hit(chosen) })).toMatchObject({ cut: false });
  });

  it("13: ordinary is slowOrdinary whatever the judge, with all notes only when every S1+ condition holds", () => {
    for (const judge of ["O", "H", "U", "timeout", "error"] as const) expect(rule({ judge })).toMatchObject({ permit: "slowOrdinary", cut: false });
    expect(rule({})).toMatchObject({ notes: "all" });
    for (const over of [{ judge: "U" }, { wordsPer2s: false }, { allFinal: false }, { parseGap: true }, { audience: "company" }, { audience: "unknown" }] as Partial<RuleInput>[]) {
      expect(rule(over)).toMatchObject({ permit: "slowOrdinary", notes: "S0" });
    }
    expect(rule({ source: "typed", judge: "typed", wordsPer2s: false, allFinal: false })).toMatchObject({ permit: "slowOrdinary", notes: "all" });
  });

  it("a regex match never changes the outcome of a parse that succeeded", () => {
    for (const parse of [{ kind: "ordinary" } as const, hit("food"), hit("forget"), hit("crisis")]) {
      expect(rule({ parse, regexMatch: true })).toEqual(rule({ parse, regexMatch: false }));
    }
  });
});

describe("a route that changes what is said needs both nets (review of the live run, item 5)", () => {
  it("forget under 0.80 with judge O doesn't cut and speaks no Fixed_Line: row 12", () => {
    expect(rule({ judge: "O", parse: hit("forget", ["forget"], false, 0.5) })).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "reply", notes: "S0", cut: false, line: null });
  });
  it("forget at 0.80 with judge O, or at 0.20 with any other judge value, takes its route", () => {
    expect(rule({ judge: "O", parse: hit("forget", ["forget"], false, 0.8) })).toMatchObject({ kind: "hold", blocked: true, swap: "now", forget: true });
    for (const judge of ["H", "U", "timeout", "error"] as const) expect(rule({ judge, parse: hit("forget", ["forget"], false, 0.2) }), judge).toMatchObject({ kind: "hold", blocked: true, forget: true });
    expect(rule({ source: "typed", judge: "typed", callLive: false, parse: hit("forget", ["forget"], false, 0.2) })).toMatchObject({ scope: "ack", cut: true, line: null, forget: true });
  });
  it("crisis at 0.20 with judge O still takes the reply", () => {
    expect(rule({ judge: "O", parse: hit("crisis", ["crisis"], false, 0.2) })).toMatchObject({ permit: "postCommitControl", scope: "ack", notes: "none", cut: true });
  });
  it("in wave B, a weak company hit with judge O doesn't swap or speak the company line", () => {
    expect(rule({ wave: "B", judge: "O", parse: hit("company", ["company"], false, 0.5) })).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "reply", cut: false, line: null });
    expect(rule({ wave: "B", judge: "O", callLive: false, parse: hit("alone", ["alone"], false, 0.41) })).toMatchObject({ scope: "reply", cut: false, line: null });
    expect(rule({ wave: "B", judge: "H", parse: hit("company", ["company"], false, 0.5) })).toMatchObject({ kind: "hold", swap: "now" });
  });
});