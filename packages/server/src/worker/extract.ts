/**
 * Extract worker: ExtractV1 on one user Turn (R22, R23, R24.1, R24.2, R24.7; KS01, KS06, KC03, KC04, KC05; Q03;
 * design "Extraction worker"). Replaces the task 11 stub.
 *
 *   1. Claim: a due `queued` or `retry` job becomes `leased` (token, leaseUntil = now + 30 s, generation + 1).
 *   2. Packet: that Turn's Evidence only.
 *   3. Call: Responses, FRANKI_BRAIN_MODEL, effort low, store:false, tools:[], strict JSON schema, PREFIX + the
 *      ExtractV1 literal, 12,000 / 4,096 tokens, 10 s deadline. Invalid, refused or incomplete output, an error or
 *      the deadline gets exactly one repair call with the same parameters; if that also fails the job goes to
 *      `retry` (contract question 25: "pending") with an ErrorCode and nextAttemptAt + 60 s, and to `failed`
 *      after 3 attempts. Nothing is committed from a failed output.
 *   4. Plan every Item (pure, core/extract.ts): span checks, holds, authority, floors, key.
 *   5. One transaction: lease token, job generation, captured epoch and policyRev must still match (KS06);
 *      Memories with lineage; single-valued supersede through Q03; hold and rejection ledger decisions; job
 *      `complete` with resultRefs; a ledger `usage` entry. The Store_Port runs W-LINEAGE on every Memory write.
 */
import {
  type CoreEpoch,
  type CoreState,
  type ErrorCode,
  EXTRACT_DEADLINE_MS,
  EXTRACT_INPUT_TOKEN_CAP,
  EXTRACT_INSTRUCTIONS,
  EXTRACT_MAX_ATTEMPTS,
  EXTRACT_OUTPUT_TOKEN_CAP,
  EXTRACT_RETRY_MS,
  type Evidence,
  type ExtractPacket,
  type Hasher,
  type ID,
  type ItemPlan,
  type Job,
  type Ledger,
  type Memory,
  type ClockPort,
  buildExtractPacket,
  estimateTokens,
  extractOutputJsonSchema,
  parseExtractOutput,
  planItem,
  tsFromMs,
} from "@franki/core";
import { type Timers, liveTimers, withDeadline } from "../clock/timers";
import type { Env } from "../config/env";
import { requireModel } from "../config/models";
import type { OpenAIPort } from "../openai/fake";
import type { ResponsesResult } from "../openai/responses";
import { DAY_MS, cFields } from "../records";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { type Lease, claimJob } from "./jobs";

export interface ExtractDeps {
  store: StorePort;
  openai: OpenAIPort;
  clock: ClockPort;
  hasher: Hasher;
  env: Env;
  /** Deadline timers; live timers when absent. */
  timers?: Timers;
}

export type ExtractOutcome = "complete" | "retry" | "failed" | "requeued" | "skipped";

/** The Responses request for one ExtractV1 call (R22.3). */
export function extractRequest(model: string, packet: ExtractPacket) {
  return {
    model,
    reasoning: { effort: "low" },
    store: false,
    tools: [],
    instructions: EXTRACT_INSTRUCTIONS,
    input: JSON.stringify(packet),
    text: { format: { type: "json_schema", name: "ExtractV1", strict: true, schema: extractOutputJsonSchema() } },
    max_output_tokens: EXTRACT_OUTPUT_TOKEN_CAP,
  };
}

type CallResult = { ok: true; items: unknown[]; usage: ResponsesResult["usage"] } | { ok: false; error: ErrorCode };

