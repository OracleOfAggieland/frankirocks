// Brief 050 part C: report.md from the analysis. Pure. Plain GitHub tables, whole ms, "n too small" for a p95
// over fewer than MIN_N_FOR_P95 values.
import { MIN_N_FOR_P95 } from "./stats.mjs";

const WORDS_MAX = 160;

/** A table cell: no pipes or line breaks, words capped. */
export function cell(v, max = WORDS_MAX) {
  if (v === null || v === undefined || v === "") return "";
  let s = String(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

export function table(head, rows) {
  if (rows.length === 0) return "_None._\n";
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => cell(c, 400)).join(" | ")} |`)].join("\n") + "\n";
}

const ms = (v) => (v === null || v === undefined ? "" : `${Math.round(v)}`);
const p95 = (d) => (d.n === 0 ? "" : d.n < MIN_N_FOR_P95 ? `n too small` : ms(d.p95));
const pct = (v) => (v === null || v === undefined ? "" : `${Math.round(v * 1000) / 10}%`);

/** `+m:ss` from the run's start. */
export function offset(t, start) {
  const s = Math.max(0, Math.round((t - start) / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const headline = (label, d) => (d.n === 0 ? `${label}: no rows` : `${label}: p50 ${ms(d.p50)} ms, p95 ${d.n < MIN_N_FOR_P95 ? "n too small" : `${ms(d.p95)} ms`}, max ${ms(d.max)} ms (n=${d.n})`);

export function renderReport({ summary: s, detail }) {
  const out = [];
  const start = detail.start;
  const step = (id) => id ?? "(none)";
  out.push(`# Live test: ${s.run}`, "");
  const metaBits = [s.commit ? `commit \`${s.commit}\`` : null, s.branch ? `branch \`${s.branch}\`` : null, s.dirty === true ? "dirty tree" : s.dirty === false ? "clean tree" : null].filter(Boolean);
  out.push(`Started ${new Date(s.startedAt).toISOString()}, ${Math.round(s.durationMs / 1000)} s long. ${metaBits.join(", ")}${metaBits.length ? "." : ""}`, "");

  out.push("## Summary", "");
  out.push(
    s.hasScript || s.steps.total > 0 ? `- Steps: ${s.steps.pass} passed, ${s.steps.fail} failed, ${s.steps.skip} skipped, ${s.steps.noResult} with no result (of ${s.steps.total}).` : "- Steps: none (no script and no step markers).",
    `- Turns: ${s.turns.total} (${s.turns.typed} typed; ${s.turns.approximate} joined by time, marked ~).`,
    `- ${headline("End to audible", s.latency.overall.endToAudibleMs)}.`,
    `- ${headline("Commit delay", s.latency.overall.commitDelayMs)}.`,
    `- Errors: ${s.errors.total}.`,
    `- Lines: ${s.lines.events} events, ${s.lines.words} words${s.lines.bad ? `, ${s.lines.bad} unreadable lines skipped` : ""}. Export: ${s.hasExport ? "yes" : "no (words and timings from the browser log only)"}.`,
    "",
  );

  out.push("## Steps", "");
  out.push(
    table(
      ["Step", "Title", "Result", "Length s", "Turns", "Tools", "Errors", "Notes"],
      detail.steps.map((r) => [
        r.id,
        r.title,
        (r.result ?? "no result") + (r.open ? " (open)" : "") + (r.attempts > 1 ? ` (${r.attempts} tries)` : ""),
        r.started ? Math.round(r.lengthMs / 1000) : "",
        r.turns.length,
        [...new Set(r.tools)].join(", "),
        r.errors || "",
        r.notes.join(" / "),
      ]),
    ),
  );

  out.push("### Turns by step", "");
  out.push("~ means the row was joined by time, not by ID.", "");
  out.push(
    table(
      ["Step", "At", "Owner", "Franki", "Path", "End to audible", "Commit delay", "Tools"],
      detail.turns.map((r) => [
        step(r.step),
        `${offset(r.anchor, start)}${r.join === "time" ? " ~" : ""}`,
        r.owner === null ? "" : `${r.typed ? "(typed) " : ""}${cell(r.owner)}`,
        cell(r.franki ?? ""),
        r.path ?? "",
        ms(r.endToAudibleMs ?? (r.typed ? r.serverMs : null)),
        ms(r.commitDelayMs),
        r.tools.join(", "),
      ]),
    ),
  );
  if (detail.turns.some((r) => r.typed && r.serverMs !== null)) out.push("For typed turns, End to audible shows the server's `turn` route time.", "");

  out.push("## Latency", "");
  out.push(`From ${s.latency.rows} \`latency.row\` events. ${s.latency.late} late. A p95 needs ${MIN_N_FOR_P95} rows.`, "");
  const latRow = (label, l) => [label, l.endToAudibleMs.n, ms(l.endToAudibleMs.p50), p95(l.endToAudibleMs), ms(l.endToAudibleMs.max), l.commitDelayMs.n, ms(l.commitDelayMs.p50), p95(l.commitDelayMs), ms(l.commitDelayMs.max)];
  out.push(
    table(
      ["Path", "Audible n", "p50", "p95", "Max", "Commit n", "p50", "p95", "Max"],
      [latRow("all", s.latency.overall), ...Object.entries(s.latency.byPath).map(([k, v]) => latRow(k, v))],
    ),
  );
  if (Object.keys(s.latency.refused).length > 0) out.push(`Refused fastO: ${Object.entries(s.latency.refused).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");

  out.push("## Routes", "");
  out.push(table(["Route", "n", "p50", "p95", "Max", "Errors", "By code"], Object.entries(s.routes).map(([k, v]) => [k, v.n || "", ms(v.p50), p95(v), ms(v.max), v.errors || "", Object.entries(v.errorsByCode).map(([c, n]) => `${c} ${n}`).join(", ")])));

  out.push("## Model calls", "");
  out.push(table(["Purpose and model", "n", "p50", "p95", "Max", "Failed", "In tokens", "Out tokens"], Object.entries(s.models).map(([k, v]) => [k, v.n, ms(v.p50), p95(v), ms(v.max), v.failed || "", v.inTok || "", v.outTok || ""])));

  out.push("## Server steps", "");
  const sp = s.serverSteps;
  out.push(
    table(
      ["Step", "n", "p50", "p95", "Max", "Notes"],
      [
        ["turn.slowParse", sp.slowParse.n, ms(sp.slowParse.p50), p95(sp.slowParse), ms(sp.slowParse.max), sp.slowParse.n ? `ok ${pct(sp.slowParse.okShare)}` : ""],
        ["turn.fastSlots", sp.fastSlots.n, ms(sp.fastSlots.p50), p95(sp.fastSlots), ms(sp.fastSlots.max), sp.fastSlots.n ? `valid ${pct(sp.fastSlots.validShare)}, over 900 ms ${pct(sp.fastSlots.over900Share)}${Object.keys(sp.fastSlots.reasons).length ? `; ${Object.entries(sp.fastSlots.reasons).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}` : ""],
        ...Object.entries(sp.openPhases.phases).map(([k, v]) => [`open.phases ${k}`, v.n, ms(v.p50), p95(v), ms(v.max), ""]),
      ],
    ),
  );
  if (sp.openPhases.n > 0) out.push(`Opens: ${sp.openPhases.n} (${Object.entries(sp.openPhases.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}).`, "");

  out.push("## Smoothness", "");
  const sm = s.smoothness;
  out.push(
    sm.fpsWindows === 0
      ? "No `fps` windows."
      : `Lowest 2 s average: ${sm.lowestAvg} fps (step ${step(sm.lowestAvgStep)}). Lowest instant: ${sm.lowestMin ?? "?"} fps. Long frames: ${sm.longFrames} over ${sm.fpsWindows} windows. Long tasks: ${sm.longtasks}${sm.longtasks ? ` (max ${ms(sm.longtaskMs.max)} ms)` : ""}.`,
    "",
  );
  const stepFps = detail.steps.filter((r) => r.lowestFps !== null || r.longtasks > 0);
  if (stepFps.length > 0) out.push(table(["Step", "Lowest fps", "Long frames", "Long tasks"], stepFps.map((r) => [r.id, r.lowestFps ?? "", r.longFrames, r.longtasks])));

  out.push("## Call quality", "");
  const cq = s.callQuality;
  out.push(
    cq.samples === 0
      ? "No `rtc.stats` samples."
      : `${cq.samples} samples. Largest: ${[
          ["jitter", cq.maxJitterMs, " ms"],
          ["packets lost", cq.maxLost, ""],
          ["concealed", cq.maxConcealed, ""],
          ["round trip", cq.maxRttMs, " ms"],
          ["jitter buffer", cq.maxJitterBufferMs, " ms"],
        ]
          .filter(([, v]) => v !== null)
          .map(([label, v, unit]) => `${label} ${v}${unit}`)
          .join(", ")}.`,
    "",
  );

  out.push("## Timelines", "");
  out.push("Phone, radio, errand, bank, money and Google events, in order.", "");
  out.push(table(["At", "Step", "Src", "Kind", "Fields"], detail.timeline.map((e) => [offset(e.t, start), step(e.step), e.src, e.kind, e.fields])));

  out.push("## Errors", "");
  out.push(table(["At", "Step", "What", "Detail"], detail.errors.map((e) => [offset(e.t, start), step(e.step), e.what, e.detail])));

  out.push("## Gaps", "");
  const g = s.gaps;
  const list = (xs) => (xs.length ? xs.join(", ") : "none");
  out.push(
    `- Steps with no result: ${list(g.noResult)}.`,
    `- Steps never started: ${list(g.notStarted)}.`,
    `- Steps started with no events inside: ${list(g.noEvents)}.`,
    g.outsideAnyStep === null ? "- Events outside any step: no step markers, so every event is outside." : `- Events outside any step: ${g.outsideAnyStep}${g.outsideAnyStep ? ` (${Object.entries(g.outsideByKind).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}.`,
  );
  if (Object.keys(s.unknownKinds).length > 0) out.push(`- Kinds this report does not read: ${Object.entries(s.unknownKinds).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  out.push("");
  return out.join("\n");
}
