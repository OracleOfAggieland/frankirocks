/**
 * Brief 049 part A, ruling 6: the test-only Errand agent that proves the framework while production's registry is
 * empty. It knows nothing about any provider: it "searches" mail rows a test seeded as Evidence, registers each row
 * it returns through `read`, and answers with their refs. The planner is a scripted fake that answers only requests
 * whose result format is `ErrandResultV1`; everything else on `responses.create` falls through to whatever the test
 * scripted.
 */
import { type Class, type Errand, type ErrandSender, type ErrandSource, type Evidence, type ID, type Sens, type Session, type Stamp, type Turn, buildSlice } from "@franki/core";
import { sampleEvidence, testId } from "@franki/core/testing";
import type { ErrandAgent, ErrandTool } from "../errands/agent";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { paths } from "../store/paths";
import { errandIdOf } from "../errands/records";
import { turnRoute } from "../routes/turn";
import { type TestRig, callRoute, patchRecord, testRig } from "./fakes";
import { asrTurn, openTestSession } from "./session-fixtures";

export const ERRAND_OWNER = "owner-1";

export interface SeededMail {
  eid: ID;
  rev: number;
  text: string;
  cls: Class;
  sens: Sens;
  /** Review fix V1: what the agent knows of who sent it; null for an event. */
  sender: ErrandSender | null;
  source: ErrandSource;
}

/**
 * Stores one mail row (or, with `event`, an invitation) as retained Evidence of class `cls` (T for a third party's
 * words by default).
 */
export async function seedMail(rig: TestRig, label: string, x: { text: string; from?: string; address?: string; subject?: string; cls?: Class; sens?: Sens; mailedByOwner?: boolean; at?: string; event?: boolean }, uid = ERRAND_OWNER): Promise<SeededMail> {
  const eid = testId(`mail-${label}`) as ID;
  const subject = x.subject ?? `Subject ${label}`;
  const e: Evidence = sampleEvidence({
    logicalId: testId(`mail-log-${label}`),
    source: "voice",
    kind: "turn",
    text: { kind: "inline", text: x.text },
    fieldSlices: [buildSlice({ eid, fieldPath: "text", fieldText: x.text, start: 0, end: x.text.length, class: x.cls ?? "T", sens: x.sens ?? "S0" }, rig.deps.hasher)],
  });
  await rig.store.transaction(uid, async (tx) => tx.create(paths.evidence(uid, eid), e));
  const stored = await rig.store.get<Evidence>(uid, paths.evidence(uid, eid));
  const from = x.from ?? "Dana Writer";
  const at = x.at ?? "2026-11-02T15:00:00.000Z";
  const mailed = x.mailedByOwner ?? true;
  const source: ErrandSource = x.event === true ? { kind: "event", title: subject, startsAt: at, allDay: false } : { kind: "mail", from, subject, at, mailedByOwner: mailed };
  const sender = x.event === true ? null : { name: from, address: x.address ?? `${label}@example.test`, mailed };
  return { eid, rev: stored!.data.rev, text: x.text, cls: x.cls ?? "T", sens: x.sens ?? "S0", sender, source };
}

/** The test agent's one tool: returns every seeded row, each registered as read. */
export function searchTool(mail: () => readonly SeededMail[]): ErrandTool {
  return {
    name: "search_mail",
    description: "Search the owner's mail.",
    parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
    async run(ctx) {
      const items = [];
      for (const m of mail()) {
        const ref = ctx.read({ evidenceId: m.eid, rev: m.rev, cls: m.cls, sens: m.sens, shown: true, sender: m.sender, source: m.source });
        if (ref !== null) items.push({ ref, subject: m.source.kind === "mail" ? m.source.subject : m.source.title, text: m.text });
      }
      return { items };
    },
  };
}

export function testMailAgent(mail: () => readonly SeededMail[], available: ErrandAgent["available"] = async () => "ready"): ErrandAgent {
  return { id: "test-mail", about: "mail", instructions: "Test agent: search the owner's mail with search_mail.", tools: [searchTool(mail)], available };
}

