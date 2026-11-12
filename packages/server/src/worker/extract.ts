/**
 * Extract worker: ExtractV1 on one user Turn (R22, R23, R24.1, R24.2, R24.7; KS01, KS06, KC03, KC04, KC05; Q03;
 * design "Extraction worker"). Replaces the task 11 stub.
 *
 *   1. Claim: a due `queued` or `retry` job becomes `leased` (token, leaseUntil = now + EXTRACT_LEASE_MS,
 *      generation + 1).
 *   2. Packet: that Turn's Evidence as the only field; the Owner's earlier turns in the Session when this one leans
 *      on them, and related saved Memories in `open` when it says something changed or is a short reply (contract
 *      question 42). Every input is recorded in `contextIds` and `dependsOn`.
 *   3. Call: Responses, FRANKI_BRAIN_MODEL, effort low, store:false, tools:[], strict JSON schema, PREFIX + the
 *      ExtractV1 literal, 12,000 / 4,096 tokens, 30 s deadline (contract question 35). Invalid, refused or
 *      incomplete output, an error or
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
  type CoreRules,
  backstopProposal,
  withRulesDefaults,
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
  type ContextRef,
  type HeadMemory,
  type OpenRef,
  PACKET_OPEN_CAP,
  PACKET_TURNS_CAP,
  type PacketOpen,
  type PacketTurn,
  type PlanContext,
  type Turn,
  buildExtractPacket,
  estimateTokens,
  evidenceFieldText,
  extractOutputJsonSchema,
  needsEarlierTurns,
  openRefOf,
  parseDep,
  parseExtractOutput,
  planItem,
  relevantOpen,
  renderedMemory,
  type RenameIndex,
  renameIndex,
  renameLine,
  sameClaim,
  canonicalJSON,
  mentionName,
  msFromTs,
  place,
  statusTransition,
  tsFromMs,
  wantsOpen,
} from "@franki/core";
import { type Timers, liveTimers, withDeadline } from "../clock/timers";
import type { Env } from "../config/env";
import { ownerClock } from "../core-docs";
import { requireModel } from "../config/models";
import { readAllMemories, storeReader } from "../head-build";
import type { OpenAIPort } from "../openai/fake";
import type { ResponsesResult } from "../openai/responses";
import { DAY_MS, cFields } from "../records";
import type { Log } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { turnOrder } from "../turns";
import { backstopItems, withBackstop } from "../onturn/backstop";
import { turnEvidence } from "../onturn/context";
import { type Lease, claimJob } from "./jobs";

export interface ExtractDeps {
  store: StorePort;
  openai: OpenAIPort;
  clock: ClockPort;
  hasher: Hasher;
  env: Env;
  /** Deadline timers; live timers when absent. */
  timers?: Timers;
  /** Structured server log (IDs and check names only); silent when absent. */
  log?: Log;
}

/** The packet's `open` list and what code keeps about each entry to check a named target. */
export interface OpenContext {
  list: PacketOpen[];
  refs: Map<string, OpenRef>;
}

/** The Owner's earlier turns the packet carries, and their Evidence for its lineage. */
export interface PriorTurns {
  turns: PacketTurn[];
  evidence: { id: ID; rev: number }[];
}

const NO_OPEN: OpenContext = { list: [], refs: new Map() };
const NO_TURNS: PriorTurns = { turns: [], evidence: [] };

/**
 * The packet's `open` list: the Owner's active U Memories below S2 that share a content word with what was said
 * (`relevantOpen`), newest first, at most 40, each as its stored line. Read outside the commit transaction; the
 * commit re-reads every target it changes.
 */
