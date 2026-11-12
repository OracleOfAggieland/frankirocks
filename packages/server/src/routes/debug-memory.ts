/**
 * GET /api/debug/memory (R28.4, R28.5, R29.1, R29.2, R29.9, R29.11, R29.12; KC03, KC09; Q14, Q28, Q33; design
 * "GET /api/debug/memory"). Development only: while NODE_ENV is "production" it answers 404 CONFIG before any
 * Store_Port read. Read-only: no core documents, no request ledger.
 *
 * `?section=turns|evidence|memories|jobs|ledger|head|rules[&sessionId=][&cursor=]`. Pages hold at most 50 items;
 * `nextCursor` is set exactly when more remain. A cursor names the last item of the previous page and must be a
 * record of the requesting Owner (otherwise SCOPE), so pages never repeat or skip items read with no writes in
 * between. Memory items carry their lineage from `resolveLineage`, with a mismatch flag.
 *
 * S2 content may appear here (the development owner-inspection carve-out of R28.4, not `inspect`). Each response
 * that contains S2 content writes one log line with the uid, the revealed IDs and the ops time, and no content.
 */
import {
  type CoreBundle,
  type DebugItem,
  type DebugPage,
  DebugRequest,
  type DebugSessionView,
  type Evidence,
  type ID,
  type Infer,
  type Job,
  type Ledger,
  type Memory,
  PERMIT_KINDS,
  type PermitKind,
  type Session,
  type Turn,
  isIdShape,
  msFromTs,
  resolveLineage,
  tsFromMs,
} from "@franki/core";
import { fastODecisionId } from "../admission/seam";
import { isProduction } from "../config/env";
import { paths } from "../store/paths";
import type { StoredDoc } from "../store/port";
import { readTurns } from "../worker/extract-jobs";
import { configError, parseError, scopeError } from "./errors";
import { rulesItem } from "./debug-rules";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

export const DEBUG_PAGE_SIZE = 50;

type DebugReq = Infer<typeof DebugRequest>;

const COMPLETE = { state: "complete" as const, from: null, to: null, missingRanges: [], generation: 0 };

function page(section: DebugReq["section"], items: DebugItem[], more: boolean, cursorOf: (item: DebugItem) => string, session: DebugSessionView | null = null): DebugPage {
  return { section, items, nextCursor: more && items.length > 0 ? cursorOf(items[items.length - 1]!) : null, coverage: COMPLETE, session };
}

/** Q28 page over a top-level collection, after `cursor` (which must exist under the Owner). */
async function q28<T>(ctx: RouteContext, collection: "evidence" | "memories" | "jobs", cursor: string | null): Promise<{ rows: StoredDoc<T>[]; more: boolean }> {
  const { uid, deps } = ctx;
  if (cursor !== null) {
    if (!isIdShape(cursor)) throw parseError("cursor");
    if ((await deps.store.get(uid, `${paths.collection(uid, collection)}/${cursor}`)) === null) throw scopeError();
  }
  const rows = await deps.store.query<T>(uid, {
    collection: paths.collection(uid, collection),
    where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
    orderBy: { field: "__name__", dir: "asc" },
    limit: DEBUG_PAGE_SIZE + 1,
  });
  return { rows: rows.slice(0, DEBUG_PAGE_SIZE), more: rows.length > DEBUG_PAGE_SIZE };
}

async function memoryItem(ctx: RouteContext, doc: StoredDoc<Memory>): Promise<DebugItem> {
  const m = doc.data;
  const evidence = new Map<string, Evidence>();
  const eids = [...new Set(m.rootSlices.map((s) => s.eid))];
  const docs = await Promise.all(eids.map((eid) => ctx.deps.store.get<Evidence>(ctx.uid, paths.evidence(ctx.uid, eid)).catch(() => null)));
  eids.forEach((eid, i) => {
    const e = docs[i];
    if (e !== null && e !== undefined) evidence.set(eid, e.data);
  });
  const r = resolveLineage({ memory: m, evidence, hasher: ctx.deps.hasher });
  const links = m.rootSlices.slice(0, 128).map((slice) => ({ slice, text: r.links.find((l) => l.slice === slice)?.text ?? null }));
  const failures = r.ok ? [] : r.failures.slice(0, 256).map((f) => ({ kind: f.kind, index: Math.max(0, f.index), eid: f.eid }));
  return { kind: "memory", id: doc.id, record: m, lineage: { ok: r.ok, links, failures } };
}

type Admission = { issuer: "seam" | "browser" | null; permitKind: PermitKind | null; falseHold: boolean; turnId: ID | null };

/**
 * Issuer, Permit kind and false hold of an admission decision (voice-control R13.3, R13.4; design "Debug_Panel").
 * The closed decision payload has no kind field (question 57): a decision keyed `H("fastO", sessionId, turnId)` is
 * the browser's `fastO`; any other takes the kind from the cited request entry's stored response (null for a hold).
 */
