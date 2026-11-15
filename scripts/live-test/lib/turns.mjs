// Brief 050 part C: one row per turn, joined from the owner's words, Franki's words, the browser's `latency.row`,
// the stored turns (when the export exists) and the server's events. Pure.
//
// Joins by ID first: a stored user turn's `itemIds` hold the owner's `itemId`, its `spokenResponseId` is Franki's
// `responseId`, and its document ID is the latency row's `turnId`. What no ID ties falls back to time order, and the
// row is marked approximate (`join: "time"`).
//
// The latency row's times are browser opsClock values, which are epoch ms in live mode, so they compare with `t`.

/** An owner line this long after a turn's commit still belongs to it (transcription lags the commit). */
export const OWNER_AFTER_COMMIT_MS = 15_000;
/** And this long before it (clock offset between the two writers). */
export const OWNER_BEFORE_COMMIT_MS = 2_000;
/** Franki's words belong to the latest earlier turn only within this long. */
export const FRANKI_WITHIN_MS = 60_000;
/** A typed line's `route.done` for `turn` comes within this long. */
export const TYPED_ROUTE_WITHIN_MS = 30_000;

/** Stored turns this far outside the run's first and last event still count. */
export const STORED_SLACK_MS = 5 * 60_000;

const iso = (v) => {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function newRow(anchor) {
  return {
    anchor,
    turnId: null,
    sessionId: null,
    source: null,
    owner: null,
    ownerT: null,
    franki: null,
    frankiT: null,
    typed: false,
    path: null,
    verdict: null,
    endToAudibleMs: null,
    commitDelayMs: null,
    late: null,
    refused: null,
    serverMs: null,
    stored: null,
    tools: [],
    approx: [],
  };
}

function attachLatency(row, lat) {
  row.path = typeof lat.path === "string" ? lat.path : row.path;
  row.verdict = typeof lat.verdict === "string" ? lat.verdict : row.verdict;
  row.endToAudibleMs = num(lat.endToAudibleMs);
  row.commitDelayMs = num(lat.commitDelayMs);
  row.late = typeof lat.late === "boolean" ? lat.late : null;
  row.refused = typeof lat.refused === "string" ? lat.refused : null;
}

const latencyAnchor = (lat) => num(lat.commit) ?? num(lat.lastLoud) ?? lat.t;

/**
 * @param input {{ words: object[], latency: object[], storedTurns: object[]|null, serverEvents: object[],
 *   range: {start: number, end: number}|null }} `range` drops stored turns from other sessions' times (the export
 *   holds whole sessions); a turn within STORED_SLACK_MS of the run's ends is kept.
 */
export function joinTurns({ words, latency, storedTurns, serverEvents, range = null }) {
  const rows = [];
  const owners = words.filter((w) => w.kind === "words.owner" || w.kind === "words.typed");
  const frankis = words.filter((w) => w.kind === "words.franki");
  const usedOwner = new Set();
  const usedFranki = new Set();
  const usedLatency = new Set();
  const latencyById = new Map();
  for (const lat of latency) if (typeof lat.turnId === "string" && !latencyById.has(lat.turnId)) latencyById.set(lat.turnId, lat);

  // 1. Stored user turns, when the export exists.
  const inRange = (d) => {
    if (range === null) return true;
    const at = iso(d.data?.committedAt);
    return at === null || (at >= range.start - STORED_SLACK_MS && at <= range.end + STORED_SLACK_MS);
  };
  const stored = (storedTurns ?? []).filter((d) => d.data?.role === "user" && inRange(d));
  const assistants = (storedTurns ?? []).filter((d) => d.data?.role === "assistant");
  for (const doc of stored) {
    const d = doc.data;
    const committed = iso(d.committedAt);
    const row = newRow(committed ?? 0);
    row.turnId = doc.id ?? null;
    row.sessionId = typeof d.sessionId === "string" ? d.sessionId : null;
    row.source = "stored";
    row.stored = {
      state: d.state ?? null,
      judge: d.judge ?? null,
      admitMs: iso(d.admittedAt) !== null && committed !== null ? iso(d.admittedAt) - committed : null,
      playbackMs: iso(d.playbackAt) !== null && committed !== null ? iso(d.playbackAt) - committed : null,
    };
    const itemIds = Array.isArray(d.itemIds) ? d.itemIds : [];
    const ow = owners.find((w) => !usedOwner.has(w) && typeof w.itemId === "string" && itemIds.includes(w.itemId));
    if (ow) {
      usedOwner.add(ow);
      row.owner = ow.text ?? null;
      row.ownerT = ow.t;
      row.typed = ow.kind === "words.typed";
    } else if (typeof d.text === "string") {
      // A typed line has no item ID: the same words near the commit tie it.
      const typed = owners.find((w) => !usedOwner.has(w) && w.kind === "words.typed" && w.text === d.text && committed !== null && Math.abs(w.t - committed) < TYPED_ROUTE_WITHIN_MS);
      if (typed) {
        usedOwner.add(typed);
        row.typed = true;
        row.ownerT = typed.t;
      }
      row.owner = d.text;
    }
    const lat = row.turnId ? latencyById.get(row.turnId) : undefined;
    if (lat) {
      usedLatency.add(lat);
      attachLatency(row, lat);
    }
    const fr = typeof d.spokenResponseId === "string" ? frankis.find((w) => !usedFranki.has(w) && w.responseId === d.spokenResponseId) : undefined;
    if (fr) {
      usedFranki.add(fr);
      row.franki = fr.text ?? null;
      row.frankiT = fr.t;
    } else {
      const next = assistants.find((a) => a.data.sessionId === d.sessionId && a.data.seq === d.seq + 1);
      if (next && typeof next.data.text === "string") row.franki = next.data.text;
    }
    if (committed === null) row.anchor = row.ownerT ?? row.frankiT ?? 0;
    rows.push(row);
  }

  // 2. Latency rows no stored turn claimed.
  for (const lat of latency) {
    if (usedLatency.has(lat)) continue;
    usedLatency.add(lat);
    const row = newRow(latencyAnchor(lat));
    row.turnId = typeof lat.turnId === "string" ? lat.turnId : null;
    row.source = "latency";
    attachLatency(row, lat);
    rows.push(row);
  }

  // 3. Owner lines and typed lines left over: the nearest row with no owner words, else a row of their own.
  for (const w of owners) {
    if (usedOwner.has(w)) continue;
    usedOwner.add(w);
    let best = null;
    for (const r of rows) {
      if (r.owner !== null || r.ownerT !== null) continue;
      const dt = w.t - r.anchor;
      if (dt < -OWNER_BEFORE_COMMIT_MS || dt > OWNER_AFTER_COMMIT_MS) continue;
      if (best === null || Math.abs(dt) < Math.abs(w.t - best.anchor)) best = r;
    }
    const row = best ?? newRow(w.t);
    if (!best) {
      row.source = "words";
      rows.push(row);
    } else row.approx.push("owner");
    row.owner = w.text ?? null;
    row.ownerT = w.t;
    row.typed = w.kind === "words.typed";
    if (row.typed && row.path === null) row.path = "typed";
  }
  for (const r of rows) if (r.typed && r.path === null) r.path = "typed";

  rows.sort((a, b) => a.anchor - b.anchor);

  // 4. Franki's words left over: the latest earlier row with none, within FRANKI_WITHIN_MS; else a row of their own
  //    (a greeting or a proactive line).
  for (const w of frankis) {
    if (usedFranki.has(w)) continue;
    usedFranki.add(w);
    let target = null;
    for (const r of rows) {
      if (r.anchor > w.t) break;
      target = r;
    }
    if (target && target.franki === null && w.t - target.anchor <= FRANKI_WITHIN_MS) {
      target.franki = w.text ?? null;
      target.frankiT = w.t;
      target.approx.push("franki");
    } else {
      const row = newRow(w.t);
      row.source = "words";
      row.franki = w.text ?? null;
      row.frankiT = w.t;
      rows.push(row);
      rows.sort((a, b) => a.anchor - b.anchor);
    }
  }

  // 5. Server events: by `turnId` where they carry one, else the typed line's `route.done` by time, and tools in the
  //    gap between this row and the next.
  const byTurn = new Map();
  for (const r of rows) if (r.turnId) byTurn.set(r.turnId, r);
  const usedRoute = new Set();
  for (const r of rows) {
    if (!r.typed) continue;
    const from = r.ownerT ?? r.anchor;
    const done = serverEvents.find((e) => !usedRoute.has(e) && e.kind === "route.done" && e.route === "turn" && e.t >= from && e.t - from <= TYPED_ROUTE_WITHIN_MS);
    if (done) {
      usedRoute.add(done);
      r.serverMs = num(done.ms);
      r.approx.push("route");
    }
  }
  for (const e of serverEvents) {
    if (!e.kind.startsWith("tool.")) continue;
    const owner = typeof e.turnId === "string" ? byTurn.get(e.turnId) : undefined;
    if (owner) {
      owner.tools.push(e.kind);
      continue;
    }
    let target = null;
    for (const r of rows) {
      if (r.anchor > e.t) break;
      target = r;
    }
    if (target) {
      target.tools.push(e.kind);
      if (!target.approx.includes("tool")) target.approx.push("tool");
    }
  }

  return rows.map((r) => ({ ...r, join: r.approx.length > 0 ? "time" : "id" }));
}
