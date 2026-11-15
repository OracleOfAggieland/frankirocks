// Brief 050 part C: from a loaded run to the report's numbers. Pure. Words stay in `detail` (for report.md);
// `summary` holds numbers, IDs and enum values only (for summary.json).
import { metaStart, scriptSteps as readScriptSteps } from "./run.mjs";
import { countBy, describe, groupBy, share, sum } from "./stats.mjs";
import { buildWindows, stepAt, stepRows } from "./steps.mjs";
import { joinTurns } from "./turns.mjs";

/** The event kinds the report reads. Any other kind is counted and otherwise skipped. */
export const KNOWN_KINDS = new Set([
  "route.done", "turn.slowParse", "turn.fastSlots", "model.call", "open.phases",
  "page.load", "user", "voice.event", "voice.cmd", "rt.event", "rt.deltas", "rt.state", "api.call", "latency.row",
  "fps", "longtask", "rtc.stats", "radio", "phone", "card", "error", "visibility",
  "step.start", "step.end", "mark",
]);
const TIMELINE = /^(phone|radio|errand|bank|money|google)(\.|$)/;
const TIMELINE_ROUTE = /^(phone|bank|google|errand)/;
/** A FastSlotsV1 call over this is slow (brief 050, part C 2). */
export const FAST_SLOTS_SLOW_MS = 900;
/** Fields that are the line's frame, not its content. */
const FRAME = new Set(["t", "src", "kind", "m", "page", "seq"]);

const isWords = (e) => e.kind.startsWith("words.") || e.kind === "note";
const isRunner = (e) => e.src === "runner";

