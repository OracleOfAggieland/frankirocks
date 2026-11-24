/**
 * The seed reset (brief 019 task 5; contracts §1 Clocks "Reset fences, clears all tenant rows (paged Q28,
 * subcollections too), reseeds before unblock; namespace salts synthetic IDs only"; §6 POST /api/seed/reset).
 * It clones the persona into the caller's own tenant, in this order:
 *
 *   1. Fence: `core/epoch.barrier` goes up (phase `fence`), so open answers blocked and state, turn, tool and
 *      receipt refuse with BARRIER; the epoch rises in the same transaction, as the forget fence's does (contracts
 *      §8 step 2), so every Stamp and every captured epoch from before the reset fails its check from here on
 *      (brief 038 finding 2); `core/state.fixtureNamespace` names the new namespace, so a crashed reset can be
 *      recognised as this tenant's own and taken over by the next one. policyRev is not raised.
 *   2. Close (phase `close`): every live Session moves to closing and its calls are hung up. A hangup that fails
 *      leaves the Session's hangup Job and fails the reset retryably; the barrier stays, so nothing can speak.
 *   3. Clear (phase `install`): every row but the core documents and this request's own ledger entry.
 *   4. Reseed: `loadSeed`, built in memory first.
 *   5. Unblock: one transaction writes the clone's five core documents, clears the barrier and records the answer.
 *
 * Two visits never see each other's rows: each is its own tenant, the store refuses any path outside it, and the
 * clear leaves nothing of an earlier visit in the same tenant.
 */
