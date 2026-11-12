/**
 * Extract_Job records (R22.1, R14.5). `/api/turn` writes one in the Turn's transaction; when a Session reaches
 * `closed`, `ensureExtractJobs` makes sure each committed user Turn with U Evidence has exactly one, creating only
 * missing ones, so repeated closes never duplicate jobs. Assistant Turns never get one (R21.4).
 */
import { type CoreEpoch, type Evidence, type Hasher, type ID, type Job, type Turn, idParts } from "@franki/core";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { workJob } from "./jobs";
import { turnOrder } from "../turns";

export const extractJobId = (eid: ID, hasher: Hasher): ID => hasher.id(idParts.extractJob(eid));

/** The Extract_Job for one turn Evidence, capturing the epoch and policyRev current at its commit. */
export function extractJobRecord(uid: string, eid: ID, evidence: Evidence, now: number, core: { epoch: number; policyRev: number }): Job {
  const text = evidence.text?.kind === "inline" ? evidence.text.text : "";
  return workJob({
    uid,
    kind: "extract",
    now,
    epoch: core.epoch,
    policyRev: core.policyRev,
    sourceIds: [eid],
    inputRevs: [{ id: eid, rev: evidence.rev }],
    targets: [{ type: "evidence", id: eid, rev: evidence.rev }],
    class: "U",
    fields: [{ eid, fieldPath: "text", base: 0, end: text.length }],
    priority: "interactive",
  });
}

/** Reads every Turn of a Session in `seq` order through Q14 pages of 100 (R19.9). */
export async function readTurns(store: StorePort, uid: string, sessionId: ID): Promise<{ id: ID; turn: Turn }[]> {
  // A user Turn and its assistant Turns share a seq, so each next page starts at (>=) the last returned seq and
  // drops Turns already seen; a page boundary inside one seq can then skip nothing.
  const out = new Map<ID, Turn>();
  let cursor = 0;
  for (;;) {
    const page = await store.query<Turn>(uid, {
      collection: paths.turns(uid, sessionId),
      where: [{ field: "seq", op: ">=", value: cursor }],
      orderBy: { field: "seq", dir: "asc" },
      limit: 100,
    });
    for (const d of page) out.set(d.id, d.data);
    if (page.length < 100) break;
    const last = page[page.length - 1]!.data.seq;
    if (last === cursor) throw new Error("more than 100 Turns share one seq");
    cursor = last;
  }
  return sortTurns([...out].map(([id, turn]) => ({ id, turn })));
}

/** Turn order (R19.6): seq ascending; user before assistant at equal seq; then committedAt. */
export function sortTurns<T extends { turn: Turn }>(turns: T[]): T[] {
  return [...turns].sort((a, b) => turnOrder(a.turn, b.turn));
}

/** Ensures exactly one Extract_Job per committed user Turn with U Evidence in the Session. Returns created job IDs. */
export async function ensureExtractJobs(uid: string, sessionId: ID, deps: { store: StorePort; hasher: Hasher; clock: { read(): { opsClock: { now: number } } } }): Promise<ID[]> {
  const turns = await readTurns(deps.store, uid, sessionId);
  const wanted = turns.filter(({ turn }) => turn.role === "user" && turn.evidenceId !== null && turn.sourceClass === "U" && turn.parseState === "committed");
  if (wanted.length === 0) return [];
  return deps.store.transaction(uid, async (tx) => {
    // Two round trips whatever the number of Turns (the open awaits this on the prior Session's close; its tail
    // reserve counts them): core/epoch and every Job together, then the Evidence of the Turns with no Job.
    const jobs = wanted.map(({ turn }) => ({ eid: turn.evidenceId!, jobId: extractJobId(turn.evidenceId!, deps.hasher) }));
    const [epoch, ...existing] = await Promise.all([tx.get<CoreEpoch>(paths.core(uid, "epoch")), ...jobs.map((j) => tx.get(paths.job(uid, j.jobId)))]);
    const core = { epoch: epoch?.data.epoch ?? 1, policyRev: epoch?.data.policyRev ?? 1 };
    const missing = jobs.filter((_, i) => existing[i] === null);
    const evidence = await Promise.all(missing.map((j) => tx.get<Evidence>(paths.evidence(uid, j.eid))));
    const created: ID[] = [];
    for (const [i, j] of missing.entries()) {
      const e = evidence[i]!;
      if (e === null) continue;
      tx.create(paths.job(uid, j.jobId), extractJobRecord(uid, j.eid, e.data, deps.clock.read().opsClock.now, core));
      created.push(j.jobId);
    }
    return created;
  });
}
