/**
 * Job records and leases shared by the hangup and extract workers (contracts §1 jobs; design "Extraction
 * worker" step 1, "Close"). A claim is one transaction: the job must be `queued` or `retry` and due; it becomes
 * `leased` with a new lease token, `leaseUntil = now + 30 s` (or the caller's longer lease) and `generation + 1`.
 * A claim that loses a race to another runner returns null, as for a job leased elsewhere.
 */
import { type Class, type Hasher, type ID, type Job, type Ref, msFromTs, tsFromMs } from "@franki/core";
import { cFields } from "../records";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";

export const LEASE_MS = 30_000;

export interface WorkJobInit {
  uid: string;
  kind: "extract" | "hangup";
  now: number;
  epoch: number;
  policyRev: number;
  sourceIds: ID[];
  inputRevs: { id: ID; rev: number }[];
  targets: Ref[];
  class: Class | null;
  fields: { eid: ID; fieldPath: "text"; base: number; end: number }[];
  priority: Job["priority"];
}

export function workJob(init: WorkJobInit): Job {
  const now = tsFromMs(init.now);
  return {
    ...cFields(init.uid, now, init.epoch, init.policyRev),
    kind: init.kind,
    status: "queued",
    priority: init.priority,
    nextAttemptAt: now,
    leaseUntil: null,
    leaseToken: null,
    generation: 0,
    attempts: 0,
    sourceIds: init.sourceIds,
    inputRevs: init.inputRevs,
    connectorId: null,
    syncGeneration: null,
    payload: {
      kind: "work",
      task: init.kind,
      targets: init.targets,
      class: init.class,
      fields: init.fields,
      cursor: { fieldIndex: 0, offset: 0, afterId: null, leg: "exact" },
      query: null,
    },
    resultRefs: [],
    error: null,
    retainUntil: null,
  };
}

export interface Lease {
  jobId: ID;
  token: ID;
  generation: number;
  job: Job;
}

/**
 * Claims a due `queued` or `retry` job. Returns null when it is not claimable now, which includes losing the claim
 * to another runner that woke at the same due time: its commit wins and this one fails with staleRevision, which
 * neither store retries. Every other error still throws.
 */
export async function claimJob(store: StorePort, uid: string, jobId: ID, opsNow: number, hasher: Hasher, leaseMs = LEASE_MS): Promise<Lease | null> {
  try {
    return await store.transaction(uid, async (tx) => {
      const doc = await tx.get<Job>(paths.job(uid, jobId));
      if (doc === null) return null;
      const job = doc.data;
      if (job.status !== "queued" && job.status !== "retry") return null;
      if (msFromTs(job.nextAttemptAt) > opsNow) return null;
      const generation = job.generation + 1;
      const token = hasher.id(["lease", jobId, generation]);
      const leased: Job = {
        ...job,
        status: "leased",
        leaseToken: token,
        leaseUntil: tsFromMs(opsNow + leaseMs),
        generation,
        updatedAt: tsFromMs(opsNow),
      };
      tx.update(doc.path, leased);
      return { jobId, token, generation, job: leased };
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return null;
    throw error;
  }
}

/** Q17: due `queued` and `retry` jobs of a kind, oldest first. */
export async function dueJobs(store: StorePort, uid: string, opsNow: number, kind: Job["kind"]): Promise<ID[]> {
  const ids: ID[] = [];
  for (const status of ["queued", "retry"] as const) {
    const rows = await store.query<Job>(uid, {
      collection: paths.collection(uid, "jobs"),
      where: [
        { field: "status", op: "==", value: status },
        { field: "nextAttemptAt", op: "<=", value: tsFromMs(opsNow) },
      ],
      orderBy: { field: "nextAttemptAt", dir: "asc" },
      limit: 100,
    });
    ids.push(...rows.filter((r) => r.data.kind === kind).map((r) => r.id));
  }
  return ids;
}
