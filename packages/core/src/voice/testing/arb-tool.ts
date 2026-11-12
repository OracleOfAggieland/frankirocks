/**
 * Calls that reach the tools (brief 040, item 1). Plain module, test-only. `arbToolCall` is `arbCall` with function
 * calls and tool answers sprinkled through it, and `ToolDriver` plays it with the model calling one named tool and
 * the route answering `ready` (with a Permit hashed as the seam does), `hold`, `stale` or not at all. The result the
 * driver answers with is the same object whatever the tool, with its `name` set to the tool's, so two runs that
 * differ only by the tool's name are comparable step by step.
 */
import fc from "fast-check";
import { payloadHash } from "../../admission";
import { tsFromMs } from "../../schema/primitives";
import type { Permit } from "../../schema/wire";
import { type CallToolName, type VoiceCommand, replyPayload } from "../machine";
import { type Action, CallDriver, type Step, arbCall } from "./arb-call";

export type ToolAnswer = "ready" | "hold" | "stale" | "failed";

/** One tool step, inserted into a call at random. */
const toolStep: fc.Arbitrary<Step> = fc.record({
  action: fc.oneof(
    { weight: 3, arbitrary: fc.record({ k: fc.constant("fnCall" as const), pick: fc.nat({ max: 3 }) }) },
    { weight: 3, arbitrary: fc.record({ k: fc.constant("toolAnswer" as const), ok: fc.constant(true) }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant("hash" as const), pick: fc.nat({ max: 3 }), ok: fc.constantFrom(true, true, true, false) }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant("created" as const), pick: fc.nat({ max: 3 }) }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant("started" as const), pick: fc.nat({ max: 3 }) }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant("stopped" as const) }) },
  ) as fc.Arbitrary<Action>,
  dt: fc.integer({ min: 0, max: 800 }),
});

const at = (action: Action, dt = 0): Step => ({ action, dt });

/**
 * The model calls the tool from the reply it is speaking: after a reply's `response.created` or its audio start, a
 * function call, then (perhaps) the route's answer, its Permit's check, the tool reply's `response.created` and audio.
 */
const toolTurn = (roll: number, wait: number): Step[] => {
  const call = at({ k: "fnCall", pick: 0 }, roll % 3 === 0 ? 0 : 50);
  if (roll % 5 === 4) return [call];
  return [call, at({ k: "toolAnswer", ok: true }, wait), at({ k: "hash", pick: 0, ok: roll % 7 !== 6 }), at({ k: "created", pick: 0 }, 30), at({ k: "started", pick: 0 }, 200)];
};