async function admissionOf(ctx: RouteContext, id: string, entry: Ledger): Promise<Admission> {
  const none: Admission = { issuer: null, permitKind: null, falseHold: false, turnId: null };
  if (entry.kind !== "decision" || entry.payload.purpose !== "answer") return none;
  const refs = [...entry.payload.acceptedRefs, ...entry.payload.heldRefs];
  const ref = refs.find((r) => r.type === "turn");
  const turnId = ref === undefined ? null : (ref.id as ID);
  if (ref !== undefined && "parentId" in ref && id === fastODecisionId(ctx.deps.hasher, ref.parentId, ref.id)) return { issuer: "browser", permitKind: "fastO", falseHold: false, turnId };
  const reqRef = entry.state === "complete" ? entry.payload.acceptedRefs.find((r) => r.type === "ledger") : undefined;
  const [request, turn] = await Promise.all([
    reqRef === undefined ? null : ctx.deps.store.get<Ledger>(ctx.uid, paths.ledger(ctx.uid, reqRef.id)).catch(() => null),
    ref === undefined || !("parentId" in ref) ? null : ctx.deps.store.get<Turn>(ctx.uid, paths.turn(ctx.uid, ref.parentId, ref.id as ID)).catch(() => null),
  ]);
  const response = request !== null && request.data.kind === "request" ? (request.data.payload.response as { permit?: { kind?: unknown } | null } | null) : null;
  const kind = response?.permit?.kind;
  const permitKind = typeof kind === "string" && (PERMIT_KINDS as readonly string[]).includes(kind) ? (kind as PermitKind) : null;
  // A false hold: the judge held (or timed out on) a voice Turn the parse found ordinary.
  const falseHold = permitKind === "slowOrdinary" && turn !== null && turn.data.itemIds.length > 0 && turn.data.judge !== "O";
  return { issuer: "seam", permitKind, falseHold, turnId };
}