/** One planner answer: call a tool, or finish with a result. */
export type PlannerStep =
  | { call: string; args?: unknown }
  | { outcome: "answered" | "nothing" | "failed"; lines?: { text: string; refs: string[] }[] }
  | { raw: unknown }
  | { never: true };

const isPlanner = (body: unknown) => (body as { text?: { format?: { name?: unknown } } } | null)?.text?.format?.name === "ErrandResultV1";

/** Planner requests the rig has seen. */
export const plannerRequests = (rig: TestRig) => rig.openai.requestsTo("responses.create").filter((r) => isPlanner(r.body));

/**
 * Answers planner requests from `steps`, in order (then `nothing`). Requests that are not the planner's go to
 * `other`, or fail closed.
 */
export function scriptPlanner(rig: TestRig, steps: PlannerStep[], other?: (body: unknown) => ReturnType<typeof ok>): void {
  let n = 0;
  rig.openai.respond("responses.create", (body) => {
    if (!isPlanner(body)) return other?.(body) ?? { kind: "error", error: new Error("unscripted responses.create") };
    const step = steps[n++] ?? { outcome: "nothing" as const };
    if ("never" in step) return { kind: "never" };
    if ("raw" in step) return ok(step.raw);
    if ("call" in step) {
      return ok(normalizeResponse({ status: "completed", output: [{ type: "function_call", status: "completed", call_id: `call_${n}`, name: step.call, arguments: JSON.stringify(step.args ?? { query: "x" }) }] } as never));
    }
    const text = JSON.stringify({ outcome: step.outcome, lines: step.lines ?? [] });
    return ok(normalizeResponse({ status: "completed", output_text: text, output: [] } as never));
  });
}

export interface ErrandSetup {
  /** The Errand the setup turn would start. */
  errandId: ID;
  rig: TestRig;
  sessionId: string;
  mail: SeededMail[];
  stamp: Stamp;
}

export const ASK = "Check my mail for when the plumber is coming.";

export async function errandSetup(steps: PlannerStep[], opts: { agents?: boolean; judge?: "O" | "timeout"; noMail?: boolean } = {}): Promise<ErrandSetup> {
  const rig = testRig();
  const mail: SeededMail[] = [];
  if (opts.agents !== false) rig.deps.errandAgents = [testMailAgent(() => mail)];
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, ERRAND_OWNER, paths.session(ERRAND_OWNER, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  if (opts.noMail !== true) mail.push(await seedMail(rig, "plumber", { text: "The plumber comes Thursday at 9.", from: "Pat Plumber", subject: "Your visit" }));
  scriptPlanner(rig, steps);
  const turn = await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 1, ASK, [{ itemId: "item1", commitSeq: 1 }]), judge: opts.judge ?? "O" });
  if (turn.status !== 200) throw new Error(`errandSetup: turn failed ${JSON.stringify(turn.body)}`);
  if (opts.judge !== "timeout") {
    const tp = paths.turn(ERRAND_OWNER, s.sessionId, turn.body.stamp.turnId);
    await patchRecord<Turn>(rig.store, ERRAND_OWNER, tp, { judge: "O" });
  }
  return { rig, sessionId: s.sessionId, mail, stamp: turn.body.stamp, errandId: errandIdOf(rig.deps.hasher, s.sessionId, turn.body.stamp.turnId) };
}

export const tool = (x: ErrandSetup, label = "1", about: string[] = ["mail"]) => ({ requestId: testId(`errand-${label}`), stamp: x.stamp, callId: `tool${label}`, tool: { name: "start_errand", args: { about } } });
export const poll = (x: ErrandSetup) => ({ sessionId: x.sessionId, generation: 1, seen: { epoch: x.stamp.epoch, policyRev: x.stamp.policyRev, bundleRev: x.stamp.bundleRev, rulesRev: x.stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
export const errandOf = async (x: ErrandSetup) => (await x.rig.store.get<Errand>(ERRAND_OWNER, paths.errand(ERRAND_OWNER, errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId))))?.data ?? null;

