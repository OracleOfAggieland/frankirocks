/**
 * Brief 050 part B, item 7: the runner page's pure state. One step at a time; Start, Pass, Fail, Skip and Back;
 * a result per step that survives a reload. The page turns each action into the runner events it posts.
 */

export interface ScriptStep {
  id: string;
  title: string;
  group?: string;
  do?: string[];
  say?: string[];
  watch?: string[];
  account?: string;
}

export interface Script {
  title: string;
  steps: ScriptStep[];
}

export type StepResult = "pass" | "fail" | "skip";

export interface RunnerState {
  /** Names the script the results belong to; a different script starts clean. */
  scriptKey: string;
  index: number;
  /** The step started and not yet ended, or null. */
  running: string | null;
  results: Record<string, StepResult>;
  /** Notes posted per step (a count only; the words went to the route). */
  notes: Record<string, number>;
}

export type RunnerAction =
  | { type: "start" }
  | { type: "end"; result: StepResult }
  | { type: "back" }
  | { type: "go"; index: number }
  | { type: "noted" };

/** What the page posts for an action. */
export type RunnerPost = { kind: "step.start"; step: string; title: string } | { kind: "step.end"; step: string; result: StepResult };

/** Used when the run has no script.json. */
export const BUILT_IN_SCRIPT: Script = {
  title: "Quick live check",
  steps: [
    { id: "Q1", group: "Setup", title: "Open the lab and sign in", do: ["Open /lab in the other window", "Sign in with the test account"], watch: ["The status line here shows events arriving"] },
    { id: "Q2", group: "Voice", title: "Start a call and say hello", do: ["Press the power button"], say: ["Hi Franki, how's it going?"], watch: ["Franki answers out loud"] },
    { id: "Q3", group: "Voice", title: "Interrupt Franki", say: ["Tell me about my week.", "(talk over the answer) Actually, stop."], watch: ["Franki stops at once"] },
    { id: "Q4", group: "Typed", title: "Type a line during the call", do: ["Type a short question and send it"], watch: ["The reply plays as voice"] },
    { id: "Q5", group: "Voice", title: "Hang up", do: ["Press the power button again"], watch: ["The call ends cleanly"] },
    { id: "Q6", group: "Typed", title: "Type a line with no call open", do: ["Type a short question and send it"], watch: ["The reply shows as text"] },
  ],
};

const lines = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return out.length === 0 ? undefined : out;
};
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** A script from `GET /api/dev/live-test`'s `script`, or null. Steps without an ID and a title are dropped; IDs are unique. */
export function parseScript(v: unknown): Script | null {
  if (typeof v !== "object" || v === null) return null;
  const raw = (v as { steps?: unknown }).steps;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const steps: ScriptStep[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const r = s as Record<string, unknown>;
    const id = text(r.id);
    const title = text(r.title);
    if (id === undefined || title === undefined || seen.has(id)) continue;
    seen.add(id);
    const step: ScriptStep = { id, title };
    const group = text(r.group);
    if (group !== undefined) step.group = group;
    const account = text(r.account);
    if (account !== undefined) step.account = account;
    for (const k of ["do", "say", "watch"] as const) {
      const l = lines(r[k]);
      if (l !== undefined) step[k] = l;
    }
    steps.push(step);
  }
  if (steps.length === 0) return null;
  return { title: text((v as { title?: unknown }).title) ?? "Live test", steps };
}

export const scriptKey = (s: Script): string => `${s.title}|${s.steps.map((x) => x.id).join(",")}`;

export function initialRunner(script: Script): RunnerState {
  return { scriptKey: scriptKey(script), index: 0, running: null, results: {}, notes: {} };
}

