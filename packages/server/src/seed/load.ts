/**
 * The one seed load (brief 019 task 4). It builds every row first (`buildSeed`: the extraction worker's planner,
 * exact spans, closed schemas, W-LINEAGE), so a packet that fails a check fails the load before anything is
 * written. Then it writes the rows through the Store_Port's ordinary `create`, which runs the same commit checks a
 * live turn or the extraction worker gets: schema, size, tenant and W-LINEAGE. There is no second write path.
 *
 * Rows are written a few lines per transaction (SEED_LINES_PER_TX), each line's Evidence before the Memories that
 * quote it. A store failure partway leaves part of a seed behind; the reset that called the load still holds its
 * barrier, so nothing reads it, and a retry clears it first.
 */
import { type ClockPair, type ClockPort, type CoreDocs, type Hasher, type ID, tsFromMs } from "@franki/core";
import { initialCoreDocs } from "../core-docs";
import type { StorePort } from "../store/port";
import { type SeedRows, buildSeed } from "./build";
import { localInstant } from "./clock";
import type { SeedFixture } from "./fixture";

/** Lines per write transaction: well under Firestore's 500 writes, and a few round trips for the whole persona. */
export const SEED_LINES_PER_TX = 20;

export interface LoadDeps {
  store: StorePort;
  hasher: Hasher;
  clock: ClockPort;
}

export interface LoadInput {
  fixture: SeedFixture;
  namespace: ID;
  zone: string;
  /** The clone's world clock at load (`cloneWorldStart`). */
  worldStart: number;
  /** The epoch and policyRev the rows are written under. */
  core: { epoch: number; policyRev: number };
}

/** Builds and writes the seed. Throws `SeedLoadError` (nothing written) or a store error. */
export async function loadSeed(deps: LoadDeps, uid: string, input: LoadInput): Promise<SeedRows> {
  const rows = await buildSeed(input.fixture, {
    uid,
    namespace: input.namespace,
    zone: input.zone,
    worldStart: input.worldStart,
    opsNow: deps.clock.read().opsClock.now,
    core: input.core,
    hasher: deps.hasher,
  });
  for (let i = 0; i < rows.groups.length; i += SEED_LINES_PER_TX) {
    const chunk = rows.groups.slice(i, i + SEED_LINES_PER_TX);
    await deps.store.transaction(uid, async (tx) => {
      for (const g of chunk) for (const w of g.writes) tx.create(w.path, w.record);
    });
  }
  return rows;
}

export interface SeedCoreInput {
  rows: SeedRows;
  zone: string;
  worldStart: number;
  opsNow: number;
  namespace: ID;
  visitId: ID;
  /** The documents before the reset, whose revisions only rise. */
  prior: CoreDocs;
}

/**
 * The five core documents of a fresh clone: fixture clock mode at the clone's Friday 08:40, the namespace and visit
 * ID stored (they persist across a reload), coverage over the hero window, rules and bundle empty. The epoch rises,
 * so work captured before the reset fails STALE; the rules and bundle revisions rise too, so no older Deck is taken
 * for newer. policyRev is kept: only a late control hit raises it (brief 014, S6).
 */
export function seedCoreDocs(uid: string, input: SeedCoreInput): CoreDocs {
  const pair: ClockPair = { worldClock: { now: input.worldStart, zone: input.zone }, opsClock: { now: input.opsNow } };
  const fresh = initialCoreDocs(uid, pair, input.zone);
  const { prior } = input;
  const epoch = prior.epoch.epoch + 1;
  const policyRev = prior.epoch.policyRev;
  const keep = <T extends { epoch: number; policyRev: number; createdAt: string }>(doc: T, was: { createdAt: string }): T => ({ ...doc, epoch, policyRev, createdAt: was.createdAt });
  const rulesRev = prior.rules.rulesRev + 1;
  return {
    epoch: keep({ ...fresh.epoch, barrier: null }, prior.epoch),
    state: keep(
      {
        ...fresh.state,
        clockMode: "fixture",
        worldClock: tsFromMs(input.worldStart),
        fixtureNamespace: input.namespace,
        visitId: input.visitId,
        coverage: {
          state: "complete",
          from: tsFromMs(localInstant(input.rows.window.from, 0, input.zone)),
          to: tsFromMs(input.worldStart),
          missingRanges: [],
          generation: prior.state.coverage.generation + 1,
        },
      },
      prior.state,
    ),
    counters: keep(fresh.counters, prior.counters),
    rules: keep({ ...fresh.rules, rulesRev }, prior.rules),
    bundle: keep({ ...fresh.bundle, rulesRev, bundleRev: prior.bundle.bundleRev + 1 }, prior.bundle),
  };
}
