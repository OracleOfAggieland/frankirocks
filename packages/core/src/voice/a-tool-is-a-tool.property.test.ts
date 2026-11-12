// Feature: what the voice machine sends (brief 040), Property 1: a tool is a tool.
// For any call, `suggest` and `answer` are dispatched under exactly the conditions `recall` is: play the same call
// with the model calling `recall` and with it calling the other tool (and the route answering with the same result
// under that tool's name), and at every step the events and the machine's commands differ only by the tool's name.
// Nothing is dispatched before admission, the reply is staged the same way, a late or stale result is handled the
// same way, and the reply after a tool result offers the same tools. The one other difference allowed is what
// code sends as `answer`'s arguments: both IDs null, whatever the model wrote (H-180), checked here too; and the
// hashes over a result named differently, which each run computes over its own payload as the seam does.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CallToolName } from "./machine";
import { arbToolCall, runToolCall, toolCommands } from "./testing/arb-tool";

/** Renames `name` fields equal to `from` (and the same inside JSON strings) to `recall`, and masks tool arguments. */
function normalise(value: unknown, from: CallToolName): unknown {
  if (typeof value === "string") return value.split(`"name":"${from}"`).join(`"name":"recall"`);
  if (Array.isArray(value)) return value.map((v) => normalise(v, from));
  if (value === null || typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  // A tool definition in the offered list keeps its own name: the list is the same in both runs.
  if (o.type === "function" && "parameters" in o) return value;
  const out: Record<string, unknown> = {};
  // A hash over a result whose name differs differs too; each run's driver hashes its own payload as the seam does.
  for (const [k, v] of Object.entries(o)) out[k] = k === "name" && v === from ? "recall" : k === "approvedPayloadHash" || (k === "hash" && o.type === "permitChecked") ? "HASH" : normalise(v, from);
  if (o.kind === "tool" && typeof o.body === "object" && o.body !== null) {
    const body = out.body as Record<string, unknown>;
    out.body = { ...body, tool: { ...(body.tool as Record<string, unknown>), args: "ARGS" } };
  }
  return out;
}

const steps = (name: CallToolName, call: { steps: Parameters<typeof runToolCall>[0]; answers: Parameters<typeof runToolCall>[2] }) =>
  runToolCall(call.steps, name, call.answers);

describe("Property 1: a tool is a tool", () => {
  for (const other of ["suggest", "answer"] as const) {
    it(`${other} is dispatched, staged and answered exactly as recall is`, () => {
      fc.assert(
        fc.property(arbToolCall, (call) => {
          const a = steps("recall", call);
          const b = steps(other, call);
          expect(b.trace.steps.length).toBe(a.trace.steps.length);
          for (let i = 0; i < a.trace.steps.length; i++) {
            const sa = a.trace.steps[i]!;
            const sb = b.trace.steps[i]!;
            expect(normalise(sb.event, other), `event at step ${i}`).toEqual(normalise(sa.event, "recall"));
            expect(normalise(sb.commands, other), `commands at step ${i}`).toEqual(normalise(sa.commands, "recall"));
          }
          for (const c of toolCommands(b)) {
            expect(c.body.tool.name).toBe(other);
            if (other === "answer") expect(c.body.tool.args).toEqual({ pendingId: null, choiceId: null });
            else expect(c.body.tool.args).toEqual({ query: "x" });
          }
        }),
        { numRuns: 1_000 },
      );
    });
  }

  it("the calls reach a tool dispatch and a reply after a tool result often enough to mean something", () => {
    const calls = fc.sample(arbToolCall, { seed: 2026, numRuns: 500 });
    let dispatched = 0;
    let replied = 0;
    for (const call of calls) {
      const d = steps("recall", call);
      if (toolCommands(d).length > 0) dispatched += 1;
      if (d.trace.creates.some((c) => JSON.stringify(c.event).includes('"function_call_output"'))) replied += 1;
    }
    expect(dispatched).toBeGreaterThanOrEqual(120); // 249 of 500 at seed 2026
    expect(replied).toBeGreaterThanOrEqual(50); // 103 of 500 at seed 2026
  });
});