/** A stored state for this script, or a fresh one (another script's results never carry over). */
export function restoreRunner(script: Script, stored: unknown): RunnerState {
  const fresh = initialRunner(script);
  if (typeof stored !== "object" || stored === null) return fresh;
  const s = stored as Partial<RunnerState>;
  if (s.scriptKey !== fresh.scriptKey) return fresh;
  const ids = new Set(script.steps.map((x) => x.id));
  const results: Record<string, StepResult> = {};
  for (const [k, v] of Object.entries(s.results ?? {})) if (ids.has(k) && (v === "pass" || v === "fail" || v === "skip")) results[k] = v;
  const notes: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.notes ?? {})) if (ids.has(k) && typeof v === "number" && v > 0) notes[k] = v;
  const index = typeof s.index === "number" && Number.isInteger(s.index) && s.index >= 0 && s.index < script.steps.length ? s.index : 0;
  const running = typeof s.running === "string" && ids.has(s.running) ? s.running : null;
  return { scriptKey: fresh.scriptKey, index, running, results, notes };
}

/** The step after `index` with no result, else the next one, else the last. */
function nextIndex(script: Script, results: Record<string, StepResult>, index: number): number {
  for (let i = index + 1; i < script.steps.length; i++) if (results[script.steps[i]!.id] === undefined) return i;
  return Math.min(index + 1, script.steps.length - 1);
}

/** One action: the new state and what to post. */
export function applyRunnerAction(script: Script, s: RunnerState, a: RunnerAction): { state: RunnerState; posts: RunnerPost[] } {
  const step = script.steps[s.index];
  if (step === undefined) return { state: s, posts: [] };
  switch (a.type) {
    case "start": {
      if (s.running === step.id) return { state: s, posts: [] };
      const posts: RunnerPost[] = [];
      // Starting one step ends nothing silently: a step left running stays without a result.
      posts.push({ kind: "step.start", step: step.id, title: step.title });
      return { state: { ...s, running: step.id }, posts };
    }
    case "end": {
      const results = { ...s.results, [step.id]: a.result };
      const atEnd = s.index === script.steps.length - 1;
      return {
        state: { ...s, results, running: s.running === step.id ? null : s.running, index: atEnd ? s.index : nextIndex(script, results, s.index) },
        posts: [{ kind: "step.end", step: step.id, result: a.result }],
      };
    }
    case "back":
      return { state: { ...s, index: Math.max(0, s.index - 1) }, posts: [] };
    case "go":
      return a.index >= 0 && a.index < script.steps.length ? { state: { ...s, index: a.index }, posts: [] } : { state: s, posts: [] };
    case "noted":
      return { state: { ...s, notes: { ...s.notes, [step.id]: (s.notes[step.id] ?? 0) + 1 } }, posts: [] };
  }
}

export type KeyAction = "start" | "pass" | "startOrPass" | "fail" | "skip" | "note" | "back" | "mark";

/**
 * A key on the page, outside the note box: Enter starts the step or, once started, passes it; F fails, S skips, N
 * goes to the note box, B or Backspace goes back, M drops a mark. Keys with a modifier, and every key typed into a
 * text field, are the browser's.
 */
export function keyAction(key: string, opts: { inText: boolean; modifier: boolean }): KeyAction | null {
  if (opts.inText || opts.modifier) return null;
  switch (key) {
    case "Enter":
      return "startOrPass";
    case "f":
    case "F":
      return "fail";
    case "s":
    case "S":
      return "skip";
    case "n":
    case "N":
      return "note";
    case "b":
    case "B":
    case "Backspace":
      return "back";
    case "m":
    case "M":
      return "mark";
    default:
      return null;
  }
}

/** Counts for the side list's head. */
export function tally(script: Script, s: RunnerState): { pass: number; fail: number; skip: number; open: number } {
  const t = { pass: 0, fail: 0, skip: 0, open: 0 };
  for (const step of script.steps) {
    const r = s.results[step.id];
    if (r === undefined) t.open++;
    else t[r]++;
  }
  return t;
}

/** "12 s ago" for the status line. */
export function ago(ms: number | null): string {
  if (ms === null) return "never";
  if (ms < 1_500) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