/** A slow-path turn whose admitted reply calls the tool: judged H, posted, answered `ordinary`, checked, created. */
const arbSlowToolScene: fc.Arbitrary<Step[]> = fc
  .record({ judgeMs: fc.integer({ min: 100, max: 1_600 }), asrMs: fc.integer({ min: 100, max: 3_000 }), letter: fc.constantFrom<"H" | "U" | "O">("H", "H", "U", "O") })
  .map(({ judgeMs, asrMs, letter }) => [
    at({ k: "speechStart" }, 200),
    at({ k: "speechStop" }, 900),
    at({ k: "stateOk", variant: "fresh" }, 100),
    at({ k: "commit" }, 200),
    at({ k: "itemAdded", pick: 0 }, 40),
    at({ k: "created", pick: 1 }, 20),
    at({ k: "created", pick: 0 }, 5),
    at({ k: "hash", pick: 0, ok: true }),
    at({ k: "judgeDone", pick: 0, letter }, judgeMs),
    at({ k: "transcript", pick: 0, fail: false, empty: false }, asrMs),
    at({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, 400),
    at({ k: "hash", pick: 0, ok: true }),
    at({ k: "created", pick: 0 }, 30),
    at({ k: "started", pick: 0 }, 300),
    at({ k: "stopped" }, 1_500),
    at({ k: "done", pick: 0 }),
    at({ k: "timer", early: false, pick: 0 }, 100),
  ]);

/** `arbCall` or slow tool scenes, with tool turns after replies, up to 12 tool steps at random, and the route's answers in order. */
export const arbToolCall: fc.Arbitrary<{ steps: Step[]; answers: ToolAnswer[] }> = fc
  .tuple(
    fc.oneof({ weight: 1, arbitrary: arbCall }, { weight: 1, arbitrary: fc.array(arbSlowToolScene, { minLength: 1, maxLength: 3 }).map((ss) => ss.flat()) }),
    fc.array(fc.nat({ max: 99 }), { minLength: 60, maxLength: 60 }),
    fc.array(fc.tuple(fc.nat({ max: 80 }), toolStep), { maxLength: 12 }),
    fc.array(fc.constantFrom<ToolAnswer>("ready", "ready", "hold", "stale", "failed"), { minLength: 4, maxLength: 4 }),
    fc.integer({ min: 0, max: 7_000 }),
  )
  .map(([base, rolls, inserts, answers, wait]) => {
    const steps: Step[] = [];
    base.forEach((s, i) => {
      steps.push(s);
      const r = rolls[i % rolls.length]!;
      if ((s.action.k === "created" || s.action.k === "started") && r < 60) steps.push(...toolTurn(r, wait % (r + 1 < 10 ? 7_000 : 2_000)));
    });
    for (const [where, s] of inserts) steps.splice(Math.min(where, steps.length), 0, s);
    return { steps, answers };
  });

/** The route's result, the same object for every tool but its name. */
export function toolResultFor(name: CallToolName) {
  return { name, notes: [], coverage: "complete", truncated: false, cursor: null, pendingId: null, snapshot: null, cards: [] };
}

export class ToolDriver extends CallDriver {
  private answered = 0;

  constructor(
    readonly toolName: CallToolName,
    private readonly answers: readonly ToolAnswer[],
  ) {
    super();
  }

  override play(s: Step): void {
    const a = s.action;
    if (a.k !== "fnCall" && a.k !== "toolAnswer") return super.play(s);
    if (this.pending.open && this.st.awaitingOpen) this.connect();
    if (a.k === "fnCall") {
      const live = this.trace.responses.filter((x) => x.purpose !== "judge" && !x.cancelled);
      const r = live.length === 0 ? undefined : live[live.length - 1 - (a.pick % live.length)];
      if (r === undefined) return;
      this.rt({ type: "response.function_call_arguments.done", response_id: r.id, call_id: this.fresh("call_"), name: this.toolName, arguments: '{"query":"x"}' }, s.dt);
      return;
    }
    const t = this.pending.tool;
    if (t === null) return;
    this.pending.tool = null;
    const answer = this.answers[this.answered++ % Math.max(1, this.answers.length)] ?? "hold";
    if (answer === "failed") {
      this.ev({ type: "toolFailed", callId: t.callId }, s.dt);
      return;
    }
    const result = toolResultFor(this.toolName);
    const payload = answer === "ready" ? replyPayload(this.st, { purpose: "tool", notes: [], toolCall: null, toolOutput: result as never }) : null;
    const permit: Permit | null =
      payload === null
        ? null
        : {
            permitId: this.fresh("p"),
            stamp: t.stamp,
            kind: "slowOrdinary",
            scope: "reply",
            approvedPayloadHash: payloadHash(payload, this.hasher),
            noteIds: [],
            momentIds: [],
            expiresAt: tsFromMs(this.now + s.dt + 10_000),
          };
    const status = permit !== null ? "ready" : answer === "stale" ? "stale" : "hold";
    this.ev({ type: "toolOk", callId: t.callId, response: { stamp: t.stamp, callId: t.callId, status, result: permit === null ? null : result, deck: null, permit } as never }, s.dt);
  }
}

export function runToolCall(steps: readonly Step[], name: CallToolName, answers: readonly ToolAnswer[]): ToolDriver {
  const d = new ToolDriver(name, answers).start();
  for (const s of steps) d.play(s);
  return d;
}

/** Every `tool` command a trace sent. */
export function toolCommands(d: CallDriver): Extract<VoiceCommand, { kind: "tool" }>[] {
  return d.trace.steps.flatMap((s) => s.commands.filter((c): c is Extract<VoiceCommand, { kind: "tool" }> => c.kind === "tool"));
}