async function callOnce(body: unknown, deps: ExtractDeps): Promise<CallResult> {
  let result: ResponsesResult;
  try {
    result = (await withDeadline(deps.openai.call("responses.create", body), EXTRACT_DEADLINE_MS, deps.timers ?? liveTimers)) as ResponsesResult;
  } catch {
    return { ok: false, error: "DEPENDENCY" };
  }
  if (result === null || typeof result !== "object") return { ok: false, error: "PARSE" };
  if (result.refusal !== null && result.refusal !== undefined) return { ok: false, error: "PARSE" };
  if (result.status !== "completed") return { ok: false, error: "PARSE" };
  const parsed = parseExtractOutput(result.outputText);
  if (!parsed.ok) return { ok: false, error: "PARSE" };
  return { ok: true, items: parsed.items, usage: result.usage ?? { inputTokens: 0, outputTokens: 0 } };
}

/** Writes the failed-attempt state: `retry` with nextAttemptAt + 60 s, or `failed` after 3 attempts. */
function failAttempt(tx: Tx, path: string, job: Job, error: ErrorCode, opsNow: number): ExtractOutcome {
  const attempts = job.attempts + 1;
  const failed = attempts >= EXTRACT_MAX_ATTEMPTS;
  tx.update(path, {
    ...job,
    status: failed ? "failed" : "retry",
    attempts,
    error,
    nextAttemptAt: tsFromMs(opsNow + EXTRACT_RETRY_MS),
    leaseToken: null,
    leaseUntil: null,
    updatedAt: tsFromMs(opsNow),
  });
  return failed ? "failed" : "retry";
}

/** Reads the leased job and checks the lease is still this attempt's (KS06). */
async function leasedJob(tx: Tx, uid: string, lease: Lease): Promise<{ path: string; job: Job } | null> {
  const doc = await tx.get<Job>(paths.job(uid, lease.jobId));
  if (doc === null || doc.data.status !== "leased" || doc.data.leaseToken !== lease.token || doc.data.generation !== lease.generation) return null;
  return { path: doc.path, job: doc.data };
}

function decisionEntry(uid: string, plan: Extract<ItemPlan, { kind: "hold" | "reject" }>, evidenceRevs: Map<string, number>, now: string, core: { epoch: number; policyRev: number }): Ledger {
  return {
    ...cFields(uid, now, core.epoch, core.policyRev),
    kind: "decision",
    state: plan.kind === "hold" ? "blocked" : "failed",
    at: now,
    retainUntil: null,
    payload: {
      purpose: "commit",
      acceptedRefs: [],
      heldRefs: plan.eids.slice(0, 32).map((eid) => ({ type: "evidence" as const, id: eid, rev: evidenceRevs.get(eid) ?? 1 })),
      reasonCodes: plan.reasons,
      audience: "private",
    },
  };
}