import { type CoreDocs, type ID, type Infer, type ResetRequest, type SeedResetResponse, type Session, msFromTs, tsFromMs } from "@franki/core";
import { BANK_ENV_VARS } from "../bank/config";
import { resetBankCursors } from "../bank/connector";
import { buildDemoConnectors, writeDemoConnectors } from "../demo/install";
import { readCoreDocs } from "../core-docs";
import { type RequestKey, completeRequest } from "../ledger/request";
import { barrierError, configError, dependencyError, staleError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";
import { sealKeysFrom } from "../sealed";
import { LIVE_STATUSES, beginCloseInTx } from "../sessions";
import { paths } from "../store/paths";
import type { StoredDoc } from "../store/port";
import { ensureHangupJob, hangupAll } from "../worker/hangup";
import { SeedLoadError } from "./build";
import { CLEAR_PAGE, clearTenant } from "./clear";
import { cloneWorldStart } from "./clock";
import { isRealAccount, liveAccountError, readLiveData } from "./live";
import { loadSeed, seedCoreDocs } from "./load";
import { pairedFixture } from "./pairing";

export type ResetReq = Infer<typeof ResetRequest>;
export type ResetRes = Infer<typeof SeedResetResponse>;

/** How long a reset's barrier holds before another reset of this tenant may take it over. */
export const RESET_BARRIER_MS = 60_000;
/** Time allowed for hanging up the open calls before the reset gives up and asks for a retry. */
export const RESET_HANGUP_BUDGET_MS = 3_000;

/** A reset makes a new namespace; a retry of the same request gets the same one. */
export const namespaceFor = (ctx: RouteContext, req: ResetReq): ID => ctx.deps.hasher.id(["seed-ns", ctx.uid, req.visitId, req.requestId]);
const opIdFor = (ctx: RouteContext, namespace: ID): ID => ctx.deps.hasher.id(["seed-reset", namespace]);


async function setPhase(ctx: RouteContext, opId: ID, phase: "close" | "install"): Promise<void> {
  const { uid, deps } = ctx;
  await deps.store.transaction(uid, async (tx) => {
    const doc = await tx.get<CoreDocs["epoch"]>(paths.core(uid, "epoch"));
    const barrier = doc?.data.barrier ?? null;
    if (doc === null || barrier === null || barrier.opId !== opId) throw staleError("barrier");
    tx.update(doc.path, { ...doc.data, barrier: { ...barrier, phase }, updatedAt: tsFromMs(deps.clock.read().opsClock.now) });
  });
}

/** Step 1: raises the barrier and the epoch. */
async function fence(ctx: RouteContext, namespace: ID, opId: ID): Promise<void> {
  const { uid, deps } = ctx;
  return deps.store.transaction(uid, async (tx) => {
    const core = await readCoreDocs(tx, uid);
    const ops = deps.clock.read().opsClock.now;
    const barrier = core.epoch.data.barrier;
    const priorNs = core.state.data.fixtureNamespace;
    const ownCrashed = barrier !== null && priorNs !== null && barrier.opId === opIdFor(ctx, priorNs);
    const sameRequest = barrier !== null && barrier.opId === opId;
    if (barrier !== null && !sameRequest) {
      // Another control operation (a forget) holds the tenant, or a reset of ours is still inside its deadline.
      if (!ownCrashed || msFromTs(barrier.deadline) > ops) throw barrierError();
    }
    // Who may reset (contracts §6 "seedrole/namespace", which no contract defines; brief 038 finding 1): a clone,
    // or an account with no data of its own. A real account is answered LIVE and loses nothing.
    if (barrier === null && isRealAccount(core.state.data, await readLiveData(tx, uid, core.rules.data))) throw liveAccountError();
    const now = tsFromMs(ops);
    tx.update(paths.core(uid, "epoch"), {
      ...core.epoch.data,
      // Brief 038 finding 2: the fence raises the epoch, so a writer of the old visit fails STALE during the reset.
      epoch: core.epoch.data.epoch + 1,
      barrier: { opId, phase: "fence", startedAt: now, deadline: tsFromMs(ops + RESET_BARRIER_MS), queuedOps: barrier?.queuedOps ?? [] },
      updatedAt: now,
    });
    tx.update(paths.core(uid, "state"), { ...core.state.data, fixtureNamespace: namespace, updatedAt: now });
  });
}

/** Step 2: closes every live Session and hangs up its calls. */
async function closeCalls(ctx: RouteContext): Promise<void> {
  const { uid, deps } = ctx;
  const live: StoredDoc<Session>[] = [];
  let after: string | null = null;
  for (;;) {
    const page: StoredDoc<Session>[] = await deps.store.query<Session>(uid, {
      collection: paths.collection(uid, "sessions"),
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: CLEAR_PAGE,
    });
    live.push(...page.filter((s) => LIVE_STATUSES.includes(s.data.status)));
    if (page.length < CLEAR_PAGE) break;
    after = page[page.length - 1]!.id;
  }
  for (const s of live) {
    const ops = deps.clock.read().opsClock.now;
    const begun = await deps.store.transaction(uid, (tx) => beginCloseInTx(tx, uid, s.id, ops));
    if (begun === null || begun.callIds.length === 0) continue;
    if (!(await hangupAll(begun.callIds, deps, RESET_HANGUP_BUDGET_MS))) {
      await deps.store.transaction(uid, async (tx) => {
        const doc = await tx.get<Session>(paths.session(uid, s.id));
        if (doc !== null) await ensureHangupJob(tx, uid, s.id, doc.data.rev, deps.clock.read().opsClock.now, deps.hasher);
      });
      throw dependencyError(1000, "hangup");
    }
  }
}

export async function resetVisit(ctx: RouteContext, req: ResetReq, key: RequestKey): Promise<ResetRes> {
  const { uid, deps } = ctx;
  // Brief 054 ruling 3: a demo fixture only for an anonymous tenant, and only a demo fixture for one (R5).
  const fixture = pairedFixture(ctx.anonymous, req.fixtureId);
  // A demo visit's connectors are sealed under the bank's key; a missing key answers CONFIG before anything is fenced.
  const demoKeys = fixture.demo === undefined ? null : sealKeysFrom(deps.env, BANK_ENV_VARS.tokenKey);
  const namespace = namespaceFor(ctx, req);
  const opId = opIdFor(ctx, namespace);

  // Brief 038 finding 3: the clone is laid out in the zone the browser sends now, never the one stored before.
  const zone = req.clientZone;
  await fence(ctx, namespace, opId);
  await setPhase(ctx, opId, "close");
  await closeCalls(ctx);
  await setPhase(ctx, opId, "install");
  await clearTenant(deps.store, uid, new Set([key.path]), opId);

  const ops = deps.clock.read().opsClock.now;
  const worldStart = cloneWorldStart(ops, zone);
  const prior = await deps.store.transaction(uid, async (tx) => readCoreDocs(tx, uid));
  let rows;
  try {
    rows = await loadSeed(deps, uid, { fixture, namespace, zone, worldStart, core: { epoch: prior.epoch.data.epoch, policyRev: prior.epoch.data.policyRev }, opId });
  } catch (error) {
    if (error instanceof SeedLoadError) {
      deps.log("seed.loadFailed", { check: error.check, line: error.lineId });
      throw configError(500, `seed:${error.check}`);
    }
    throw error;
  }

  // Brief 054 R11: a demo visit's bank, Gmail and Calendar, connected, with tokens for this visit's world and zone.
  const demoDocs =
    demoKeys === null
      ? null
      : buildDemoConnectors({ uid, hasher: deps.hasher, fixture, keys: demoKeys, worldStart, zone, opsNow: deps.clock.read().opsClock.now, core: { epoch: prior.epoch.data.epoch, policyRev: prior.epoch.data.policyRev } });

  const res: ResetRes = { fixtureNamespace: namespace, worldClock: tsFromMs(worldStart), sessionId: null };
  await deps.store.transaction(uid, async (tx) => {
    const core = await readCoreDocs(tx, uid);
    if (core.epoch.data.barrier?.opId !== opId) throw staleError("barrier");
    const docs = seedCoreDocs(uid, {
      rows,
      zone,
      worldStart,
      opsNow: deps.clock.read().opsClock.now,
      namespace,
      visitId: req.visitId,
      prior: { epoch: core.epoch.data, state: core.state.data, counters: core.counters.data, rules: core.rules.data, bundle: core.bundle.data },
    });
    for (const id of ["epoch", "state", "counters", "rules", "bundle"] as const) tx.update(paths.core(uid, id), { ...docs[id], updatedAt: tsFromMs(deps.clock.read().opsClock.now) });
    // Brief 046 ruling 9: a connected bank stays; its rows were cleared, so the next pull imports again. A demo visit's
    // three connectors are written again instead (contract question 102), in this same transaction (R11.8).
    if (demoDocs === null) await resetBankCursors(tx, uid, deps.clock.read().opsClock.now);
    else await writeDemoConnectors(tx, uid, demoDocs);
    await completeRequest(tx, key, res, deps.clock.read().opsClock.now);
  });
  deps.log("seed.reset", { rows: rows.groups.reduce((n, g) => n + g.writes.length, 0) });
  return res;
}