/** Groups a page's decisions by Turn, in the order each Turn first appears, and marks the one that played. */
function groupByTurn(items: Extract<DebugItem, { kind: "ledger" }>[]): Extract<DebugItem, { kind: "ledger" }>[] {
  const groups = new Map<string, Extract<DebugItem, { kind: "ledger" }>[]>();
  for (const item of items) {
    const key = item.turnId ?? `id:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].flatMap((g) => {
    const fastO = g.some((i) => i.permitKind === "fastO");
    return g.map((i) => ({ ...i, played: i.record.state === "complete" && (fastO ? i.permitKind === "fastO" : i.permitKind !== null) }));
  });
}

async function ledgerPage(ctx: RouteContext, cursor: string | null): Promise<DebugPage> {
  const { uid, deps } = ctx;
  let after: { at: string; id: string } | null = null;
  if (cursor !== null) {
    if (!isIdShape(cursor)) throw parseError("cursor");
    const doc = await deps.store.get<Ledger>(uid, paths.ledger(uid, cursor));
    if (doc === null || doc.data.kind !== "decision") throw scopeError();
    after = { at: doc.data.at, id: cursor };
  }
  // Q33, newest first; ties on `at` sort by document ID descending.
  const items: DebugItem[] = [];
  let more = false;
  let bound = after?.at ?? null;
  let skipThrough = after?.id ?? null;
  for (;;) {
    const rows = await deps.store.query<Ledger>(uid, {
      collection: paths.collection(uid, "ledger"),
      where: [{ field: "kind", op: "==", value: "decision" }, ...(bound === null ? [] : [{ field: "at", op: "<=" as const, value: bound }])],
      orderBy: { field: "at", dir: "desc" },
      limit: 100,
    });
    let fresh = 0;
    const picked: typeof rows = [];
    for (const row of rows) {
      if (after !== null && skipThrough !== null && (row.data.at > after.at || (row.data.at === after.at && row.id >= skipThrough))) continue;
      fresh++;
      if (items.length + picked.length === DEBUG_PAGE_SIZE) {
        more = true;
        break;
      }
      picked.push(row);
    }
    // Each row's Turn read in parallel: one round trip after another (about 75 ms each from a laptop to us-central1)
    // passed the panel's 3 s budget at about 40 decisions, so the panel showed stale data on every refresh.
    const admissions = await Promise.all(picked.map((row) => admissionOf(ctx, row.id, row.data)));
    picked.forEach((row, i) => items.push({ kind: "ledger", id: row.id, record: row.data, ...admissions[i]!, played: false }));
    if (more || rows.length < 100 || fresh === 0) break;
    const last = rows[rows.length - 1]!;
    bound = last.data.at;
    after = { at: last.data.at, id: last.id };
    skipThrough = last.id;
  }
  // The cursor is the oldest decision read, whatever the grouping puts last.
  const oldest = items.length > 0 ? items[items.length - 1]!.id : null;
  const grouped = groupByTurn(items as Extract<DebugItem, { kind: "ledger" }>[]);
  return { ...page("ledger", grouped, false, (i) => i.id), nextCursor: more ? oldest : null };
}

async function turnsPage(ctx: RouteContext, req: DebugReq): Promise<DebugPage> {
  const { uid, deps } = ctx;
  let sessionId = req.sessionId;
  let sessionDoc: StoredDoc<Session> | null = null;
  if (sessionId === null) {
    const epoch = await deps.store.get<{ activeSessionId: ID | null }>(uid, paths.core(uid, "epoch"));
    sessionId = epoch?.data.activeSessionId ?? null;
    if (sessionId === null) return page("turns", [], false, (i) => i.id);
    sessionDoc = await deps.store.get<Session>(uid, paths.session(uid, sessionId));
  } else {
    sessionDoc = await deps.store.get<Session>(uid, paths.session(uid, sessionId));
    if (sessionDoc === null) throw scopeError();
  }
  const all = await readTurns(deps.store, uid, sessionId);
  let start = 0;
  if (req.cursor !== null) {
    const at = all.findIndex((t) => t.id === req.cursor);
    if (at < 0) throw scopeError();
    start = at + 1;
  }
  const slice = all.slice(start, start + DEBUG_PAGE_SIZE);
  const view = sessionDoc === null ? null : sessionView(sessionId, sessionDoc.data, all, deps.clock.read().opsClock.now);
  return page("turns", slice.map(({ id, turn }) => ({ kind: "turn", id, record: turn })), start + DEBUG_PAGE_SIZE < all.length, (i) => i.id, view);
}

/** The Session's audience and parses (voice-control R13.5; design "Debug_Panel"). */
function sessionView(sessionId: ID, s: Session, turns: { id: string; turn: Turn }[], opsNow: number): DebugSessionView {
  const users = turns.filter((t) => t.turn.role === "user");
  const gap = s.committedParseSeq < s.lastClientSeq ? users.find((t) => t.turn.seq === s.committedParseSeq + 1) : undefined;
  return {
    sessionId,
    audience: s.audience,
    repairPending: s.parseLease !== null && msFromTs(s.parseLease.until) > opsNow,
    failedParses: users.filter((t) => t.turn.parseState === "failed").length,
    parseGapTurnId: gap === undefined ? null : (gap.id as ID),
  };
}

/** IDs of records in the page that carry S2 content. */
function s2Ids(p: DebugPage): string[] {
  const ids: string[] = [];
  for (const item of p.items) {
    if (item.kind === "memory" && (item.record.sens === "S2" || item.record.rootSlices.some((s) => s.sens === "S2"))) ids.push(item.id);
    if (item.kind === "evidence" && item.record.fieldSlices.some((s) => s.sens === "S2")) ids.push(item.id);
  }
  return ids;
}

export async function debugMemory(ctx: RouteContext, req: DebugReq): Promise<DebugPage> {
  const { uid, deps } = ctx;
  let result: DebugPage;
  let rulesS2 = false;
  switch (req.section) {
    case "head": {
      const bundle = await deps.store.get<CoreBundle>(uid, paths.core(uid, "bundle"));
      result = page("head", bundle === null ? [] : [{ kind: "head", id: "bundle", record: bundle.data }], false, (i) => i.id);
      break;
    }
    case "turns":
      result = await turnsPage(ctx, req);
      break;
    case "ledger":
      result = await ledgerPage(ctx, req.cursor);
      break;
    case "evidence": {
      const { rows, more } = await q28<Evidence>(ctx, "evidence", req.cursor);
      result = page("evidence", rows.map((r) => ({ kind: "evidence", id: r.id, record: r.data })), more, (i) => i.id);
      break;
    }
    case "jobs": {
      const { rows, more } = await q28<Job>(ctx, "jobs", req.cursor);
      result = page("jobs", rows.map((r) => ({ kind: "job", id: r.id, record: r.data })), more, (i) => i.id);
      break;
    }
    // Brief 018 task B11: the rules section, one item.
    case "rules": {
      const r = await rulesItem(ctx);
      result = page("rules", r.item === null ? [] : [r.item], false, (i) => i.id);
      if (r.revealsS2) rulesS2 = true;
      break;
    }
    case "memories": {
      const { rows, more } = await q28<Memory>(ctx, "memories", req.cursor);
      const items: DebugItem[] = await Promise.all(rows.map((r) => memoryItem(ctx, r)));
      result = page("memories", items, more, (i) => i.id);
      break;
    }
  }
  const revealed = [...s2Ids(result), ...(rulesS2 ? ["rules"] : [])];
  if (revealed.length > 0) deps.log("debug.s2reveal", { uid, ids: revealed, opsAt: tsFromMs(deps.clock.read().opsClock.now) });
  return result;
}

const QUERY_KEYS = new Set(["section", "sessionId", "cursor"]);

export const debugMemoryRoute: RouteSpec<DebugReq> = {
  name: "debug",
  parse: ({ query }) => {
    for (const key of query.keys()) if (!QUERY_KEYS.has(key)) throw parseError(`unknown parameter ${key}`);
    return parseWith(DebugRequest, {
      section: query.get("section"),
      sessionId: query.get("sessionId"),
      cursor: query.get("cursor"),
    });
  },
  run: (ctx, req) => {
    // Refused in production before any Store_Port read (R29.12); the guard before this only verified the token.
    if (isProduction(ctx.deps.env)) throw configError(404, "debug route disabled in production");
    return debugMemory(ctx, req);
  },
};
