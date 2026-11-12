/**
 * GET /api/memory (contracts §6 Routes; brief 020). `?view=overview|item|why|receipt|lab|strip[&id=][&cursor=]`.
 * Read-only: no core documents are created, no request ledger entry is written. The pure views in
 * `@franki/core` (`memory-views`) decide what crosses; this file only reads the rows.
 *
 *   - Every Memory row returned passes `shown`: `spokenGrade` (the one `eligible` function) under the caller's
 *     audience. The audience is the active Session's effective audience, or private with no Session open.
 *   - Under a barrier the route answers BARRIER. Before the core documents exist, every view is empty.
 *   - `overview` is `snapshot()`; `item` and `why` need `id`; `receipt` takes the forget receipt `id`, or the newest
 *     one; `lab` counts real rows; `strip` reads the newest live loop.
 */
import {
  type CoreEpoch,
  type Cov,
  type Evidence,
  type ID,
  type Ledger,
  type MemoryRequest,
  type MemoryResponse,
  MemoryRequest as MemoryRequestSchema,
  type Session,
  type ViewContext,
  type ViewRow,
  isIdShape,
  itemView,
  labView,
  receiptView,
  snapshot,
  stripView,
  tsFromMs,
  whyView,
} from "@franki/core";
import { effectiveAudience } from "../audience";
import { ownerClock, readCoreDocs } from "../core-docs";
import { foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { paths } from "../store/paths";
import { barrierError, parseError, scopeError } from "./errors";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

/** The Lab reads at most this many Evidence and ledger rows each; past it, its coverage is partial. */
export const LAB_READ_CAP = 2_000;
/** The store's query limit. */
const PAGE = 100;
/** A recent told line's note lives as long as a recall note. */
const NOTE_TTL_MS = 60_000;

const COMPLETE: Cov = { state: "complete", from: null, to: null, missingRanges: [], generation: 0 };

/** The empty answer of a view: zeros and empty lists, never samples. */
export function emptyMemoryResponse(view: MemoryRequest["view"]): MemoryResponse {
  return {
    items: [],
    snapshot: view === "overview" ? { cards: [], overview: { topics: [], guesses: 0, heldPrivate: 0, recentTold: [] }, coverage: COMPLETE, truncated: false, cursor: null } : null,
    lab:
      view === "lab"
        ? { readEmails: 0, privateGuesses: 0, guessLinesSpoken: 0, delivered: 0, held: 0, steered: 0, declined: 0, blocked: 0, falseHolds: 0, overForget: 0, foodWithoutSuggest: 0, coverage: COMPLETE, limits: [] }
        : null,
    strip: view === "strip" ? { loopId: null, steps: [] } : null,
    nextCursor: null,
    coverage: COMPLETE,
  };
}

/** Every document of a collection in ID order, up to `cap`; `complete` is false when the cap stopped the read. */
async function readCapped<T>(ctx: RouteContext, collection: "evidence" | "ledger", cap: number): Promise<{ rows: { id: string; data: T }[]; complete: boolean }> {
  const rows: { id: string; data: T }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { id: string; data: T }[] = await ctx.deps.store.query<T>(ctx.uid, {
      collection: paths.collection(ctx.uid, collection),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: PAGE,
    });
    for (const d of page) {
      if (rows.length >= cap) return { rows, complete: false };
      rows.push(d);
    }
    if (page.length < PAGE) return { rows, complete: true };
    cursor = page[page.length - 1]!.id;
  }
}

/** The caller's audience: the active Session's effective audience, or private when none is open. */
async function callerAudience(ctx: RouteContext, epoch: CoreEpoch, opsNow: number) {
  if (epoch.activeSessionId === null) return "private" as const;
  const s = await ctx.deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, epoch.activeSessionId));
  if (s === null || (s.data.status !== "active" && s.data.status !== "minting")) return "private" as const;
  return effectiveAudience(s.data, opsNow);
}

