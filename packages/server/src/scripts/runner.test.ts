/**
 * The script runner checks itself (brief 029 task 1): a small green script, and the runner's own refusals. A step
 * that makes a model call it did not declare fails; so does a declared answer that is never used; a failed
 * assertion names the step, the expectation and what was said.
 */
import { describe, expect, it } from "vitest";
import { PERSONA } from "../seed/persona";
import { type Script, ScriptFailure, parse, reply, runScript, scriptSuite } from "../testing/script-runner";

const SEED_MAIL = PERSONA.lines.filter((l) => l.kind === "mail").length;

const SMALL: Script = {
  name: "runner: seed, open, one typed line, the Lab",
  scores: "brief 029 task 1",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "runner" },
    { label: "open a session", do: "open" },
    {
      label: "type a line",
      do: "type",
      text: "Good morning",
      answers: [reply("Morning, Riley."), parse()],
      expect: [{ mustSay: { note: true } }],
    },
    { label: "read the Lab", do: "read", view: "lab", expect: [{ lab: { readEmails: SEED_MAIL } }] },
  ],
};

scriptSuite(SMALL);

describe("the runner's refusals", () => {
  it("fails a step whose model call was not declared", async () => {
    const s: Script = { ...SMALL, steps: SMALL.steps.map((st) => (st.do === "type" ? { ...st, answers: [reply("Morning, Riley.")] } : st)) };
    const e = await runScript(s).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ScriptFailure);
    expect((e as ScriptFailure).step).toBe("type a line");
    expect((e as ScriptFailure).expectation).toContain("decisions.create");
  });

  it("fails a step that declared an answer it never used", async () => {
    const s: Script = { ...SMALL, steps: SMALL.steps.map((st) => (st.do === "open" ? { ...st, answers: [reply("unused")] } : st)) };
    const e = await runScript(s).catch((x: unknown) => x);
    expect((e as ScriptFailure).step).toBe("open a session");
    expect((e as ScriptFailure).actual).toBe("0 call(s)");
  });

  it("prints the step, the expectation and what was said", async () => {
    const s: Script = {
      ...SMALL,
      steps: SMALL.steps.map((st) => (st.do === "type" ? { ...st, expect: [{ neverSay: ["Riley"] }] } : st)),
    };
    const e = (await runScript(s).catch((x: unknown) => x)) as ScriptFailure;
    expect(e.message).toContain('step "type a line"');
    expect(e.message).toContain('never "Riley"');
    expect(e.message).toContain("[note at type a line] Morning, Riley.");
  });
});
