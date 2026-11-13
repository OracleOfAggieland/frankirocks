/**
 * Brief 046 ruling 6: one pull of one bank, all or nothing.
 *
 *   1. Lease: one pull at a time per connector, held by the contract's quota lease in a Firestore transaction. A
 *      pull that finds the lease held answers at once with the connector as it stands.
 *   2. Read: `/transactions/sync` from the stored cursor to `has_more: false`, restarting from the stored cursor on
 *      TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION (three tries). Nothing is written while reading.
 *   3. Write: every row, in pages of transactions. IDs are deterministic, so a row already stored as it is writes
 *      nothing, a changed row is a new revision and a removed row is a new revision with `removed: true`.
 *   4. Publish: only then, in the last transaction, the cursor, the coverage and the last success advance (the intent
 *      of KS05). A crash before it leaves the old cursor, and the next pull rewrites the same IDs.
 *
 * A pull never writes `core/state.coverage` (ruling 5), and refuses while a reset or forget holds the barrier.
 */
import {
  type BankView,
  type Connector,
  type CoreEpoch,
  type Cov,
  type Evidence,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { ConfigError } from "../config/env";
import { barrierError, dependencyError, scopeError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";
import { appendEvidenceRevision, evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import type { StoredDoc, Tx } from "../store/port";
import { type BankConfig, BANK_ENV_VARS } from "./config";
import { UNKNOWN_COVERAGE, bankView, getConnector, isActiveBank } from "./connector";
import { BankCallError, type BankPort, MUTATION_DURING_PAGINATION, type PlaidAccount, type PlaidTransaction, type UpdateStatus } from "./plaid";
import { type BankRowContext, type SkipReason, bankEvidence, bankLogicalId, bankRowContent, contentKey, storedCategoryCode, storedContentKey } from "./rows";
import { SealError, openToken } from "./seal";

export const PULL_LEASE_MS = 120_000;
/** Ruling 7: a money read pulls first when the last success is older than this by the ops clock. */
export const STALE_AFTER_MS = 3_600_000;
export const SYNC_TRIES = 3;
/** A pull larger than this many rows is refused as transient rather than half-written. */
export const PULL_ROWS_MAX = 20_000;
export const WRITE_CHUNK = 100;
const DAY = 86_400_000;
/** How far back Plaid's initial update reaches before the historical one completes. */
const INITIAL_DAYS = 30;
const HISTORY_DAYS = 90;
/** Revisions probed per row; a row is never revised more often than this. */
const MAX_REVISIONS = 64;

export interface BankRuntime {
  port: BankPort;
  config: BankConfig;
}

type Lease = { kind: "leased"; token: string; epoch: number; connector: Connector } | { kind: "answer"; view: BankView };

async function epochOf(tx: Pick<Tx, "get">, uid: string): Promise<CoreEpoch | null> {
  return (await tx.get<CoreEpoch>(paths.core(uid, "epoch")))?.data ?? null;
}

async function takeLease(ctx: RouteContext, connectorId: string): Promise<Lease> {
  const { uid, deps } = ctx;
  return deps.store.transaction(uid, async (tx) => {
    const epoch = await epochOf(tx, uid);
    if (epoch?.barrier) throw barrierError();
    const doc = await getConnector(tx, uid, connectorId);
    if (doc === null || doc.data.provider !== "plaid" || doc.data.bank === null) throw scopeError();
    const c = doc.data;
    const view = bankView(doc.id, c);
    if (!isActiveBank(c) || c.state === "expired" || c.bank!.token === null) return { kind: "answer", view };
    const now = deps.clock.read().opsClock.now;
    if (c.quota.leaseUntil !== null && msFromTs(c.quota.leaseUntil) > now) return { kind: "answer", view };
    const token = deps.hasher.id(["bank-lease", uid, connectorId, now, c.rev]);
    tx.update(doc.path, { ...c, quota: { ...c.quota, leaseUntil: tsFromMs(now + PULL_LEASE_MS), leaseToken: token }, updatedAt: tsFromMs(now) });
    return { kind: "leased", token, epoch: epoch?.epoch ?? 1, connector: c };
  });
}

/** Runs `work` on the connector only while this pull still holds its lease; otherwise returns null. */
async function withLease<T>(ctx: RouteContext, connectorId: string, token: string, work: (tx: Tx, doc: StoredDoc<Connector>) => Promise<T>): Promise<T | null> {
  const { uid, deps } = ctx;
  return deps.store.transaction(uid, async (tx) => {
    const doc = await getConnector(tx, uid, connectorId);
    if (doc === null || doc.data.quota.leaseToken !== token || doc.data.state === "disconnected") return null;
    return work(tx, doc);
  });
}

const released = (now: number): Connector["quota"] => ({ nextAllowedAt: tsFromMs(now), leaseUntil: null, leaseToken: null });

/** Drops this pull's lease, best effort; a lease that is not dropped lapses on its own. */
async function releaseLease(ctx: RouteContext, connectorId: string, token: string): Promise<void> {
  try {
    await withLease(ctx, connectorId, token, async (tx, doc) => {
      const now = ctx.deps.clock.read().opsClock.now;
      tx.update(doc.path, { ...doc.data, quota: released(now), updatedAt: tsFromMs(now) });
    });
  } catch {
    // The lease lapses after PULL_LEASE_MS.
  }
}

/** Needs-reconnect sets the connector `expired`; revoked sets it `disconnected` and erases the token. */
async function recordProblem(ctx: RouteContext, connectorId: string, token: string, error: BankCallError): Promise<BankView | null> {
  return withLease(ctx, connectorId, token, async (tx, doc) => {
    const now = ctx.deps.clock.read().opsClock.now;
    const c = doc.data;
    const bank = c.bank!;
    const next: Connector =
      error.problem === "needsReconnect"
        ? { ...c, state: "expired", lastError: "AUTH", bank: { ...bank, problem: "needsReconnect" } }
        : error.problem === "revoked"
          ? { ...c, state: "disconnected", lastError: "AUTH", cursor: null, bank: { ...bank, problem: "revoked", token: null } }
          : { ...c, lastError: "DEPENDENCY", bank: { ...bank, problem: "transient" } };
    const out = { ...next, quota: released(now), updatedAt: tsFromMs(now) };
    tx.update(doc.path, out);
    return bankView(doc.id, out);
  });
}

interface Pulled {
  final: Map<string, PlaidTransaction | null>;
  accounts: PlaidAccount[];
  cursor: string;
  status: UpdateStatus;
}

/** Step 2: every page from the stored cursor, restarting on a mutation during paging. Writes nothing. */
async function readAll(rt: BankRuntime, accessToken: string, from: string | null): Promise<Pulled> {
  for (let attempt = 1; ; attempt++) {
    const final = new Map<string, PlaidTransaction | null>();
    const accounts: PlaidAccount[] = [];
    let cursor = from;
    try {
      for (;;) {
        const page = await rt.port.sync(rt.config, accessToken, cursor);
        for (const t of [...page.added, ...page.modified]) final.set(t.transaction_id, t);
        for (const r of page.removed) final.set(r.transaction_id, null);
        accounts.push(...page.accounts);
        if (final.size > PULL_ROWS_MAX) throw new BankCallError(null, false);
        cursor = page.nextCursor;
        if (!page.hasMore) return { final, accounts, cursor: page.nextCursor, status: page.updateStatus };
      }
    } catch (error) {
      if (error instanceof BankCallError && error.code === MUTATION_DURING_PAGINATION && attempt < SYNC_TRIES) continue;
      throw error;
    }
  }
}

/** The latest stored revision of a logical row, and its version, or null. */
async function latestRevision(tx: Pick<Tx, "get">, uid: string, logicalId: string, ctx: RouteContext): Promise<{ eid: string; version: number; data: Evidence } | null> {
  let found: { eid: string; version: number; data: Evidence } | null = null;
  for (let v = 1; v <= MAX_REVISIONS; v++) {
    const eid = evidenceId(logicalId, v, ctx.deps.hasher);
    const doc = await tx.get<Evidence>(paths.evidence(uid, eid));
    if (doc === null) return found;
    found = { eid, version: v, data: doc.data };
  }
  return found;
}

/**
 * Step 3, one page of transactions inside one transaction. Writes only what differs from what is stored, so applying
 * the same pull again writes nothing.
 */
async function writeChunk(tx: Tx, ctx: RouteContext, rowCtx: BankRowContext, ids: string[], pulled: Pulled, willExist: ReadonlySet<string>): Promise<number> {
  const { uid, deps } = ctx;
  let writes = 0;
  for (const id of ids) {
    const t = pulled.final.get(id)!;
    const logicalId = bankLogicalId(deps.hasher, uid, rowCtx.connectorId, id);
    const latest = await latestRevision(tx, uid, logicalId, ctx);
    if (t === null) {
      // Removed: a new revision with `removed: true`, once. A row never stored stays unstored.
      if (latest === null || latest.data.observation.kind !== "bank" || latest.data.observation.removed) continue;
      const o = latest.data.observation;
      const content = { title: latest.data.title ?? "", categoryCode: storedCategoryCode(latest.data), occurredAt: latest.data.occurredAt, assertedAt: latest.data.assertedAt, observation: { ...o, removed: true } };
      const eid = evidenceId(logicalId, latest.version + 1, deps.hasher);
      await appendEvidenceRevision(tx, uid, latest.eid, bankEvidence(eid, logicalId, latest.eid, content, rowCtx), deps.hasher);
      writes++;
      continue;
    }
    // Pending to posted: the posted row names the pending row's first revision, when that row is (or will be) stored.
    let pendingOfId: string | null = null;
    if (t.pending_transaction_id !== null) {
      const pendingLogical = bankLogicalId(deps.hasher, uid, rowCtx.connectorId, t.pending_transaction_id);
      const first = evidenceId(pendingLogical, 1, deps.hasher);
      if (willExist.has(t.pending_transaction_id) || (await tx.get(paths.evidence(uid, first))) !== null) pendingOfId = first;
    }
    const content = bankRowContent(t, rowCtx, pendingOfId, false);
    if (typeof content === "string") continue;
    if (latest === null) {
      const eid = evidenceId(logicalId, 1, deps.hasher);
      tx.create(paths.evidence(uid, eid), bankEvidence(eid, logicalId, null, content, rowCtx));
      writes++;
    } else if (storedContentKey(latest.data) !== contentKey(content)) {
      const eid = evidenceId(logicalId, latest.version + 1, deps.hasher);
      await appendEvidenceRevision(tx, uid, latest.eid, bankEvidence(eid, logicalId, latest.eid, content, rowCtx), deps.hasher);
      writes++;
    }
  }
  return writes;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Merges a pull's accounts into the stored list: the sync answer leaves out accounts with no transactions. */
export function mergeAccounts(stored: NonNullable<Connector["bank"]>["accounts"], seen: readonly PlaidAccount[]): NonNullable<Connector["bank"]>["accounts"] {
  const out = [...stored];
  for (const a of seen) {
    const next = { accountId: clip(a.account_id, 128), name: clip(a.name, 128), mask: a.mask === null ? null : clip(a.mask, 8), type: clip(a.type, 32), subtype: a.subtype === null ? null : clip(a.subtype, 64) };
    const i = out.findIndex((x) => x.accountId === next.accountId);
    if (i >= 0) out[i] = next;
    else if (out.length < 32) out.push(next);
  }
  return out;
}

export function coverageAfter(status: UpdateStatus, connectedAt: string, now: number): Cov {
  const at = msFromTs(connectedAt);
  if (status === "HISTORICAL_UPDATE_COMPLETE") return { state: "complete", from: tsFromMs(at - HISTORY_DAYS * DAY), to: tsFromMs(now), missingRanges: [], generation: 0 };
  if (status === "INITIAL_UPDATE_COMPLETE") return { state: "partial", from: tsFromMs(at - INITIAL_DAYS * DAY), to: tsFromMs(now), missingRanges: [], generation: 0 };
  return UNKNOWN_COVERAGE;
}

/**
 * One pull of one connector. Answers the connector as it stands after the pull, or at once when another pull holds
 * the lease or the bank can't be read (expired, disconnected). A transient failure is recorded and answered
 * DEPENDENCY; needs-reconnect and revoked are recorded and answered with the changed connector.
 */
export async function pullBank(ctx: RouteContext, connectorId: string, rt: BankRuntime): Promise<BankView> {
  const { uid, deps } = ctx;
  const lease = await takeLease(ctx, connectorId);
  if (lease.kind === "answer") return lease.view;
  const { token, connector } = lease;
  const bank = connector.bank!;
  let accessToken: string;
  try {
    accessToken = openToken(rt.config.tokenKeys, uid, connectorId, bank.token!);
  } catch (error) {
    await releaseLease(ctx, connectorId, token);
    if (error instanceof SealError) throw new ConfigError(BANK_ENV_VARS.tokenKey);
    throw error;
  }

  let pulled: Pulled;
  try {
    const from = connector.cursor?.kind === "inline" ? connector.cursor.text : null;
    pulled = await readAll(rt, accessToken, from);
  } catch (error) {
    if (!(error instanceof BankCallError)) {
      await releaseLease(ctx, connectorId, token);
      throw error;
    }
    deps.log("bank.pullFailed", { problem: error.problem, ...(error.code === null ? {} : { code: error.code }) });
    const view = await recordProblem(ctx, connectorId, token, error);
    if (error.problem === "transient" || view === null) throw dependencyError(1000, "bank");
    return view;
  }

  try {
    const opsNow = deps.clock.read().opsClock.now;
    const rowCtx: BankRowContext = { uid, connectorId, generation: connector.activeGeneration, epoch: lease.epoch, policyRev: 1, opsNow, hasher: deps.hasher };
    const epochDoc = await deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch"));
    rowCtx.policyRev = epochDoc?.data.policyRev ?? 1;
    // Rows skipped are counted from the pull alone, so a pull that is applied again counts the same.
    const skipped: Record<SkipReason, number> = { noCurrency: 0, badAmount: 0, badDate: 0 };
    const willExist = new Set<string>();
    for (const [id, t] of pulled.final) {
      if (t === null) continue;
      const c = bankRowContent(t, rowCtx, null, false);
      if (typeof c === "string") skipped[c]++;
      else willExist.add(id);
    }
    const ids = [...pulled.final.keys()].sort();
    let writes = 0;
    for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
      const chunk = ids.slice(i, i + WRITE_CHUNK);
      const n = await deps.store.transaction(uid, async (tx) => {
        const epoch = await epochOf(tx, uid);
        if (epoch?.barrier || (epoch?.epoch ?? 1) !== lease.epoch) throw barrierError();
        const doc = await getConnector(tx, uid, connectorId);
        if (doc === null || doc.data.quota.leaseToken !== token || doc.data.state === "disconnected") return null;
        return writeChunk(tx, ctx, rowCtx, chunk, pulled, willExist);
      });
      if (n === null) return await currentView(ctx, connectorId);
      writes += n;
    }
    // Step 4: publish, only after every row is written.
    const view = await deps.store.transaction(uid, async (tx) => {
      const epoch = await epochOf(tx, uid);
      if (epoch?.barrier || (epoch?.epoch ?? 1) !== lease.epoch) throw barrierError();
      const doc = await getConnector(tx, uid, connectorId);
      if (doc === null || doc.data.quota.leaseToken !== token || doc.data.state === "disconnected") return null;
      const now = deps.clock.read().opsClock.now;
      const c = doc.data;
      const historical = pulled.status === "HISTORICAL_UPDATE_COMPLETE" || c.bank!.historicalComplete;
      const next: Connector = {
        ...c,
        state: historical ? "connected" : "syncing",
        cursor: { kind: "inline", text: pulled.cursor },
        coverage: coverageAfter(historical ? "HISTORICAL_UPDATE_COMPLETE" : pulled.status, c.bank!.connectedAt, now),
        nextPollAt: tsFromMs(now + STALE_AFTER_MS),
        quota: released(now),
        lastSuccessAt: tsFromMs(now),
        lastError: null,
        bank: { ...c.bank!, accounts: mergeAccounts(c.bank!.accounts, pulled.accounts), historicalComplete: historical, problem: null, lastPullSkipped: skipped },
        updatedAt: tsFromMs(now),
      };
      tx.update(doc.path, next);
      return bankView(doc.id, next);
    });
    deps.log("bank.pulled", { rows: pulled.final.size, writes });
    return view ?? (await currentView(ctx, connectorId));
  } catch (error) {
    await releaseLease(ctx, connectorId, token);
    throw error;
  }
}

async function currentView(ctx: RouteContext, connectorId: string): Promise<BankView> {
  const doc = await getConnector({ get: (p) => ctx.deps.store.get(ctx.uid, p) }, ctx.uid, connectorId);
  if (doc === null) throw scopeError();
  return bankView(doc.id, doc.data);
}

/** Ruling 7, for the money read (part C): pulls first when the last success is older than an hour by the ops clock. */
export async function pullIfStale(ctx: RouteContext, connectorId: string, rt: BankRuntime): Promise<BankView> {
  const doc = await getConnector({ get: (p) => ctx.deps.store.get(ctx.uid, p) }, ctx.uid, connectorId);
  if (doc === null) throw scopeError();
  const last = doc.data.lastSuccessAt;
  if (last !== null && ctx.deps.clock.read().opsClock.now - msFromTs(last) < STALE_AFTER_MS) return bankView(doc.id, doc.data);
  return pullBank(ctx, connectorId, rt);
}