/** The newest forget receipt, or the one named. */
async function readReceipt(ctx: RouteContext, id: ID | null): Promise<{ id: ID; ledger: Ledger } | null> {
  const { uid, deps } = ctx;
  if (id !== null) {
    const doc = await deps.store.get<Ledger>(uid, paths.ledger(uid, id));
    if (doc === null || doc.data.kind !== "forgetReceipt") throw scopeError();
    return { id, ledger: doc.data };
  }
  const rows = await deps.store.query<Ledger>(uid, {
    collection: paths.collection(uid, "ledger"),
    where: [{ field: "kind", op: "==", value: "forgetReceipt" }],
    orderBy: { field: "at", dir: "desc" },
    limit: 1,
  });
  return rows.length === 0 ? null : { id: rows[0]!.id as ID, ledger: rows[0]!.data };
}

export async function getMemory(ctx: RouteContext, req: MemoryRequest): Promise<MemoryResponse> {
  const { uid, deps } = ctx;
  const empty = emptyMemoryResponse(req.view);
  if ((req.view === "item" || req.view === "why") && req.id === null) throw parseError("id");
  const reader = storeReader(deps.store, uid);
  if ((await deps.store.get(uid, paths.core(uid, "epoch"))) === null) return empty;
  const core = await readCoreDocs(reader, uid);
  if (core.epoch.data.barrier !== null) throw barrierError();
  if (req.view === "receipt") return { ...empty, items: receiptView(await readReceipt(ctx, req.id)) };

  const pair = ownerClock(core.state.data, deps.clock);
  const opsNow = pair.opsClock.now;
  const audience = await callerAudience(ctx, core.epoch.data, opsNow);
  const rows: ViewRow[] = (await readAllMemories(reader, uid)).map((r) => ({ id: r.id as ID, memory: r.memory }));
  const snap = await snapshotFor(reader, uid, rows, core.epoch.data, 0);
  const ec = { ...foregroundEC(uid, core.epoch.data, pair, 0), audience, purpose: "inspect" as const, operation: "card" as const };
  const view: ViewContext = {
    ec,
    snapshot: snap,
    noteFor: (memoryId) => deps.hasher.id(["told", uid, memoryId]) as ID,
    expiresAt: tsFromMs(opsNow + NOTE_TTL_MS),
  };

  switch (req.view) {
    case "overview": {
      const s = snapshot(rows, view, req.cursor);
      if (s === null) throw scopeError();
      return { ...empty, snapshot: s, nextCursor: s.cursor, coverage: s.coverage };
    }
    case "item":
      return { ...empty, items: itemView(rows, req.id!, view) };
    case "why": {
      const evidence = new Map<string, Evidence>();
      snap.refs.forEach((r, i) => {
        if (r.collection === "evidence") evidence.set(r.id, snap.rows[i] as Evidence);
      });
      // Roots that no dependsOn entry names are read here.
      const target = rows.find((r) => r.id === req.id);
      for (const s of target?.memory.rootSlices ?? []) {
        if (evidence.has(s.eid) || !isIdShape(s.eid)) continue;
        const doc = await deps.store.get<Evidence>(uid, paths.evidence(uid, s.eid));
        if (doc !== null) evidence.set(s.eid, doc.data);
      }
      return { ...empty, items: whyView(rows, evidence, req.id!, view) };
    }
    case "lab": {
      const [evidence, ledger] = await Promise.all([readCapped<Evidence>(ctx, "evidence", LAB_READ_CAP), readCapped<Ledger>(ctx, "ledger", LAB_READ_CAP)]);
      const lab = labView({
        ec,
        snapshot: snap,
        memories: rows,
        evidence: evidence.rows.map((d) => ({ id: d.id, evidence: d.data })),
        decisions: ledger.rows.filter((d) => d.data.kind === "decision").map((d) => ({ id: d.id, entry: d.data })),
        complete: evidence.complete && ledger.complete,
      });
      return { ...empty, lab, coverage: lab.coverage };
    }
    case "strip":
      return { ...empty, strip: stripView(rows, view) };
    default:
      req.view satisfies never;
      return empty;
  }
}

const QUERY_KEYS = new Set(["view", "id", "cursor"]);

export const memoryRoute: RouteSpec<MemoryRequest> = {
  name: "memory",
  parse: ({ query }) => {
    for (const key of query.keys()) if (!QUERY_KEYS.has(key)) throw parseError(`unknown parameter ${key}`);
    return parseWith(MemoryRequestSchema, { view: query.get("view"), id: query.get("id"), cursor: query.get("cursor") });
  },
  run: (ctx, req) => getMemory(ctx, req),
};
