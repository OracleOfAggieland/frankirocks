import { describe, expect, it } from "vitest";
import { type RuleInput, serverRule } from "./admission";
import type { ControlClass } from "./intents/classes";
import { ALONE_LINE, COMPANY_LINE, FORGET_NOT_YET } from "./voice/lines";

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
const hit = (chosen: ControlClass | null, candidates: ControlClass[] = chosen === null ? [] : [chosen], uncertain = false) =>
  ({ kind: "hit", chosen, candidates, uncertain }) as const;
const rule = (over: Partial<RuleInput>) => serverRule({ ...base, ...over });

describe("serverRule, one case per design row", () => {
  it("1: a narrowed call is blocked", () => {
    expect(rule({ narrowedHere: true })).toEqual({ kind: "hold", reasons: ["audience"], blocked: true, swap: "none" });
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

  it("11: forget says the fixed line", () => {
    expect(rule({ parse: hit("forget") })).toMatchObject({ permit: "postCommitControl", scope: "ack", notes: "none", line: FORGET_NOT_YET, cut: true });
  });

  it("12: every other hit, and wave A audience classes, keep their tools with S0 notes and cut nothing", () => {
    for (const chosen of ["correct", "transition", "hardRule", "food", "action", "why", "answer", "rushed", "company", "quiet", "alone"] as const) {
      expect(rule({ parse: hit(chosen) })).toMatchObject({ permit: "postCommitControl", scope: "reply", notes: "S0", line: null, cut: false });
    }
    expect(rule({ parse: hit(null, [], true) })).toMatchObject({ permit: "postCommitControl", scope: "reply", notes: "S0", cut: false });
  });

  it("only routes that change what is said cut a playing reply", () => {
    expect(rule({ parse: hit("crisis") })).toMatchObject({ cut: true });
    expect(rule({ parse: hit("forget") })).toMatchObject({ cut: true });
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