export function pickOpen(all: readonly HeadMemory[], said: readonly string[], renames: RenameIndex = workerRenames(all), handledRefs: ReadonlySet<string> = new Set()): OpenContext {
  const candidates = all
    // Brief 025 task C5: a Memory the on-turn route corrected, changed or wrote for this turn is never offered.
    .filter((m) => openable(m) && !handledRefs.has(m.id))
    .sort((a, b) => (a.memory.updatedAt < b.memory.updatedAt ? 1 : a.memory.updatedAt > b.memory.updatedAt ? -1 : a.id < b.id ? -1 : 1))
    // Task C4 (G14): each line with the current name, or left out when its old name can't be replaced.
    .flatMap((m) => {
      const renamed = renameLine(renderedMemory(m.memory), m.memory, renames);
      return renamed === null ? [] : [{ id: m.id, rev: m.memory.rev, kind: m.memory.kind, rendered: renamed.text, memory: m.memory }];
    });
  const picked = relevantOpen(candidates, said).slice(0, PACKET_OPEN_CAP);
  return {
    list: picked.map(({ id, rev, kind, rendered }) => ({ id, rev, kind, rendered })),
    refs: new Map(picked.map((p) => [p.id, openRefOf(p.memory)])),
  };
}

const openable = (m: HeadMemory) => m.memory.status === "active" && m.memory.sourceClass === "U" && m.memory.sens !== "S2";

/** The worker's rename index (task C4): current names from the rows `pickOpen` may show. */
export function workerRenames(all: readonly HeadMemory[]): RenameIndex {
  return renameIndex(all, all.filter(openable));
}

/**
 * The packet's `lastTurns`: up to 4 of the Owner's own turns before this one in the same Session (user role, Source
 * Class U, retained Evidence), in R19.6 order (`turnOrder`). Franki's replies are left out: they are never the
 * Owner's word, and a short reply ("With a P.") reads against what the Owner said before it.
 */
export async function priorTurns(store: StorePort, uid: string, evidence: Evidence): Promise<PriorTurns> {
  if (evidence.sessionId === null || evidence.turnId === null) return NO_TURNS;
  const sessionId = evidence.sessionId;
  const current = await store.get<Turn>(uid, paths.turn(uid, sessionId, evidence.turnId));
  if (current === null || current.data.seq <= 0) return NO_TURNS;
  const seq = current.data.seq;
  const rows = await store.query<Turn>(uid, {
    collection: paths.turns(uid, sessionId),
    where: [{ field: "seq", op: ">=", value: Math.max(0, seq - PACKET_TURNS_CAP) }],
    orderBy: { field: "seq", dir: "asc" },
    limit: 32,
  });
  const earlier = rows
    .filter((r) => r.data.seq < seq && r.data.role === "user" && r.data.sourceClass === "U" && r.data.evidenceId !== null)
    .sort((a, b) => turnOrder(a.data, b.data))
    .slice(-PACKET_TURNS_CAP);
  const docs = await Promise.all(earlier.map((r) => store.get<Evidence>(uid, paths.evidence(uid, r.data.evidenceId!))));
  const out: PriorTurns = { turns: [], evidence: [] };
  earlier.forEach((r, i) => {
    const ev = docs[i] ?? null;
    const text = ev === null || ev.data.status !== "retained" ? null : evidenceFieldText(ev.data, "text");
    if (ev === null || text === null || text.trim() === "") return;
    out.turns.push({ id: r.id, rev: r.data.rev, role: "user", text });
    out.evidence.push({ id: ev.id, rev: ev.data.rev });
  });
  return out;
}

/** A rule or an allergy: never closed by extraction (memory-spec §8, hard rules are never withdrawn). */
const protectedRow = (m: Memory): boolean => m.kind === "rule" || m.predicate === "allergy";

/** What the on-turn routes handled for one Evidence (design section 5): rule slots, memory keys and Memory IDs. */
function handledFor(rules: CoreRules | null, eid: string): { ruleKeys: { subjectId: string | null; code: string }[]; keys: string[]; refs: string[] } {
  const entries = (rules?.handled ?? []).filter((h) => h.eid === eid).flatMap((h) => h.entries);
  return { ruleKeys: entries.flatMap((e) => e.ruleKeys), keys: entries.flatMap((e) => e.keys), refs: entries.flatMap((e) => e.refs.map((r) => r.id)) };
}

/** Memories on one key with one status, newest first, at most 32. */
async function sameKeyRows(tx: Tx, uid: string, key: string, status: "active" | "wrong"): Promise<{ id: string; path: string; data: Memory }[]> {
  return tx.query<Memory>({
    collection: paths.collection(uid, "memories"),
    where: [
      { field: "key", op: "==", value: key },
      { field: "status", op: "==", value: status },
    ],
    orderBy: { field: "validFromKey", dir: "desc" },
    limit: 32,
  });
}