export async function runExtractJob(uid: string, jobId: string, deps: ExtractDeps): Promise<ExtractOutcome> {
  const lease = await claimJob(deps.store, uid, jobId, deps.clock.read().opsClock.now, deps.hasher);
  if (lease === null) return "skipped";
  const job = lease.job;
  const eid = job.sourceIds[0]!;

  const [evidenceDoc, stateDoc] = await Promise.all([
    deps.store.get<Evidence>(uid, paths.evidence(uid, eid)),
    deps.store.get<CoreState>(uid, paths.core(uid, "state")),
  ]);
  if (evidenceDoc === null) {
    await deps.store.transaction(uid, async (tx) => {
      const leased = await leasedJob(tx, uid, lease);
      if (leased !== null) failAttempt(tx, leased.path, { ...leased.job, attempts: EXTRACT_MAX_ATTEMPTS }, "SCOPE", deps.clock.read().opsClock.now);
    });
    return "failed";
  }
  const evidence = evidenceDoc.data;
  const packet = buildExtractPacket({
    jobId,
    epoch: job.epoch,
    policyRev: job.policyRev,
    eid,
    evidence,
    homeZone: stateDoc?.data.homeZone ?? "UTC",
    currentZone: stateDoc?.data.currentZone ?? null,
  });
  const model = requireModel("brain", deps.env);
  const body = extractRequest(model, packet);

  let call: CallResult;
  if (estimateTokens(body.instructions) + estimateTokens(body.input) > EXTRACT_INPUT_TOKEN_CAP) {
    call = { ok: false, error: "LIMIT" };
  } else {
    call = await callOnce(body, deps);
    // Exactly one repair attempt with the same parameters (R22.4).
    if (!call.ok) call = await callOnce(body, deps);
  }

  const pair = deps.clock.read();
  const ops = pair.opsClock.now;
  const now = tsFromMs(ops);
  return deps.store.transaction(uid, async (tx): Promise<ExtractOutcome> => {
    const leased = await leasedJob(tx, uid, lease);
    // Lost the lease (Q18 requeued it and another worker claimed it): commit nothing (R22.9).
    if (leased === null) return "requeued";
    const epoch = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epoch === null || epoch.data.epoch !== job.epoch || epoch.data.policyRev !== job.policyRev) {
      // The captured epoch or policyRev changed: mark failed with an ErrorCode, write no Memory (KS06).
      tx.update(leased.path, { ...leased.job, status: "failed", error: "STALE", leaseToken: null, leaseUntil: null, updatedAt: now });
      return "failed";
    }
    if (!call.ok) return failAttempt(tx, leased.path, leased.job, call.error, ops);

    const ctx = {
      uid,
      jobId,
      packet: new Map([[eid, { evidence, fields: ["text"] }]]),
      hasher: deps.hasher,
      worldNow: tsFromMs(pair.worldClock.now),
      opsNow: now,
      nextReviewAt: tsFromMs(pair.worldClock.now + 365 * DAY_MS),
      epoch: job.epoch,
      policyRev: job.policyRev,
    };
    const plans = call.items.map((raw, index) => planItem(raw, index, ctx));
    const revs = new Map([[eid, evidence.rev]]);
    const core = { epoch: job.epoch, policyRev: job.policyRev };
    const written: { id: ID; memory: Memory }[] = [];

    for (const plan of plans) {
      if (plan.kind === "hold" || plan.kind === "reject") {
        tx.create(paths.ledger(uid, deps.hasher.id(["extract-decision", jobId, plan.index])), decisionEntry(uid, plan, revs, now, core));
        continue;
      }
      if (plan.kind !== "memory") continue;
      if ((await tx.get(paths.memory(uid, plan.id))) !== null) continue;
      // Single-valued key: the new active Memory moves every current active one to history (R23.5, Q03).
      if (plan.single && plan.memory.status === "active") {
        const current = await tx.query<Memory>({
          collection: paths.collection(uid, "memories"),
          where: [
            { field: "key", op: "==", value: plan.memory.key },
            { field: "status", op: "==", value: "active" },
            { field: "validFromKey", op: "<=", value: plan.memory.validFromKey },
          ],
          orderBy: { field: "validFromKey", dir: "desc" },
          limit: 32,
        });
        for (const old of current) {
          if (written.some((w) => w.id === old.id)) continue;
          tx.update(old.path, { ...old.data, status: "history", validTo: plan.memory.validFrom, updatedAt: now });
        }
        // An earlier Item of this same output with the same key is superseded too.
        for (const w of written) {
          if (w.memory.key === plan.memory.key && w.memory.status === "active") w.memory = { ...w.memory, status: "history", validTo: plan.memory.validFrom };
        }
      }
      written.push({ id: plan.id, memory: plan.memory });
    }
    for (const w of written) tx.create(paths.memory(uid, w.id), w.memory);

    tx.update(leased.path, {
      ...leased.job,
      status: "complete",
      attempts: leased.job.attempts + 1,
      error: null,
      leaseToken: null,
      leaseUntil: null,
      resultRefs: written.slice(0, 32).map((w) => ({ type: "memory" as const, id: w.id, rev: 1 })),
      updatedAt: now,
    });
    const usage: Ledger = {
      ...cFields(uid, now, core.epoch, core.policyRev),
      kind: "usage",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: { jobId, model: model.slice(0, 64), inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens, costMicros: 0 },
    };
    tx.create(paths.ledger(uid, deps.hasher.id(["usage", jobId, lease.generation])), usage);
    return "complete";
  });
}