/** The event's own fields, as `k=v` pairs, for a timeline line. Arrays joined with commas. */
export function fieldsOf(e) {
  return Object.entries(e)
    .filter(([k]) => !FRAME.has(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
    .join(" ");
}

const routeOf = (e) => (typeof e.route === "string" ? e.route : "?");
const failedApi = (e) => typeof e.err === "string" || (typeof e.status === "number" && (e.status < 200 || e.status >= 300));

export function analyze(run) {
  const allEvents = run.events;
  const words = [...run.words, ...allEvents.filter(isWords)].sort((a, b) => a.t - b.t);
  const events = allEvents.filter((e) => !isWords(e));
  const times = [...events, ...words].map((e) => e.t);
  const firstT = times.length > 0 ? Math.min(...times) : null;
  const lastT = times.length > 0 ? Math.max(...times) : null;
  const start = metaStart(run.meta) ?? firstT ?? 0;
  const end = Math.max(lastT ?? start, start);

  // Steps.
  const scriptSteps = readScriptSteps(run.script);
  const windows = buildWindows(events, start, end);
  const steps = stepRows(scriptSteps, windows);
  const at = (t) => stepAt(windows, t);
  const of = (kind) => events.filter((e) => e.kind === kind);

  // Turns.
  const latency = of("latency.row");
  const serverEvents = events.filter((e) => e.src === "server");
  const turns = joinTurns({
    words,
    latency,
    storedTurns: run.firestore?.turns ?? null,
    serverEvents,
    range: firstT === null ? null : { start: Math.min(start, firstT), end },
  }).map((r) => ({ ...r, step: at(r.anchor) }));

  // Latency, from the browser's rows.
  const latencyOf = (rows) => ({ endToAudibleMs: describe(rows.map((r) => r.endToAudibleMs)), commitDelayMs: describe(rows.map((r) => r.commitDelayMs)) });
  const byPath = {};
  for (const [path, rows] of groupBy(latency, (r) => (typeof r.path === "string" ? r.path : "none"))) byPath[path] = { rows: rows.length, ...latencyOf(rows) };
  const latencySummary = { rows: latency.length, overall: latencyOf(latency), byPath, late: latency.filter((r) => r.late === true).length, refused: countBy(latency.filter((r) => typeof r.refused === "string"), (r) => r.refused) };

  // Routes.
  const routes = {};
  for (const [key, rows] of groupBy(of("route.done"), (e) => `${routeOf(e)}${typeof e.method === "string" ? ` ${e.method}` : ""}`)) {
    const errors = rows.filter((e) => e.status !== 200);
    routes[key] = { ...describe(rows.map((e) => e.ms)), errors: errors.length, errorsByCode: countBy(errors, (e) => (typeof e.code === "string" ? e.code : `status ${e.status ?? "?"}`)) };
  }

  // Model calls.
  const models = {};
  for (const [key, rows] of groupBy(of("model.call"), (e) => `${e.purpose ?? "?"} | ${e.model ?? "?"}`)) {
    models[key] = { ...describe(rows.map((e) => e.ms)), failed: rows.filter((e) => e.ok === false).length, inTok: sum(rows.map((e) => e.inTok)), outTok: sum(rows.map((e) => e.outTok)) };
  }

  // Server steps.
  const slow = of("turn.slowParse");
  const fast = of("turn.fastSlots");
  const opens = of("open.phases");
  const phaseFields = [...new Set(opens.flatMap((e) => Object.keys(e).filter((k) => !FRAME.has(k) && typeof e[k] === "number")))];
  const serverSteps = {
    slowParse: { ...describe(slow.map((e) => e.ms)), okShare: share(slow.filter((e) => e.ok === true).length, slow.length) },
    fastSlots: {
      ...describe(fast.map((e) => e.ms)),
      validShare: share(fast.filter((e) => e.valid === true).length, fast.length),
      over900Share: share(fast.filter((e) => typeof e.ms === "number" && e.ms > FAST_SLOTS_SLOW_MS).length, fast.length),
      reasons: countBy(fast.filter((e) => typeof e.reason === "string"), (e) => e.reason),
    },
    openPhases: { n: opens.length, outcomes: countBy(opens, (e) => e.outcome ?? "?"), phases: Object.fromEntries(phaseFields.map((k) => [k, describe(opens.map((e) => e[k]))])) },
  };

  // Smoothness.
  const fps = of("fps");
  const longtasks = of("longtask");
  const lowest = (rows) => rows.reduce((best, e) => (typeof e.avg === "number" && (best === null || e.avg < best.avg) ? e : best), null);
  const low = lowest(fps);
  const smoothness = {
    fpsWindows: fps.length,
    lowestAvg: low ? Math.round(low.avg * 10) / 10 : null,
    lowestAvgStep: low ? at(low.t) : null,
    lowestMin: fps.length > 0 ? Math.min(...fps.map((e) => (typeof e.min === "number" ? e.min : Infinity))) : null,
    longFrames: sum(fps.map((e) => e.long)),
    longtasks: longtasks.length,
    longtaskMs: describe(longtasks.map((e) => e.ms)),
  };
  if (smoothness.lowestMin === Infinity) smoothness.lowestMin = null;

  // Call quality.
  const rtc = of("rtc.stats");
  const maxOf = (k) => {
    const xs = rtc.map((e) => e[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
    return xs.length > 0 ? Math.round(Math.max(...xs) * 10) / 10 : null;
  };
  const callQuality = { samples: rtc.length, maxJitterMs: maxOf("jitterMs"), maxLost: maxOf("lost"), maxConcealed: maxOf("concealed"), maxRttMs: maxOf("rttMs"), maxJitterBufferMs: maxOf("jitterBufferMs") };

  // Timelines.
  const timeline = events
    .filter((e) => TIMELINE.test(e.kind) || (e.kind === "api.call" && TIMELINE_ROUTE.test(routeOf(e))))
    .map((e) => ({ t: e.t, step: at(e.t), src: e.src ?? "?", kind: e.kind, fields: fieldsOf(e) }));

  // Errors.
  const errors = [
    ...of("error").map((e) => ({ t: e.t, step: at(e.t), what: `error (${e.where ?? "?"})`, detail: typeof e.message === "string" ? e.message.slice(0, 300) : "" })),
    ...of("route.done").filter((e) => e.status !== 200).map((e) => ({ t: e.t, step: at(e.t), what: `route ${routeOf(e)} ${e.status ?? "?"}`, detail: typeof e.code === "string" ? e.code : "" })),
    ...of("api.call").filter(failedApi).map((e) => ({ t: e.t, step: at(e.t), what: `api ${routeOf(e)} ${e.status ?? ""}`.trim(), detail: typeof e.err === "string" ? e.err : "" })),
  ].sort((a, b) => a.t - b.t);

  // Per step: what happened inside its windows.
  const inStep = (id) => (e) => at(e.t) === id;
  const stepDetail = steps.map((s) => {
    const mine = events.filter((e) => !isRunner(e) && inStep(s.id)(e));
    const fpsMine = fps.filter(inStep(s.id));
    const lowMine = lowest(fpsMine);
    return {
      ...s,
      events: mine.length,
      turns: turns.filter((r) => r.step === s.id),
      tools: mine.filter((e) => e.kind.startsWith("tool.")).map((e) => e.kind),
      errors: errors.filter((e) => e.step === s.id).length,
      notes: words.filter((w) => w.kind === "note" && (w.step === s.id || (typeof w.step !== "string" && at(w.t) === s.id))).map((w) => (typeof w.text === "string" ? w.text : "")),
      lowestFps: lowMine ? Math.round(lowMine.avg * 10) / 10 : null,
      longFrames: sum(fpsMine.map((e) => e.long)),
      longtasks: longtasks.filter(inStep(s.id)).length,
    };
  });

  // Gaps.
  const outside = events.filter((e) => !isRunner(e) && at(e.t) === null);
  const gaps = {
    noResult: stepDetail.filter((s) => s.result === null).map((s) => s.id),
    noEvents: stepDetail.filter((s) => s.started && s.events === 0).map((s) => s.id),
    notStarted: stepDetail.filter((s) => !s.started).map((s) => s.id),
    outsideAnyStep: windows.length > 0 ? outside.length : null,
    outsideByKind: windows.length > 0 ? Object.fromEntries(Object.entries(countBy(outside, (e) => e.kind)).slice(0, 10)) : {},
  };

  const unknownKinds = countBy(events.filter((e) => !KNOWN_KINDS.has(e.kind) && e.src !== "server"), (e) => e.kind);
  const results = countBy(steps, (s) => s.result ?? "none");
  const summary = {
    run: run.name,
    startedAt: start,
    durationMs: end - start,
    commit: typeof run.meta?.commit === "string" ? run.meta.commit : null,
    branch: typeof run.meta?.branch === "string" ? run.meta.branch : null,
    dirty: typeof run.meta?.dirty === "boolean" ? run.meta.dirty : null,
    hasScript: scriptSteps.length > 0,
    hasExport: run.firestore !== null,
    lines: { events: events.length, words: words.length, bad: run.badLines },
    steps: { total: steps.length, pass: results.pass ?? 0, fail: results.fail ?? 0, skip: results.skip ?? 0, noResult: results.none ?? 0 },
    stepResults: stepDetail.map((s) => ({ id: s.id, result: s.result, lengthMs: s.lengthMs, attempts: s.attempts, events: s.events, turns: s.turns.length, errors: s.errors, lowestFps: s.lowestFps, longFrames: s.longFrames })),
    turns: { total: turns.length, byId: turns.filter((r) => r.join === "id").length, approximate: turns.filter((r) => r.join === "time").length, typed: turns.filter((r) => r.typed).length },
    latency: latencySummary,
    routes,
    models,
    serverSteps,
    smoothness,
    callQuality,
    timelineEvents: timeline.length,
    errors: { total: errors.length, byWhat: countBy(errors, (e) => e.what) },
    gaps,
    unknownKinds,
  };
  return { summary, detail: { start, steps: stepDetail, turns, timeline, errors, meta: run.meta } };
}
