/**
 * Core documents (R10.13; design "Core documents"). `ensureCoreDocs` runs at the start of every authenticated
 * route except the read-only debug route. One transaction: if `core/epoch` exists it writes nothing, otherwise it
 * creates all five documents. Two concurrent first requests leave exactly one set: the loser's commit sees
 * `core/epoch` appear (staleRevision), re-reads, and finds the set already there.
 */
import {
  type ClockPair,
  type ClockPort,
  type CoreDocs,
  type CoreState,
  civilDay,
  isZone,
  tsFromMs,
  withZone,
} from "@franki/core";
import { DAY_MS, cFields } from "./records";
import { StoreError, isStoreError } from "./store/errors";
import { paths } from "./store/paths";
import type { StorePort, Tx } from "./store/port";

export interface CoreDocsDeps {
  store: StorePort;
  clock: ClockPort;
}

/** The five documents with the design's initial values. */
export function initialCoreDocs(uid: string, pair: ClockPair, clientZone: string | null): CoreDocs {
  const ops = pair.opsClock.now;
  const now = tsFromMs(ops);
  const zone = clientZone !== null && isZone(clientZone) ? clientZone : "UTC";
  const c = cFields(uid, now, 1, 1);
  return {
    epoch: { ...c, barrier: null, activeSessionId: null, activeCallId: null, activeLeaseToken: null, leaseUntil: null },
    state: {
      ...c,
      audience: "private",
      audienceSessionId: null,
      currentZone: zone,
      homeZone: zone,
      holidayLocale: "US",
      memoryOn: true,
      isolatedInputProven: false,
      careSubjectIds: [],
      lastInteractionAt: null,
      modifiers: { rushed: null, crisis: null },
      clockMode: "live",
      worldClock: null,
      // Placeholder until nightly work exists (L).
      nextNightAt: tsFromMs(ops + DAY_MS),
      projectionDirty: false,
      coverage: { state: "unknown", from: null, to: null, missingRanges: [], generation: 0 },
      fixtureNamespace: null,
      visitId: null,
    },
    counters: {
      ...c,
      day: civilDay(pair.worldClock.now, zone).date,
      reservedMicros: 0,
      settledMicros: 0,
      optionalCeilingMicros: 0,
      heavy: 0,
      senderAsks: [],
      counts: [],
      connectorOffers: [],
      warmth: { sessionId: null, turnsWithoutReference: 0 },
    },
    rules: { ...c, rulesRev: 1, allergies: [], standing: [], rulePages: 0, gazetteerVersion: "none", noneConfirmed: [] },
    bundle: { ...c, state: "dirty", bundleRev: 0, rulesRev: 1, head: null, headHash: null, selectedRefs: [], compiledAt: null, expiresAt: null },
  };
}

/** Creates the core documents once. Returns true when this call created them. */
export async function ensureCoreDocs(uid: string, deps: CoreDocsDeps, clientZone: string | null = null): Promise<boolean> {
  // Fast path: the five documents are created together, so an existing core/epoch means they all exist. A plain
  // read costs one round trip; the transaction below costs two or three on every request.
  if ((await deps.store.get(uid, paths.core(uid, "epoch"))) !== null) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await deps.store.transaction(uid, async (tx) => {
        if ((await tx.get(paths.core(uid, "epoch"))) !== null) return false;
        const docs = initialCoreDocs(uid, deps.clock.read(), clientZone);
        for (const id of ["epoch", "state", "counters", "rules", "bundle"] as const) tx.create(paths.core(uid, id), docs[id]);
        return true;
      });
    } catch (error) {
      // Another first request won the race; the next attempt sees core/epoch and writes nothing.
      if (!isStoreError(error, "staleRevision")) throw error;
    }
  }
  throw new StoreError("staleRevision", "core documents still contended", paths.core(uid, "epoch"));
}

/** Reads all five core documents in a transaction. */
export async function readCoreDocs(tx: Pick<Tx, "get">, uid: string): Promise<{ [K in keyof CoreDocs]: { data: CoreDocs[K]; rev: number } }> {
  const read = async <K extends keyof CoreDocs>(id: K) => {
    const doc = await tx.get<CoreDocs[K]>(paths.core(uid, id));
    if (doc === null) throw new StoreError("invalidInput", "core documents are missing", paths.core(uid, id));
    return { data: doc.data, rev: (doc.data as { rev: number }).rev };
  };
  const [epoch, state, counters, rules, bundle] = await Promise.all([
    read("epoch"),
    read("state"),
    read("counters"),
    read("rules"),
    read("bundle"),
  ]);
  return { epoch, state, counters, rules, bundle };
}

/** Thrown when core/state is in fixture clock mode, which this slice does not support (R6.7). */
export class UnsupportedClockModeError extends Error {
  readonly code = "unsupported" as const;
  constructor() {
    super("unsupported: fixture clock mode is not available in this slice");
    this.name = "UnsupportedClockModeError";
  }
}

/** The ClockPair for an Owner: worldClock.zone is core/state.currentZone; fixture mode is rejected (R6.7). */
export function ownerClock(state: CoreState, clock: ClockPort): ClockPair {
  if (state.clockMode !== "live") throw new UnsupportedClockModeError();
  return withZone(clock.read(), state.currentZone);
}
