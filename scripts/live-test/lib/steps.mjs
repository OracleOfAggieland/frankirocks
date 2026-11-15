// Brief 050 part C: step windows from the runner's `step.start` and `step.end` events. Pure.
//
// Each `step.start` opens a window that closes at its own `step.end`, or at the next `step.start` (marked open),
// or at the end of the run (marked open). A `step.end` with no open window for that step makes a window from the
// previous window's close (or the run's start) to the end, marked `noStart`. A step started again (Back) gets a
// second window; its result is the last one given.

const RESULTS = new Set(["pass", "fail", "skip"]);

export function buildWindows(events, runStart, runEnd) {
  const marks = events.filter((e) => e.src === "runner" && (e.kind === "step.start" || e.kind === "step.end") && typeof e.step === "string" && e.step !== "");
  const windows = [];
  let open = null;
  let lastClose = runStart;
  for (const e of marks) {
    if (e.kind === "step.start") {
      if (open) {
        open.end = e.t;
        open.closedBy = "next";
        lastClose = e.t;
      }
      open = { step: e.step, title: typeof e.title === "string" ? e.title : "", start: e.t, end: null, result: null, closedBy: null };
      windows.push(open);
    } else {
      const result = RESULTS.has(e.result) ? e.result : null;
      if (open && open.step === e.step) {
        open.end = e.t;
        open.result = result;
        open.closedBy = "end";
        lastClose = e.t;
        open = null;
      } else {
        // Another step is open: it closes here, and this result gets an empty window of its own.
        const start = open ? e.t : Math.min(lastClose, e.t);
        if (open) {
          open.end = e.t;
          open.closedBy = "next";
        }
        open = null;
        windows.push({ step: e.step, title: "", start, end: e.t, result, closedBy: "noStart" });
        lastClose = e.t;
      }
    }
  }
  if (open) {
    open.end = Math.max(runEnd, open.start);
    open.closedBy = "runEnd";
  }
  return windows;
}

/** The step a time falls in: the window with the latest start that holds it. Null outside every window. */
export function stepAt(windows, t) {
  let best = null;
  for (const w of windows) {
    if (t >= w.start && t <= w.end && (best === null || w.start >= best.start)) best = w;
  }
  return best ? best.step : null;
}

/**
 * One row per step: the script's order first, then any step seen only in the events. `result` is the last result
 * given; `lengthMs` sums the step's windows; `open` is true when a window never got its `step.end`.
 */
export function stepRows(scriptSteps, windows) {
  const rows = new Map();
  for (const s of scriptSteps) rows.set(s.id, { id: s.id, title: s.title, group: s.group, windows: [], inScript: true });
  for (const w of windows) {
    if (!rows.has(w.step)) rows.set(w.step, { id: w.step, title: w.title, group: "", windows: [], inScript: false });
    const row = rows.get(w.step);
    if (!row.title && w.title) row.title = w.title;
    row.windows.push(w);
  }
  return [...rows.values()].map((r) => {
    const ended = r.windows.filter((w) => w.result !== null);
    return {
      id: r.id,
      title: r.title,
      group: r.group,
      inScript: r.inScript,
      result: ended.length > 0 ? ended[ended.length - 1].result : null,
      started: r.windows.length > 0,
      open: r.windows.some((w) => w.closedBy === "next" || w.closedBy === "runEnd"),
      attempts: r.windows.length,
      lengthMs: r.windows.reduce((a, w) => a + (w.end - w.start), 0),
      windows: r.windows,
    };
  });
}