/** The same value after normalization: a name in any case, with or without "my" (G35 (2)). */
const sameValue = (a: Memory, b: Memory): boolean =>
  a.value.kind === "text" && b.value.kind === "text" ? mentionName(a.value.text) === mentionName(b.value.text) : canonicalJSON(a.value) === canonicalJSON(b.value);

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

/** Long enough for a call, its repair and the commit, so a slow call never outlives its lease. */
export const EXTRACT_LEASE_MS = 2 * EXTRACT_DEADLINE_MS + 15_000;

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
  const lease = await claimJob(deps.store, uid, jobId, deps.clock.read().opsClock.now, deps.hasher, EXTRACT_LEASE_MS);
  if (lease === null) return "skipped";
  const job = lease.job;
  const eid = job.sourceIds[0]!;

  const [evidenceDoc, stateDoc, rulesBefore] = await Promise.all([
    deps.store.get<Evidence>(uid, paths.evidence(uid, eid)),
    deps.store.get<CoreState>(uid, paths.core(uid, "state")),
    deps.store.get<CoreRules>(uid, paths.core(uid, "rules")),
  ]);
  if (evidenceDoc === null) {
    await deps.store.transaction(uid, async (tx) => {
      const leased = await leasedJob(tx, uid, lease);
      if (leased !== null) failAttempt(tx, leased.path, { ...leased.job, attempts: EXTRACT_MAX_ATTEMPTS }, "SCOPE", deps.clock.read().opsClock.now);
    });
    return "failed";
  }
  const evidence = evidenceDoc.data;
  // Packet size is a forgetting decision (memory-spec §4): earlier turns only when this one leans on them, `open` only
  // when it says something changed or is a short reply, and then only related Memories. Every input becomes a
  // dependency of what the packet writes.
  const said = evidenceFieldText(evidence, "text") ?? "";
  const [earlier, all] = await Promise.all([
    needsEarlierTurns(said) ? priorTurns(deps.store, uid, evidence) : Promise.resolve(NO_TURNS),
    // Every turn reads the Memories: the rename index (task C4) decides whose a name is, even with no `open` list.
    readAllMemories(storeReader(deps.store, uid), uid),
  ]);
  const renames = workerRenames(all);
  const refsBefore = new Set(handledFor(rulesBefore === null ? null : (withRulesDefaults(rulesBefore.data) as CoreRules), eid).refs);
  const open = !wantsOpen(said) ? NO_OPEN : pickOpen(all, [said, ...earlier.turns.map((t) => t.text)], renames, refsBefore);
  const context: ContextRef[] = [
    ...earlier.evidence.map((e) => ({ type: "evidence" as const, ...e })),
    ...open.list.map((o) => ({ type: "memory" as const, id: o.id, rev: o.rev })),
  ];
  const packet = buildExtractPacket({
    jobId,
    epoch: job.epoch,
    policyRev: job.policyRev,
    eid,
    evidence,
    homeZone: stateDoc?.data.homeZone ?? "UTC",
    currentZone: stateDoc?.data.currentZone ?? null,
    open: open.list,
    lastTurns: earlier.turns,
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

  // World time comes from the Owner's clock: in a seeded clone it is core/state.worldClock (brief 019 task 6).
  const pair = stateDoc === null ? deps.clock.read() : ownerClock(stateDoc.data, deps.clock);
  const ops = pair.opsClock.now;
  const now = tsFromMs(ops);
  return deps.store.transaction(uid, async (tx): Promise<ExtractOutcome> => {
    const leased = await leasedJob(tx, uid, lease);
    // Lost the lease (Q18 requeued it and another worker claimed it): commit nothing (R22.9).
    if (leased === null) return "requeued";
    const epoch = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epoch !== null && epoch.data.epoch === job.epoch && epoch.data.policyRev > job.policyRev) {
      // A policyRev rise (a late control hit, wave B's audience changes) must never lose an extraction: the job
      // runs again at the new policyRev, with nothing written from this call (review of wave A, item 16; Q93).
      tx.update(leased.path, { ...leased.job, status: "queued", policyRev: epoch.data.policyRev, error: null, leaseToken: null, leaseUntil: null, updatedAt: now });
      return "requeued";
    }
    if (epoch === null || epoch.data.epoch !== job.epoch || epoch.data.policyRev !== job.policyRev) {
      // The captured epoch or policyRev changed: mark failed with an ErrorCode, write no Memory (KS06).
      tx.update(leased.path, { ...leased.job, status: "failed", error: "STALE", leaseToken: null, leaseUntil: null, updatedAt: now });
      return "failed";
    }
    if (!call.ok) return failAttempt(tx, leased.path, leased.job, call.error, ops);

    // What the on-turn route handled for this Evidence (brief 012 section 5): its allergy slots are skipped.
    const rulesDoc = await tx.get<CoreRules>(paths.core(uid, "rules"));
    const rules = rulesDoc === null ? null : (withRulesDefaults(rulesDoc.data) as CoreRules);
    const { ruleKeys: handled, keys: handledKeys, refs: handledRefs } = handledFor(rules, eid);
    const ctx: PlanContext = {
      handled,
      handledKeys,
      handledRefs,
      uid,
      jobId,
      packet: new Map([[eid, { evidence, fields: ["text"] }]]),
      hasher: deps.hasher,
      worldNow: tsFromMs(pair.worldClock.now),
      opsNow: now,
      nextReviewAt: tsFromMs(pair.worldClock.now + 365 * DAY_MS),
      epoch: job.epoch,
      policyRev: job.policyRev,
      open: open.refs,
      renames,
      context,
      zone: stateDoc?.data.currentZone ?? stateDoc?.data.homeZone ?? "UTC",
    };
    const plans = call.items.map((raw, index) => planItem(raw, index, ctx));
    // The allergy backstop (G18, G39): held allergy items the route didn't handle become a pending proposal.
    if (rules !== null) {
      const held = new Set(plans.flatMap((p) => (p.kind === "hold" ? [p.index] : [])));
      const proposal = backstopProposal(turnEvidence(evidence, eid, deps.hasher), backstopItems(call.items.filter((_, i) => held.has(i))), handled, (evidence.turnId as ID | null) ?? null, deps.hasher);
      if (proposal !== null) tx.update(rulesDoc!.path, withBackstop(rules, proposal));
    }
    const revs = new Map([[eid, evidence.rev]]);
    const core = { epoch: job.epoch, policyRev: job.policyRev };
    const written: { id: ID; memory: Memory }[] = [];
    // Saved Memories this output already closed; one record is written at most once per transaction.
    const closed = new Set<string>();

    for (const plan of plans) {
      if (plan.kind === "reject") deps.log?.("extract.reject", { jobId, index: plan.index, detail: plan.detail });
      if (plan.kind === "memory" && plan.restored !== undefined) deps.log?.("extract.idRestored", { jobId, index: plan.index, paths: plan.restored });
      if (plan.kind === "hold" || plan.kind === "reject") {
        tx.create(paths.ledger(uid, deps.hasher.id(["extract-decision", jobId, plan.index])), decisionEntry(uid, plan, revs, now, core));
        continue;
      }
      if (plan.kind !== "memory") continue;
      if ((await tx.get(paths.memory(uid, plan.id))) !== null) continue;
      const m = plan.memory;
      if (m.status !== "active") {
        written.push({ id: plan.id, memory: m });
        continue;
      }
      // Active Memories with the same key (Q03), later-asserted ones included (G35: no `validFromKey` bound).
      const sameKey = (await sameKeyRows(tx, uid, m.key, "active")).filter((d) => !closed.has(d.id));
      // G35 (2): a value the owner refuted after saying it is skipped `negated` and closes nothing.
      const refuted = await sameKeyRows(tx, uid, m.key, "wrong");
      if (refuted.some((d) => sameValue(d.data, m) && (d.data.validTo === null || m.assertedAt <= d.data.validTo))) {
        deps.log?.("extract.skip", { jobId, index: plan.index, reason: "negated" });
        continue;
      }
      // Saying a saved fact again writes nothing, unless it is a correction or a change.
      if (plan.change === "none" && (sameKey.some((d) => sameClaim(d.data, m)) || written.some((w) => w.memory.status === "active" && sameClaim(w.memory, m)))) continue;
      // A single-valued key that a rule or an allergy holds is not changed by extraction: the Item is held, not
      // written as a second active value beside it.
      if (plan.single && sameKey.some((d) => protectedRow(d.data))) {
        deps.log?.("extract.hold", { jobId, index: plan.index, reason: "protectedKey" });
        const held = { kind: "hold" as const, index: plan.index, reasons: ["unsupported" as const], eids: [...new Set(m.rootSlices.map((s) => s.eid))] };
        tx.create(paths.ledger(uid, deps.hasher.id(["extract-decision", jobId, plan.index])), decisionEntry(uid, held, revs, now, core));
        continue;
      }

      // What this Memory replaces: every same-key Memory of a single-valued predicate (R23.5), same-key Memories
      // of a scoped multi-valued one when it says it corrects or changes them, and the `open` Memories it names.
      // Never a rule or an allergy.
      const replaced = new Map<string, { path: string; data: Memory }>();
      if (plan.single || (plan.change !== "none" && m.scopeId !== "global")) for (const d of sameKey) if (!protectedRow(d.data)) replaced.set(d.id, d);
      for (const target of plan.targetIds) {
        if (closed.has(target) || replaced.has(target)) continue;
        const doc = await tx.get<Memory>(paths.memory(uid, target));
        // Checked again at commit: still active, still the revision the packet showed, the same predicate.
        const shown = ctx.open?.get(target);
        if (doc !== null && doc.data.status === "active" && doc.data.rev === shown?.rev && doc.data.predicate === m.predicate && !protectedRow(doc.data)) {
          replaced.set(target, doc);
        }
      }
      // G35 (3), design 6.6: an item never closes a row asserted after it. It is placed with `to` at that row's
      // `validFrom` (clamped to now, CQ 141), so it is history and closes nothing.
      const later = [...replaced.values()].filter((d) => d.data.assertedAt > m.assertedAt);
      if (later.length > 0) {
        const nowMs = pair.worldClock.now;
        const fromMs = msFromTs(m.validFrom ?? m.assertedAt);
        const toMs = Math.min(nowMs, Math.max(fromMs, Math.min(...later.map((d) => msFromTs(d.data.validFrom ?? d.data.assertedAt)))));
        if (place({ from: fromMs, to: toMs, cls: m.sourceClass, change: plan.change }, nowMs) === "history") {
          written.push({ id: plan.id, memory: { ...m, status: "history", validTo: tsFromMs(toMs) } });
          continue;
        }
      }
      // A correction says the old value was an error (`wrong`); anything else says it stopped being true (`history`).
      // `statusTransition` (design 6.5) is the one function that decides it; a row it refuses is left as it is.
      const event = plan.change === "correct" ? "correct" : "transition";
      for (const [id, old] of replaced) {
        const status = statusTransition(old.data.status, event);
        if (status === "refuse") {
          // Not closed, so not replaced: `replacesIds` names only the rows this Memory closed.
          replaced.delete(id);
          continue;
        }
        closed.add(id);
        tx.update(old.path, { ...old.data, status, validTo: m.validFrom, updatedAt: now });
      }
      // An earlier Item of this same output with the same single-valued key is closed the same way.
      if (plan.single) {
        for (const w of written) {
          const status = statusTransition(w.memory.status, event);
          if (w.memory.key === m.key && w.memory.status === "active" && status !== "refuse") w.memory = { ...w.memory, status, validTo: m.validFrom };
        }
      }
      written.push({ id: plan.id, memory: { ...m, replacesIds: [...new Set([...m.replacesIds, ...replaced.keys()])].slice(0, 16) } });
    }
    // A Memory this output closed is no dependency of what the output wrote: the Owner's words in this turn replaced
    // it, and once it is `wrong` the dependency would deny every Memory of the packet (eligibility clause 11), the
    // correction included. `contextIds` still names it, and the Memory that replaced it names it in `replacesIds`.
    const closedDep = (d: string) => {
      const p = parseDep(d);
      return p !== null && p.collection === "memories" && closed.has(p.id);
    };
    for (const w of written) tx.create(paths.memory(uid, w.id), { ...w.memory, dependsOn: w.memory.dependsOn.filter((d) => !closedDep(d)) });

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
