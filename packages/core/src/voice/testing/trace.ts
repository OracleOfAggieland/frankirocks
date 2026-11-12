/**
 * Trace helpers for the machine properties (voice-control R20.1; design "Correctness Properties"). Plain module.
 */
import { type TimerName, type VoicePhase, type VoiceState, step } from "../machine";
import type { Trace, TraceStep } from "./arb-call";

/** The response heard after a step: the one in the output buffer, if output is unmuted. */
export function audibleResponse(s: TraceStep): string | null {
  return s.after.outputMuted ? null : s.playing;
}

/** audible(r, i): after step i, output is unmuted and r is the response playing. */
export function audible(s: TraceStep, responseId: string): boolean {
  return audibleResponse(s) === responseId;
}

/** The turn the machine admitted a reply for at this step (its active reply's Permit's turn), or null. */
export function activeTurn(st: VoiceState): string | null {
  return st.active?.permit.stamp.turnId ?? null;
}

/** The first step at which a reply of `turnId` became the machine's active (admitted) reply. */
export function admittedAt(trace: Trace, turnId: string): number | null {
  const s = trace.steps.find((x) => activeTurn(x.after) === turnId && activeTurn(x.before) !== turnId);
  return s === undefined ? null : s.i;
}

/** Every turn the trace mentions in a command or an active reply. */
export function turnsOf(trace: Trace): Set<string> {
  const out = new Set<string>();
  for (const s of trace.steps) {
    const t = s.after.turn?.turnId;
    if (t !== undefined) out.add(t);
    for (const c of s.commands) {
      if (c.kind === "turn") out.add(c.body.turnId);
      if (c.kind === "receipt" || c.kind === "tool") out.add(c.body.stamp.turnId);
    }
  }
  return out;
}

/** Steps at which output went from muted to unmuted. */
export function unmutes(trace: Trace): TraceStep[] {
  return trace.steps.filter((s) => s.before.outputMuted && !s.after.outputMuted);
}

const SETTLED: readonly VoicePhase[] = ["LISTENING", "RECOVERY", "CLOSED"];

/**
 * Fires every armed timer at its deadline, earliest first, with no other events, until the phase settles or
 * `maxFirings` is reached. Timers in `ignore` (keep-alive polls that end no wait) are not fired. Returns the phases
 * visited and the total time used.
 */
export function drainTimers(start: VoiceState, now: number, maxFirings = 20, ignore: readonly TimerName[] = []): { phases: VoicePhase[]; elapsed: number; settled: boolean; state: VoiceState } {
  let st = start;
  let t = now;
  const phases: VoicePhase[] = [st.phase];
  for (let n = 0; n < maxFirings; n++) {
    if (SETTLED.includes(st.phase)) return { phases, elapsed: t - now, settled: true, state: st };
    const armed = (Object.entries(st.deadlines) as [TimerName, number][]).filter(([name]) => !ignore.includes(name)).sort((a, b) => a[1] - b[1]);
    if (armed.length === 0) break;
    const [name, at] = armed[0]!;
    t = Math.max(t, at);
    st = step(st, { type: "timer", name }, t).state;
    phases.push(st.phase);
  }
  return { phases, elapsed: t - now, settled: SETTLED.includes(st.phase), state: st };
}

/** The step indexes at which a `turn` command for `turnId` was sent, with their times. */
export function postsOf(trace: Trace, turnId: string): { i: number; now: number }[] {
  return trace.steps.filter((s) => s.commands.some((c) => c.kind === "turn" && c.body.turnId === turnId)).map((s) => ({ i: s.i, now: s.now }));
}

/** The turns with a post and no answer yet at step i, whose post is younger than `limitMs` (Outstanding_Turns). */
export function outstandingAt(trace: Trace, i: number, limitMs: number): string[] {
  const now = trace.steps[i]!.now;
  const lastPost = new Map<string, { i: number; now: number }>();
  const lastAnswer = new Map<string, number>();
  for (const s of trace.steps.slice(0, i + 1)) {
    for (const c of s.commands) if (c.kind === "turn") lastPost.set(c.body.turnId, { i: s.i, now: s.now });
    if (s.event.type === "turnOk" || s.event.type === "turnFailed") lastAnswer.set(s.event.turnId, s.i);
  }
  return [...lastPost].filter(([t, p]) => (lastAnswer.get(t) ?? -1) < p.i && now - p.now < limitMs).map(([t]) => t);
}

/** The time of the last `/api/turn` answer at or before step i, or null. */
export function lastTurnAnswerAt(trace: Trace, i: number): number | null {
  for (let k = i; k >= 0; k--) {
    const e = trace.steps[k]!.event.type;
    if (e === "turnOk" || e === "turnFailed") return trace.steps[k]!.now;
  }
  return null;
}

/** The response that a realtime event names, if any. */
export function eventResponseId(s: TraceStep): string | null {
  if (s.event.type !== "realtime") return null;
  const e = s.event.event as Record<string, unknown>;
  if (typeof e.response_id === "string") return e.response_id;
  const r = e.response as Record<string, unknown> | undefined;
  return typeof r?.id === "string" ? r.id : null;
}

/**
 * Fires every armed timer except `ignore`, earliest first, with no other events, until none is armed or
 * `maxFirings` is reached, whatever the phase. Returns the commands the firings sent and the final state.
 */
export function drainAll(start: VoiceState, now: number, ignore: readonly TimerName[] = [], maxFirings = 40): { commands: import("../machine").VoiceCommand[]; state: VoiceState } {
  let st = start;
  let t = now;
  const commands: import("../machine").VoiceCommand[] = [];
  for (let n = 0; n < maxFirings; n++) {
    const armed = (Object.entries(st.deadlines) as [TimerName, number][]).filter(([name]) => !ignore.includes(name)).sort((a, b) => a[1] - b[1]);
    if (armed.length === 0) break;
    const [name, at] = armed[0]!;
    t = Math.max(t, at);
    const r = step(st, { type: "timer", name }, t);
    st = r.state;
    commands.push(...r.commands);
  }
  return { commands, state: st };
}
